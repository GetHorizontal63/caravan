import fs from 'node:fs/promises'
import { openZip } from '../util/zip.ts'
import { normalizeIsbn } from '../metadata/isbn.ts'
import { xml } from './opf.ts'
import { attr, list, stripHtml, text, type ExtractedMeta } from './types.ts'

async function loadFb2Source(file: string): Promise<string> {
  if (/\.(fbz|fb2\.zip)$/i.test(file)) {
    const zip = await openZip(file)
    try {
      const name = zip.names.find(n => n.toLowerCase().endsWith('.fb2')) ?? zip.names[0]
      return (await zip.read(name))?.toString('utf8') ?? ''
    } finally { zip.close() }
  }
  const buf = await fs.readFile(file)
  const head = buf.subarray(0, 200).toString('latin1')
  const enc = /encoding=["']([\w-]+)["']/i.exec(head)?.[1]?.toLowerCase()
  try {
    return new TextDecoder(enc && enc !== 'utf-8' ? enc : 'utf-8').decode(buf)
  } catch {
    return buf.toString('utf8')
  }
}

export async function extractFb2(file: string): Promise<ExtractedMeta> {
  const doc = xml.parse(await loadFb2Source(file))
  const fb = doc.FictionBook ?? {}
  const ti = fb.description?.['title-info'] ?? {}
  const pi = fb.description?.['publish-info'] ?? {}

  const authors = list(ti.author).map(a => {
    const parts = [text(a['first-name']), text(a['middle-name']), text(a['last-name'])].filter(Boolean)
    return parts.length ? parts.join(' ') : text(a.nickname)
  }).filter((s): s is string => !!s)

  const seq = list(ti.sequence)[0]
  const isbn = normalizeIsbn(text(pi.isbn))

  const meta: ExtractedMeta = {
    title: text(ti['book-title']),
    authors: authors.length ? authors : undefined,
    description: stripHtml(annotationText(ti.annotation)),
    language: text(ti.lang),
    tags: list(ti.genre).map(text).filter((s): s is string => !!s),
    series: attr(seq, 'name'),
    seriesIndex: Number(attr(seq, 'number')) || undefined,
    publisher: text(pi.publisher),
    published: text(pi.year) ?? text(ti.date),
    isbns: isbn ? [isbn] : [],
  }

  const coverRef = attr(list(ti.coverpage?.image)[0], 'href')?.replace(/^#/, '')
  if (coverRef) {
    const bin = list(fb.binary).find(b => attr(b, 'id') === coverRef)
    const data = text(bin)
    if (data) meta.cover = { data: Buffer.from(data.replace(/\s+/g, ''), 'base64'), mime: attr(bin, 'content-type') }
  }
  return meta
}

/** Annotation is nested <p> elements; flatten whatever the parser produced into text. */
function annotationText(node: unknown): string | undefined {
  if (node == null) return undefined
  if (typeof node !== 'object') return String(node)
  const out: string[] = []
  const walk = (n: unknown) => {
    if (n == null) return
    if (typeof n !== 'object') { out.push(String(n)); return }
    if (Array.isArray(n)) { n.forEach(walk); return }
    for (const [k, v] of Object.entries(n as Record<string, unknown>)) {
      if (k.startsWith('@_')) continue
      walk(v)
      if (k === 'p') out.push('\n')
    }
  }
  walk(node)
  return out.join(' ').replace(/ *\n */g, '\n').trim()
}
