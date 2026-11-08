import fs from 'node:fs'
import fsp from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import { pipeline } from 'node:stream/promises'
import type { FastifyInstance } from 'fastify'
import { db, getSettings, now, saveSettings, tx, type ServerSettings } from '../db.ts'
import { hashPassword, requireAdmin, safeJson } from '../auth.ts'
import { detail, getBook, setAuthors, setTags, sortTitle, touchBook } from '../books.ts'
import { deleteCover, fetchCover, storeCover } from '../covers.ts'
import { scanLibrary, scanAll, scanState } from '../scanner.ts'
import { applyRemote, autoIdentify, metadataQueue, searchProviders, type RemoteBook } from '../metadata/index.ts'
import { normalizeIsbn, toIsbn10 } from '../metadata/isbn.ts'
import { formatOf, supportedExtensions } from '../formats.ts'

interface LibraryBody { name: string; kind?: string; paths: string[]; fetchMetadata?: boolean }

export default async function adminRoutes(app: FastifyInstance) {
  app.addHook('preHandler', requireAdmin)

  // ---- libraries -----------------------------------------------------------

  app.post<{ Body: LibraryBody }>('/api/libraries', async (req, reply) => {
    const { name, kind = 'books', paths = [], fetchMetadata = true } = req.body ?? ({} as LibraryBody)
    if (!name?.trim() || !paths.length) return reply.code(400).send({ error: 'A name and at least one folder are required' })
    for (const p of paths) if (!fs.existsSync(p)) return reply.code(400).send({ error: `Folder not found: ${p}` })
    const r = db.prepare('INSERT INTO libraries(name, kind, paths, fetch_metadata, created_at) VALUES (?,?,?,?,?)')
      .run(name.trim(), kind, JSON.stringify(paths), fetchMetadata ? 1 : 0, now())
    const id = Number(r.lastInsertRowid)
    void scanLibrary(id).catch(() => {})
    return { id }
  })

  app.put<{ Params: { id: string }; Body: LibraryBody }>('/api/libraries/:id', async (req, reply) => {
    const { name, kind, paths, fetchMetadata } = req.body ?? ({} as LibraryBody)
    for (const p of paths ?? []) if (!fs.existsSync(p)) return reply.code(400).send({ error: `Folder not found: ${p}` })
    db.prepare('UPDATE libraries SET name = COALESCE(?, name), kind = COALESCE(?, kind), paths = COALESCE(?, paths), fetch_metadata = COALESCE(?, fetch_metadata) WHERE id = ?')
      .run(name ?? null, kind ?? null, paths ? JSON.stringify(paths) : null, fetchMetadata === undefined ? null : fetchMetadata ? 1 : 0, Number(req.params.id))
    return { ok: true }
  })

  app.delete<{ Params: { id: string } }>('/api/libraries/:id', async req => {
    const covers = db.prepare('SELECT cover, spine FROM books WHERE library_id = ?').all(Number(req.params.id)) as { cover: string | null; spine: string | null }[]
    db.prepare('DELETE FROM libraries WHERE id = ?').run(Number(req.params.id))
    for (const c of covers) { await deleteCover(c.cover); await deleteCover(c.spine) }
    return { ok: true }
  })

  app.post<{ Params: { id: string } }>('/api/libraries/:id/scan', async (_req, reply) => {
    if (scanState.running) return reply.code(409).send({ error: 'A scan is already running' })
    void scanLibrary(Number(_req.params.id)).catch(() => {})
    return { ok: true }
  })

  app.post('/api/scan', async (_req, reply) => {
    if (scanState.running) return reply.code(409).send({ error: 'A scan is already running' })
    void scanAll()
    return { ok: true }
  })

  app.get('/api/scan/status', async () => ({ ...scanState, metadataPending: metadataQueue.pending }))

  /** Upload books straight into a library's first folder. */
  app.post<{ Params: { id: string } }>('/api/libraries/:id/upload', async (req, reply) => {
    const lib = db.prepare('SELECT paths FROM libraries WHERE id = ?').get(Number(req.params.id)) as { paths: string } | undefined
    const dir = lib && safeJson<string[]>(lib.paths, [])[0]
    if (!dir) return reply.code(404).send({ error: 'Library not found' })
    const saved: string[] = []
    for await (const part of req.files()) {
      const name = path.basename(part.filename).replace(/[<>:"|?*\x00-\x1f]/g, '_')
      if (!formatOf(name)) { part.file.resume(); continue }
      let target = path.join(dir, name)
      for (let i = 1; fs.existsSync(target); i++) target = path.join(dir, name.replace(/(\.[^.]+)$/, ` (${i})$1`))
      await pipeline(part.file, fs.createWriteStream(target))
      saved.push(path.basename(target))
    }
    if (saved.length && !scanState.running) void scanLibrary(Number(req.params.id)).catch(() => {})
    return { saved }
  })

  /** Folder picker for the library editor. */
  app.get<{ Querystring: { path?: string } }>('/api/fs/browse', async (req, reply) => {
    const p = req.query.path
    if (!p) {
      if (process.platform === 'win32') {
        const drives = 'CDEFGHIJKLMNOPQRSTUVWXYZ'.split('').map(l => `${l}:\\`).filter(d => fs.existsSync(d))
        return { path: '', parent: null, dirs: drives.map(d => ({ name: d, path: d })) }
      }
      const roots = ['/books', '/media', '/mnt', '/data', os.homedir(), '/'].filter((d, i, a) => fs.existsSync(d) && a.indexOf(d) === i)
      return { path: '', parent: null, dirs: roots.map(d => ({ name: d, path: d })) }
    }
    try {
      const entries = await fsp.readdir(p, { withFileTypes: true })
      const dirs = entries.filter(e => e.isDirectory() && !e.name.startsWith('.') && !e.name.startsWith('$'))
        .map(e => ({ name: e.name, path: path.join(p, e.name) })).sort((a, b) => a.name.localeCompare(b.name))
      const books = entries.filter(e => e.isFile() && formatOf(e.name)).length
      const parent = path.dirname(p) === p ? '' : path.dirname(p)
      return { path: p, parent, dirs, books }
    } catch (e) {
      return reply.code(400).send({ error: (e as Error).message })
    }
  })

  // ---- metadata editing ------------------------------------------------------

  interface EditBody {
    title?: string; subtitle?: string; authors?: string[]; description?: string; publisher?: string; published?: string
    language?: string; isbn?: string; pageCount?: number; series?: string; seriesIndex?: number; tags?: string[]; locked?: boolean
  }

  app.patch<{ Params: { id: string }; Body: EditBody }>('/api/books/:id', async (req, reply) => {
    const b = getBook(Number(req.params.id))
    if (!b) return reply.code(404).send({ error: 'Book not found' })
    const x = req.body ?? {}
    const str = (v: string | undefined, cur: string | null) => (v === undefined ? cur : v.trim() || null)
    const isbn13 = x.isbn === undefined ? b.isbn13 : normalizeIsbn(x.isbn) ?? null
    if (x.isbn && !isbn13) return reply.code(400).send({ error: 'That ISBN is not valid' })
    const title = x.title?.trim() || b.title
    tx(() => {
      db.prepare(`UPDATE books SET title=?, sort_title=?, subtitle=?, description=?, publisher=?, published=?, language=?, isbn13=?, isbn10=?,
        page_count=?, series=?, series_index=?, metadata_locked=?, metadata_source='manual', updated_at=? WHERE id=?`).run(
        title, sortTitle(title), str(x.subtitle, b.subtitle), str(x.description, b.description), str(x.publisher, b.publisher),
        str(x.published, b.published), str(x.language, b.language), isbn13, isbn13 ? toIsbn10(isbn13) ?? null : null,
        x.pageCount === undefined ? b.page_count : x.pageCount || null, str(x.series, b.series),
        x.seriesIndex === undefined ? b.series_index : x.seriesIndex ?? null,
        x.locked === undefined ? b.metadata_locked : x.locked ? 1 : 0, now(), b.id)
      if (x.authors) setAuthors(b.id, x.authors)
      if (x.tags) setTags(b.id, x.tags)
    })
    return detail(getBook(b.id)!, req.user!.id)
  })

  app.delete<{ Params: { id: string } }>('/api/books/:id', async req => {
    const b = getBook(Number(req.params.id))
    if (b) {
      db.prepare('DELETE FROM books WHERE id = ?').run(b.id)
      await deleteCover(b.cover)
      await deleteCover(b.spine)
    }
    return { ok: true }
  })

  app.get<{ Querystring: { isbn?: string; title?: string; author?: string } }>('/api/metadata/search', async req =>
    searchProviders({ isbn: req.query.isbn, title: req.query.title, author: req.query.author }))

  app.post<{ Params: { id: string }; Body: { candidate: RemoteBook; replaceCover?: boolean } }>('/api/books/:id/identify', async (req, reply) => {
    if (!req.body?.candidate) return reply.code(400).send({ error: 'candidate is required' })
    const b = await applyRemote(Number(req.params.id), req.body.candidate, { mode: 'replace', replaceCover: req.body.replaceCover ?? true })
    return detail(b!, req.user!.id)
  })

  app.post<{ Params: { id: string } }>('/api/books/:id/refresh', async (req, reply) => {
    const id = Number(req.params.id)
    const found = await autoIdentify(id)
    const b = getBook(id)
    if (!b) return reply.code(404).send({ error: 'Book not found' })
    return { found, book: detail(b, req.user!.id) }
  })

  /** Replace the cover from an uploaded image or a URL. */
  app.post<{ Params: { id: string }; Body: { url?: string } }>('/api/books/:id/cover', async (req, reply) => {
    const b = getBook(Number(req.params.id))
    if (!b) return reply.code(404).send({ error: 'Book not found' })
    let data: Buffer | undefined
    let source = 'upload'
    if (req.isMultipart()) {
      const file = await req.file()
      data = file ? await file.toBuffer() : undefined
    } else if (req.body?.url) {
      data = await fetchCover(req.body.url)
      source = 'url'
    }
    if (!data) return reply.code(400).send({ error: 'No usable image' })
    const name = await storeCover(b.id, data)
    if (!name) return reply.code(400).send({ error: 'That image could not be read' })
    await deleteCover(b.cover)
    db.prepare('UPDATE books SET cover = ?, cover_source = ? WHERE id = ?').run(name, source, b.id)
    touchBook(b.id)
    return detail(getBook(b.id)!, req.user!.id)
  })

  // ---- users -------------------------------------------------------------------

  app.get('/api/users', async () =>
    db.prepare(`SELECT u.id, u.username, u.is_admin AS isAdmin, u.created_at AS createdAt, (SELECT MAX(last_seen) FROM sessions s WHERE s.user_id = u.id) AS lastSeen
      FROM users u ORDER BY u.username`).all())

  app.post<{ Body: { username: string; password: string; isAdmin?: boolean } }>('/api/users', async (req, reply) => {
    const { username, password, isAdmin } = req.body ?? ({} as any)
    if (!username?.trim() || (password ?? '').length < 4) return reply.code(400).send({ error: 'Username and a password of at least 4 characters are required' })
    try {
      const r = db.prepare('INSERT INTO users(username, password_hash, is_admin, created_at) VALUES (?,?,?,?)').run(username.trim(), hashPassword(password), isAdmin ? 1 : 0, now())
      return { id: Number(r.lastInsertRowid) }
    } catch {
      return reply.code(409).send({ error: 'That username is taken' })
    }
  })

  app.patch<{ Params: { id: string }; Body: { password?: string; isAdmin?: boolean } }>('/api/users/:id', async (req, reply) => {
    const id = Number(req.params.id)
    if (req.body?.password) db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(hashPassword(req.body.password), id)
    if (typeof req.body?.isAdmin === 'boolean') {
      if (!req.body.isAdmin && id === req.user!.id) return reply.code(400).send({ error: 'You cannot remove your own administrator access' })
      db.prepare('UPDATE users SET is_admin = ? WHERE id = ?').run(req.body.isAdmin ? 1 : 0, id)
    }
    return { ok: true }
  })

  app.delete<{ Params: { id: string } }>('/api/users/:id', async (req, reply) => {
    if (Number(req.params.id) === req.user!.id) return reply.code(400).send({ error: 'You cannot delete yourself' })
    db.prepare('DELETE FROM users WHERE id = ?').run(Number(req.params.id))
    return { ok: true }
  })

  // ---- server settings ---------------------------------------------------------

  app.get('/api/settings', async () => ({ ...getSettings(), supportedExtensions: supportedExtensions() }))

  app.put<{ Body: Partial<ServerSettings> }>('/api/settings', async req => {
    saveSettings(req.body ?? {})
    return getSettings()
  })

  app.get('/api/stats', async () => db.prepare(`SELECT
      (SELECT COUNT(*) FROM books WHERE missing = 0) AS books,
      (SELECT COUNT(*) FROM authors) AS authors,
      (SELECT COUNT(DISTINCT series) FROM books WHERE series IS NOT NULL) AS series,
      (SELECT COUNT(*) FROM books WHERE cover IS NULL AND missing = 0) AS withoutCover,
      (SELECT COUNT(*) FROM books WHERE metadata_source = 'file' AND missing = 0) AS unmatched,
      (SELECT COUNT(*) FROM books WHERE missing = 1) AS missing,
      (SELECT COALESCE(SUM(size), 0) FROM books WHERE missing = 0) AS bytes`).get())

  /** Queue every unmatched / coverless book for a provider lookup. */
  app.post('/api/metadata/refresh-all', async () => {
    const ids = (db.prepare(`SELECT id FROM books WHERE missing = 0 AND metadata_locked = 0 AND (metadata_source = 'file' OR cover IS NULL)`).all() as { id: number }[]).map(r => r.id)
    metadataQueue.push(...ids)
    return { queued: ids.length }
  })
}
