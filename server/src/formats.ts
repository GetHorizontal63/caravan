import path from 'node:path'
import { config } from './config.ts'

/**
 * How each file type reaches the reader:
 *  - "foliate": rendered natively in the browser by foliate-js (EPUB, MOBI/AZW3, FB2, CBZ)
 *  - "pdf":     rendered by pdf.js
 *  - "convert": converted server-side on first open, then rendered by foliate-js
 */
export type Engine = 'foliate' | 'pdf'

export interface FormatInfo {
  format: string
  label: string
  mime: string
  engine: Engine
  /** Server converts the file to this format before handing it to the reader. */
  convertTo?: 'epub' | 'cbz'
  comic?: boolean
  /** Needs Calibre's ebook-convert to be configured. */
  needsCalibre?: boolean
}

const F = (format: string, label: string, mime: string, engine: Engine, extra: Partial<FormatInfo> = {}): FormatInfo =>
  ({ format, label, mime, engine, ...extra })

const table: Record<string, FormatInfo> = {
  epub: F('epub', 'EPUB', 'application/epub+zip', 'foliate'),
  kepub: F('epub', 'Kobo EPUB', 'application/epub+zip', 'foliate'),
  mobi: F('mobi', 'MOBI', 'application/x-mobipocket-ebook', 'foliate'),
  prc: F('mobi', 'MOBI', 'application/x-mobipocket-ebook', 'foliate'),
  azw: F('azw', 'Kindle AZW', 'application/vnd.amazon.ebook', 'foliate'),
  azw3: F('azw3', 'Kindle AZW3/KF8', 'application/vnd.amazon.ebook', 'foliate'),
  fb2: F('fb2', 'FictionBook', 'application/x-fictionbook+xml', 'foliate'),
  fbz: F('fbz', 'FictionBook (zip)', 'application/x-zip-compressed-fb2', 'foliate'),
  cbz: F('cbz', 'Comic (CBZ)', 'application/vnd.comicbook+zip', 'foliate', { comic: true }),
  cbr: F('cbr', 'Comic (CBR)', 'application/vnd.comicbook-rar', 'foliate', { comic: true, convertTo: 'cbz' }),
  pdf: F('pdf', 'PDF', 'application/pdf', 'pdf'),
  txt: F('txt', 'Plain text', 'text/plain', 'foliate', { convertTo: 'epub' }),
  md: F('md', 'Markdown', 'text/markdown', 'foliate', { convertTo: 'epub' }),
  html: F('html', 'HTML', 'text/html', 'foliate', { convertTo: 'epub' }),
  htm: F('html', 'HTML', 'text/html', 'foliate', { convertTo: 'epub' }),
  // Calibre-only formats
  docx: F('docx', 'Word', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'foliate', { convertTo: 'epub', needsCalibre: true }),
  odt: F('odt', 'OpenDocument', 'application/vnd.oasis.opendocument.text', 'foliate', { convertTo: 'epub', needsCalibre: true }),
  rtf: F('rtf', 'RTF', 'application/rtf', 'foliate', { convertTo: 'epub', needsCalibre: true }),
  lit: F('lit', 'Microsoft LIT', 'application/x-ms-reader', 'foliate', { convertTo: 'epub', needsCalibre: true }),
  pdb: F('pdb', 'Palm eReader', 'application/vnd.palm', 'foliate', { convertTo: 'epub', needsCalibre: true }),
  lrf: F('lrf', 'Sony LRF', 'application/x-sony-bbeb', 'foliate', { convertTo: 'epub', needsCalibre: true }),
}

export function formatOf(file: string): FormatInfo | undefined {
  const lower = file.toLowerCase()
  if (lower.endsWith('.fb2.zip')) return table.fbz
  if (lower.endsWith('.kepub.epub')) return table.kepub
  const info = table[path.extname(lower).slice(1)]
  if (!info) return undefined
  if (info.needsCalibre && !config.calibreConvert) return undefined
  return info
}

export const supportedExtensions = () => Object.keys(table).filter(ext => !table[ext].needsCalibre || config.calibreConvert)
