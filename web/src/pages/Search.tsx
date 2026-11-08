import { useEffect, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { Search as SearchIcon } from 'lucide-react'
import { BookGrid } from '../components/books'
import { Empty } from '../components/ui'
import { Filters } from './Library'

/** Free-text search plus filtered views (author, series, tag, status) — all backed by /api/books. */
export default function SearchPage() {
  const [params, setParams] = useSearchParams()
  const [text, setText] = useState(params.get('q') ?? '')
  const set = (k: string, v: string) => setParams(p => { v ? p.set(k, v) : p.delete(k); return p }, { replace: true })

  // debounce typing into the URL
  useEffect(() => {
    const t = setTimeout(() => { if ((params.get('q') ?? '') !== text) set('q', text) }, 300)
    return () => clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [text])

  const label = params.get('label')
  const filtered = ['q', 'author', 'series', 'tag', 'status', 'sort'].some(k => params.get(k))
  return (
    <>
      <div className="page-title"><h1>{label ?? 'Search'}</h1></div>
      {!label && (
        <div className="header-search" style={{ display: 'block', maxWidth: 560, margin: '0 0 16px' }}>
          <SearchIcon size={18} />
          <input className="input" autoFocus placeholder="Title, author, series, tag or ISBN" value={text} onChange={e => setText(e.target.value)} />
        </div>
      )}
      <Filters params={params} set={set} />
      {filtered
        ? <BookGrid params={{ q: params.get('q') ?? undefined, author: params.get('author') ?? undefined, series: params.get('series') ?? undefined, tag: params.get('tag') ?? undefined, status: params.get('status') ?? undefined, sort: params.get('sort') ?? 'title' }} empty={<Empty icon={<SearchIcon size={40} />} title="No matches" />} />
        : <Empty icon={<SearchIcon size={40} />} title="Find a book">Search across every library you can access.</Empty>}
    </>
  )
}
