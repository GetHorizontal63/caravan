import { useEffect, useMemo, useState } from 'react'
import { Link, Navigate, Route, Routes } from 'react-router-dom'
import { BookOpen, CloudOff, RefreshCw, Trash2 } from 'lucide-react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { formatBytes, serverUrl } from '../api'
import { listOffline, onOfflineChange, pendingChanges, removeOffline, syncOutbox, type OfflineBook } from '../offline'
import { useSession } from '../session'
import { Empty, Spinner, toast } from '../components/ui'
import { hue } from '../components/books'

/** The saved books, as a hook (re-reads when a book is saved or removed). */
export function useOfflineBooks() {
  const qc = useQueryClient()
  useEffect(() => onOfflineChange(() => void qc.invalidateQueries({ queryKey: ['offline-books'] })), [qc])
  return useQuery({ queryKey: ['offline-books'], queryFn: listOffline, staleTime: 0 })
}

function CoverImage({ book }: { book: OfflineBook }) {
  const url = useMemo(() => (book.cover ? URL.createObjectURL(book.cover) : null), [book.cover])
  useEffect(() => () => { if (url) URL.revokeObjectURL(url) }, [url])
  const h = hue(book.detail.title)
  return (
    <div className="cover">
      {url ? <img src={url} alt="" /> : <div className="placeholder" style={{ background: `linear-gradient(160deg, hsl(${h} 42% 36%), hsl(${(h + 35) % 360} 48% 18%))` }}><div className="t">{book.detail.title}</div></div>}
      {book.detail.progress > 0 && !book.detail.finished && <div className="progress"><div style={{ width: `${Math.max(3, Math.round(book.detail.progress * 100))}%` }} /></div>}
    </div>
  )
}

/** Books saved on this device, with remove buttons (used offline and in Settings). */
export function OfflineList({ compact = false }: { compact?: boolean }) {
  const q = useOfflineBooks()
  if (q.isLoading) return <Spinner />
  const books = q.data ?? []
  if (!books.length) return <Empty title="No books saved on this device">Open a book’s page and press <b>Save offline</b> to read it without a connection.</Empty>
  return (
    <div className={compact ? 'list' : 'grid'}>
      {books.map(b => compact ? (
        <div key={b.id} className="list-item">
          <span className="grow"><b>{b.detail.title}</b><span className="small faint"> · {b.detail.authors.join(', ')} · {formatBytes(b.size)}</span></span>
          <button className="icon-btn" aria-label={`Remove ${b.detail.title} from this device`} onClick={() => void removeOffline(b.id).then(() => toast('Removed from this device'))}><Trash2 size={17} /></button>
        </div>
      ) : (
        <Link key={b.id} to={`/read/${b.id}`} className="book-card" title={b.detail.title}>
          <CoverImage book={b} />
          <div className="meta">
            <div className="title">{b.detail.title}</div>
            <div className="author">{b.detail.authors.join(', ') || ' '}</div>
          </div>
        </Link>
      ))}
    </div>
  )
}

/** Settings → On this device: saved books, unsynced changes, Sync now. */
export function OfflineDevice() {
  const qc = useQueryClient()
  const books = useOfflineBooks()
  const pending = useQuery({ queryKey: ['offline-pending'], queryFn: pendingChanges, refetchInterval: 5000 })
  const [syncing, setSyncing] = useState(false)
  const total = (books.data ?? []).reduce((n, b) => n + b.size, 0)
  const sync = async () => {
    setSyncing(true)
    try {
      const n = await syncOutbox()
      const left = await pendingChanges()
      toast(left ? `Still offline: ${left} change${left === 1 ? '' : 's'} waiting` : n ? `Synced ${n} change${n === 1 ? '' : 's'}` : 'Everything is up to date')
      void qc.invalidateQueries()
    } finally {
      setSyncing(false)
    }
  }
  return (
    <section className="card" style={{ marginBottom: 18 }}>
      <h3 style={{ marginBottom: 4 }}>On this device</h3>
      <p className="small muted" style={{ marginTop: 0 }}>
        Books saved for offline reading{books.data?.length ? ` · ${books.data.length} book${books.data.length === 1 ? '' : 's'}, ${formatBytes(total)}` : ''}.
        {' '}{pending.data ? `${pending.data} change${pending.data === 1 ? '' : 's'} made offline will sync when the server is reachable.` : 'All your notes and progress are synced.'}
      </p>
      <OfflineList compact />
      <div className="row" style={{ marginTop: 12 }}>
        <button className="btn small" onClick={() => void sync()} disabled={syncing}><RefreshCw size={15} />{syncing ? 'Syncing…' : 'Sync now'}</button>
      </div>
    </section>
  )
}

/** What Satchel shows when the server can't be reached: the saved books, readable as usual. */
function OfflineHome() {
  const { refresh } = useSession()
  const [trying, setTrying] = useState(false)
  const pending = useQuery({ queryKey: ['offline-pending'], queryFn: pendingChanges, refetchInterval: 5000 })
  const retry = async () => { setTrying(true); await refresh(); setTrying(false) }
  return (
    <main className="page offline-page">
      <div className="offline-banner">
        <CloudOff size={20} />
        <div className="grow">
          <b>You’re offline</b>
          <div className="small">Can’t reach {serverUrl() || 'your server'}. Saved books open as usual{pending.data ? `; ${pending.data} change${pending.data === 1 ? '' : 's'} will sync when you’re back` : ''}.</div>
        </div>
        <button className="btn small" onClick={() => void retry()} disabled={trying}><RefreshCw size={15} />{trying ? 'Trying…' : 'Try again'}</button>
      </div>
      <div className="page-title"><div className="grow"><h1>On this device</h1><div className="sub"><BookOpen size={13} style={{ verticalAlign: '-1px' }} /> Saved for offline reading</div></div></div>
      <OfflineList />
    </main>
  )
}

/** The app while offline: saved books and the reader; everything else waits for the connection. */
export default function OfflineApp({ reader }: { reader: React.ReactNode }) {
  const { refresh } = useSession()
  // keep checking quietly; the moment the server answers, the full app (and syncing) comes back
  useEffect(() => {
    const t = setInterval(() => void refresh(), 20_000)
    const back = () => void refresh()
    window.addEventListener('online', back)
    return () => { clearInterval(t); window.removeEventListener('online', back) }
  }, [refresh])
  useEffect(() => { void syncOutbox() }, [])
  return (
    <Routes>
      <Route path="/read/:id" element={reader} />
      <Route path="/" element={<OfflineHome />} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  )
}
