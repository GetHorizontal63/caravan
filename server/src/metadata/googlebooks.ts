import { getJson } from './http.ts'
import { normalizeIsbn, toIsbn10 } from './isbn.ts'
import { stripHtml } from '../extract/types.ts'
import type { RemoteBook, SearchQuery } from './types.ts'

const API = 'https://www.googleapis.com/books/v1/volumes'

function bestImage(links: Record<string, string> | undefined): string | undefined {
  if (!links) return undefined
  const url = links.extraLarge ?? links.large ?? links.medium ?? links.small ?? links.thumbnail ?? links.smallThumbnail
  if (!url) return undefined
  // Ask Google's image server for a large rendition and drop the page-curl effect.
  return url.replace(/^http:/, 'https:').replace(/&edge=curl/, '').replace(/&zoom=\d/, '') + '&fife=w800-h1200'
}

function toRemote(item: any): RemoteBook {
  const v = item.volumeInfo ?? {}
  const ids: { type: string; identifier: string }[] = v.industryIdentifiers ?? []
  const isbn13 = normalizeIsbn(ids.find(i => i.type === 'ISBN_13')?.identifier) ?? normalizeIsbn(ids.find(i => i.type === 'ISBN_10')?.identifier)
  return {
    provider: 'googlebooks',
    providerId: item.id,
    title: v.title,
    subtitle: v.subtitle,
    authors: v.authors ?? [],
    description: stripHtml(v.description),
    publisher: v.publisher,
    published: v.publishedDate,
    language: v.language,
    pageCount: v.pageCount || v.printedPageCount,
    isbn13,
    isbn10: isbn13 ? toIsbn10(isbn13) : undefined,
    tags: (v.categories ?? []).flatMap((c: string) => c.split(/\s*\/\s*/)).filter((c: string, i: number, a: string[]) => a.indexOf(c) === i),
    coverUrl: bestImage(v.imageLinks),
  }
}

const withKey = (url: string, key: string) => (key ? `${url}&key=${encodeURIComponent(key)}` : url)

export async function search(q: SearchQuery, apiKey: string): Promise<RemoteBook[]> {
  const terms: string[] = []
  if (q.isbn) terms.push(`isbn:${q.isbn}`)
  else {
    if (q.title) terms.push(`intitle:${q.title}`)
    if (q.author) terms.push(`inauthor:${q.author}`)
  }
  if (!terms.length) return []
  const data = await getJson<{ items?: any[] }>(withKey(`${API}?q=${encodeURIComponent(terms.join(' '))}&maxResults=12&printType=books`, apiKey), 250)
  return (data?.items ?? []).map(toRemote).filter(b => b.title)
}

/** The single-volume endpoint has the full description and larger images. */
export async function enrich(book: RemoteBook, apiKey: string): Promise<RemoteBook> {
  const item = await getJson<any>(withKey(`${API}/${encodeURIComponent(book.providerId)}?`, apiKey), 250)
  if (!item) return book
  const full = toRemote(item)
  return { ...book, ...Object.fromEntries(Object.entries(full).filter(([, v]) => v !== undefined && !(Array.isArray(v) && !v.length))) } as RemoteBook
}
