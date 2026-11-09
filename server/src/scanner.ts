import fs from 'node:fs/promises'
import { watch, type FSWatcher } from 'node:fs'
import path from 'node:path'
import { db, getSettings, now, tx } from './db.ts'
import { formatOf } from './formats.ts'
import { extractMetadata } from './extract/index.ts'
import { normalizeIsbn, toIsbn10 } from './metadata/isbn.ts'
import { setAuthors, setTags, sortTitle, type BookRow } from './books.ts'
import { storeCover } from './covers.ts'
import { metadataQueue } from './metadata/index.ts'
import { safeJson } from './auth.ts'
import { ART_DIR, syncFolderArt } from './folderArt.ts'

export interface LibraryRow {
  id: number
  name: string
  kind: string
  paths: string
  fetch_metadata: number
  created_at: number
  last_scan: number | null
}

export const scanState = {
  running: false,
  libraryId: null as number | null,
  libraryName: '',
  total: 0,
  processed: 0,
  added: 0,
  current: '',
  error: '',
}

const under = (file: string, root: string) => {
  const r = path.resolve(root)
  return path.resolve(file).startsWith(r.endsWith(path.sep) ? r : r + path.sep)
}

const SKIP_DIRS = /^(\.|@eaDir$|#recycle$|\$RECYCLE\.BIN$|System Volume Information$|lost\+found$)/i
/** When the same book exists in several formats side by side, the one that reads best is the primary version. */
const PRIORITY = ['epub', 'azw3', 'mobi', 'azw', 'fb2', 'fbz', 'cbz', 'cbr', 'pdf', 'docx', 'odt', 'rtf', 'html', 'md', 'txt', 'lit', 'pdb', 'lrf']

async function walk(root: string, out: string[]) {
  let entries: import('node:fs').Dirent[]
  try {
    entries = await fs.readdir(root, { withFileTypes: true })
  } catch (e) {
    console.warn(`[scan] cannot read ${root}: ${(e as Error).message}`)
    return
  }
  for (const e of entries) {
    const full = path.join(root, e.name)
    if (e.isDirectory()) {
      if (!SKIP_DIRS.test(e.name) && !ART_DIR.test(e.name)) await walk(full, out)
    } else if (e.isFile() && !e.name.startsWith('._') && formatOf(e.name)) {
      out.push(full)
    }
  }
}

/** Files with the same name in the same folder are one book in several formats, best format first. */
function groupFormats(files: string[]): string[][] {
  const groups = new Map<string, string[]>()
  for (const f of files) {
    const key = path.join(path.dirname(f), path.basename(f).replace(/\.(fb2\.zip|kepub\.epub|[^.]+)$/i, '')).toLowerCase()
    groups.set(key, [...(groups.get(key) ?? []), f])
  }
  const rank = (f: string) => { const i = PRIORITY.indexOf(formatOf(f)!.format); return i < 0 ? 99 : i }
  return [...groups.values()].map(g => g.sort((a, b) => rank(a) - rank(b)))
}

/** Two entries turned out to be one book (e.g. a file was renamed to match another): move everything onto `keep`. */
function mergeBooks(keep: number, drop: number) {
  tx(() => {
    db.prepare('UPDATE book_files SET book_id = ? WHERE book_id = ?').run(keep, drop)
    db.prepare('UPDATE annotations SET book_id = ? WHERE book_id = ?').run(keep, drop)
    // reading state: the more recently read copy wins; finished/favourite carry over if either had them
    db.prepare(`INSERT INTO user_books(user_id, book_id, locator, fraction, finished, favorite, last_read, file_id)
        SELECT user_id, ?, locator, fraction, finished, favorite, last_read, file_id FROM user_books WHERE book_id = ? AND true
      ON CONFLICT(user_id, book_id) DO UPDATE SET
        locator = CASE WHEN COALESCE(excluded.last_read, 0) > COALESCE(user_books.last_read, 0) THEN excluded.locator ELSE user_books.locator END,
        fraction = CASE WHEN COALESCE(excluded.last_read, 0) > COALESCE(user_books.last_read, 0) THEN excluded.fraction ELSE user_books.fraction END,
        file_id = CASE WHEN COALESCE(excluded.last_read, 0) > COALESCE(user_books.last_read, 0) THEN excluded.file_id ELSE user_books.file_id END,
        last_read = max(COALESCE(excluded.last_read, 0), COALESCE(user_books.last_read, 0)),
        finished = max(excluded.finished, user_books.finished),
        favorite = max(excluded.favorite, user_books.favorite)`).run(keep, drop)
    db.prepare('INSERT OR IGNORE INTO collection_books(collection_id, book_id, position, added_at) SELECT collection_id, ?, position, added_at FROM collection_books WHERE book_id = ?').run(keep, drop)
    db.prepare('DELETE FROM books WHERE id = ?').run(drop)
  })
}

/**
 * Create or refresh a book from its preferred file. Returns the id when metadata was (re)read, so the
 * caller can queue identification; undefined when nothing needed reading.
 */
async function importFile(lib: LibraryRow, file: string, stat: import('node:fs').Stats, existing: BookRow | undefined): Promise<number | undefined> {
  const info = formatOf(file)!
  const mtime = Math.floor(stat.mtimeMs)
  if (existing && existing.path === file && existing.size === stat.size && existing.mtime === mtime) {
    if (existing.missing) db.prepare('UPDATE books SET missing = 0 WHERE id = ?').run(existing.id)
    return undefined
  }
  // File changed (or a better format turned up) but the metadata was curated by hand or by a provider: keep it.
  if (existing && (existing.metadata_locked || existing.metadata_source !== 'file')) {
    db.prepare('UPDATE books SET path = ?, format = ?, size = ?, mtime = ?, missing = 0, updated_at = ? WHERE id = ?').run(file, info.format, stat.size, mtime, now(), existing.id)
    return undefined
  }

  const meta = await extractMetadata(file, info.format)
  const isbn13 = meta.isbns?.map(normalizeIsbn).find(Boolean) ?? null
  const title = meta.title?.slice(0, 500) || path.basename(file)
  const fields = [
    info.format, stat.size, mtime, title, sortTitle(title), meta.subtitle ?? null, meta.description ?? null,
    meta.publisher ?? null, meta.published ?? null, meta.language ?? null, isbn13, isbn13 ? toIsbn10(isbn13) ?? null : null,
    meta.pageCount ?? null, meta.series ?? null, meta.seriesIndex ?? null,
  ] as const

  const id = tx(() => {
    let bookId: number
    if (existing) {
      db.prepare(`UPDATE books SET path=?, format=?, size=?, mtime=?, title=?, sort_title=?, subtitle=?, description=?, publisher=?, published=?,
        language=?, isbn13=?, isbn10=?, page_count=?, series=?, series_index=?, missing=0, updated_at=? WHERE id=?`).run(file, ...fields, now(), existing.id)
      bookId = existing.id
    } else {
      const r = db.prepare(`INSERT INTO books(library_id, path, format, size, mtime, title, sort_title, subtitle, description, publisher, published,
        language, isbn13, isbn10, page_count, series, series_index, added_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
        .run(lib.id, file, ...fields, now(), now())
      bookId = Number(r.lastInsertRowid)
    }
    setAuthors(bookId, meta.authors ?? [])
    setTags(bookId, meta.tags ?? [])
    return bookId
  })

  if (meta.cover && (!existing?.cover || existing.cover_source === 'embedded' || existing.cover_source === 'generated')) {
    const name = await storeCover(id, meta.cover.data)
    if (name) db.prepare('UPDATE books SET cover = ?, cover_source = ? WHERE id = ?').run(name, info.format === 'pdf' ? 'generated' : 'embedded', id)
  }
  if (!existing) scanState.added++
  return id
}

interface FileRow { id: number; book_id: number; path: string; format: string; size: number; mtime: number; missing: number }

export async function scanLibrary(libraryId: number) {
  const lib = db.prepare('SELECT * FROM libraries WHERE id = ?').get(libraryId) as LibraryRow | undefined
  if (!lib) throw new Error('Library not found')
  if (scanState.running) throw new Error('A scan is already running')
  Object.assign(scanState, { running: true, libraryId, libraryName: lib.name, total: 0, processed: 0, added: 0, current: 'Listing files…', error: '' })
  try {
    const roots = safeJson<string[]>(lib.paths, [])
    const files: string[] = []
    const reachable: string[] = []
    for (const root of roots) {
      try {
        await fs.access(root)
        reachable.push(root)
        await walk(root, files)
      } catch {
        console.warn(`[scan] library path unreachable, skipping: ${root}`)
      }
    }
    const groups = groupFormats(files)
    scanState.total = groups.length

    const fileRows = db.prepare('SELECT f.* FROM book_files f JOIN books b ON b.id = f.book_id WHERE b.library_id = ?').all(libraryId) as unknown as FileRow[]
    const byPath = new Map(fileRows.map(f => [f.path, f]))
    const bookById = (id: number) => db.prepare('SELECT * FROM books WHERE id = ?').get(id) as BookRow | undefined
    const settings = getSettings()
    const toIdentify: number[] = []
    const seen = new Set<string>()
    const insFile = db.prepare('INSERT INTO book_files(book_id, path, format, size, mtime, missing, added_at) VALUES (?,?,?,?,?,0,?)')
    const updFile = db.prepare('UPDATE book_files SET book_id = ?, format = ?, size = ?, mtime = ?, missing = 0 WHERE id = ?')

    for (const group of groups) {
      const primary = group[0]
      scanState.current = path.basename(primary)
      try {
        // the book these files belong to: whichever entry already owns one of them (merging if several do)
        const owners = [...new Set(group.map(p => byPath.get(p)?.book_id).filter((x): x is number => x != null))]
          .map(bookById).filter((b): b is BookRow => !!b)
          .sort((a, b) => Number(b.metadata_source !== 'file') - Number(a.metadata_source !== 'file') || a.id - b.id)
        for (const extra of owners.slice(1)) mergeBooks(owners[0].id, extra.id)
        const existing = owners[0] ? bookById(owners[0].id) : undefined

        const stats = new Map<string, import('node:fs').Stats>()
        for (const p of group) stats.set(p, await fs.stat(p))
        const id = await importFile(lib, primary, stats.get(primary)!, existing)
        const bookId = id ?? existing!.id
        if (id && lib.fetch_metadata && settings.autoFetchMetadata) {
          const b = db.prepare('SELECT metadata_locked FROM books WHERE id = ?').get(id) as { metadata_locked: number }
          if (!b.metadata_locked) toIdentify.push(id)
        }
        for (const p of group) {
          const st = stats.get(p)!, mtime = Math.floor(st.mtimeMs), fmt = formatOf(p)!.format
          const row = byPath.get(p)
          if (!row) insFile.run(bookId, p, fmt, st.size, mtime, now())
          else if (row.book_id !== bookId || row.size !== st.size || row.mtime !== mtime || row.missing || row.format !== fmt) updFile.run(bookId, fmt, st.size, mtime, row.id)
          seen.add(p)
        }
      } catch (e) {
        console.warn(`[scan] ${primary}: ${(e as Error).message}`)
      }
      scanState.processed++
    }

    // Files not found: flag them only when their folder was reachable (a NAS outage shouldn't wipe a library);
    // forget them when the folder was removed from the library altogether.
    let gone = 0
    for (const f of fileRows) {
      if (seen.has(f.path)) continue
      if (!roots.some(r => under(f.path, r))) db.prepare('DELETE FROM book_files WHERE id = ?').run(f.id)
      else if (reachable.some(r => under(f.path, r)) && !f.missing) { db.prepare('UPDATE book_files SET missing = 1 WHERE id = ?').run(f.id); gone++ }
    }
    // a book is available while any of its versions is; its primary is the best available one
    db.prepare('DELETE FROM books WHERE library_id = ? AND NOT EXISTS (SELECT 1 FROM book_files f WHERE f.book_id = books.id)').run(libraryId)
    db.prepare(`UPDATE books SET missing = CASE WHEN EXISTS (SELECT 1 FROM book_files f WHERE f.book_id = books.id AND f.missing = 0) THEN 0 ELSE 1 END
      WHERE library_id = ?`).run(libraryId)

    // covers/ and spines/ folders next to the books (before identification, so folder covers aren't downloaded over)
    await syncFolderArt(libraryId, lib.kind, dir => { scanState.current = `Artwork: ${dir}` })

    db.prepare('UPDATE libraries SET last_scan = ? WHERE id = ?').run(now(), libraryId)
    metadataQueue.push(...toIdentify)
    console.log(`[scan] ${lib.name}: ${files.length} files in ${groups.length} books, ${scanState.added} new, ${gone} missing`)
  } catch (e) {
    scanState.error = (e as Error).message
    throw e
  } finally {
    scanState.running = false
    scanState.current = ''
  }
}

export async function scanAll() {
  const libs = db.prepare('SELECT id FROM libraries').all() as { id: number }[]
  for (const l of libs) {
    try { await scanLibrary(l.id) } catch (e) { console.warn(`[scan] ${(e as Error).message}`) }
  }
}

// ---- watching library folders ------------------------------------------------
// Any change under a library folder (books added, removed or renamed; covers/ or spines/ images added,
// edited or deleted) queues a rescan of that library once things have been quiet for a moment, so
// copying a whole folder of books triggers one scan, not hundreds. The schedule remains as a safety net
// (and covers shares where change events don't arrive, e.g. network mounts inside the container).

const QUIET_MS = Number(process.env.CARAVAN_WATCH_DELAY_MS ?? 15_000)
const watchers = new Map<string, FSWatcher>()
const queued = new Map<number, ReturnType<typeof setTimeout>>()

export function queueScan(libraryId: number, delay = QUIET_MS) {
  clearTimeout(queued.get(libraryId))
  const run = () => {
    if (scanState.running) { queued.set(libraryId, setTimeout(run, QUIET_MS)); return }
    queued.delete(libraryId)
    scanLibrary(libraryId).catch(e => console.warn(`[watch] ${(e as Error).message}`))
  }
  queued.set(libraryId, setTimeout(run, delay))
}

function relevant(file: string | null | undefined) {
  if (!file) return true // some platforms don't say what changed
  const parts = file.split(/[\\/]/)
  if (parts.some(p => SKIP_DIRS.test(p))) return false // @eaDir thumbnails, recycle bins, dotfiles
  if (ART_DIR.test(parts[parts.length - 1])) return false // the scanner creating covers/ and spines/ itself
  return true
}

/** Start/stop watchers to match the libraries' folders. Cheap; called every scheduler tick. */
export function syncWatchers() {
  const enabled = (process.env.CARAVAN_WATCH ?? process.env.JR_WATCH) !== '0'
  const libs = enabled ? db.prepare('SELECT id, paths FROM libraries').all() as { id: number; paths: string }[] : []
  const want = new Map<string, { id: number; root: string }>()
  for (const l of libs) for (const root of safeJson<string[]>(l.paths, [])) want.set(`${l.id}\u0000${root}`, { id: l.id, root })
  for (const [key, w] of watchers) if (!want.has(key)) { w.close(); watchers.delete(key) }
  for (const [key, { id, root }] of want) {
    if (watchers.has(key)) continue
    try {
      const w = watch(root, { recursive: true, persistent: false }, (_event, file) => { if (relevant(file?.toString())) queueScan(id) })
      // e.g. the folder disappeared or the system's watch limit was hit: drop it, retry on a later tick
      w.on('error', e => { console.warn(`[watch] ${root}: ${e.message}`); w.close(); watchers.delete(key) })
      watchers.set(key, w)
    } catch {
      /* folder missing right now: retried next tick; the schedule still covers it */
    }
  }
}

/** Periodic rescans (interval comes from server settings, re-read each tick) + folder watching. */
export function startScheduler() {
  let last = Date.now()
  syncWatchers()
  setInterval(() => {
    syncWatchers()
    const hours = getSettings().scanIntervalHours
    if (hours > 0 && !scanState.running && Date.now() - last > hours * 3600_000) {
      last = Date.now()
      void scanAll()
    }
  }, 60_000).unref()
}
