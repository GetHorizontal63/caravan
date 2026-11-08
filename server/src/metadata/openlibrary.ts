import { getJson } from './http.ts'
import { normalizeIsbn, toIsbn10 } from './isbn.ts'
import type { RemoteBook, SearchQuery } from './types.ts'

const OL = 'https://openlibrary.org'
const cover = (id: number | undefined) => (id && id > 0 ? `https://covers.openlibrary.org/b/id/${id}-L.jpg?default=false` : undefined)
const desc = (d: unknown) => (typeof d === 'string' ? d : (d as { value?: string } | undefined)?.value)

export async function lookupIsbn(isbn: string): Promise<RemoteBook | undefined> {
  const data = await getJson<Record<string, any>>(`${OL}/api/books?bibkeys=ISBN:${isbn}&format=json&jscmd=data`)
  const b = data?.[`ISBN:${isbn}`]
  if (!b) return undefined
  const ids = b.identifiers ?? {}
  const isbn13 = normalizeIsbn(ids.isbn_13?.[0]) ?? normalizeIsbn(ids.isbn_10?.[0]) ?? isbn
  const book: RemoteBook = {
    provider: 'openlibrary',
    providerId: String(b.key ?? '').replace('/books/', ''),
    title: b.title,
    subtitle: b.subtitle,
    authors: (b.authors ?? []).map((a: { name: string }) => a.name),
    publisher: b.publishers?.[0]?.name,
    published: b.publish_date,
    pageCount: b.number_of_pages,
    isbn13,
    isbn10: toIsbn10(isbn13),
    tags: (b.subjects ?? []).slice(0, 12).map((s: { name: string }) => s.name),
    coverUrl: b.cover?.large ? `${b.cover.large}?default=false` : `https://covers.openlibrary.org/b/isbn/${isbn13}-L.jpg?default=false`,
  }
  return enrich(book)
}

/** Fetch description / series / language from the edition + work records. */
export async function enrich(book: RemoteBook): Promise<RemoteBook> {
  if (book.description) return book
  const key = book.providerId
  let workKey: string | undefined
  if (/^OL\d+M$/.test(key)) {
    const ed = await getJson<any>(`${OL}/books/${key}.json`)
    if (ed) {
      book.description ??= desc(ed.description)
      book.language ??= ed.languages?.[0]?.key?.replace('/languages/', '')
      workKey = ed.works?.[0]?.key
    }
  } else if (/^OL\d+W$/.test(key)) {
    workKey = `/works/${key}`
  }
  if (workKey && !book.description) {
    const work = await getJson<any>(`${OL}${workKey}.json`)
    book.description = desc(work?.description)
    if (!book.tags?.length && work?.subjects) book.tags = work.subjects.slice(0, 12)
  }
  if (book.description) book.description = book.description.replace(/\r\n/g, '\n')
    .replace(/\[([^\]]+)\]\((?:https?:\/\/|\/)[^)]*\)/g, '$1') // markdown links → text
    .replace(/^-{3,}[\s\S]*$/m, '') // trailing "----------" link lists.replace(/\(\[source\]\[\d+\]\)|\[\d+\]: http\S+/g, '').trim()
  return book
}

export async function search(q: SearchQuery): Promise<RemoteBook[]> {
  if (q.isbn) {
    const b = await lookupIsbn(q.isbn)
    return b ? [b] : []
  }
  const params = new URLSearchParams({
    limit: '12',
    fields: 'key,title,subtitle,author_name,first_publish_year,isbn,cover_i,publisher,language,number_of_pages_median,subject,cover_edition_key',
  })
  if (q.title) params.set('title', q.title)
  if (q.author) params.set('author', q.author)
  const data = await getJson<{ docs?: any[] }>(`${OL}/search.json?${params}`)
  return (data?.docs ?? []).map(d => {
    const isbn13 = (d.isbn as string[] | undefined)?.map(normalizeIsbn).find(Boolean)
    return {
      provider: 'openlibrary' as const,
      providerId: d.cover_edition_key ?? String(d.key).replace('/works/', ''),
      title: d.title,
      subtitle: d.subtitle,
      authors: d.author_name ?? [],
      publisher: d.publisher?.[0],
      published: d.first_publish_year ? String(d.first_publish_year) : undefined,
      language: d.language?.[0],
      pageCount: d.number_of_pages_median,
      isbn13,
      isbn10: isbn13 ? toIsbn10(isbn13) : undefined,
      tags: (d.subject ?? []).slice(0, 12),
      coverUrl: cover(d.cover_i),
    }
  })
}
