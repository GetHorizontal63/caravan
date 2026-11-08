import { DatabaseSync } from 'node:sqlite'
import { paths } from './config.ts'

export const db = new DatabaseSync(paths.db)
db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;')

/** Ordered schema migrations. Append only — never edit a shipped migration. */
const migrations: string[] = [
  `
  CREATE TABLE users (
    id INTEGER PRIMARY KEY,
    username TEXT NOT NULL UNIQUE COLLATE NOCASE,
    password_hash TEXT NOT NULL,
    is_admin INTEGER NOT NULL DEFAULT 0,
    prefs TEXT NOT NULL DEFAULT '{}',
    created_at INTEGER NOT NULL
  );
  CREATE TABLE sessions (
    token_hash TEXT PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    device TEXT,
    created_at INTEGER NOT NULL,
    last_seen INTEGER NOT NULL
  );
  CREATE TABLE settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );
  CREATE TABLE libraries (
    id INTEGER PRIMARY KEY,
    name TEXT NOT NULL,
    kind TEXT NOT NULL DEFAULT 'books',          -- books | comics
    paths TEXT NOT NULL DEFAULT '[]',            -- JSON array of folders
    fetch_metadata INTEGER NOT NULL DEFAULT 1,
    created_at INTEGER NOT NULL,
    last_scan INTEGER
  );
  CREATE TABLE books (
    id INTEGER PRIMARY KEY,
    library_id INTEGER NOT NULL REFERENCES libraries(id) ON DELETE CASCADE,
    path TEXT NOT NULL UNIQUE,
    format TEXT NOT NULL,
    size INTEGER NOT NULL,
    mtime INTEGER NOT NULL,
    title TEXT NOT NULL,
    sort_title TEXT NOT NULL,
    subtitle TEXT,
    description TEXT,
    publisher TEXT,
    published TEXT,
    language TEXT,
    isbn13 TEXT,
    isbn10 TEXT,
    page_count INTEGER,
    series TEXT,
    series_index REAL,
    cover TEXT,                 -- file name inside data/covers
    cover_source TEXT,          -- embedded | openlibrary | googlebooks | upload | generated (| folder, migration 3)
    provider_ids TEXT NOT NULL DEFAULT '{}',
    metadata_source TEXT NOT NULL DEFAULT 'file', -- file | openlibrary | googlebooks | manual
    metadata_locked INTEGER NOT NULL DEFAULT 0,
    metadata_checked INTEGER,   -- last time remote providers were queried
    missing INTEGER NOT NULL DEFAULT 0,
    added_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  );
  CREATE INDEX books_library ON books(library_id);
  CREATE INDEX books_sort ON books(sort_title);
  CREATE INDEX books_isbn ON books(isbn13);
  CREATE TABLE authors (
    id INTEGER PRIMARY KEY,
    name TEXT NOT NULL UNIQUE COLLATE NOCASE,
    sort_name TEXT NOT NULL
  );
  CREATE TABLE book_authors (
    book_id INTEGER NOT NULL REFERENCES books(id) ON DELETE CASCADE,
    author_id INTEGER NOT NULL REFERENCES authors(id) ON DELETE CASCADE,
    ord INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (book_id, author_id)
  );
  CREATE TABLE tags (
    id INTEGER PRIMARY KEY,
    name TEXT NOT NULL UNIQUE COLLATE NOCASE
  );
  CREATE TABLE book_tags (
    book_id INTEGER NOT NULL REFERENCES books(id) ON DELETE CASCADE,
    tag_id INTEGER NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
    PRIMARY KEY (book_id, tag_id)
  );
  CREATE TABLE user_books (
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    book_id INTEGER NOT NULL REFERENCES books(id) ON DELETE CASCADE,
    locator TEXT,               -- EPUB CFI, or "page:N" for PDF
    fraction REAL NOT NULL DEFAULT 0,
    finished INTEGER NOT NULL DEFAULT 0,
    favorite INTEGER NOT NULL DEFAULT 0,
    last_read INTEGER,
    PRIMARY KEY (user_id, book_id)
  );
  CREATE TABLE annotations (
    id INTEGER PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    book_id INTEGER NOT NULL REFERENCES books(id) ON DELETE CASCADE,
    kind TEXT NOT NULL DEFAULT 'highlight',  -- highlight | bookmark
    locator TEXT NOT NULL,
    text TEXT,
    note TEXT,
    color TEXT,
    chapter TEXT,
    created_at INTEGER NOT NULL
  );
  CREATE INDEX annotations_user_book ON annotations(user_id, book_id);
  `,
  `
  CREATE TABLE collections (
    id INTEGER PRIMARY KEY,
    library_id INTEGER NOT NULL REFERENCES libraries(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    description TEXT,
    created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  );
  CREATE INDEX collections_library ON collections(library_id);
  CREATE TABLE collection_books (
    collection_id INTEGER NOT NULL REFERENCES collections(id) ON DELETE CASCADE,
    book_id INTEGER NOT NULL REFERENCES books(id) ON DELETE CASCADE,
    position REAL NOT NULL,
    added_at INTEGER NOT NULL,
    PRIMARY KEY (collection_id, book_id)
  );
  CREATE INDEX collection_books_book ON collection_books(book_id);
  `,
  // the product was renamed JellyReader -> Caravan; carry stored server names over ("JellyReader (test)" -> "Caravan (test)")
  `
  UPDATE settings SET value = replace(value, 'JellyReader', 'Caravan') WHERE key = 'serverName';
  `,
  // art from the book's own covers/ and spines/ folders (see folderArt.ts)
  `
  ALTER TABLE books ADD COLUMN cover_sig TEXT;
  ALTER TABLE books ADD COLUMN cover_color TEXT;
  ALTER TABLE books ADD COLUMN spine TEXT;
  ALTER TABLE books ADD COLUMN spine_sig TEXT;
  `,
  // one book, several files: same name in the same folder, different formats (Dune.epub + Dune.pdf + Dune.azw3).
  // books.path/format/size/mtime keep describing the preferred ("primary") version.
  `
  CREATE TABLE book_files (
    id INTEGER PRIMARY KEY,
    book_id INTEGER NOT NULL REFERENCES books(id) ON DELETE CASCADE,
    path TEXT NOT NULL UNIQUE,
    format TEXT NOT NULL,
    size INTEGER NOT NULL,
    mtime INTEGER NOT NULL,
    missing INTEGER NOT NULL DEFAULT 0,
    added_at INTEGER NOT NULL
  );
  CREATE INDEX book_files_book ON book_files(book_id);
  INSERT INTO book_files(book_id, path, format, size, mtime, missing, added_at) SELECT id, path, format, size, mtime, missing, added_at FROM books;

  -- which version a reading position / annotation was made in; positions are format-specific
  ALTER TABLE user_books ADD COLUMN file_id INTEGER REFERENCES book_files(id) ON DELETE SET NULL;
  UPDATE user_books SET file_id = (SELECT f.id FROM book_files f JOIN books b ON b.path = f.path WHERE b.id = user_books.book_id);
  ALTER TABLE annotations ADD COLUMN file_id INTEGER REFERENCES book_files(id) ON DELETE SET NULL;
  ALTER TABLE annotations ADD COLUMN fraction REAL;
  UPDATE annotations SET file_id = (SELECT f.id FROM book_files f JOIN books b ON b.path = f.path WHERE b.id = annotations.book_id);

  -- where an annotation lands in the other versions (found by searching for its text); NULL locator = not found
  CREATE TABLE annotation_anchors (
    annotation_id INTEGER NOT NULL REFERENCES annotations(id) ON DELETE CASCADE,
    file_id INTEGER NOT NULL REFERENCES book_files(id) ON DELETE CASCADE,
    locator TEXT,
    PRIMARY KEY (annotation_id, file_id)
  );
  `,
]

