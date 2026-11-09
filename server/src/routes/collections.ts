import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'
import { db, now } from '../db.ts'
import { requireUser } from '../auth.ts'
import { canSeeBook, libraryVisible } from '../access.ts'

/**
 * Collections: hand-curated groups of books inside a library (like Jellyfin collections).
 * Visible to every user; editable by whoever created them and by administrators.
 */

interface CollectionRow {
  id: number
  library_id: number
  name: string
  description: string | null
  created_by: number | null
  created_at: number
  updated_at: number
}

const summary = (c: CollectionRow) => {
  const count = (db.prepare('SELECT COUNT(*) AS n FROM collection_books cb JOIN books b ON b.id = cb.book_id AND b.missing = 0 WHERE cb.collection_id = ?').get(c.id) as { n: number }).n
  // up to four covers for the card collage, in collection order
  const covers = (db.prepare(`SELECT b.id, b.cover FROM collection_books cb JOIN books b ON b.id = cb.book_id
      WHERE cb.collection_id = ? AND b.missing = 0 AND b.cover IS NOT NULL ORDER BY cb.position LIMIT 4`).all(c.id) as { id: number; cover: string }[])
    .map(b => ({ id: b.id, coverVersion: b.cover.replace(/\.jpg$/, '') }))
  return {
    id: c.id,
    libraryId: c.library_id,
    name: c.name,
    description: c.description,
    createdBy: c.created_by,
    count,
    covers,
    updatedAt: c.updated_at,
  }
}

function load(id: string | number, reply: FastifyReply, userId: number): CollectionRow | undefined {
  const c = db.prepare('SELECT * FROM collections WHERE id = ?').get(Number(id)) as CollectionRow | undefined
  // collections on someone else's shelf don't exist as far as this user is concerned
  if (!c || !libraryVisible(c.library_id, userId)) { reply.code(404).send({ error: 'Collection not found' }); return undefined }
  return c
}

function canEdit(req: FastifyRequest, c: CollectionRow, reply: FastifyReply) {
  if (req.user!.is_admin || c.created_by === req.user!.id) return true
  reply.code(403).send({ error: 'Only the person who created this collection (or an administrator) can change it' })
  return false
}

const touch = (id: number) => db.prepare('UPDATE collections SET updated_at = ? WHERE id = ?').run(now(), id)

