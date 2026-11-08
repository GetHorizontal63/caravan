/** A candidate match returned by a remote metadata provider. */
export interface RemoteBook {
  provider: 'openlibrary' | 'googlebooks'
  providerId: string
  title: string
  subtitle?: string
  authors: string[]
  description?: string
  publisher?: string
  published?: string
  language?: string
  isbn13?: string
  isbn10?: string
  pageCount?: number
  series?: string
  seriesIndex?: number
  tags?: string[]
  coverUrl?: string
  /** 0..1 similarity to what we searched for (filled by the matcher) */
  score?: number
  /** set when several providers' records were merged */
  coverUrls?: string[]
  providerIds?: Record<string, string>
}

export interface SearchQuery {
  isbn?: string
  title?: string
  author?: string
}
