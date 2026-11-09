import fs from 'node:fs'
import path from 'node:path'
import type { FastifyInstance, FastifyReply } from 'fastify'
import { db, now } from '../db.ts'
import { requireUser, safeJson } from '../auth.ts'
import { BOOK_SELECT, detail, fileOf, getBook, summarize, type BookRow } from '../books.ts'
import { coverPath } from '../covers.ts'
import { formatOf } from '../formats.ts'
import { readableFile } from '../convert.ts'
import { define, DictionaryError } from '../dictionary.ts'
import { canSeeBook, VISIBLE_BOOK } from '../access.ts'

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
  // never anything from someone else's shelf unless it was shared with this user
  const where = ['b.missing = 0', VISIBLE_BOOK]
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
  if (q.shared === '1') { where.push('EXISTS (SELECT 1 FROM shelf_shares sh2 WHERE sh2.book_id = b.id AND sh2.user_id = :user)') }
  if (q.collection) { where.push('EXISTS (SELECT 1 FROM collection_books cb WHERE cb.book_id = b.id AND cb.collection_id = :collection)'); params.collection = Number(q.collection) }
  switch (q.status) {
    case 'unread': where.push('(ub.fraction IS NULL OR ub.fraction = 0) AND COALESCE(ub.finished, 0) = 0'); break
    case 'reading': where.push('ub.fraction > 0 AND COALESCE(ub.finished, 0) = 0'); break
    case 'finished': where.push('ub.finished = 1'); break
    case 'favorite': where.push('ub.favorite = 1'); break
  }
  let order = q.sort === 'collection' && q.collection
    ? '(SELECT cb.position FROM collection_books cb WHERE cb.book_id = b.id AND cb.collection_id = :collection)'
    : SORTS[q.sort ?? 'title'] ?? SORTS.title
  // bookshelf: every series together (series A-Z, in reading order), then everything else in the chosen order
  if (q.group === 'series') order = `b.series IS NULL, b.series COLLATE NOCASE, b.series_index IS NULL, b.series_index, ${order}`
  const limit = Math.min(Number(q.limit) || 60, 500)
  const offset = Number(q.offset) || 0
  const base = BOOK_SELECT + ` WHERE ${where.join(' AND ')}`
  const total = (db.prepare(`SELECT COUNT(*) AS n FROM (${base})`).get(params) as { n: number }).n
  const rows = db.prepare(`${base} ORDER BY ${order} LIMIT ${limit} OFFSET ${offset}`).all(params) as unknown as (BookRow & { authors: string })[]
  return { total, items: rows.map(summarize) }
}

/** The book, if it exists and this user may see it (another user's shelf answers "not found", not "forbidden"). */
function requireBook(id: string, reply: FastifyReply, userId: number): BookRow | undefined {
  const b = getBook(Number(id))
  if (!b || !canSeeBook(b.id, userId)) { reply.code(404).send({ error: 'Book not found' }); return undefined }
  return b
}

const contentDisposition = (name: string) => `attachment; filename="${name.replace(/[^\x20-\x7e]/g, '_').replace(/"/g, '')}"; filename*=UTF-8''${encodeURIComponent(name)}`

