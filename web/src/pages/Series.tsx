import { useState, type CSSProperties } from 'react'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { useQueries, useQuery, useQueryClient } from '@tanstack/react-query'
import { Plus, Pencil, X, BookOpen, Check, Layers, Users, Clock, Settings2 } from 'lucide-react'
import { api, coverUrl, type BookDetail, type BookSummary, type Library } from '../api'
import { Book3D, Cover, SkeletonCards, hue, useCoverColor } from '../components/books'
import { Empty, Modal, toast } from '../components/ui'
import { BookPicker } from '../components/BookPicker'
import { useSession } from '../session'

type Status = 'done' | 'current' | 'next' | 'todo'

/** A fanned hand of up to five covers. */
function CoverFan({ books }: { books: BookSummary[] }) {
  const shown = books.slice(0, 5)
  const n = shown.length
  return (
    <div className="cover-fan" style={{ ['--n' as string]: n }}>
      {shown.map((b, i) => (
        <Link key={b.id} to={`/book/${b.id}`} className="fan-card" style={{ ['--i' as string]: i, ['--mid' as string]: (n - 1) / 2 }} aria-label={b.title}>
          <Cover book={b} showProgress={false} eager />
        </Link>
      ))}
    </div>
  )
}

/** One series as a reading path. Administrators can add, remove, renumber and rename. */
export default function SeriesPage() {
  const { name: raw = '' } = useParams()
  const name = decodeURIComponent(raw)
  const [params] = useSearchParams()
  const nav = useNavigate()
  const qc = useQueryClient()
  const { user } = useSession()
  const libId = params.get('library')
  const books = useQuery({
    queryKey: ['books', { series: name }],
    queryFn: () => api<{ items: BookSummary[] }>(`/api/books?${new URLSearchParams({ series: name, sort: 'series', limit: '500' })}`),
  })
  const libs = useQuery({ queryKey: ['libraries'], queryFn: () => api<Library[]>('/api/libraries') })
  const items = books.data?.items ?? []
  // descriptions for the path entries (cached per book, shared with the book page)
  const details = useQueries({
    queries: items.slice(0, 60).map(b => ({ queryKey: ['book', String(b.id)], queryFn: () => api<BookDetail>(`/api/books/${b.id}`), staleTime: 60_000 })),
  })
  const detailOf = (id: number) => details.find(d => d.data?.id === id)?.data
  const libraryId = Number(libId) || items[0]?.libraryId || libs.data?.[0]?.id
  const [dialog, setDialog] = useState<'add' | 'rename' | null>(null)
  const [editing, setEditing] = useState(false)
  const [newName, setNewName] = useState(name)
  const admin = !!user?.isAdmin
  const tint = useCoverColor(items[0] ? coverUrl(items[0]) : undefined)
  const refresh = () => { void qc.invalidateQueries({ queryKey: ['books'] }); void qc.invalidateQueries({ queryKey: ['series'] }) }

  const setIndex = async (b: BookSummary, value: string) => {
    const v = value.trim() === '' ? null : Number(value)
    if (v !== null && Number.isNaN(v)) return
    if (v === b.seriesIndex) return
    await api('/api/series/index', { body: { bookId: b.id, index: v } })
    refresh()
  }

  // reading state across the series
  const finished = items.filter(b => b.finished).length
  const inProgress = items.filter(b => !b.finished && b.progress > 0)
  const overall = items.length ? items.reduce((n, b) => n + (b.finished ? 1 : b.progress), 0) / items.length : 0
  const next = inProgress[0] ?? items.find(b => !b.finished)
  const status = (b: BookSummary): Status => b.finished ? 'done' : b === next ? (b.progress > 0 ? 'current' : 'next') : b.progress > 0 ? 'current' : 'todo'
  const authors = [...new Set(items.flatMap(b => b.authors))]
  const h = hue(name)
  const accent = tint ?? `hsl(${h} 60% 60%)`

  if (books.isLoading) return <div className="grid"><SkeletonCards count={6} /></div>
  if (!items.length) return <Empty title="No books in this series" />

  return (
    <div className="series-page" style={{ '--tint': accent } as CSSProperties}>
      {/* ---------------- hero */}
      <section className="series-hero">
        {coverUrl(items[0]) && <div className="series-hero-bg" style={{ backgroundImage: `url("${coverUrl(items[0])}")` }} />}
        <div className="series-hero-inner">
          <CoverFan books={items} />
          <div className="series-hero-text">
            <div className="eyebrow"><Layers size={13} /> Series</div>
            <h1>{name}</h1>
            {!!authors.length && (
              <div className="series-authors"><Users size={15} />{authors.slice(0, 3).join(', ')}{authors.length > 3 ? ` +${authors.length - 3}` : ''}</div>
            )}
            <div className="series-stats">
              <span className="stat-chip"><b>{items.length}</b> book{items.length === 1 ? '' : 's'}</span>
              <span className="stat-chip"><b>{finished}</b> finished</span>
              {!!inProgress.length && <span className="stat-chip"><b>{inProgress.length}</b> in progress</span>}
            </div>
            <div className="series-progress" aria-label={`${Math.round(overall * 100)}% of the series read`}>
              <div className="bar"><div style={{ width: `${Math.max(overall > 0 ? 2 : 0, overall * 100)}%` }} /></div>
              <span>{Math.round(overall * 100)}%</span>
            </div>
            {admin && (
              <div className="row" style={{ marginTop: 16 }}>
                {libraryId && <button className="btn" onClick={() => setDialog('add')}><Plus size={17} />Add books</button>}
                <button className={`btn ${editing ? 'primary' : ''}`} onClick={() => setEditing(e => !e)}>{editing ? <><Check size={16} />Done</> : <><Settings2 size={16} />Edit series</>}</button>
                <button className="btn" onClick={() => { setNewName(name); setDialog('rename') }}><Pencil size={16} />Rename</button>
              </div>
            )}
          </div>
        </div>
      </section>

      {/* ---------------- up next */}
      {next && !editing && (
        <section className="up-next">
          <Link to={`/book/${next.id}`} className="up-next-book"><Book3D book={next} /></Link>
          <div className="grow" style={{ minWidth: 0 }}>
            <div className="eyebrow">{next.progress > 0 ? 'Continue the series' : finished ? 'Up next' : 'Start here'}</div>
            <div className="up-next-title">{next.seriesIndex != null && <span className="num-badge">#{next.seriesIndex}</span>}{next.title}</div>
            {detailOf(next.id)?.description && <p className="up-next-desc">{detailOf(next.id)!.description}</p>}
            {next.progress > 0 && <div className="mini-progress"><div style={{ width: `${next.progress * 100}%` }} /></div>}
          </div>
          <button className="btn primary lg" onClick={() => nav(`/read/${next.id}`)}><BookOpen size={19} />{next.progress > 0 ? `Continue · ${Math.round(next.progress * 100)}%` : 'Read'}</button>
        </section>
      )}
      {!next && !editing && (
        <section className="up-next complete">
          <div className="complete-badge"><Check size={26} strokeWidth={3} /></div>
          <div><div className="up-next-title">Series complete</div><div className="muted small">You've finished every book in {name}.</div></div>
        </section>
      )}

      {/* ---------------- reading path */}
      <h2 className="path-heading">Reading order</h2>
      <ol className={`reading-path ${editing ? 'editing' : ''}`}>
        {items.map((b, i) => {
          const st = status(b)
          const d = detailOf(b.id)
          return (
            <li key={b.id} className={`path-item ${st}`}>
              <div className="path-node" aria-hidden>
                {st === 'done' ? <Check size={16} strokeWidth={3} /> : st === 'current' ? (
                  <svg viewBox="0 0 36 36" width="34" height="34"><circle cx="18" cy="18" r="15" fill="none" stroke="var(--line-strong)" strokeWidth="3" /><circle cx="18" cy="18" r="15" fill="none" stroke="var(--tint)" strokeWidth="3" strokeLinecap="round" strokeDasharray={94.2} strokeDashoffset={94.2 * (1 - b.progress)} transform="rotate(-90 18 18)" /></svg>
                ) : <span>{b.seriesIndex ?? i + 1}</span>}
              </div>
              <div className="path-card">
                <Link to={`/book/${b.id}`} className="path-cover"><Cover book={b} /></Link>
                <div className="path-body">
                  <div className="path-meta">
                    {editing ? (
                      <label className="num-edit"># <input defaultValue={b.seriesIndex ?? ''} placeholder="–" inputMode="decimal" aria-label="Book number"
                        onBlur={e => void setIndex(b, e.target.value)} onKeyDown={e => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur() }} /></label>
                    ) : b.seriesIndex != null && <span className="num-badge">Book {b.seriesIndex}</span>}
                    <span className={`state-pill ${st}`}>
                      {st === 'done' ? 'Finished' : st === 'current' ? `${Math.round(b.progress * 100)}% read` : st === 'next' ? 'Up next' : 'Not started'}
                    </span>
                    {d?.pageCount ? <span className="faint small"><Clock size={12} style={{ verticalAlign: -1 }} /> {d.pageCount} pages</span> : null}
                  </div>
                  <Link to={`/book/${b.id}`} className="path-title">{b.title}</Link>
                  {b.authors.length > 0 && authors.length > 1 && <div className="small muted">{b.authors.join(', ')}</div>}
                  {d?.description && !editing && <p className="path-desc">{d.description}</p>}
                  {st === 'current' && <div className="mini-progress"><div style={{ width: `${b.progress * 100}%` }} /></div>}
                </div>
                {editing ? (
                  <button className="icon-btn danger-hover" aria-label="Remove from series" title="Remove from series"
                    onClick={async () => { await api('/api/series/remove', { body: { bookIds: [b.id] } }); refresh() }}><X size={18} /></button>
                ) : (
                  <button className="icon-btn path-read" aria-label={`Read ${b.title}`} title="Read" onClick={() => nav(`/read/${b.id}`)}><BookOpen size={19} /></button>
                )}
              </div>
            </li>
          )
        })}
      </ol>

      {dialog === 'add' && libraryId && (
        <BookPicker
          libraryId={libraryId}
          title={`Add books to “${name}”`}
          exclude={items.map(b => b.id)}
          actionLabel={n => (n ? `Add ${n} book${n === 1 ? '' : 's'}` : 'Add books')}
          onClose={() => setDialog(null)}
          onPick={async ids => {
            await api('/api/series/assign', { body: { series: name, bookIds: ids } })
            toast(`Added ${ids.length} book${ids.length === 1 ? '' : 's'} — numbered after the last one`)
            setDialog(null)
            refresh()
          }}
        />
      )}
      {dialog === 'rename' && (
        <Modal title="Rename series" onClose={() => setDialog(null)} footer={<>
          <button className="btn" onClick={() => setDialog(null)}>Cancel</button>
          <button className="btn primary" disabled={!newName.trim() || newName.trim() === name} onClick={async () => {
            const r = await api<{ series: string }>('/api/series/rename', { body: { from: name, to: newName } })
            refresh()
            setDialog(null)
            nav(`/series/${encodeURIComponent(r.series)}${libId ? `?library=${libId}` : ''}`, { replace: true })
          }}>Rename</button>
        </>}>
          <label className="field"><span>Name</span><input className="input" value={newName} onChange={e => setNewName(e.target.value)} autoFocus /></label>
          <p className="small faint">Using the name of another series merges the two.</p>
        </Modal>
      )}
    </div>
  )
}

