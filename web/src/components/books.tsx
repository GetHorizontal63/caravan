import { useEffect, useRef, useState, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { useInfiniteQuery } from '@tanstack/react-query'
import { Check, ChevronLeft, ChevronRight } from 'lucide-react'
import { api, coverUrl, type BookSummary } from '../api'
import { Empty } from './ui'
import { useSelectable } from './selection'

/** Deterministic, pleasant colours for books without cover art. */
export function hue(s: string) {
  let h = 0
  for (const c of s) h = (h * 31 + c.charCodeAt(0)) >>> 0
  return h % 360
}

type CoverBook = Pick<BookSummary, 'id' | 'title' | 'authors' | 'hasCover' | 'coverVersion' | 'format'> & Partial<BookSummary>

export function Cover({ book, showProgress = true, showFormat = false, eager = false, children }: { book: CoverBook; showProgress?: boolean; showFormat?: boolean; eager?: boolean; children?: ReactNode }) {
  const [failed, setFailed] = useState(false)
  const src = !failed ? coverUrl(book) : undefined
  const h = hue(book.title)
  return (
    <div className="cover">
      {src ? (
        <img src={src} alt="" loading={eager ? 'eager' : 'lazy'} decoding="async" onError={() => setFailed(true)} />
      ) : (
        <div className="placeholder" style={{ background: `linear-gradient(160deg, hsl(${h} 42% 36%), hsl(${(h + 35) % 360} 48% 18%))` }}>
          <div>
            <div className="t">{book.title}</div>
            <div className="rule" />
          </div>
          <div className="a">{book.authors?.[0]}</div>
        </div>
      )}
      {showFormat && <span className="badge fmt">{book.format}</span>}
      {showProgress && book.finished && <span className="done" title="Finished"><Check size={14} strokeWidth={3} /></span>}
      {showProgress && !book.finished && (book.progress ?? 0) > 0 && (
        <div className="progress"><div style={{ width: `${Math.max(3, Math.round((book.progress ?? 0) * 100))}%` }} /></div>
      )}
      {children}
    </div>
  )
}

/** A cover rendered as a physical book, angled with visible page edges. */
export function Book3D({ book, className = '' }: { book: CoverBook; className?: string }) {
  return (
    <div className={`book3d ${className}`}>
      <Cover book={book} showProgress={false} eager><span className="pages" /></Cover>
    </div>
  )
}

export function BookCard({ book }: { book: BookSummary }) {
  const selectable = useSelectable(book)
  return (
    <Link to={`/book/${book.id}`} className="book-card" title={book.title} {...selectable}>
      <Cover book={book} />
      <span className="select-mark" aria-hidden><Check size={15} strokeWidth={3} /></span>
      <div className="meta">
        <div className="title">{book.title}</div>
        <div className="author">{book.series && book.seriesIndex != null ? `${book.series} #${book.seriesIndex} · ` : ''}{book.authors.join(', ') || ' '}</div>
      </div>
    </Link>
  )
}

export function SkeletonCards({ count = 8 }: { count?: number }) {
  return (
    <>
      {Array.from({ length: count }, (_, i) => (
        <div key={i} className="book-card skel-card" aria-hidden>
          <div className="cover skeleton" style={{ animationDelay: `${i * 80}ms` }} />
          <div className="skeleton l1" />
          <div className="skeleton l2" />
        </div>
      ))}
    </>
  )
}

export function Shelf({ title, books, more, count }: { title: string; books: BookSummary[]; more?: string; count?: number }) {
  const row = useRef<HTMLDivElement>(null)
  const [edge, setEdge] = useState({ start: true, end: false })
  const update = () => {
    const el = row.current
    if (el) setEdge({ start: el.scrollLeft <= 4, end: el.scrollLeft + el.clientWidth >= el.scrollWidth - 4 })
  }
  useEffect(update, [books.length])
  if (!books.length) return null
  const scroll = (dir: number) => row.current?.scrollBy({ left: dir * row.current.clientWidth * 0.85, behavior: 'smooth' })
  return (
    <section className="shelf">
      <div className="shelf-head">
        <h2>{title}</h2>
        {count != null && <span className="count">{count}</span>}
        <span className="spacer" />
        <div className="shelf-nav">
          <button onClick={() => scroll(-1)} disabled={edge.start} aria-label="Scroll left"><ChevronLeft size={18} /></button>
          <button onClick={() => scroll(1)} disabled={edge.end} aria-label="Scroll right"><ChevronRight size={18} /></button>
        </div>
        {more && <Link className="more" to={more}>See all</Link>}
      </div>
      <div className="shelf-row" ref={row} onScroll={update}>
        {books.map(b => <BookCard key={b.id} book={b} />)}
      </div>
    </section>
  )
}

/** Paged grid with infinite scroll; `params` is the /api/books query. */
export function BookGrid({ params, empty }: { params: Record<string, string | undefined>; empty?: ReactNode }) {
  const clean = Object.fromEntries(Object.entries(params).filter(([, v]) => v)) as Record<string, string>
  const q = useInfiniteQuery({
    queryKey: ['books', clean],
    initialPageParam: 0,
    queryFn: ({ pageParam, signal }) => api<{ total: number; items: BookSummary[] }>(`/api/books?${new URLSearchParams({ ...clean, offset: String(pageParam), limit: '60' })}`, { signal }),
    getNextPageParam: (last, all) => {
      const loaded = all.reduce((n, p) => n + p.items.length, 0)
      return loaded < last.total ? loaded : undefined
    },
  })
  const sentinel = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const el = sentinel.current
    if (!el) return
    const io = new IntersectionObserver(([e]) => { if (e.isIntersecting && q.hasNextPage && !q.isFetchingNextPage) void q.fetchNextPage() }, { rootMargin: '800px' })
    io.observe(el)
    return () => io.disconnect()
  }, [q.hasNextPage, q.isFetchingNextPage, q.fetchNextPage])

  if (q.isLoading) return <div className="grid"><SkeletonCards count={12} /></div>
  if (q.isError) return <div className="error">{(q.error as Error).message}</div>
  const items = q.data?.pages.flatMap(p => p.items) ?? []
  if (!items.length) return <>{empty ?? <Empty title="Nothing here yet" />}</>
  return (
    <>
      <div className="grid">
        {items.map(b => <BookCard key={b.id} book={b} />)}
        {q.isFetchingNextPage && <SkeletonCards count={6} />}
      </div>
      <div ref={sentinel} style={{ height: 1 }} />
    </>
  )
}