export default async function bookRoutes(app: FastifyInstance) {
  app.addHook('preHandler', requireUser)

  app.get('/api/libraries', async req => {
    const libs = db.prepare(`SELECT l.*, (SELECT COUNT(*) FROM books b WHERE b.library_id = l.id AND b.missing = 0) AS count FROM libraries l WHERE l.owner_id IS NULL ORDER BY l.name`).all() as any[]
    return libs.map(l => ({ id: l.id, name: l.name, kind: l.kind, paths: req.user!.is_admin ? safeJson(l.paths, []) : undefined, fetchMetadata: !!l.fetch_metadata, count: l.count, lastScan: l.last_scan }))
  })

  app.get<{ Querystring: Q }>('/api/books', async req => queryBooks(req.user!.id, req.query))

  app.get('/api/home', async req => {
    const uid = req.user!.id
    const continueReading = queryBooks(uid, { status: 'reading', sort: 'recent', limit: '20' }).items
    const recentlyAdded = queryBooks(uid, { sort: 'added', limit: '24' }).items
    const libs = db.prepare('SELECT id, name, kind FROM libraries WHERE owner_id IS NULL ORDER BY name').all() as { id: number; name: string; kind: string }[]
    const favorites = queryBooks(uid, { status: 'favorite', sort: 'recent', limit: '20' }).items
    return {
      continueReading,
      recentlyAdded,
      favorites,
      libraries: libs.map(l => ({ ...l, books: queryBooks(uid, { library: String(l.id), sort: 'added', limit: '16' }).items })),
    }
  })

  app.get('/api/authors', async req =>
    db.prepare(`SELECT a.id, a.name, COUNT(*) AS count FROM authors a JOIN book_authors ba ON ba.author_id = a.id JOIN books b ON b.id = ba.book_id AND b.missing = 0
      WHERE ${VISIBLE_BOOK} GROUP BY a.id ORDER BY a.sort_name`).all({ user: req.user!.id }))

  app.get<{ Querystring: { library?: string } }>('/api/series', async req => {
    const lib = req.query.library ? Number(req.query.library) : null
    return db.prepare(`SELECT series AS name, COUNT(*) AS count, MIN(id) AS firstBook,
        (SELECT id FROM books b2 WHERE b2.series = b.series AND b2.cover IS NOT NULL AND b2.missing = 0 AND b2.library_id = b.library_id ORDER BY b2.series_index LIMIT 1) AS coverBook,
        (SELECT cover FROM books b2 WHERE b2.series = b.series AND b2.cover IS NOT NULL AND b2.missing = 0 AND b2.library_id = b.library_id ORDER BY b2.series_index LIMIT 1) AS coverFile
      FROM books b WHERE series IS NOT NULL AND missing = 0 AND (:lib IS NULL OR library_id = :lib) AND ${VISIBLE_BOOK}
      GROUP BY series ORDER BY series COLLATE NOCASE`).all({ lib, user: req.user!.id })
  })

  app.get('/api/tags', async req =>
    db.prepare(`SELECT t.name, COUNT(*) AS count FROM tags t JOIN book_tags bt ON bt.tag_id = t.id JOIN books b ON b.id = bt.book_id
      WHERE ${VISIBLE_BOOK} GROUP BY t.id ORDER BY count DESC LIMIT 200`).all({ user: req.user!.id }))

  app.get<{ Params: { id: string } }>('/api/books/:id', async (req, reply) => {
    const b = requireBook(req.params.id, reply, req.user!.id)
    return b && detail(b, req.user!.id)
  })

  app.get<{ Params: { id: string } }>('/api/books/:id/cover', async (req, reply) => {
    const b = requireBook(req.params.id, reply, req.user!.id)
    if (!b) return
    if (!b.cover) return reply.code(404).send({ error: 'No cover' })
    reply.header('Cache-Control', 'private, max-age=31536000, immutable').type('image/jpeg')
    return reply.send(fs.createReadStream(coverPath(b.cover)))
  })

  app.get<{ Params: { id: string } }>('/api/books/:id/spine', async (req, reply) => {
    const b = requireBook(req.params.id, reply, req.user!.id)
    if (!b) return
    if (!b.spine) return reply.code(404).send({ error: 'No spine image' })
    reply.header('Cache-Control', 'private, max-age=31536000, immutable').type('image/jpeg')
    return reply.send(fs.createReadStream(coverPath(b.spine)))
  })

  /** Original file, as a download. `?file=` picks a version (default: the primary one). */
  app.get<{ Params: { id: string }; Querystring: { file?: string } }>('/api/books/:id/file', async (req, reply) => {
    const b = requireBook(req.params.id, reply, req.user!.id)
    if (!b) return
    const f = fileOf(b, req.query.file)
    const info = formatOf(f.path)
    reply.header('Content-Disposition', contentDisposition(path.basename(f.path)))
      .header('Content-Length', fs.statSync(f.path).size)
      .type(info?.mime ?? 'application/octet-stream')
    return reply.send(fs.createReadStream(f.path))
  })

  /** File in a format the in-browser reader can open (converted and cached when needed). `?file=` picks a version. */
  app.get<{ Params: { id: string }; Querystring: { file?: string } }>('/api/books/:id/content', async (req, reply) => {
    const b = requireBook(req.params.id, reply, req.user!.id)
    if (!b) return
    // no version asked for: resume the one this reader last used
    const last = db.prepare('SELECT file_id FROM user_books WHERE user_id = ? AND book_id = ?').get(req.user!.id, b.id) as { file_id: number | null } | undefined
    const f = fileOf(b, req.query.file || last?.file_id)
    const info = formatOf(f.path)
    if (!info) return reply.code(415).send({ error: 'Unsupported format' })
    const { file, format } = await readableFile(b, info, f)
    const out = formatOf('x.' + format) ?? info
    reply.header('X-Book-Format', format)
      .header('X-Book-File', String(f.id))
      .header('Access-Control-Expose-Headers', 'X-Book-Format, X-Book-File')
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

  /**
   * Reading position. `at` is when it was recorded on the device: a position saved offline and sent later only
   * replaces the stored one if it's newer (another device may have moved on in the meantime).
   */
  app.put<{ Params: { id: string }; Body: { locator?: string; fraction?: number; fileId?: number; at?: number } }>('/api/books/:id/progress', async (req, reply) => {
    const b = requireBook(req.params.id, reply, req.user!.id)
    if (!b) return
    const at = Number(req.body?.at)
    const when = Number.isFinite(at) && at > 0 ? Math.min(at, now()) : now()
    const cur = db.prepare('SELECT last_read FROM user_books WHERE user_id = ? AND book_id = ?').get(req.user!.id, b.id) as { last_read: number | null } | undefined
    if (cur?.last_read && cur.last_read > when) return { ok: true, stale: true }
    const fraction = Math.max(0, Math.min(1, Number(req.body?.fraction) || 0))
    const patch: Record<string, unknown> = { locator: req.body?.locator ?? null, fraction, last_read: when, file_id: fileOf(b, req.body?.fileId).id || null }
    if (fraction >= 0.995) patch.finished = 1
    upsertUserBook(req.user!.id, b.id, patch)
    return { ok: true }
  })

  app.post<{ Params: { id: string }; Body: { finished?: boolean; favorite?: boolean } }>('/api/books/:id/state', async (req, reply) => {
    const b = requireBook(req.params.id, reply, req.user!.id)
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

  // ---- dictionary ------------------------------------------------------------

  /** Merriam-Webster definition, pronunciation and part of speech for a selected word. */
  app.get<{ Querystring: { word?: string } }>('/api/define', async (req, reply) => {
    try {
      return await define(req.query.word ?? '')
    } catch (e) {
      if (e instanceof DictionaryError) return reply.code(e.status).send({ error: e.message })
      throw e
    }
  })

  // ---- annotations (highlights + bookmarks) --------------------------------

  /**
   * Annotations as seen from one version (`?file=`, default primary). Those made in another version come with
   * the locator found for this one (`annotation_anchors`), or locator null: `unanchored` says a search already
   * failed, otherwise the reader should look for the text and report back via PUT /anchor.
   */
  app.get<{ Params: { id: string }; Querystring: { file?: string } }>('/api/books/:id/annotations', async (req, reply) => {
    const b = requireBook(req.params.id, reply, req.user!.id)
    if (!b) return
    const f = fileOf(b, req.query.file)
    const rows = db.prepare(`SELECT a.id, a.kind, a.locator, a.text, a.note, a.color, a.chapter, a.created_at AS createdAt, a.fraction, a.file_id AS fileId,
        bf.format AS originFormat, an.locator AS anchor, an.file_id IS NOT NULL AS tried
      FROM annotations a
      LEFT JOIN book_files bf ON bf.id = a.file_id
      LEFT JOIN annotation_anchors an ON an.annotation_id = a.id AND an.file_id = :file
      WHERE a.user_id = :user AND a.book_id = :book ORDER BY a.created_at`).all({ file: f.id, user: req.user!.id, book: b.id }) as any[]
    return rows.map(({ anchor, tried, ...a }) => {
      const native = a.fileId === f.id || a.fileId == null
      return { ...a, locator: native ? a.locator : anchor ?? null, native, unanchored: !native && !anchor && !!tried }
    })
  })

  app.post<{ Params: { id: string }; Body: { kind?: string; locator: string; text?: string; note?: string; color?: string; chapter?: string; fraction?: number; fileId?: number; createdAt?: number } }>('/api/books/:id/annotations', async (req, reply) => {
    const b = requireBook(req.params.id, reply, req.user!.id)
    if (!b) return
    const { kind = 'highlight', locator, text, note, color, chapter, fraction, fileId, createdAt } = req.body ?? ({} as any)
    // made offline and synced later: keep when it was really made
    const made = typeof createdAt === 'number' && createdAt > 0 && createdAt <= now() ? createdAt : now()
    if (!locator) return reply.code(400).send({ error: 'locator is required' })
    const r = db.prepare('INSERT INTO annotations(user_id, book_id, kind, locator, text, note, color, chapter, fraction, file_id, created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)')
      .run(req.user!.id, b.id, kind === 'bookmark' ? 'bookmark' : 'highlight', locator, text?.slice(0, 5000) ?? null, note?.slice(0, 5000) ?? null, color ?? null, chapter ?? null,
        typeof fraction === 'number' && Number.isFinite(fraction) ? Math.max(0, Math.min(1, fraction)) : null, fileOf(b, fileId).id || null, made)
    return { id: Number(r.lastInsertRowid) }
  })

  /** Where an annotation from another version lands in this one (locator null: the text wasn't found). */
  app.put<{ Params: { aid: string }; Body: { fileId: number; locator: string | null } }>('/api/annotations/:aid/anchor', async (req, reply) => {
    const a = db.prepare('SELECT book_id FROM annotations WHERE id = ? AND user_id = ?').get(Number(req.params.aid), req.user!.id) as { book_id: number } | undefined
    const f = a && db.prepare('SELECT id FROM book_files WHERE id = ? AND book_id = ?').get(Number(req.body?.fileId), a.book_id)
    if (!f) return reply.code(404).send({ error: 'Not found' })
    db.prepare(`INSERT INTO annotation_anchors(annotation_id, file_id, locator) VALUES (?, ?, ?)
      ON CONFLICT(annotation_id, file_id) DO UPDATE SET locator = excluded.locator`).run(Number(req.params.aid), Number(req.body.fileId), req.body.locator || null)
    return { ok: true }
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