/** Start a brand-new series from the library page (admins). */
export function NewSeriesDialog({ libraryId, onClose }: { libraryId: number; onClose(): void }) {
  const [name, setName] = useState('')
  const [picking, setPicking] = useState(false)
  const nav = useNavigate()
  const qc = useQueryClient()
  if (picking) {
    return (
      <BookPicker libraryId={libraryId} title={`Books in “${name}” (in reading order)`} actionLabel={n => (n ? `Create series with ${n}` : 'Create series')}
        onClose={onClose}
        onPick={async ids => {
          await api('/api/series/assign', { body: { series: name.trim(), bookIds: ids } })
          void qc.invalidateQueries({ queryKey: ['series'] })
          void qc.invalidateQueries({ queryKey: ['books'] })
          nav(`/series/${encodeURIComponent(name.trim())}?library=${libraryId}`)
        }} />
    )
  }
  return (
    <Modal title="New series" onClose={onClose} footer={<>
      <button className="btn" onClick={onClose}>Cancel</button>
      <button className="btn primary" disabled={!name.trim()} onClick={() => setPicking(true)}>Choose books</button>
    </>}>
      <label className="field"><span>Series name</span><input className="input" value={name} onChange={e => setName(e.target.value)} autoFocus onKeyDown={e => { if (e.key === 'Enter' && name.trim()) setPicking(true) }} /></label>
      <p className="small faint">Next, pick the books. They're numbered 1, 2, 3… in the order you select them; you can change the numbers afterwards.</p>
    </Modal>
  )
}
