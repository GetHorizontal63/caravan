import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'
import { db, getSettings } from '../db.ts'
import { verifyPassword, userFromToken, tokenFrom, type User } from '../auth.ts'
import { getBook, authorsOf, filesOf } from '../books.ts'
import { coverPath } from '../covers.ts'
import { formatOf } from '../formats.ts'
import { queryBooks } from './books.ts'
import { canSeeBook, VISIBLE_BOOK } from '../access.ts'

/**
 * OPDS 1.2 catalog (Atom) for e-ink devices and third-party reader apps.
 * Auth: HTTP Basic with a Caravan account (or ?api_key=).
 */

const cache = new Map<string, { user: User; until: number }>()

async function opdsAuth(req: FastifyRequest, reply: FastifyReply) {
  const tokenUser = userFromToken(tokenFrom(req))
  if (tokenUser) { req.user = tokenUser; return }
  const h = req.headers.authorization
  if (h?.startsWith('Basic ')) {
    const key = crypto.createHash('sha256').update(h).digest('hex')
    const hit = cache.get(key)
    if (hit && hit.until > Date.now()) { req.user = hit.user; return }
    const [username, ...rest] = Buffer.from(h.slice(6), 'base64').toString('utf8').split(':')
    const row = db.prepare('SELECT id, username, is_admin, prefs, password_hash FROM users WHERE username = ?').get(username) as (User & { password_hash: string }) | undefined
    if (row && verifyPassword(rest.join(':'), row.password_hash)) {
      cache.set(key, { user: row, until: Date.now() + 10 * 60_000 })
      req.user = row
      return
    }
  }
  reply.code(401).header('WWW-Authenticate', 'Basic realm="Caravan"').send('Authentication required')
}

const x = (s: unknown) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
const NAV = 'application/atom+xml;profile=opds-catalog;kind=navigation'
const ACQ = 'application/atom+xml;profile=opds-catalog;kind=acquisition'

function feed(id: string, title: string, self: string, body: string, extraLinks = '') {
  return `<?xml version="1.0" encoding="UTF-8"?>
<feed xmlns="http://www.w3.org/2005/Atom" xmlns:dc="http://purl.org/dc/terms/" xmlns:opds="http://opds-spec.org/2010/catalog" xmlns:opensearch="http://a9.com/-/spec/opensearch/1.1/">
  <id>${x(id)}</id>
  <title>${x(title)}</title>
  <updated>${new Date().toISOString()}</updated>
  <author><name>${x(getSettings().serverName)}</name></author>
  <link rel="self" href="${x(self)}" type="${ACQ}"/>
  <link rel="start" href="/opds" type="${NAV}"/>
  <link rel="search" href="/opds/opensearch.xml" type="application/opensearchdescription+xml"/>
  ${extraLinks}
${body}
</feed>`
}

const navEntry = (id: string, title: string, href: string, content = '') => `  <entry>
    <title>${x(title)}</title><id>${x(id)}</id><updated>${new Date().toISOString()}</updated>
    <content type="text">${x(content)}</content>
    <link rel="subsection" href="${x(href)}" type="${ACQ}"/>
  </entry>`

function bookEntry(id: number) {
  const b = getBook(id)!
  const info = formatOf(b.path)
  const authors = authorsOf(b.id)
  return `  <entry>
    <title>${x(b.title)}</title>
    <id>urn:caravan:book:${b.id}</id>
    <updated>${new Date(b.updated_at).toISOString()}</updated>
    ${authors.map(a => `<author><name>${x(a.name)}</name></author>`).join('')}
    ${b.language ? `<dc:language>${x(b.language)}</dc:language>` : ''}
    ${b.published ? `<dc:issued>${x(b.published)}</dc:issued>` : ''}
    ${b.publisher ? `<dc:publisher>${x(b.publisher)}</dc:publisher>` : ''}
    ${b.isbn13 ? `<dc:identifier>urn:isbn:${b.isbn13}</dc:identifier>` : ''}
    ${b.description ? `<summary type="text">${x(b.description.slice(0, 2000))}</summary>` : ''}
    ${b.cover ? `<link rel="http://opds-spec.org/image" href="/opds/books/${b.id}/cover" type="image/jpeg"/>
    <link rel="http://opds-spec.org/image/thumbnail" href="/opds/books/${b.id}/cover" type="image/jpeg"/>` : ''}
    ${filesOf(b).map(f => `<link rel="http://opds-spec.org/acquisition" href="/opds/books/${b.id}/file/${encodeURIComponent(path.basename(f.path))}" type="${x(formatOf(f.path)?.mime ?? 'application/octet-stream')}" title="${x(formatOf(f.path)?.label ?? f.format)}"/>`).join('\n    ') ||
      `<link rel="http://opds-spec.org/acquisition" href="/opds/books/${b.id}/file/${encodeURIComponent(path.basename(b.path))}" type="${x(info?.mime ?? 'application/octet-stream')}"/>`}
  </entry>`
}