/**
 * Dominant colour of a cover image (vivid pixels weighted higher), as an `hsl()` string.
 * Used to tint the book page. Returns undefined until loaded or if the image can't be read.
 */
export function useCoverColor(src: string | undefined) {
  const [color, setColor] = useState<string>()
  useEffect(() => {
    setColor(undefined)
    if (!src) return
    const img = new Image()
    img.crossOrigin = 'anonymous'
    img.decoding = 'async'
    img.onload = () => {
      try {
        const c = document.createElement('canvas')
        c.width = 24; c.height = 36
        const ctx = c.getContext('2d', { willReadFrequently: true })!
        ctx.drawImage(img, 0, 0, 24, 36)
        const d = ctx.getImageData(0, 0, 24, 36).data
        let r = 0, g = 0, b = 0, w = 0
        for (let i = 0; i < d.length; i += 4) {
          const max = Math.max(d[i], d[i + 1], d[i + 2]), min = Math.min(d[i], d[i + 1], d[i + 2])
          const sat = max ? (max - min) / max : 0
          const weight = 0.05 + sat * sat * (max > 40 ? 1 : 0.2)
          r += d[i] * weight; g += d[i + 1] * weight; b += d[i + 2] * weight; w += weight
        }
        r /= w; g /= w; b /= w
        // to HSL, then normalise lightness/saturation so it works as an accent on dark and light themes
        const mx = Math.max(r, g, b) / 255, mn = Math.min(r, g, b) / 255
        const l = (mx + mn) / 2
        let h = 0, s = 0
        if (mx !== mn) {
          const dd = mx - mn
          s = l > 0.5 ? dd / (2 - mx - mn) : dd / (mx + mn)
          const [R, G, B] = [r / 255, g / 255, b / 255]
          h = mx === R ? (G - B) / dd + (G < B ? 6 : 0) : mx === G ? (B - R) / dd + 2 : (R - G) / dd + 4
          h *= 60
        }
        // keep the cover's hue but force a vivid, mid-light accent; near-grey covers fall back to the default accent
        if (s < 0.12) return
        setColor(`hsl(${Math.round(h)} ${Math.round(Math.min(85, Math.max(58, s * 100)))}% ${Math.round(Math.min(64, Math.max(54, l * 100)))}%)`)
      } catch { /* tainted canvas: keep default accent */ }
    }
    img.src = src
    return () => { img.onload = null }
  }, [src])
  return color
}
