import path from 'node:path'
import fs from 'node:fs'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const repoRoot = path.resolve(here, '..', '..')

/** CARAVAN_* settings; the older JR_* names still work. */
const env = (name: string, fallback: string) => process.env[`CARAVAN_${name}`]?.trim() || process.env[`JR_${name}`]?.trim() || fallback

/** Calibre's ebook-convert, if configured and present. */
function calibre(): string {
  const p = (process.env.CARAVAN_CALIBRE_CONVERT || process.env.JR_CALIBRE_CONVERT)?.trim()
  return p && fs.existsSync(p) ? p : ''
}

export const config = {
  port: Number(env('PORT', '8420')),
  host: env('HOST', '0.0.0.0'),
  /** Where the database, cover cache and converted files live. */
  dataDir: path.resolve(env('DATA_DIR', path.join(repoRoot, 'data'))),
  /** Built web client (vite output). */
  webDir: path.resolve(env('WEB_DIR', path.join(repoRoot, 'web', 'dist'))),
  /** Optional path to Calibre's ebook-convert for exotic formats (DOCX, RTF, LIT, PDB...). */
  calibreConvert: calibre(),
  userAgent: 'Caravan/0.1 (self-hosted e-book server)',
}

export const paths = {
  db: path.join(config.dataDir, 'caravan.db'),
  covers: path.join(config.dataDir, 'covers'),
  backgrounds: path.join(config.dataDir, 'backgrounds'),
  cache: path.join(config.dataDir, 'cache'),
  /** each user's private shelf: shelves/<user id>/ */
  shelves: path.join(config.dataDir, 'shelves'),
}

for (const dir of [config.dataDir, paths.covers, paths.cache, paths.backgrounds, paths.shelves]) fs.mkdirSync(dir, { recursive: true })

// Carry over a database from before the rename (JellyReader -> Caravan).
const legacyDb = path.join(config.dataDir, 'jellyreader.db')
if (!fs.existsSync(paths.db) && fs.existsSync(legacyDb)) {
  for (const suffix of ['', '-wal', '-shm']) {
    if (fs.existsSync(legacyDb + suffix)) fs.renameSync(legacyDb + suffix, paths.db + suffix)
  }
}
