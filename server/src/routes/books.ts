import fs from 'node:fs'
import path from 'node:path'
import type { FastifyInstance, FastifyReply } from 'fastify'
import { db, now } from '../db.ts'
import { requireUser, safeJson } from '../auth.ts'
import { BOOK_SELECT, detail, getBook, summarize, type BookRow } from '../books.ts'
import { coverPath } from '../covers.ts'
import { formatOf } from '../formats.ts'
import { readableFile } from '../convert.ts'

type Q = Record<string, string | undefined>

const SORTS: Record<string, string> = {
  title: 'b.sort_title COLLATE NOCASE ASC',
  author: `(SELECT min(a.sort_name) FROM book_authors ba JOIN authors a ON a.id = ba.author_id WHERE ba.book_id = b.id) ASC, b.series, b.series_index, b.sort_title`,
  added: 'b.added_at DESC',
  recent: 'ub.last_read IS NULL, ub.last_read DESC',
  series: 'b.series IS NULL, b.series COLLATE NOCASE, b.series_index, b.sort_title',
  published: 'b.published IS NULL, b.published DESC',
}

/** Shared filter builder for the grid, search and OPDS. */
export function queryBooks(userId: number, q: Q) {
  const where = ['b.missing = 0']
  const params: Record<string, string | number> = { user: userId }
  if (q.library) { where.push('b.library_id = :library'); params.library = Number(q.library) }
  if (q.q?.trim()) {
    const term = q.q.trim()
    params.q = `%${term.replace(/[%_]/g, m => '\\' + m)}%`
    params.qraw = term.replace(/[^0-9X]/gi, '')
    where.push(`(b.title LIKE :q ESCAPE '\\' OR b.subtitle LIKE :q ESCAPE '\\' OR b.series LIKE :q ESCAPE '\\' OR b.isbn13 = :qraw OR b.isbn10 = :qraw
      OR EXISTS (SELECT 1 FROM book_authors ba JOIN authors a ON a.id = ba.author_id WHERE ba.book_id = b.id AND a.name LIKE :q ESCAPE '\\')
      OR EXISTS (SELECT 1 FROM book_tags bt JOIN tags t ON t.id = bt.tag_id WHERE bt.book_id = b.id AND t.name LIKE :q ESCAPE '\\'))`)
  }
  if (q.author) { where.push('EXISTS (SELECT 1 FROM book_authors ba WHERE ba.book_id = b.id AND ba.author_id = :author)'); params.author = Number(q.author) }
  if (q.series) { where.push('b.series = :series'); params.series = q.series }
  if (q.tag) { where.push('EXISTS (SELECT 1 FROM book_tags bt JOIN tags t ON t.id = bt.tag_id WHERE bt.book_id = b.id AND t.name = :tag)'); params.tag = q.tag }
  if (q.format) { where.push('b.format = :format'); params.format = q.format }
  if (q.collection) { where.push('EXISTS (SELECT 1 FROM collection_books cb WHERE cb.book_id = b.id AND cb.collection_id = :collection)'); params.collection = Number(q.collection) }
  switch (q.status) {
    case 'unread': where.push('(ub.fraction IS NULL OR ub.fraction = 0) AND COALESCE(ub.finished, 0) = 0'); break
    case 'reading': where.push('ub.fraction > 0 AND COALESCE(ub.finished, 0) = 0'); break
    case 'finished': where.push('ub.finished = 1'); break
    case 'favorite': where.push('ub.favorite = 1'); break
  }
  const order = q.sort === 'collection' && q.collection
    ? '(SELECT cb.position FROM collection_books cb WHERE cb.book_id = b.id AND cb.collection_id = :collection)'
    : SORTS[q.sort ?? 'title'] ?? SORTS.title
  const limit = Math.min(Number(q.limit) || 60, 500)
  const offset = Number(q.offset) || 0
  const base = BOOK_SELECT + ` WHERE ${where.join(' AND ')}`
  const total = (db.prepare(`SELECT COUNT(*) AS n FROM (${base})`).get(params) as { n: number }).n
  const rows = db.prepare(`${base} ORDER BY ${order} LIMIT ${limit} OFFSET ${offset}`).all(params) as unknown as (BookRow & { authors: string })[]
  return { total, items: rows.map(summarize) }
}

function requireBook(id: string, reply: FastifyReply): BookRow | undefined {
  const b = getBook(Number(id))
  if (!b) reply.code(404).send({ error: 'Book not found' })
  return b
}