export default async function collectionRoutes(app: FastifyInstance) {
  app.addHook('preHandler', requireUser)

  app.get<{ Params: { id: string } }>('/api/libraries/:id/collections', async (req, reply) => {
    if (!libraryVisible(Number(req.params.id), req.user!.id)) return reply.code(404).send({ error: 'Library not found' })
    const rows = db.prepare('SELECT * FROM collections WHERE library_id = ? ORDER BY name COLLATE NOCASE').all(Number(req.params.id)) as unknown as CollectionRow[]
    return rows.map(summary)
  })

  app.post<{ Params: { id: string }; Body: { name?: string; description?: string; bookIds?: number[] } }>('/api/libraries/:id/collections', async (req, reply) => {
    if (!libraryVisible(Number(req.params.id), req.user!.id)) return reply.code(404).send({ error: 'Library not found' })
    const name = req.body?.name?.trim()
    if (!name) return reply.code(400).send({ error: 'Give the collection a name' })
    const r = db.prepare('INSERT INTO collections(library_id, name, description, created_by, created_at, updated_at) VALUES (?,?,?,?,?,?)')
      .run(Number(req.params.id), name.slice(0, 120), req.body?.description?.trim().slice(0, 2000) || null, req.user!.id, now(), now())
    const id = Number(r.lastInsertRowid)
    if (req.body?.bookIds?.length) addBooks(id, req.body.bookIds)
    return summary(db.prepare('SELECT * FROM collections WHERE id = ?').get(id) as unknown as CollectionRow)
  })

  app.get<{ Params: { id: string } }>('/api/collections/:id', async (req, reply) => {
    const c = load(req.params.id, reply, req.user!.id)
    if (!c) return
    const lib = db.prepare('SELECT name FROM libraries WHERE id = ?').get(c.library_id) as { name: string } | undefined
    const owner = c.created_by ? (db.prepare('SELECT username FROM users WHERE id = ?').get(c.created_by) as { username: string } | undefined) : undefined
    return { ...summary(c), libraryName: lib?.name, createdByName: owner?.username ?? null, canEdit: !!req.user!.is_admin || c.created_by === req.user!.id }
  })

  app.patch<{ Params: { id: string }; Body: { name?: string; description?: string } }>('/api/collections/:id', async (req, reply) => {
    const c = load(req.params.id, reply, req.user!.id)
    if (!c || !canEdit(req, c, reply)) return
    const name = req.body?.name === undefined ? c.name : req.body.name.trim()
    if (!name) return reply.code(400).send({ error: 'Give the collection a name' })
    const description = req.body?.description === undefined ? c.description : req.body.description.trim() || null
    db.prepare('UPDATE collections SET name = ?, description = ?, updated_at = ? WHERE id = ?').run(name.slice(0, 120), description, now(), c.id)
    return summary(db.prepare('SELECT * FROM collections WHERE id = ?').get(c.id) as unknown as CollectionRow)
  })

  app.delete<{ Params: { id: string } }>('/api/collections/:id', async (req, reply) => {
    const c = load(req.params.id, reply, req.user!.id)
    if (!c || !canEdit(req, c, reply)) return
    db.prepare('DELETE FROM collections WHERE id = ?').run(c.id)
    return { ok: true }
  })

  function addBooks(collectionId: number, bookIds: number[]) {
    const max = (db.prepare('SELECT COALESCE(MAX(position), 0) AS p FROM collection_books WHERE collection_id = ?').get(collectionId) as { p: number }).p
    const lib = (db.prepare('SELECT library_id FROM collections WHERE id = ?').get(collectionId) as { library_id: number }).library_id
    const ins = db.prepare(`INSERT OR IGNORE INTO collection_books(collection_id, book_id, position, added_at)
      SELECT ?, id, ?, ? FROM books WHERE id = ? AND library_id = ?`)
    let added = 0
    bookIds.forEach((bid, i) => { added += Number(ins.run(collectionId, max + i + 1, now(), Number(bid), lib).changes) })
    touch(collectionId)
    return added
  }

  app.post<{ Params: { id: string }; Body: { bookIds: number[] } }>('/api/collections/:id/books', async (req, reply) => {
    const c = load(req.params.id, reply, req.user!.id)
    if (!c || !canEdit(req, c, reply)) return
    const added = addBooks(c.id, req.body?.bookIds ?? [])
    return { added }
  })

  app.delete<{ Params: { id: string; bookId: string } }>('/api/collections/:id/books/:bookId', async (req, reply) => {
    const c = load(req.params.id, reply, req.user!.id)
    if (!c || !canEdit(req, c, reply)) return
    db.prepare('DELETE FROM collection_books WHERE collection_id = ? AND book_id = ?').run(c.id, Number(req.params.bookId))
    touch(c.id)
    return { ok: true }
  })

  /** Move a book to a new place in the collection's order (index is 0-based). */
  app.post<{ Params: { id: string }; Body: { bookId: number; index: number } }>('/api/collections/:id/move', async (req, reply) => {
    const c = load(req.params.id, reply, req.user!.id)
    if (!c || !canEdit(req, c, reply)) return
    const ids = (db.prepare('SELECT book_id FROM collection_books WHERE collection_id = ? ORDER BY position').all(c.id) as { book_id: number }[]).map(r => r.book_id)
    const from = ids.indexOf(Number(req.body?.bookId))
    if (from < 0) return reply.code(404).send({ error: 'That book is not in this collection' })
    ids.splice(from, 1)
    ids.splice(Math.max(0, Math.min(ids.length, Number(req.body.index) || 0)), 0, Number(req.body.bookId))
    const upd = db.prepare('UPDATE collection_books SET position = ? WHERE collection_id = ? AND book_id = ?')
    ids.forEach((bid, i) => upd.run(i + 1, c.id, bid))
    touch(c.id)
    return { ok: true }
  })

  /** Collections in this book's library, flagged with whether the book is in each (for the "Add to collection" dialog). */
  app.get<{ Params: { id: string } }>('/api/books/:id/collections', async (req, reply) => {
    const book = db.prepare('SELECT library_id FROM books WHERE id = ?').get(Number(req.params.id)) as { library_id: number } | undefined
    if (!book || !canSeeBook(Number(req.params.id), req.user!.id)) return reply.code(404).send({ error: 'Book not found' })
    // a book shared from someone's shelf: their collections are theirs
    if (!libraryVisible(book.library_id, req.user!.id)) return []
    const rows = db.prepare(`SELECT c.*, EXISTS (SELECT 1 FROM collection_books cb WHERE cb.collection_id = c.id AND cb.book_id = ?) AS has
      FROM collections c WHERE c.library_id = ? ORDER BY c.name COLLATE NOCASE`).all(Number(req.params.id), book.library_id) as unknown as (CollectionRow & { has: number })[]
    return rows.map(r => ({ ...summary(r), contains: !!r.has, canEdit: !!req.user!.is_admin || r.created_by === req.user!.id }))
  })
}
