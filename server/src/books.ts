import { db, now } from './db.ts'
import { safeJson } from './auth.ts'
import { formatOf } from './formats.ts'

export interface BookRow {
  id: number
  library_id: number
  path: string
  format: string
  size: number
  mtime: number
  title: string
  sort_title: string
  subtitle: string | null
  description: string | null
  publisher: string | null
  published: string | null
  language: string | null
  isbn13: string | null
  isbn10: string | null
  page_count: number | null
  series: string | null
  series_index: number | null
  cover: string | null
  cover_source: string | null
  provider_ids: string
  metadata_source: string
  metadata_locked: number
  metadata_checked: number | null
  missing: number
  added_at: number
  updated_at: number
}

const ARTICLES = /^(the|a|an|der|die|das|le|la|les|el|los|las|il)\s+/i
export const sortTitle = (t: string) => t.replace(ARTICLES, '').replace(/^[^\p{L}\p{N}]+/u, '').toLowerCase()

/** "Ursula K. Le Guin" → "Le Guin, Ursula K." (simple heuristic; keeps existing "Last, First") */
export function sortName(name: string): string {
  if (name.includes(',')) return name.toLowerCase()
  const parts = name.trim().split(/\s+/)
  if (parts.length < 2) return name.toLowerCase()
  const particles = new Set(['le', 'la', 'de', 'du', 'van', 'von', 'der', 'da', 'di', 'del'])
  let i = parts.length - 1
  while (i > 1 && particles.has(parts[i - 1].toLowerCase())) i--
  const suffix = /^(jr\.?|sr\.?|ii|iii|iv)$/i.test(parts[parts.length - 1]) ? parts.length - 1 : -1
  if (suffix > 0) i = Math.min(i, suffix - 1)
  return `${parts.slice(i).join(' ')}, ${parts.slice(0, i).join(' ')}`.toLowerCase()
}

export function getBook(id: number): BookRow | undefined {
  return db.prepare('SELECT * FROM books WHERE id = ?').get(id) as BookRow | undefined
}

export function setAuthors(bookId: number, names: string[]) {
  db.prepare('DELETE FROM book_authors WHERE book_id = ?').run(bookId)
  const ins = db.prepare('INSERT INTO authors(name, sort_name) VALUES (?, ?) ON CONFLICT(name) DO UPDATE SET name = name RETURNING id')
  const link = db.prepare('INSERT OR IGNORE INTO book_authors(book_id, author_id, ord) VALUES (?,?,?)')
  const seen = new Set<string>()
  names.map(n => n.trim()).filter(Boolean).forEach((name, i) => {
    if (seen.has(name.toLowerCase())) return
    seen.add(name.toLowerCase())
    const { id } = ins.get(name, sortName(name)) as { id: number }
    link.run(bookId, id, i)
  })
  db.exec('DELETE FROM authors WHERE id NOT IN (SELECT author_id FROM book_authors)')
}

export function setTags(bookId: number, names: string[]) {
  db.prepare('DELETE FROM book_tags WHERE book_id = ?').run(bookId)
  const ins = db.prepare('INSERT INTO tags(name) VALUES (?) ON CONFLICT(name) DO UPDATE SET name = name RETURNING id')
  const link = db.prepare('INSERT OR IGNORE INTO book_tags(book_id, tag_id) VALUES (?,?)')
  for (const raw of names.slice(0, 20)) {
    const name = raw.trim().slice(0, 80)
    if (!name) continue
    const { id } = ins.get(name) as { id: number }
    link.run(bookId, id)
  }
  db.exec('DELETE FROM tags WHERE id NOT IN (SELECT tag_id FROM book_tags)')
}

export const authorsOf = (bookId: number) =>
  (db.prepare('SELECT a.id, a.name FROM book_authors ba JOIN authors a ON a.id = ba.author_id WHERE ba.book_id = ? ORDER BY ba.ord').all(bookId) as { id: number; name: string }[])

export const tagsOf = (bookId: number) =>
  (db.prepare('SELECT t.name FROM book_tags bt JOIN tags t ON t.id = bt.tag_id WHERE bt.book_id = ? ORDER BY t.name').all(bookId) as { name: string }[]).map(t => t.name)

export interface UserBookRow {
  locator: string | null
  fraction: number
  finished: number
  favorite: number
  last_read: number | null
}

/** Compact shape used by grids and shelves. */
export function summarize(b: BookRow & Partial<UserBookRow> & { authors?: string | null }) {
  return {
    id: b.id,
    libraryId: b.library_id,
    title: b.title,
    authors: b.authors ? b.authors.split('\u001f') : [],
    series: b.series,
    seriesIndex: b.series_index,
    format: b.format,
    hasCover: !!b.cover,
    coverVersion: b.cover ? b.cover.replace(/\.jpg$/, '') : null,
    progress: b.fraction ?? 0,
    finished: !!b.finished,
    favorite: !!b.favorite,
    lastRead: b.last_read ?? null,
    addedAt: b.added_at,
    missing: !!b.missing,
  }
}

export function detail(b: BookRow, userId: number) {
  const ub = db.prepare('SELECT locator, fraction, finished, favorite, last_read FROM user_books WHERE user_id = ? AND book_id = ?').get(userId, b.id) as UserBookRow | undefined
  const info = formatOf(b.path)
  return {
    ...summarize({ ...b, ...ub, authors: null }),
    authors: authorsOf(b.id).map(a => a.name),
    authorIds: authorsOf(b.id),
    subtitle: b.subtitle,
    description: b.description,
    publisher: b.publisher,
    published: b.published,
    language: b.language,
    isbn13: b.isbn13,
    isbn10: b.isbn10,
    pageCount: b.page_count,
    tags: tagsOf(b.id),
    size: b.size,
    fileName: b.path.split(/[\\/]/).pop(),
    formatLabel: info?.label ?? b.format.toUpperCase(),
    engine: info?.engine ?? 'foliate',
    comic: !!info?.comic,
    coverSource: b.cover_source,
    metadataSource: b.metadata_source,
    metadataLocked: !!b.metadata_locked,
    providerIds: safeJson<Record<string, string>>(b.provider_ids, {}),
    locator: ub?.locator ?? null,
    updatedAt: b.updated_at,
  }
}

/** SQL fragment that joins comma-free author list + user state onto `books b`. */
export const BOOK_SELECT = `
  SELECT b.*, ub.fraction, ub.finished, ub.favorite, ub.last_read,
    (SELECT group_concat(name, char(31)) FROM (SELECT a.name FROM book_authors ba JOIN authors a ON a.id = ba.author_id WHERE ba.book_id = b.id ORDER BY ba.ord)) AS authors
  FROM books b
  LEFT JOIN user_books ub ON ub.book_id = b.id AND ub.user_id = :user`

export function touchBook(id: number) {
  db.prepare('UPDATE books SET updated_at = ? WHERE id = ?').run(now(), id)
}