export default async function opdsRoutes(app: FastifyInstance) {
  app.addHook('preHandler', opdsAuth)
  app.addHook('onSend', async (req, reply, payload) => {
    if (!reply.getHeader('content-type')) reply.type(req.url.includes('opensearch') ? 'application/opensearchdescription+xml' : 'application/atom+xml; charset=utf-8')
    return payload
  })

  app.get('/opds', async (_req, reply) => {
    const libs = db.prepare('SELECT id, name FROM libraries WHERE owner_id IS NULL ORDER BY name').all() as { id: number; name: string }[]
    const body = [
      navEntry('jr:reading', 'Continue reading', '/opds/books?status=reading&sort=recent', 'Books you have started'),
      navEntry('jr:recent', 'Recently added', '/opds/books?sort=added'),
      navEntry('jr:all', 'All books', '/opds/books?sort=title'),
      navEntry('jr:authors', 'Authors', '/opds/authors'),
      ...libs.map(l => navEntry(`jr:lib:${l.id}`, l.name, `/opds/books?library=${l.id}&sort=title`)),
    ].join('\n')
    reply.type(`${NAV}; charset=utf-8`)
    return feed('jr:root', getSettings().serverName, '/opds', body)
  })

  app.get('/opds/opensearch.xml', async () => `<?xml version="1.0" encoding="UTF-8"?>
<OpenSearchDescription xmlns="http://a9.com/-/spec/opensearch/1.1/">
  <ShortName>${x(getSettings().serverName)}</ShortName>
  <Description>Search books</Description>
  <Url type="${ACQ}" template="/opds/books?q={searchTerms}"/>
</OpenSearchDescription>`)

  app.get('/opds/authors', async (req, reply) => {
    const rows = db.prepare(`SELECT a.id, a.name, COUNT(*) AS n FROM authors a JOIN book_authors ba ON ba.author_id = a.id JOIN books b ON b.id = ba.book_id
      WHERE ${VISIBLE_BOOK} GROUP BY a.id ORDER BY a.sort_name`).all({ user: req.user!.id }) as { id: number; name: string; n: number }[]
    reply.type(`${NAV}; charset=utf-8`)
    return feed('jr:authors', 'Authors', '/opds/authors', rows.map(r => navEntry(`jr:author:${r.id}`, r.name, `/opds/books?author=${r.id}&sort=series`, `${r.n} book(s)`)).join('\n'))
  })

  app.get<{ Querystring: Record<string, string> }>('/opds/books', async req => {
    const page = Math.max(0, Number(req.query.page) || 0)
    const per = 50
    const { total, items } = queryBooks(req.user!.id, { ...req.query, limit: String(per), offset: String(page * per) })
    const qs = (p: number) => '/opds/books?' + new URLSearchParams({ ...req.query, page: String(p) }).toString()
    const links = [
      `<opensearch:totalResults>${total}</opensearch:totalResults>`,
      (page + 1) * per < total ? `<link rel="next" href="${x(qs(page + 1))}" type="${ACQ}"/>` : '',
      page > 0 ? `<link rel="previous" href="${x(qs(page - 1))}" type="${ACQ}"/>` : '',
    ].join('\n  ')
    return feed(`jr:books:${req.url}`, req.query.q ? `Search: ${req.query.q}` : 'Books', req.url, items.map(b => bookEntry(b.id)).join('\n'), links)
  })

  app.get<{ Params: { id: string } }>('/opds/books/:id/cover', async (req, reply) => {
    const b = getBook(Number(req.params.id))
    if (!b?.cover || !canSeeBook(b.id, req.user!.id)) return reply.code(404).send('')
    return reply.type('image/jpeg').send(fs.createReadStream(coverPath(b.cover)))
  })

  app.get<{ Params: { id: string; '*': string } }>('/opds/books/:id/file/*', async (req, reply) => {
    const b = getBook(Number(req.params.id))
    if (!b || !canSeeBook(b.id, req.user!.id)) return reply.code(404).send('')
    // the file name in the URL says which version
    const name = decodeURIComponent(req.params['*'] ?? '')
    const file = filesOf(b).find(f => path.basename(f.path) === name)?.path ?? b.path
    return reply.type(formatOf(file)?.mime ?? 'application/octet-stream')
      .header('Content-Length', fs.statSync(file).size)
      .header('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(path.basename(file))}`)
      .send(fs.createReadStream(file))
  })
}