const current = (db.prepare('PRAGMA user_version').get() as { user_version: number }).user_version
for (let v = current; v < migrations.length; v++) {
  db.exec('BEGIN')
  try {
    db.exec(migrations[v])
    db.exec(`PRAGMA user_version = ${v + 1}`)
    db.exec('COMMIT')
  } catch (e) {
    db.exec('ROLLBACK')
    throw e
  }
}

export const now = () => Date.now()

export function tx<T>(fn: () => T): T {
  db.exec('BEGIN')
  try {
    const r = fn()
    db.exec('COMMIT')
    return r
  } catch (e) {
    db.exec('ROLLBACK')
    throw e
  }
}

// ---- settings -------------------------------------------------------------

export interface ServerSettings {
  serverName: string
  googleBooksApiKey: string
  autoFetchMetadata: boolean
  scanIntervalHours: number
  providers: string[] // order of preference
}

const defaults: ServerSettings = {
  serverName: 'Caravan',
  googleBooksApiKey: '',
  autoFetchMetadata: true,
  scanIntervalHours: 6,
  providers: ['openlibrary', 'googlebooks'],
}

export function getSettings(): ServerSettings {
  const rows = db.prepare('SELECT key, value FROM settings').all() as { key: string; value: string }[]
  const out: Record<string, unknown> = { ...defaults }
  for (const r of rows) {
    try { out[r.key] = JSON.parse(r.value) } catch { /* ignore corrupt */ }
  }
  return out as unknown as ServerSettings
}

export function saveSettings(patch: Partial<ServerSettings>) {
  const stmt = db.prepare('INSERT INTO settings(key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value')
  for (const [k, v] of Object.entries(patch)) {
    if (k in defaults && v !== undefined) stmt.run(k, JSON.stringify(v))
  }
}
