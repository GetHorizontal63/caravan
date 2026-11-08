import { useEffect, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Check, Search } from 'lucide-react'
import { api, type BookSummary } from '../api'
import { Cover } from './books'
import { Modal, Spinner } from './ui'

/** Search a library and pick several books (used by collections and series). */
export function BookPicker({ libraryId, title, actionLabel, exclude = [], onClose, onPick }: {
  libraryId: number
  title: string
  actionLabel: (n: number) => string
  exclude?: number[]
  onClose(): void
  onPick(ids: number[]): Promise<void> | void
}) {
  const [q, setQ] = useState('')
  const [debounced, setDebounced] = useState('')
  const [picked, setPicked] = useState<number[]>([])
  const [busy, setBusy] = useState(false)
  useEffect(() => { const t = setTimeout(() => setDebounced(q.trim()), 250); return () => clearTimeout(t) }, [q])
  const res = useQuery({
    queryKey: ['picker', libraryId, debounced],
    queryFn: () => api<{ items: BookSummary[] }>(`/api/books?${new URLSearchParams({ library: String(libraryId), sort: 'title', limit: '120', ...(debounced ? { q: debounced } : {}) })}`),
  })
  const items = (res.data?.items ?? []).filter(b => !exclude.includes(b.id))
  const toggle = (id: number) => setPicked(p => (p.includes(id) ? p.filter(x => x !== id) : [...p, id]))

  return (
    <Modal title={title} onClose={onClose} wide footer={<>
      <span className="grow small muted">{picked.length ? `${picked.length} selected` : 'Tap books to select them'}</span>
      <button className="btn" onClick={onClose}>Cancel</button>
      <button className="btn primary" disabled={!picked.length || busy} onClick={async () => { setBusy(true); try { await onPick(picked) } finally { setBusy(false) } }}>
        {actionLabel(picked.length)}
      </button>
    </>}>
      <div className="header-search" style={{ display: 'block', maxWidth: 'none', margin: '0 0 16px' }}>
        <Search size={18} />
        <input className="input" autoFocus placeholder="Search this library" value={q} onChange={e => setQ(e.target.value)} />
      </div>
      {res.isLoading ? <div className="center-screen"><Spinner /></div> : !items.length ? <p className="muted">No books found.</p> : (
        <div className="picker-grid">
          {items.map(b => (
            <button key={b.id} className={`picker-item ${picked.includes(b.id) ? 'on' : ''}`} onClick={() => toggle(b.id)}>
              <Cover book={b} showProgress={false} />
              <span className="pick-check"><Check size={14} strokeWidth={3} /></span>
              <span className="pick-title">{b.title}</span>
              <span className="pick-author">{b.authors[0] ?? ''}</span>
            </button>
          ))}
        </div>
      )}
    </Modal>
  )
}
