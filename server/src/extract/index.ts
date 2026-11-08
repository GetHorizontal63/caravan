import fs from 'node:fs/promises'
import path from 'node:path'
import { findIsbns } from '../metadata/isbn.ts'
import { extractEpub } from './epub.ts'
import { extractMobi } from './mobi.ts'
import { extractFb2 } from './fb2.ts'
import { extractPdf } from './pdf.ts'
import { extractCbr, extractCbz } from './comic.ts'
import { parseOpf } from './opf.ts'
import type { ExtractedMeta } from './types.ts'

const extractors: Record<string, (file: string) => Promise<ExtractedMeta>> = {
  epub: extractEpub,
  mobi: extractMobi,
  azw: extractMobi,
  azw3: extractMobi,
  fb2: extractFb2,
  fbz: extractFb2,
  pdf: extractPdf,
  cbz: extractCbz,
  cbr: extractCbr,
}

/**
 * Guess title / author / series from a file name. Handles common layouts:
 *   "Author - Title", "Title - Author" (when author contains a comma), "Series 03 - Title", "Title (2019)"
 */
export function metaFromFilename(file: string): ExtractedMeta {
  let base = path.basename(file).replace(/\.(fb2\.zip|kepub\.epub|[a-z0-9]{2,5})$/i, '')
  const isbns = findIsbns(base.replace(/[_]/g, ' '))
  base = base.replace(/[_]+/g, ' ').replace(/\[[^\]]*\]/g, '').replace(/\b97[89]\d{10}\b/g, '').trim()
  let year: string | undefined
  base = base.replace(/\((\d{4})\)/, (_, y) => { year = y; return '' }).trim()
  const parts = base.split(/\s+-\s+/)
  const meta: ExtractedMeta = { isbns, published: year }
  if (parts.length >= 2) {
    meta.authors = [parts[0].trim()]
    meta.title = parts.slice(1).join(' - ').trim()
  } else {
    meta.title = base
  }
  return meta
}

/** Calibre libraries keep metadata.opf + cover.jpg next to each book. Use them when present. */
async function calibreSidecar(file: string): Promise<ExtractedMeta | undefined> {
  const dir = path.dirname(file)
  const opf = await fs.readFile(path.join(dir, 'metadata.opf'), 'utf8').catch(() => undefined)
  if (!opf) return undefined
  const { meta } = parseOpf(opf)
  const cover = await fs.readFile(path.join(dir, 'cover.jpg')).catch(() => undefined)
  if (cover?.length) meta.cover = { data: cover, mime: 'image/jpeg' }
  return meta
}

const pick = <T>(...vals: (T | undefined)[]) => vals.find(v => v !== undefined && v !== null && (!Array.isArray(v) || v.length > 0))

export async function extractMetadata(file: string, format: string): Promise<ExtractedMeta> {
  const fromName = metaFromFilename(file)
  let embedded: ExtractedMeta = {}
  try {
    embedded = (await extractors[format]?.(file)) ?? {}
  } catch (e) {
    console.warn(`[extract] ${path.basename(file)}: ${(e as Error).message}`)
  }
  const sidecar = await calibreSidecar(file)
  const keys: (keyof ExtractedMeta)[] = ['title', 'subtitle', 'authors', 'description', 'publisher', 'published', 'language', 'isbns', 'series', 'seriesIndex', 'tags', 'pageCount', 'cover']
  const out: ExtractedMeta = {}
  for (const k of keys) (out as Record<string, unknown>)[k] = pick(sidecar?.[k], embedded[k], fromName[k])
  return out
}
