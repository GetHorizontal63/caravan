import fs from 'node:fs/promises'
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
/** When the same book exists in several formats side by side, keep the one that reads best. */
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

function dedupeFormats(files: string[]): string[] {
  const groups = new Map<string, string[]>()
  for (const f of files) {
    const key = path.join(path.dirname(f), path.basename(f).replace(/\.(fb2\.zip|kepub\.epub|[^.]+)$/i, '')).toLowerCase()
    groups.set(key, [...(groups.get(key) ?? []), f])
  }
  return [...groups.values()].map(g => g.sort((a, b) => PRIORITY.indexOf(formatOf(a)!.format) - PRIORITY.indexOf(formatOf(b)!.format))[0])
}

async function importFile(lib: LibraryRow, file: string, stat: import('node:fs').Stats, existing: BookRow | undefined): Promise<number | undefined> {
  const info = formatOf(file)!
  const mtime = Math.floor(stat.mtimeMs)
  if (existing && existing.size === stat.size && existing.mtime === mtime) {
    if (existing.missing) db.prepare('UPDATE books SET missing = 0 WHERE id = ?').run(existing.id)
    return undefined
  }
  // File changed but its metadata was curated by hand or by a provider: keep it, just note the new file.
  if (existing && (existing.metadata_locked || existing.metadata_source !== 'file')) {
    db.prepare('UPDATE books SET size = ?, mtime = ?, missing = 0, updated_at = ? WHERE id = ?').run(stat.size, mtime, now(), existing.id)
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
      db.prepare(`UPDATE books SET format=?, size=?, mtime=?, title=?, sort_title=?, subtitle=?, description=?, publisher=?, published=?,
        language=?, isbn13=?, isbn10=?, page_count=?, series=?, series_index=?, missing=0, updated_at=? WHERE id=?`).run(...fields, now(), existing.id)
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
    const wanted = dedupeFormats(files)
    scanState.total = wanted.length

    const known = new Map((db.prepare('SELECT * FROM books WHERE library_id = ?').all(libraryId) as unknown as BookRow[]).map(b => [b.path, b]))
    const settings = getSettings()
    const toIdentify: number[] = []

    for (const file of wanted) {
      scanState.current = path.basename(file)
      try {
        const stat = await fs.stat(file)
        const existing = known.get(file)
        known.delete(file)
        const id = await importFile(lib, file, stat, existing)
        if (id && lib.fetch_metadata && settings.autoFetchMetadata) {
          const b = db.prepare('SELECT cover, description, metadata_locked FROM books WHERE id = ?').get(id) as { cover: string | null; description: string | null; metadata_locked: number }
          if (!b.metadata_locked) toIdentify.push(id)
        }
      } catch (e) {
        console.warn(`[scan] ${file}: ${(e as Error).message}`)
      }
      scanState.processed++
    }

    // Anything left in `known` was not found. Only flag it when its root was reachable (a NAS outage shouldn't wipe a library).
    const gone = [...known.values()].filter(b => reachable.some(r => under(b.path, r)))
    for (const b of gone) db.prepare('UPDATE books SET missing = 1 WHERE id = ?').run(b.id)
    // Books also removed from the library's folder list entirely
    for (const b of known.values()) if (!roots.some(r => under(b.path, r))) db.prepare('DELETE FROM books WHERE id = ?').run(b.id)

    // covers/ and spines/ folders next to the books (before identification, so folder covers aren't downloaded over)
    await syncFolderArt(libraryId, lib.kind, dir => { scanState.current = `Artwork: ${dir}` })

    db.prepare('UPDATE libraries SET last_scan = ? WHERE id = ?').run(now(), libraryId)
    metadataQueue.push(...toIdentify)
    console.log(`[scan] ${lib.name}: ${wanted.length} files, ${scanState.added} new, ${gone.length} missing`)
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

/** Periodic rescans (interval comes from server settings, re-read each tick). */
export function startScheduler() {
  let last = Date.now()
  setInterval(() => {
    const hours = getSettings().scanIntervalHours
    if (hours > 0 && !scanState.running && Date.now() - last > hours * 3600_000) {
      last = Date.now()
      void scanAll()
    }
  }, 60_000).unref()
}
