import fs from 'node:fs/promises'
import path from 'node:path'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { zipSync, strToU8 } from 'fflate'
import { config, paths } from './config.ts'
import { readRarPages } from './extract/comic.ts'
import type { BookRow } from './books.ts'
import type { FormatInfo } from './formats.ts'

const run = promisify(execFile)
const inflight = new Map<string, Promise<string>>()

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

export interface SourceFile { id: number; path: string; mtime: number }

/** Returns a path to a file the reader can open: the original, or a cached conversion. */
export async function readableFile(book: BookRow, info: FormatInfo, src: SourceFile): Promise<{ file: string; format: string }> {
  if (!info.convertTo) return { file: src.path, format: info.format }
  const out = path.join(paths.cache, `${book.id}-f${src.id}-${src.mtime}.${info.convertTo}`)
  try {
    await fs.access(out)
    return { file: out, format: info.convertTo }
  } catch { /* convert below */ }
  let job = inflight.get(out)
  if (!job) {
    job = convert(book, info, src, out).finally(() => inflight.delete(out))
    inflight.set(out, job)
  }
  return { file: await job, format: info.convertTo }
}

async function convert(book: BookRow, info: FormatInfo, src: SourceFile, out: string): Promise<string> {
  // drop stale conversions of this file (and ones from before files were tracked separately)
  for (const f of await fs.readdir(paths.cache)) {
    if (f.startsWith(`${book.id}-f${src.id}-`) || new RegExp(`^${book.id}-\\d+\\.`).test(f)) await fs.rm(path.join(paths.cache, f), { force: true })
  }
  const tmp = out + '.tmp'
  if (info.needsCalibre) {
    await run(config.calibreConvert, [src.path, tmp.replace(/\.tmp$/, '.tmp.epub')], { timeout: 10 * 60_000 })
    await fs.rename(tmp.replace(/\.tmp$/, '.tmp.epub'), out)
    return out
  }
  let data: Uint8Array
  if (info.format === 'cbr') data = await cbrToCbz(src.path)
  else data = await textToEpub(book, src.path, info.format)
  await fs.writeFile(tmp, data)
  await fs.rename(tmp, out)
  return out
}

async function cbrToCbz(file: string): Promise<Uint8Array> {
  const { pages, comicInfo } = await readRarPages(file)
  const width = String(pages.length).length
  const files: Record<string, [Uint8Array, { level: 0 }]> = {}
  pages.forEach((p, i) => {
    files[`${String(i + 1).padStart(width, '0')}${path.extname(p.name).toLowerCase()}`] = [p.data, { level: 0 }]
  })
  if (comicInfo) files['ComicInfo.xml'] = [strToU8(comicInfo), { level: 0 }]
  return zipSync(files)
}

function decodeText(buf: Buffer): string {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(buf).replace(/^﻿/, '')
  } catch {
    return new TextDecoder('windows-1252').decode(buf)
  }
}

const CHAPTER = /^\s*(?:(?:chapter|part|book|prologue|epilogue|interlude)\b[^\n]{0,60}|[IVXLC]+\.?|\d{1,3}\.?|#{1,2}\s+[^\n]+)\s*$/i

interface Chapter { title: string; body: string }

function splitText(text: string, markdown: boolean): Chapter[] {
  const lines = text.replace(/\r\n?/g, '\n').split('\n')
  const blankSeparated = /\n\s*\n/.test(text)
  const chapters: Chapter[] = []
  let cur: Chapter = { title: 'Start', body: '' }
  let para: string[] = []
  const flushPara = () => {
    if (!para.length) return
    let html = esc(para.join(' ').trim())
    if (markdown) html = html.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>').replace(/\*(.+?)\*/g, '<em>$1</em>').replace(/`(.+?)`/g, '<code>$1</code>')
    if (html) cur.body += `<p>${html}</p>\n`
    para = []
  }
  for (const line of lines) {
    const trimmed = line.trim()
    const isHeading = trimmed.length > 0 && trimmed.length < 80 && CHAPTER.test(trimmed) && (!markdown || trimmed.startsWith('#'))
    if (isHeading) {
      flushPara()
      if (cur.body.trim()) chapters.push(cur)
      const title = trimmed.replace(/^#+\s*/, '')
      cur = { title, body: `<h2>${esc(title)}</h2>\n` }
    } else if (!trimmed) {
      flushPara()
    } else {
      para.push(trimmed)
      if (!blankSeparated) flushPara()
    }
  }
  flushPara()
  if (cur.body.trim()) chapters.push(cur)

  // No headings found? Chunk long texts so pagination stays fast.
  if (chapters.length === 1 && chapters[0].body.length > 120_000) {
    const paras = chapters[0].body.split('\n')
    chapters.length = 0
    for (let i = 0; i < paras.length; i += 400) chapters.push({ title: `Part ${chapters.length + 1}`, body: paras.slice(i, i + 400).join('\n') })
  }
  return chapters.length ? chapters : [{ title: 'Text', body: '<p></p>' }]
}

async function textToEpub(book: BookRow, file: string, format: string): Promise<Uint8Array> {
  const raw = decodeText(await fs.readFile(file))
  const title = esc(book.title)
  const lang = book.language ?? 'en'
  let chapters: Chapter[]
  let mediaType = 'application/xhtml+xml'
  if (format === 'html') {
    // Keep the author's markup; parse leniently as HTML.
    chapters = [{ title: book.title, body: raw }]
    mediaType = 'text/html'
  } else {
    chapters = splitText(raw, format === 'md')
  }

  const xhtml = (c: Chapter) => format === 'html' ? c.body : `<?xml version="1.0" encoding="utf-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" xml:lang="${lang}" lang="${lang}"><head><meta charset="utf-8"/><title>${esc(c.title)}</title></head>
<body>
${c.body}
</body></html>`

  const ext = format === 'html' ? 'html' : 'xhtml'
  const files: Record<string, Uint8Array | [Uint8Array, { level: 0 }]> = {
    mimetype: [strToU8('application/epub+zip'), { level: 0 }],
    'META-INF/container.xml': strToU8(`<?xml version="1.0"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles>
</container>`),
    'OEBPS/nav.xhtml': strToU8(`<?xml version="1.0" encoding="utf-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops"><head><title>${title}</title></head>
<body><nav epub:type="toc"><ol>
${chapters.map((c, i) => `<li><a href="c${i}.${ext}">${esc(c.title)}</a></li>`).join('\n')}
</ol></nav></body></html>`),
    'OEBPS/content.opf': strToU8(`<?xml version="1.0" encoding="utf-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="id">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:identifier id="id">caravan-${book.id}</dc:identifier>
    <dc:title>${title}</dc:title>
    <dc:language>${esc(lang)}</dc:language>
    <meta property="dcterms:modified">${new Date().toISOString().slice(0, 19)}Z</meta>
  </metadata>
  <manifest>
    <item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>
${chapters.map((_, i) => `    <item id="c${i}" href="c${i}.${ext}" media-type="${mediaType}"/>`).join('\n')}
  </manifest>
  <spine>
${chapters.map((_, i) => `    <itemref idref="c${i}"/>`).join('\n')}
  </spine>
</package>`),
  }
  chapters.forEach((c, i) => { files[`OEBPS/c${i}.${ext}`] = strToU8(xhtml(c)) })
  return zipSync(files)
}
