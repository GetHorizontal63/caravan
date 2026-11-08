import fs from 'node:fs/promises'
import { findIsbns } from '../metadata/isbn.ts'
import type { ExtractedMeta } from './types.ts'

type PdfJs = typeof import('pdfjs-dist/legacy/build/pdf.mjs')
let pdfjs: Promise<PdfJs> | undefined
const loadPdfJs = () => (pdfjs ??= import('pdfjs-dist/legacy/build/pdf.mjs'))

/** "D:20190312094500+01'00'" → "2019-03-12" */
const pdfDate = (s: unknown) => {
  const m = typeof s === 'string' ? /^(?:D:)?(\d{4})(\d{2})?(\d{2})?/.exec(s) : null
  return m ? [m[1], m[2], m[3]].filter(Boolean).join('-') : undefined
}

export async function extractPdf(file: string): Promise<ExtractedMeta> {
  const { getDocument } = await loadPdfJs()
  const data = new Uint8Array(await fs.readFile(file))
  const task = getDocument({ data, disableFontFace: true, useSystemFonts: false, verbosity: 0 })
  const doc = await task.promise
  try {
    const { info } = (await doc.getMetadata()) as { info: Record<string, unknown> }
    const str = (k: string) => (typeof info?.[k] === 'string' && (info[k] as string).trim()) || undefined
    const author = str('Author')
    const meta: ExtractedMeta = {
      title: str('Title'),
      authors: author ? author.split(/\s*(?:;|&|\band\b)\s*/).filter(Boolean) : undefined,
      description: str('Subject'),
      tags: str('Keywords')?.split(/\s*[,;]\s*/).filter(Boolean),
      published: pdfDate(info?.CreationDate),
      pageCount: doc.numPages,
    }
    // Junk titles from word processors ("Microsoft Word - foo.docx", "untitled")
    if (meta.title && /^(untitled|microsoft word|document\d*$)|\.(docx?|indd|pdf)$/i.test(meta.title)) meta.title = undefined

    // ISBN usually on the copyright page in the first few pages
    const pages = Math.min(doc.numPages, 8)
    for (let i = 1; i <= pages && !meta.isbns?.length; i++) {
      const page = await doc.getPage(i)
      const content = await page.getTextContent()
      const txt = content.items.map(it => ('str' in it ? it.str : '')).join(' ')
      const found = findIsbns(txt)
      if (found.length) meta.isbns = found
      page.cleanup()
    }

    meta.cover = await renderFirstPage(doc).catch(() => undefined)
    return meta
  } finally {
    await task.destroy()
  }
}

/** Renders page 1 to PNG when pdf.js has a Node canvas backend (@napi-rs/canvas) available. */
async function renderFirstPage(doc: any): Promise<ExtractedMeta['cover']> {
  const page = await doc.getPage(1)
  const base = page.getViewport({ scale: 1 })
  const viewport = page.getViewport({ scale: Math.min(3, 900 / base.height) })
  const factory = doc.canvasFactory
  if (!factory) return undefined
  const { canvas, context } = factory.create(Math.ceil(viewport.width), Math.ceil(viewport.height))
  await page.render({ canvasContext: context, viewport, canvas }).promise
  const data: Buffer = canvas.toBuffer('image/png')
  return data?.length ? { data, mime: 'image/png' } : undefined
}
