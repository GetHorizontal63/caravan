import { Link, useNavigate } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { BookOpen, Info } from 'lucide-react'
import { api, coverUrl, type BookDetail, type BookSummary } from '../api'
import { Book3D, Shelf, SkeletonCards } from '../components/books'
import { Empty } from '../components/ui'
import { useSession } from '../session'

interface Home {
  continueReading: BookSummary[]
  recentlyAdded: BookSummary[]
  favorites: BookSummary[]
  libraries: { id: number; name: string; kind: string; books: BookSummary[] }[]
}

function greeting() {
  const h = new Date().getHours()
  return h < 5 ? 'Reading late' : h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening'
}

/** Featured book: the one you're in the middle of, or the newest arrival. */
function Hero({ book, mode }: { book: BookSummary; mode: 'continue' | 'new' }) {
  const nav = useNavigate()
  const detail = useQuery({ queryKey: ['book', String(book.id)], queryFn: () => api<BookDetail>(`/api/books/${book.id}`) })
  const pct = Math.round(book.progress * 100)
  const bg = coverUrl(book)
  return (
    <section className="hero">
      {bg && <div className="hero-bg" style={{ backgroundImage: `url("${bg}")` }} />}
      <div className="hero-inner">
        <Link to={`/book/${book.id}`} aria-label={book.title}><Book3D book={book} /></Link>
        <div style={{ minWidth: 0 }}>
          <div className="eyebrow">{mode === 'continue' ? 'Continue reading' : 'New on your shelves'}</div>
          <h2>{book.title}</h2>
          <div className="by">{book.authors.join(', ')}{book.series ? ` · ${book.series}${book.seriesIndex != null ? ` #${book.seriesIndex}` : ''}` : ''}</div>
          {detail.data?.description && <p className="desc">{detail.data.description}</p>}
          {mode === 'continue' && (
            <div className="hero-progress">
              <div className="bar"><div style={{ width: `${Math.max(2, pct)}%` }} /></div>
              <span>{pct}%</span>
            </div>
          )}
          <div className="row" style={{ marginTop: mode === 'continue' ? 0 : 18 }}>
            <button className="btn primary lg" onClick={() => nav(`/read/${book.id}`)}><BookOpen size={19} />{mode === 'continue' ? 'Continue' : 'Start reading'}</button>
            <Link className="btn lg" to={`/book/${book.id}`}><Info size={18} />Details</Link>
          </div>
        </div>
      </div>
    </section>
  )
}

export default function HomePage() {
  const { user } = useSession()
  const q = useQuery({ queryKey: ['home'], queryFn: () => api<Home>('/api/home'), staleTime: 5_000 })
  const name = user?.username ? user.username[0].toUpperCase() + user.username.slice(1) : ''

  if (q.isLoading) {
    return (
      <>
        <div className="greeting"><h1>{greeting()}{name && `, ${name}`}</h1></div>
        <div className="hero skeleton" style={{ border: 0 }} />
        <div className="shelf-row"><SkeletonCards count={8} /></div>
      </>
    )
  }
  if (q.isError) return <p className="error">{(q.error as Error).message}</p>
  const h = q.data!
  if (!h.libraries.length) {
    return (
      <Empty title="Your library is waiting">
        {user?.isAdmin
          ? <><p>Point Caravan at a folder of e-books or comics to fill your shelves.</p><Link className="btn primary" to="/admin/libraries">Add a library</Link></>
          : <p>Ask your server administrator to add a library.</p>}
      </Empty>
    )
  }
  const featured = h.continueReading[0] ?? h.recentlyAdded[0]
  const total = h.libraries.reduce((n, l) => n + l.books.length, 0)
  return (
    <>
      <div className="greeting">
        <h1>{greeting()}{name && `, ${name}`}</h1>
        <p>{h.continueReading.length ? `You have ${h.continueReading.length} book${h.continueReading.length === 1 ? '' : 's'} in progress.` : 'Pick something new to read.'}</p>
      </div>
      {featured && <Hero book={featured} mode={h.continueReading[0] ? 'continue' : 'new'} />}
      <Shelf title="Continue reading" books={h.continueReading.slice(1)} more="/search?status=reading&sort=recent" />
      <Shelf title="Recently added" books={h.recentlyAdded} more="/search?sort=added" />
      <Shelf title="Favorites" books={h.favorites} more="/search?status=favorite" />
      {h.libraries.length > 1 && h.libraries.map(l => <Shelf key={l.id} title={l.name} books={l.books} more={`/library/${l.id}`} />)}
      {!total && <Empty title="Your shelves are empty">Books will appear here once a scan finds them.</Empty>}
    </>
  )
}
