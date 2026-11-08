import { db, getSettings, now, tx } from '../db.ts'
import { getBook, setAuthors, setTags, sortTitle, authorsOf, touchBook } from '../books.ts'
import { fetchCover, storeCover, deleteCover } from '../covers.ts'
import { safeJson } from '../auth.ts'
import * as openlibrary from './openlibrary.ts'
import * as googlebooks from './googlebooks.ts'
import { normalizeIsbn, toIsbn10 } from './isbn.ts'
import type { RemoteBook, SearchQuery } from './types.ts'

export type { RemoteBook } from './types.ts'

// ---- fuzzy matching -------------------------------------------------------

const norm = (s: string | undefined) =>
  (s ?? '').toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '')
    .replace(/[:(\[].*$/, '') // drop subtitles / bracketed noise
    .replace(/[^\p{L}\p{N}\s]/gu, ' ').replace(/\b(the|a|an)\b/g, ' ').replace(/\s+/g, ' ').trim()

function dice(a: string, b: string): number {
  if (!a || !b) return 0
  if (a === b) return 1
  const grams = (s: string) => { const m = new Map<string, number>(); for (let i = 0; i < s.length - 1; i++) { const g = s.slice(i, i + 2); m.set(g, (m.get(g) ?? 0) + 1) } return m }
  const ga = grams(a), gb = grams(b)
  let hit = 0
  for (const [g, n] of ga) hit += Math.min(n, gb.get(g) ?? 0)
  return (2 * hit) / (a.length - 1 + b.length - 1)
}

export function score(r: RemoteBook, q: SearchQuery): number {
  if (q.isbn && (r.isbn13 === q.isbn)) return 1
  const t = dice(norm(r.title), norm(q.title))
  if (!q.author) return t
  const surnames = (xs: string[]) => xs.map(x => norm(x).split(' ').pop() ?? '')
  const qa = surnames([q.author])[0]
  const a = Math.max(0, ...surnames(r.authors).map(s => dice(s, qa)))
  return t * 0.7 + a * 0.3
}

// ---- provider fan-out -----------------------------------------------------

export async function searchProviders(q: SearchQuery): Promise<RemoteBook[]> {
  const settings = getSettings()
  const isbn = normalizeIsbn(q.isbn)
  const query = { ...q, isbn }
  const runs = settings.providers.map(p =>
    p === 'openlibrary' ? openlibrary.search(query)
      : p === 'googlebooks' ? googlebooks.search(query, settings.googleBooksApiKey)
        : Promise.resolve([] as RemoteBook[]))
  const results = (await Promise.allSettled(runs)).flatMap(r => (r.status === 'fulfilled' ? r.value : []))
  for (const r of results) r.score = score(r, query)
  // keep provider order for ties so the preferred provider wins
  return results.filter(r => r.title).sort((a, b) => (b.score ?? 0) - (a.score ?? 0))
}

async function enrich(r: RemoteBook): Promise<RemoteBook> {
  try {
    return r.provider === 'openlibrary' ? await openlibrary.enrich(r) : await googlebooks.enrich(r, getSettings().googleBooksApiKey)
  } catch {
    return r
  }
}

/** Merge several provider records for the same book: first wins, others fill gaps (covers too). */
function merge(records: RemoteBook[]): RemoteBook {
  const [first, ...rest] = records
  const out: RemoteBook = { ...first }
  for (const r of rest) {
    for (const [k, v] of Object.entries(r) as [keyof RemoteBook, unknown][]) {
      const cur = out[k]
      if ((cur === undefined || cur === '' || (Array.isArray(cur) && !cur.length)) && v !== undefined) (out as any)[k] = v
    }
    // prefer the longer description
    if ((r.description?.length ?? 0) > (out.description?.length ?? 0) * 1.5) out.description = r.description
  }
  out.coverUrls = records.map(r => r.coverUrl).filter((u): u is string => !!u)
  out.providerIds = Object.fromEntries(records.map(r => [r.provider, r.providerId]))
  return out
}

// ---- applying ---------------------------------------------------------------

export interface ApplyOptions {
  /** replace = overwrite every field (manual "Identify"); fill = only fill blanks (automatic scan) */
  mode: 'replace' | 'fill'
  replaceCover?: boolean
}

export async function applyRemote(bookId: number, remote: RemoteBook, opts: ApplyOptions) {
  const book = getBook(bookId)
  if (!book) throw new Error('Book not found')
  const full = remote.description ? remote : await enrich(remote)
  const replace = opts.mode === 'replace'
  const want = <T>(cur: T | null, next: T | undefined): T | null => (next === undefined || next === null || next === '' ? cur : replace || cur === null || cur === '' ? next : cur)

  const remoteIsbn = normalizeIsbn(full.isbn13)
  const isbn13 = (replace ? remoteIsbn ?? book.isbn13 : book.isbn13 ?? remoteIsbn) ?? null
  const isbn10 = (isbn13 ? toIsbn10(isbn13) : undefined) ?? book.isbn10 ?? null
  const providerIds = { ...safeJson<Record<string, string>>(book.provider_ids, {}), ...(full.providerIds ?? { [full.provider]: full.providerId }) }
  const title = want(book.title, full.title) ?? book.title

  tx(() => {
    db.prepare(`UPDATE books SET title = ?, sort_title = ?, subtitle = ?, description = ?, publisher = ?, published = ?, language = ?,
      isbn13 = ?, isbn10 = ?, page_count = ?, series = ?, series_index = ?, provider_ids = ?, metadata_source = ?, metadata_checked = ?, updated_at = ?
      WHERE id = ?`).run(
      title, sortTitle(title), want(book.subtitle, full.subtitle), want(book.description, full.description),
      want(book.publisher, full.publisher), want(book.published, full.published), want(book.language, full.language),
      isbn13, isbn10,
      want(book.page_count, full.pageCount), want(book.series, full.series), want(book.series_index, full.seriesIndex),
      JSON.stringify(providerIds), replace || book.metadata_source === 'file' ? full.provider : book.metadata_source, now(), now(), bookId)
    if (full.authors?.length && (replace || !authorsOf(bookId).length)) setAuthors(bookId, full.authors)
    if (full.tags?.length && replace) setTags(bookId, full.tags)
  })

  if (!book.cover || opts.replaceCover || book.cover_source === 'generated') {
    const urls = [...(full.coverUrls ?? []), full.coverUrl].filter((u): u is string => !!u)
    if (isbn13) urls.push(`https://covers.openlibrary.org/b/isbn/${isbn13}-L.jpg?default=false`)
    for (const url of [...new Set(urls)]) {
      const data = await fetchCover(url)
      if (!data) continue
      const name = await storeCover(bookId, data)
      if (name) {
        await deleteCover(book.cover)
        db.prepare('UPDATE books SET cover = ?, cover_source = ? WHERE id = ?').run(name, url.includes('openlibrary') ? 'openlibrary' : 'googlebooks', bookId)
        break
      }
    }
  }
  touchBook(bookId)
  return getBook(bookId)
}

/**
 * Automatic identification used by the scanner:
 *  1. ISBN known → look it up on every provider and merge.
 *  2. Otherwise → title/author search, accept only a confident match.
 */
export async function autoIdentify(bookId: number): Promise<boolean> {
  const book = getBook(bookId)
  if (!book || book.metadata_locked) return false
  db.prepare('UPDATE books SET metadata_checked = ? WHERE id = ?').run(now(), bookId)
  const author = authorsOf(bookId)[0]?.name

  let matches: RemoteBook[] = []
  if (book.isbn13) {
    matches = (await searchProviders({ isbn: book.isbn13 })).filter(r => r.isbn13 === book.isbn13 || r.score === 1)
    // Google returns the volume even when its listed ISBN differs; keep any result for an ISBN query
    if (!matches.length) matches = await searchProviders({ isbn: book.isbn13 })
  }
  if (!matches.length && book.title) {
    const results = await searchProviders({ title: book.title, author })
    const best = results[0]
    const threshold = author ? 0.8 : 0.92
    if (best && (best.score ?? 0) >= threshold) {
      // merge in other providers' records for the same work (same ISBN or near-identical title)
      matches = results.filter(r => r === best || (best.isbn13 && r.isbn13 === best.isbn13) || (r.provider !== best.provider && (r.score ?? 0) >= threshold)).slice(0, 3)
    }
  }
  if (!matches.length) return false
  const enriched = await Promise.all(matches.slice(0, 3).map(enrich))
  await applyRemote(bookId, merge(enriched), { mode: 'fill' })
  return true
}

/** Background queue so scans finish quickly while metadata trickles in. */
const queue: number[] = []
let running = false
export const metadataQueue = {
  get pending() { return queue.length + (running ? 1 : 0) },
  push(...ids: number[]) {
    for (const id of ids) if (!queue.includes(id)) queue.push(id)
    void this.drain()
  },
  async drain() {
    if (running) return
    running = true
    try {
      while (queue.length) {
        const id = queue.shift()!
        try { await autoIdentify(id) } catch (e) { console.warn(`[metadata] book ${id}: ${(e as Error).message}`) }
      }
    } finally { running = false }
  },
}
