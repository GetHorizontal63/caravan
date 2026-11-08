import { XMLParser } from 'fast-xml-parser'
import { findIsbns, normalizeIsbn } from '../metadata/isbn.ts'
import { attr, list, stripHtml, text, type ExtractedMeta } from './types.ts'

export const xml = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  removeNSPrefix: true,
  parseTagValue: false,
  parseAttributeValue: false,
  trimValues: true,
  processEntities: true,
  htmlEntities: true,
})

export interface ParsedOpf {
  meta: ExtractedMeta
  /** manifest href of the cover image, relative to the OPF file */
  coverHref?: string
  spine: string[]
}

/** Parse an OPF package document (EPUB content.opf or Calibre metadata.opf). */
export function parseOpf(source: string): ParsedOpf {
  const doc = xml.parse(source)
  const pkg = doc.package ?? {}
  const md = pkg.metadata ?? {}
  const metas = list(md.meta)

  const metaByName = (name: string) => metas.find(m => attr(m, 'name') === name)
  const refines = (id: string | undefined, prop: string) =>
    id ? text(metas.find(m => attr(m, 'refines') === '#' + id && attr(m, 'property') === prop)) : undefined

  // titles: EPUB3 may mark a subtitle via refines/title-type
  let title: string | undefined
  let subtitle: string | undefined
  for (const t of list(md.title)) {
    const type = refines(attr(t, 'id'), 'title-type')
    if (type === 'subtitle') subtitle ??= text(t)
    else title ??= text(t)
  }

  const authors: string[] = []
  for (const c of list(md.creator)) {
    const role = attr(c, 'role') ?? refines(attr(c, 'id'), 'role')
    const name = text(c)
    if (name && (!role || role === 'aut')) authors.push(name)
  }

  const isbns = new Set<string>()
  for (const id of list(md.identifier)) {
    const v = text(id) ?? ''
    const scheme = (attr(id, 'scheme') ?? '').toLowerCase()
    const n = normalizeIsbn(v.replace(/^urn:isbn:/i, ''))
    if (n && (scheme === 'isbn' || /isbn/i.test(v) || /^[\d-]{10,17}X?$/i.test(v))) isbns.add(n)
    else for (const i of findIsbns(v)) isbns.add(i)
  }

  // series: Calibre meta, or EPUB3 belongs-to-collection
  let series = text(metaByName('calibre:series')?.['@_content'])
  let seriesIndex = Number(text(metaByName('calibre:series_index')?.['@_content'])) || undefined
  const coll = metas.find(m => attr(m, 'property') === 'belongs-to-collection')
  if (!series && coll) {
    series = text(coll)
    seriesIndex = Number(refines(attr(coll, 'id'), 'group-position')) || undefined
  }

  const date = text(md.date)
  const meta: ExtractedMeta = {
    title,
    subtitle,
    authors: authors.length ? authors : undefined,
    description: stripHtml(text(md.description)),
    publisher: text(md.publisher),
    published: date && !date.startsWith('0101') ? date.slice(0, 10) : undefined,
    language: text(md.language),
    isbns: [...isbns],
    series,
    seriesIndex,
    tags: list(md.subject).map(text).filter((s): s is string => !!s),
  }

  // cover image
  const items = list(pkg.manifest?.item)
  const coverId = text(metaByName('cover')?.['@_content'])
  const coverItem =
    items.find(i => attr(i, 'properties')?.split(/\s+/).includes('cover-image')) ??
    items.find(i => coverId && attr(i, 'id') === coverId && /^image\//.test(attr(i, 'media-type') ?? '')) ??
    items.find(i => /cover/i.test(attr(i, 'id') ?? '') && /^image\//.test(attr(i, 'media-type') ?? ''))
  const guideCover = list(pkg.guide?.reference).find(r => attr(r, 'type') === 'cover')

  const byId = new Map(items.map(i => [attr(i, 'id'), attr(i, 'href')]))
  const spine = list(pkg.spine?.itemref).map(r => byId.get(attr(r, 'idref'))).filter((h): h is string => !!h)

  return { meta, coverHref: coverItem ? attr(coverItem, 'href') : (guideCover && /\.(jpe?g|png|gif|webp)$/i.test(attr(guideCover, 'href') ?? '') ? attr(guideCover, 'href') : undefined), spine }
}
