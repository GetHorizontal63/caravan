import { Fragment, useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { useInfiniteQuery } from '@tanstack/react-query'
import { api, spineUrl, type BookSummary } from '../api'
import { Empty, Spinner } from './ui'
import { hue } from './books'
import { useSelectable } from './selection'

/** 0..1, stable per string: the same book always gets the same height and style. */
function rand(s: string, salt = 0) {
  let h = 2166136261 ^ salt
  for (const c of s) h = Math.imul(h ^ c.charCodeAt(0), 16777619)
  return ((h >>> 0) % 10000) / 10000
}

/** Pick legible ink for a background colour. */
function inkFor(hex: string | null) {
  if (!hex) return '#F3E9D7'
  const n = parseInt(hex.slice(1), 16)
  const [r, g, b] = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map(v => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4 })
  return 0.2126 * r + 0.7152 * g + 0.0722 * b > 0.32 ? '#1B2238' : '#F3E9D7'
}

const surname = (name?: string) => (name ?? '').replace(/,.*$/, '').trim().split(/\s+/).pop() ?? ''

function Spine({ book, comic }: { book: BookSummary; comic: boolean }) {
  const selectable = useSelectable(book)
  const [ratio, setRatio] = useState<number>()
  const [imgFailed, setImgFailed] = useState(false)
  const img = !imgFailed ? spineUrl(book) : undefined

  // books in a series share a height and design, like a real set
  const seed = book.series ?? book.title
  const heightFrac = book.series ? 0.86 + rand(book.series) * 0.12 : 0.78 + rand(book.title) * 0.2
  const variant = Math.floor(rand(seed, 7) * 4)
  const pages = book.pageCount ?? 0
  const width = comic
    ? Math.round(Math.min(26, Math.max(14, 10 + pages / 8)))
    : Math.round(pages ? Math.min(64, Math.max(20, 14 + pages / 14)) : 24 + rand(book.title, 3) * 16)
  const color = book.coverColor ?? `hsl(${hue(seed)} 38% 30%)`

  const style = {
    '--w': `${width}px`,
    '--hf': heightFrac,
    '--c': color,
    '--ink': inkFor(book.coverColor),
    ...(img && ratio ? { '--w-img': ratio } : {}),
  } as CSSProperties
  const label = `${book.title}${book.series ? ` (${book.series}${book.seriesIndex != null ? ` #${book.seriesIndex}` : ''})` : ''}${book.authors.length ? ` by ${book.authors.join(', ')}` : ''}`

  return (
    <div className="spine-slot">
      <Link to={`/book/${book.id}`} className={`spine v${variant} ${img ? 'has-img' : ''} ${comic ? 'comic' : ''}`} style={style} title={label} aria-label={label} {...selectable}>
        {img ? (
          <img src={img} alt="" loading="lazy" decoding="async" draggable={false}
            onLoad={e => { const i = e.currentTarget; if (i.naturalHeight) setRatio(Math.min(0.5, i.naturalWidth / i.naturalHeight)) }}
            onError={() => setImgFailed(true)} />
        ) : (
          <>
            {book.series && book.seriesIndex != null && <span className="spine-num">{book.seriesIndex}</span>}
            {!comic && <span className="spine-title">{book.title}</span>}
            {!comic && book.authors[0] && <span className="spine-author">{surname(book.authors[0])}</span>}
          </>
        )}
        <span className="spine-gloss" aria-hidden />
        {book.finished ? <span className="spine-done" aria-hidden /> : book.progress > 0 && <span className="spine-ribbon" aria-hidden />}
      </Link>
    </div>
  )
}

function Bookend({ label }: { label: string }) {
  return <div className="spine-slot bookend-slot" title={label}><span className="bookend" /></div>
}

/**
 * Library as a bookcase: spine images from each book's spines/ folder, or generated spines in the
 * cover's colour. Series are shelved together first (A-Z, in reading order), then everything else.
 */
export function Bookshelf({ params, comic = false, empty }: { params: Record<string, string | undefined>; comic?: boolean; empty?: ReactNode }) {
  const clean = Object.fromEntries(Object.entries({ ...params, group: 'series' }).filter(([, v]) => v)) as Record<string, string>
  const q = useInfiniteQuery({
    queryKey: ['books', clean],
    initialPageParam: 0,
    queryFn: ({ pageParam, signal }) => api<{ total: number; items: BookSummary[] }>(`/api/books?${new URLSearchParams({ ...clean, offset: String(pageParam), limit: '150' })}`, { signal }),
    getNextPageParam: (last, all) => {
      const loaded = all.reduce((n, p) => n + p.items.length, 0)
      return loaded < last.total ? loaded : undefined
    },
  })
  const sentinel = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const el = sentinel.current
    if (!el) return
    const io = new IntersectionObserver(([e]) => { if (e.isIntersecting && q.hasNextPage && !q.isFetchingNextPage) void q.fetchNextPage() }, { rootMargin: '600px' })
    io.observe(el)
    return () => io.disconnect()
  }, [q.hasNextPage, q.isFetchingNextPage, q.fetchNextPage])

  if (q.isLoading) return <div className="bookcase"><div className="bookcase-rows loading"><Spinner /></div></div>
  if (q.isError) return <div className="error">{(q.error as Error).message}</div>
  const items = q.data?.pages.flatMap(p => p.items) ?? []
  if (!items.length) return <>{empty ?? <Empty title="Nothing here yet" />}</>

  return (
    <>
      <div className={`bookcase ${comic ? 'comics' : ''}`}>
        <div className="bookcase-rows">
          {items.map((b, i) => {
            const prev = items[i - 1]
            // a bookend wherever one series ends (or the standalone books begin)
            const boundary = prev && prev.series !== b.series && prev.series
            return (
              <Fragment key={b.id}>
                {boundary && <Bookend label={`End of ${prev.series}`} />}
                <Spine book={b} comic={comic} />
              </Fragment>
            )
          })}
          {q.isFetchingNextPage && <div className="spine-slot"><Spinner /></div>}
        </div>
      </div>
      <div ref={sentinel} style={{ height: 1 }} />
    </>
  )
}
