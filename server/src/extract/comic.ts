import fs from 'node:fs/promises'
import { createExtractorFromData } from 'node-unrar-js'
import { openZip, isImageName, naturalCompare, mimeFromName } from '../util/zip.ts'
import { xml } from './opf.ts'
import { stripHtml, text, type ExtractedMeta } from './types.ts'

/** ComicRack ComicInfo.xml → metadata */
function parseComicInfo(src: string | undefined): ExtractedMeta {
  if (!src) return {}
  const ci = xml.parse(src)?.ComicInfo ?? {}
  const writers = text(ci.Writer)?.split(/\s*,\s*/).filter(Boolean)
  const number = Number(text(ci.Number))
  const year = text(ci.Year)
  const month = text(ci.Month)
  return {
    title: text(ci.Title),
    series: text(ci.Series),
    seriesIndex: Number.isFinite(number) ? number : undefined,
    authors: writers?.length ? writers : undefined,
    description: stripHtml(text(ci.Summary)),
    publisher: text(ci.Publisher),
    published: year ? (month ? `${year}-${month.padStart(2, '0')}` : year) : undefined,
    language: text(ci.LanguageISO),
    tags: text(ci.Genre)?.split(/\s*,\s*/).filter(Boolean),
    pageCount: Number(text(ci.PageCount)) || undefined,
  }
}

export async function extractCbz(file: string): Promise<ExtractedMeta> {
  const zip = await openZip(file)
  try {
    const images = zip.names.filter(isImageName).filter(n => !n.startsWith('__MACOSX')).sort(naturalCompare)
    const infoName = zip.names.find(n => n.toLowerCase().endsWith('comicinfo.xml'))
    const meta = parseComicInfo(infoName ? (await zip.read(infoName))?.toString('utf8') : undefined)
    meta.pageCount ??= images.length
    if (images[0]) {
      const data = await zip.read(images[0])
      if (data) meta.cover = { data, mime: mimeFromName(images[0]) }
    }
    return meta
  } finally { zip.close() }
}

/** Reads a RAR archive fully into memory and returns its image pages in reading order. */
export async function readRarPages(file: string, onlyFirst = false): Promise<{ pages: { name: string; data: Uint8Array }[]; comicInfo?: string }> {
  const buf = await fs.readFile(file)
  const data = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer
  const extractor = await createExtractorFromData({ data })
  const names = [...extractor.getFileList().fileHeaders].filter(h => !h.flags.directory).map(h => h.name)
  const images = names.filter(isImageName).sort(naturalCompare)
  const infoName = names.find(n => n.toLowerCase().endsWith('comicinfo.xml'))
  const wanted = new Set(onlyFirst ? images.slice(0, 1) : images)
  if (infoName) wanted.add(infoName)
  const out = new Map<string, Uint8Array>()
  for (const f of extractor.extract({ files: [...wanted] }).files) {
    if (f.extraction) out.set(f.fileHeader.name, f.extraction)
  }
  return {
    pages: images.filter(n => out.has(n)).map(name => ({ name, data: out.get(name)! })),
    comicInfo: infoName && out.has(infoName) ? Buffer.from(out.get(infoName)!).toString('utf8') : undefined,
  }
}

export async function extractCbr(file: string): Promise<ExtractedMeta> {
  const { pages, comicInfo } = await readRarPages(file, true)
  const meta = parseComicInfo(comicInfo)
  if (pages[0]) meta.cover = { data: Buffer.from(pages[0].data), mime: mimeFromName(pages[0].name) }
  return meta
}
