/**
 * Cover and spine art kept next to the books themselves:
 *
 *   Some Book/                     book libraries          Some Comic Series/          comic libraries
 *     Some Book.epub                                         Issue 01.cbz
 *     covers/  Some Book.jpg                                 Issue 02.cbz
 *     spines/  Some Book.jpg                                 covers/  Issue 01.jpg, Issue 02.png
 *
 * The scanner creates the folders (when the library is writable) and picks up whatever is put in them.
 * An image is matched to a book by file name; when the folder holds a single book, any image will do
 * (preferring one called cover.* / spine.*). Folder art beats embedded and downloaded art, and is
 * re-read whenever the image file changes.
 */
import fs from 'node:fs/promises'
import path from 'node:path'
import { db, now } from './db.ts'
import { deleteCover, dominantColor, storeCover, storeSpine } from './covers.ts'

export const ART_DIR = /^(covers|spines)$/i
const IMAGE = /\.(jpe?g|png|webp|gif|avif|tiff?)$/i

const stem = (f: string) => path.basename(f).replace(/\.(fb2\.zip|kepub\.epub|[^.]+)$/i, '')
const norm = (s: string) => s.toLowerCase().normalize('NFKD').replace(/[^\p{L}\p{N}]+/gu, '')

interface ArtBook {
  id: number
  path: string
  cover: string | null
  cover_source: string | null
  cover_sig: string | null
  cover_color: string | null
  spine: string | null
  spine_sig: string | null
}

type Which = 'cover' | 'spine'

/** Find (or create) a book folder's `covers` / `spines` subfolder, matching existing ones case-insensitively. */
async function artDir(dir: string, entries: string[], name: string): Promise<string | undefined> {
  const found = entries.find(e => e.toLowerCase() === name)
  if (found) return path.join(dir, found)
  try {
    await fs.mkdir(path.join(dir, name))
    return path.join(dir, name)
  } catch {
    return undefined // read-only library, or no permission: nothing to read either
  }
}

async function images(dir: string | undefined): Promise<string[]> {
  if (!dir) return []
  try {
    return (await fs.readdir(dir, { withFileTypes: true }))
      .filter(e => e.isFile() && IMAGE.test(e.name) && !e.name.startsWith('.'))
      .map(e => e.name)
      .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }))
  } catch {
    return []
  }
}

function pick(imgs: string[], bookFile: string, alone: boolean, which: Which): string | undefined {
  if (!imgs.length) return undefined
  const want = norm(stem(bookFile))
  const exact = imgs.find(i => norm(stem(i)) === want)
  if (exact) return exact
  // "Dune.jpg" for "Frank Herbert - Dune (1965).epub", if only one image fits
  const loose = imgs.filter(i => { const s = norm(stem(i)); return s.length >= 3 && (want.includes(s) || s.includes(want)) })
  if (loose.length === 1) return loose[0]
  if (!alone) return undefined
  const preferred = which === 'cover' ? /^(cover|front|folder)$/ : /^(spine|side)$/
  return imgs.find(i => preferred.test(norm(stem(i)))) ?? imgs[0]
}

async function apply(b: ArtBook, which: Which, dir: string | undefined, file: string | undefined) {
  const sigCol = which === 'cover' ? 'cover_sig' : 'spine_sig'
  if (!dir || !file) {
    // art was removed from the folder: a spine goes away; a cover stays but providers may replace it again
    if (which === 'spine' && b.spine_sig) {
      await deleteCover(b.spine)
      db.prepare('UPDATE books SET spine = NULL, spine_sig = NULL, updated_at = ? WHERE id = ?').run(now(), b.id)
    } else if (which === 'cover' && b.cover_sig) {
      db.prepare(`UPDATE books SET cover_sig = NULL, cover_source = 'generated' WHERE id = ? AND cover_source = 'folder'`).run(b.id)
    }
    return
  }
  const full = path.join(dir, file)
  const st = await fs.stat(full).catch(() => undefined)
  if (!st) return
  const sig = `${file}:${st.size}:${Math.floor(st.mtimeMs)}`
  if (sig === b[sigCol]) return
  const data = await fs.readFile(full).catch(() => undefined)
  const stored = data && (which === 'cover' ? await storeCover(b.id, data) : await storeSpine(b.id, data))
  if (!stored) {
    console.warn(`[art] can't read ${full}`)
    db.prepare(`UPDATE books SET ${sigCol} = ? WHERE id = ?`).run(sig, b.id) // don't retry an unreadable image every scan
    return
  }
  if (which === 'cover') {
    await deleteCover(b.cover)
    db.prepare(`UPDATE books SET cover = ?, cover_source = 'folder', cover_sig = ?, cover_color = NULL, updated_at = ? WHERE id = ?`).run(stored, sig, now(), b.id)
    b.cover = stored
    b.cover_color = null
  } else {
    await deleteCover(b.spine)
    db.prepare('UPDATE books SET spine = ?, spine_sig = ?, updated_at = ? WHERE id = ?').run(stored, sig, now(), b.id)
  }
}

/** "<cover file>|#rrggbb": the colour stays tied to the cover it was measured from. */
export const coverColor = (cover: string | null, stored: string | null) =>
  cover && stored?.startsWith(cover + '|') ? stored.slice(cover.length + 1) : null

export async function syncFolderArt(libraryId: number, kind: string, onProgress?: (msg: string) => void) {
  const books = db.prepare('SELECT id, path, cover, cover_source, cover_sig, cover_color, spine, spine_sig FROM books WHERE library_id = ? AND missing = 0')
    .all(libraryId) as unknown as ArtBook[]
  const byDir = new Map<string, ArtBook[]>()
  for (const b of books) {
    const d = path.dirname(b.path)
    byDir.set(d, [...(byDir.get(d) ?? []), b])
  }
  const spines = kind !== 'comics' // comics and magazines are shelved by their covers
  for (const [dir, list] of byDir) {
    onProgress?.(path.basename(dir))
    const entries = await fs.readdir(dir).catch(() => [] as string[])
    const coverDir = await artDir(dir, entries, 'covers')
    const spineDir = spines ? await artDir(dir, entries, 'spines') : undefined
    const coverImgs = await images(coverDir)
    const spineImgs = await images(spineDir)
    for (const b of list) {
      try {
        await apply(b, 'cover', coverDir, pick(coverImgs, b.path, list.length === 1, 'cover'))
        if (spines) await apply(b, 'spine', spineDir, pick(spineImgs, b.path, list.length === 1, 'spine'))
        // colour for generated spines (also backfills books whose covers came from elsewhere)
        if (b.cover && !coverColor(b.cover, b.cover_color)) {
          const c = await dominantColor(b.cover)
          if (c) db.prepare('UPDATE books SET cover_color = ? WHERE id = ?').run(`${b.cover}|${c}`, b.id)
        }
      } catch (e) {
        console.warn(`[art] ${b.path}: ${(e as Error).message}`)
      }
    }
  }
}
