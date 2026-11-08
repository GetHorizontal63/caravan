export interface ExtractedCover {
  data: Buffer
  mime?: string
}

export interface ExtractedMeta {
  title?: string
  subtitle?: string
  authors?: string[]
  description?: string
  publisher?: string
  published?: string
  language?: string
  isbns?: string[]
  series?: string
  seriesIndex?: number
  tags?: string[]
  pageCount?: number
  cover?: ExtractedCover
}

/** fast-xml-parser yields strings, {#text}, or arrays. Flatten to a trimmed string. */
export function text(node: unknown): string | undefined {
  if (node == null) return undefined
  if (Array.isArray(node)) return text(node[0])
  if (typeof node === 'object') return text((node as Record<string, unknown>)['#text'])
  const s = String(node).trim()
  return s || undefined
}

export const list = <T>(node: T | T[] | undefined | null): T[] =>
  node == null ? [] : Array.isArray(node) ? node : [node]

export const attr = (node: unknown, name: string): string | undefined =>
  node && typeof node === 'object' ? text((node as Record<string, unknown>)['@_' + name]) : undefined

export function stripHtml(html: string | undefined): string | undefined {
  if (!html) return undefined
  const s = html
    .replace(/<\s*(br|\/p|\/div|\/li|\/h\d)\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/[ \t]+/g, ' ').replace(/\n\s*\n\s*\n+/g, '\n\n')
    .trim()
  return s || undefined
}
