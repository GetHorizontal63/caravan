/**
 * Who may see which books.
 *
 * Shared libraries (owner_id NULL) are visible to every signed-in user. A personal shelf is a library with an
 * owner: its books are visible to the owner, and each book also to the people the owner shared it with.
 * Being an administrator grants nothing here: admin tools cover the shared libraries, not other people's shelves.
 */
import { db } from './db.ts'

/** SQL condition: books row `b` is visible to `:user`. */
export const VISIBLE_BOOK = `(b.library_id IN (SELECT id FROM libraries WHERE owner_id IS NULL OR owner_id = :user)
  OR EXISTS (SELECT 1 FROM shelf_shares sh WHERE sh.book_id = b.id AND sh.user_id = :user))`

/** SQL: ids of the shared (non-shelf) libraries. */
export const SHARED_LIBRARIES = `(SELECT id FROM libraries WHERE owner_id IS NULL)`

export type Access = 'none' | 'library' | 'owner' | 'shared'

export function bookAccess(bookId: number, userId: number): Access {
  const row = db.prepare('SELECT l.owner_id AS owner FROM books b JOIN libraries l ON l.id = b.library_id WHERE b.id = ?').get(bookId) as { owner: number | null } | undefined
  if (!row) return 'none'
  if (row.owner === null) return 'library'
  if (row.owner === userId) return 'owner'
  return db.prepare('SELECT 1 FROM shelf_shares WHERE book_id = ? AND user_id = ?').get(bookId, userId) ? 'shared' : 'none'
}

export const canSeeBook = (bookId: number, userId: number) => bookAccess(bookId, userId) !== 'none'

/** May change the book (metadata, cover, series…): books in shared libraries (admin routes check the role), or your own shelf. */
export const canManageBook = (bookId: number, userId: number) => {
  const a = bookAccess(bookId, userId)
  return a === 'library' || a === 'owner'
}

export function libraryOwner(libraryId: number): number | null | undefined {
  const row = db.prepare('SELECT owner_id FROM libraries WHERE id = ?').get(libraryId) as { owner_id: number | null } | undefined
  return row ? row.owner_id : undefined
}

/** A shared library, or the user's own shelf. */
export const libraryVisible = (libraryId: number, userId: number) => {
  const o = libraryOwner(libraryId)
  return o === null || o === userId
}

/** A shared (non-shelf) library. */
export const isSharedLibrary = (libraryId: number) => libraryOwner(libraryId) === null
