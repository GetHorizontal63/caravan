import { useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Plus, Pencil, Trash2, X, Library as LibIcon, ChevronLeft, ChevronRight } from 'lucide-react'
import { api, authedUrl, type BookSummary, type Collection } from '../api'
import { BookCard, SkeletonCards, hue } from '../components/books'
import { Empty, Spinner, toast } from '../components/ui'
import { BookPicker } from '../components/BookPicker'
import { CollectionEditDialog } from '../components/GroupDialogs'

/** Card with a fanned collage of up to four covers. */
export function CollectionCard({ c }: { c: Collection }) {
  const h = hue(c.name)
  return (
    <Link to={`/collection/${c.id}`} className="book-card collection-card" title={c.name}>
      <div className="collage" style={{ background: `linear-gradient(150deg, hsl(${h} 35% 30%), hsl(${(h + 40) % 360} 40% 16%))` }}>
        {c.covers.length ? c.covers.slice(0, 4).map((b, i) => (
          <img key={b.id} src={authedUrl(`/api/books/${b.id}/cover`, { v: b.coverVersion })} alt="" loading="lazy" style={{ ['--i' as string]: i, ['--n' as string]: Math.min(4, c.covers.length) }} />
        )) : <LibIcon size={34} className="collage-empty" />}
      </div>
      <div className="meta">
        <div className="title">{c.name}</div>
        <div className="author">{c.count} book{c.count === 1 ? '' : 's'}</div>
      </div>
    </Link>
  )
}

export default function CollectionPage() {
  const { id } = useParams()
  const nav = useNavigate()
  const qc = useQueryClient()
  const coll = useQuery({ queryKey: ['collection', id], queryFn: () => api<Collection>(`/api/collections/${id}`) })
  const books = useQuery({
    queryKey: ['books', { collection: id }],
    queryFn: () => api<{ items: BookSummary[] }>(`/api/books?${new URLSearchParams({ collection: id!, sort: 'collection', limit: '500' })}`),
  })
  const [dialog, setDialog] = useState<'edit' | 'add' | null>(null)
  const [manage, setManage] = useState(false)
  const refresh = () => {
    void qc.invalidateQueries({ queryKey: ['collection', id] })
    void qc.invalidateQueries({ queryKey: ['books'] })
    void qc.invalidateQueries({ queryKey: ['collections'] })
  }

  if (coll.isLoading) return <div className="center-screen"><Spinner /></div>
  if (coll.isError || !coll.data) return <p className="error">{(coll.error as Error)?.message ?? 'Not found'}</p>
  const c = coll.data
  const items = books.data?.items ?? []

  const remove = async (b: BookSummary) => {
    await api(`/api/collections/${c.id}/books/${b.id}`, { method: 'DELETE' })
    refresh()
  }
  const move = async (b: BookSummary, index: number) => {
    await api(`/api/collections/${c.id}/move`, { body: { bookId: b.id, index } })
    refresh()
  }

  return (
    <>
      <div className="group-hero">
        <div className="eyebrow"><Link to={`/library/${c.libraryId}?view=collections`}>{c.libraryName}</Link> · Collection</div>
        <h1>{c.name}</h1>
        {c.description && <p className="muted" style={{ maxWidth: '70ch', whiteSpace: 'pre-line' }}>{c.description}</p>}
        <div className="small faint">{c.count} book{c.count === 1 ? '' : 's'}{c.createdByName ? ` · created by ${c.createdByName}` : ''}</div>
        {c.canEdit && (
          <div className="row" style={{ marginTop: 16 }}>
            <button className="btn primary" onClick={() => setDialog('add')}><Plus size={17} />Add books</button>
            <button className={`btn ${manage ? 'on-chip' : ''}`} onClick={() => setManage(m => !m)}>{manage ? 'Done' : 'Arrange'}</button>
            <button className="btn" onClick={() => setDialog('edit')}><Pencil size={16} />Edit</button>
            <button className="btn danger" onClick={async () => {
              if (!confirm(`Delete the collection “${c.name}”? The books themselves stay in the library.`)) return
              await api(`/api/collections/${c.id}`, { method: 'DELETE' })
              void qc.invalidateQueries({ queryKey: ['collections'] })
              nav(`/library/${c.libraryId}?view=collections`, { replace: true })
            }}><Trash2 size={16} />Delete</button>
          </div>
        )}
      </div>

      {books.isLoading ? <div className="grid"><SkeletonCards count={8} /></div> : !items.length ? (
        <Empty title="This collection is empty">{c.canEdit && <button className="btn primary" onClick={() => setDialog('add')}><Plus size={17} />Add books</button>}</Empty>
      ) : (
        <div className={`grid ${manage ? 'managing' : ''}`}>
          {items.map((b, i) => (
            <div key={b.id} className="manage-wrap">
              <BookCard book={b} />
              {manage && (
                <div className="manage-bar">
                  <button onClick={() => void move(b, i - 1)} disabled={i === 0} aria-label="Move earlier"><ChevronLeft size={16} /></button>
                  <button onClick={() => void remove(b)} aria-label="Remove from collection" className="danger"><X size={16} /></button>
                  <button onClick={() => void move(b, i + 1)} disabled={i === items.length - 1} aria-label="Move later"><ChevronRight size={16} /></button>
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {dialog === 'edit' && <CollectionEditDialog libraryId={c.libraryId} collection={c} onClose={() => setDialog(null)} onSaved={() => { setDialog(null); refresh() }} />}
      {dialog === 'add' && (
        <BookPicker
          libraryId={c.libraryId}
          title={`Add books to “${c.name}”`}
          exclude={items.map(b => b.id)}
          actionLabel={n => (n ? `Add ${n} book${n === 1 ? '' : 's'}` : 'Add books')}
          onClose={() => setDialog(null)}
          onPick={async ids => {
            const r = await api<{ added: number }>(`/api/collections/${c.id}/books`, { body: { bookIds: ids } })
            toast(`Added ${r.added} book${r.added === 1 ? '' : 's'}`)
            setDialog(null)
            refresh()
          }}
        />
      )}
    </>
  )
}