const contentDisposition = (name: string) => `attachment; filename="${name.replace(/[^\x20-\x7e]/g, '_').replace(/"/g, '')}"; filename*=UTF-8''${encodeURIComponent(name)}`

export default async function bookRoutes(app: FastifyInstance) {
  app.addHook('preHandler', requireUser)

  app.get('/api/libraries', async req => {
    const libs = db.prepare(`SELECT l.*, (SELECT COUNT(*) FROM books b WHERE b.library_id = l.id AND b.missing = 0) AS count FROM libraries l ORDER BY l.name`).all() as any[]
    return libs.map(l => ({ id: l.id, name: l.name, kind: l.kind, paths: req.user!.is_admin ? safeJson(l.paths, []) : undefined, fetchMetadata: !!l.fetch_metadata, count: l.count, lastScan: l.last_scan }))
  })

  app.get<{ Querystring: Q }>('/api/books', async req => queryBooks(req.user!.id, req.query))

  app.get('/api/home', async req => {
    const uid = req.user!.id
    const continueReading = queryBooks(uid, { status: 'reading', sort: 'recent', limit: '20' }).items
    const recentlyAdded = queryBooks(uid, { sort: 'added', limit: '24' }).items
    const libs = db.prepare('SELECT id, name, kind FROM libraries ORDER BY name').all() as { id: number; name: string; kind: string }[]
    const favorites = queryBooks(uid, { status: 'favorite', sort: 'recent', limit: '20' }).items
    return {
      continueReading,
      recentlyAdded,
      favorites,
      libraries: libs.map(l => ({ ...l, books: queryBooks(uid, { library: String(l.id), sort: 'added', limit: '16' }).items })),
    }
  })

  app.get('/api/authors', async () =>
    db.prepare(`SELECT a.id, a.name, COUNT(*) AS count FROM authors a JOIN book_authors ba ON ba.author_id = a.id JOIN books b ON b.id = ba.book_id AND b.missing = 0
      GROUP BY a.id ORDER BY a.sort_name`).all())

  app.get<{ Querystring: { library?: string } }>('/api/series', async req => {
    const lib = req.query.library ? Number(req.query.library) : null
    return db.prepare(`SELECT series AS name, COUNT(*) AS count, MIN(id) AS firstBook,
        (SELECT id FROM books b2 WHERE b2.series = b.series AND b2.cover IS NOT NULL AND b2.missing = 0 ORDER BY b2.series_index LIMIT 1) AS coverBook,
        (SELECT cover FROM books b2 WHERE b2.series = b.series AND b2.cover IS NOT NULL AND b2.missing = 0 ORDER BY b2.series_index LIMIT 1) AS coverFile
      FROM books b WHERE series IS NOT NULL AND missing = 0 AND (:lib IS NULL OR library_id = :lib)
      GROUP BY series ORDER BY series COLLATE NOCASE`).all({ lib })
  })

  app.get('/api/tags', async () =>
    db.prepare('SELECT t.name, COUNT(*) AS count FROM tags t JOIN book_tags bt ON bt.tag_id = t.id GROUP BY t.id ORDER BY count DESC LIMIT 200').all())

  app.get<{ Params: { id: string } }>('/api/books/:id', async (req, reply) => {
    const b = requireBook(req.params.id, reply)
    return b && detail(b, req.user!.id)
  })

  app.get<{ Params: { id: string } }>('/api/books/:id/cover', async (req, reply) => {
    const b = requireBook(req.params.id, reply)
    if (!b) return
    if (!b.cover) return reply.code(404).send({ error: 'No cover' })
    reply.header('Cache-Control', 'private, max-age=31536000, immutable').type('image/jpeg')
    return reply.send(fs.createReadStream(coverPath(b.cover)))
  })

  /** Original file, as a download. */
  app.get<{ Params: { id: string } }>('/api/books/:id/file', async (req, reply) => {
    const b = requireBook(req.params.id, reply)
    if (!b) return
    const info = formatOf(b.path)
    reply.header('Content-Disposition', contentDisposition(path.basename(b.path)))
      .header('Content-Length', fs.statSync(b.path).size)
      .type(info?.mime ?? 'application/octet-stream')
    return reply.send(fs.createReadStream(b.path))
  })

  /** File in a format the in-browser reader can open (converted and cached when needed). */
  app.get<{ Params: { id: string } }>('/api/books/:id/content', async (req, reply) => {
    const b = requireBook(req.params.id, reply)
    if (!b) return
    const info = formatOf(b.path)
    if (!info) return reply.code(415).send({ error: 'Unsupported format' })
    const { file, format } = await readableFile(b, info)
    const out = formatOf('x.' + format) ?? info
    reply.header('X-Book-Format', format)
      .header('Access-Control-Expose-Headers', 'X-Book-Format')
      .header('Content-Length', fs.statSync(file).size)
      .header('Cache-Control', 'private, max-age=3600')
      .type(out.mime)
    return reply.send(fs.createReadStream(file))
  })

  // ---- per-user state ------------------------------------------------------

  const upsertUserBook = (uid: number, bookId: number, patch: Record<string, unknown>) => {
    db.prepare('INSERT OR IGNORE INTO user_books(user_id, book_id) VALUES (?, ?)').run(uid, bookId)
    const keys = Object.keys(patch)
    if (keys.length) db.prepare(`UPDATE user_books SET ${keys.map(k => `${k} = :${k}`).join(', ')} WHERE user_id = :uid AND book_id = :bid`)
      .run({ ...patch, uid, bid: bookId } as any)
  }

  app.put<{ Params: { id: string }; Body: { locator?: string; fraction?: number } }>('/api/books/:id/progress', async (req, reply) => {
    const b = requireBook(req.params.id, reply)
    if (!b) return
    const fraction = Math.max(0, Math.min(1, Number(req.body?.fraction) || 0))
    const patch: Record<string, unknown> = { locator: req.body?.locator ?? null, fraction, last_read: now() }
    if (fraction >= 0.995) patch.finished = 1
    upsertUserBook(req.user!.id, b.id, patch)
    return { ok: true }
  })

  app.post<{ Params: { id: string }; Body: { finished?: boolean; favorite?: boolean } }>('/api/books/:id/state', async (req, reply) => {
    const b = requireBook(req.params.id, reply)
    if (!b) return
    const patch: Record<string, unknown> = {}
    if (typeof req.body?.finished === 'boolean') {
      patch.finished = req.body.finished ? 1 : 0
      if (!req.body.finished) { patch.fraction = 0; patch.locator = null }
    }
    if (typeof req.body?.favorite === 'boolean') patch.favorite = req.body.favorite ? 1 : 0
    upsertUserBook(req.user!.id, b.id, patch)
    return detail(b, req.user!.id)
  })

  // ---- annotations (highlights + bookmarks) --------------------------------

  app.get<{ Params: { id: string } }>('/api/books/:id/annotations', async req =>
    db.prepare('SELECT id, kind, locator, text, note, color, chapter, created_at AS createdAt FROM annotations WHERE user_id = ? AND book_id = ? ORDER BY created_at').all(req.user!.id, Number(req.params.id)))

  app.post<{ Params: { id: string }; Body: { kind?: string; locator: string; text?: string; note?: string; color?: string; chapter?: string } }>('/api/books/:id/annotations', async (req, reply) => {
    const b = requireBook(req.params.id, reply)
    if (!b) return
    const { kind = 'highlight', locator, text, note, color, chapter } = req.body ?? ({} as any)
    if (!locator) return reply.code(400).send({ error: 'locator is required' })
    const r = db.prepare('INSERT INTO annotations(user_id, book_id, kind, locator, text, note, color, chapter, created_at) VALUES (?,?,?,?,?,?,?,?,?)')
      .run(req.user!.id, b.id, kind === 'bookmark' ? 'bookmark' : 'highlight', locator, text?.slice(0, 5000) ?? null, note?.slice(0, 5000) ?? null, color ?? null, chapter ?? null, now())
    return { id: Number(r.lastInsertRowid) }
  })

  app.patch<{ Params: { aid: string }; Body: { note?: string; color?: string } }>('/api/annotations/:aid', async req => {
    db.prepare('UPDATE annotations SET note = COALESCE(?, note), color = COALESCE(?, color) WHERE id = ? AND user_id = ?')
      .run(req.body?.note ?? null, req.body?.color ?? null, Number(req.params.aid), req.user!.id)
    return { ok: true }
  })

  app.delete<{ Params: { aid: string } }>('/api/annotations/:aid', async req => {
    db.prepare('DELETE FROM annotations WHERE id = ? AND user_id = ?').run(Number(req.params.aid), req.user!.id)
    return { ok: true }
  })
}
