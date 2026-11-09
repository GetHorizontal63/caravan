/**
 * My Shelf: every user's private library. Only its owner can see it, add to it or remove from it; the owner
 * chooses, book by book, which other users may also read it. Administrators have no access to other shelves.
 * Files live in <data>/shelves/<user id>/ and are scanned like any library (formats, covers, versions…).
 */
import fs from 'node:fs'
import fsp from 'node:fs/promises'
import path from 'node:path'
import { pipeline } from 'node:stream/promises'
import type { FastifyInstance } from 'fastify'
import { db, now, tx } from '../db.ts'
import { requireUser } from '../auth.ts'
import { paths } from '../config.ts'
import { formatOf } from '../formats.ts'
import { deleteCover } from '../covers.ts'
import { bookAccess } from '../access.ts'
import { queueScan, scanLibrary, scanState } from '../scanner.ts'

export const shelfDir = (userId: number) => path.join(paths.shelves, String(userId))

/** The user's shelf library, created the first time it's needed. */
export function ensureShelf(userId: number): number {
  const row = db.prepare('SELECT id FROM libraries WHERE owner_id = ?').get(userId) as { id: number } | undefined
  if (row) return row.id
  const dir = shelfDir(userId)
  fs.mkdirSync(dir, { recursive: true })
  const r = db.prepare('INSERT INTO libraries(name, kind, paths, fetch_metadata, created_at, owner_id) VALUES (?,?,?,?,?,?)')
    .run('My Shelf', 'books', JSON.stringify([dir]), 1, now(), userId)
  return Number(r.lastInsertRowid)
}

/** Remove a user's shelf files from disk (the database rows go with the user). */
export async function deleteShelfFiles(userId: number) {
  await fsp.rm(shelfDir(userId), { recursive: true, force: true })
}

export default async function shelfRoutes(app: FastifyInstance) {
  app.addHook('preHandler', requireUser)

  app.get('/api/shelf', async req => {
    const uid = req.user!.id
    const libraryId = ensureShelf(uid)
    const mine = (db.prepare('SELECT COUNT(*) AS n FROM books WHERE library_id = ? AND missing = 0').get(libraryId) as { n: number }).n
    const shared = (db.prepare('SELECT COUNT(*) AS n FROM shelf_shares sh JOIN books b ON b.id = sh.book_id AND b.missing = 0 WHERE sh.user_id = ?').get(uid) as { n: number }).n
    return { libraryId, count: mine, sharedWithMe: shared }
  })

  /** Add books to your shelf. */
  app.post('/api/shelf/upload', async req => {
    const libraryId = ensureShelf(req.user!.id)
    const dir = shelfDir(req.user!.id)
    fs.mkdirSync(dir, { recursive: true })
    const saved: string[] = []
    const skipped: string[] = []
    for await (const part of req.files()) {
      const name = path.basename(part.filename).replace(/[<>:"|?*\x00-\x1f]/g, '_')
      if (!formatOf(name)) { skipped.push(name); part.file.resume(); continue }
      let target = path.join(dir, name)
      for (let i = 1; fs.existsSync(target); i++) target = path.join(dir, name.replace(/(\.[^.]+)$/, ` (${i})$1`))
      await pipeline(part.file, fs.createWriteStream(target))
      saved.push(path.basename(target))
    }
    if (saved.length) {
      if (scanState.running) queueScan(libraryId, 1000)
      else void scanLibrary(libraryId).catch(() => queueScan(libraryId))
    }
    return { saved, skipped }
  })

  /** Take a book off your shelf: its files are deleted. */
  app.delete<{ Params: { id: string } }>('/api/shelf/books/:id', async (req, reply) => {
    const id = Number(req.params.id)
    if (bookAccess(id, req.user!.id) !== 'owner') return reply.code(404).send({ error: 'Book not found on your shelf' })
    const files = db.prepare('SELECT path FROM book_files WHERE book_id = ?').all(id) as { path: string }[]
    const b = db.prepare('SELECT cover, spine FROM books WHERE id = ?').get(id) as { cover: string | null; spine: string | null }
    db.prepare('DELETE FROM books WHERE id = ?').run(id)
    const dir = shelfDir(req.user!.id)
    for (const f of files) if (path.resolve(f.path).startsWith(path.resolve(dir) + path.sep)) await fsp.rm(f.path, { force: true })
    await deleteCover(b.cover)
    await deleteCover(b.spine)
    return { ok: true }
  })

  /** People you can share with (everyone but you). */
  app.get('/api/shelf/people', async req =>
    db.prepare('SELECT id, username FROM users WHERE id != ? ORDER BY username COLLATE NOCASE').all(req.user!.id))

  /** Who can see one of your books. */
  app.get<{ Params: { id: string } }>('/api/shelf/books/:id/shares', async (req, reply) => {
    const id = Number(req.params.id)
    if (bookAccess(id, req.user!.id) !== 'owner') return reply.code(404).send({ error: 'Book not found on your shelf' })
    const userIds = (db.prepare('SELECT user_id FROM shelf_shares WHERE book_id = ?').all(id) as { user_id: number }[]).map(r => r.user_id)
    return { userIds }
  })

  /** Set exactly who can see one of your books (an empty list makes it private again). */
  app.put<{ Params: { id: string }; Body: { userIds?: number[] } }>('/api/shelf/books/:id/shares', async (req, reply) => {
    const id = Number(req.params.id)
    if (bookAccess(id, req.user!.id) !== 'owner') return reply.code(404).send({ error: 'Book not found on your shelf' })
    const wanted = [...new Set((req.body?.userIds ?? []).map(Number))].filter(u => u !== req.user!.id)
    const valid = new Set((db.prepare('SELECT id FROM users').all() as { id: number }[]).map(u => u.id))
    tx(() => {
      db.prepare('DELETE FROM shelf_shares WHERE book_id = ?').run(id)
      const ins = db.prepare('INSERT INTO shelf_shares(book_id, user_id, created_at) VALUES (?,?,?)')
      for (const u of wanted) if (valid.has(u)) ins.run(id, u, now())
    })
    const userIds = (db.prepare('SELECT user_id FROM shelf_shares WHERE book_id = ?').all(id) as { user_id: number }[]).map(r => r.user_id)
    return { userIds }
  })
}
