import { useState, type FormEvent } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Check, Plus, Library as LibIcon } from 'lucide-react'
import { api, type BookDetail, type Collection, type SeriesSummary } from '../api'
import { Modal, Spinner, toast } from './ui'
import { Combobox } from './Dropdown'

/** Create a new collection, or rename / describe an existing one. */
export function CollectionEditDialog({ libraryId, collection, initialBookIds, onClose, onSaved }: {
  libraryId: number
  collection?: Collection
  initialBookIds?: number[]
  onClose(): void
  onSaved(c: Collection): void
}) {
  const [name, setName] = useState(collection?.name ?? '')
  const [description, setDescription] = useState(collection?.description ?? '')
  const [error, setError] = useState('')
  const save = async (e: FormEvent) => {
    e.preventDefault()
    try {
      const c = collection
        ? await api<Collection>(`/api/collections/${collection.id}`, { method: 'PATCH', body: { name, description } })
        : await api<Collection>(`/api/libraries/${libraryId}/collections`, { body: { name, description, bookIds: initialBookIds ?? [] } })
      onSaved(c)
    } catch (err) { setError((err as Error).message) }
  }
  return (
    <Modal title={collection ? 'Edit collection' : 'New collection'} onClose={onClose} footer={<>
      <button className="btn" onClick={onClose}>Cancel</button>
      <button className="btn primary" form="coll-form" disabled={!name.trim()}>{collection ? 'Save' : 'Create'}</button>
    </>}>
      <form id="coll-form" onSubmit={e => void save(e)}>
        <label className="field"><span>Name</span><input className="input" value={name} onChange={e => setName(e.target.value)} placeholder="Summer reading, Hugo winners, Comfort reads…" autoFocus /></label>
        <label className="field"><span>Description (optional)</span><textarea className="textarea" rows={3} value={description} onChange={e => setDescription(e.target.value)} /></label>
        {error && <p className="error">{error}</p>}
      </form>
    </Modal>
  )
}

/** From a book page: tick the collections this book belongs to, or start a new one with it. */
export function AddToCollectionDialog({ book, onClose }: { book: BookDetail; onClose(): void }) {
  const qc = useQueryClient()
  const list = useQuery({ queryKey: ['book-collections', book.id], queryFn: () => api<Collection[]>(`/api/books/${book.id}/collections`) })
  const [creating, setCreating] = useState(false)
  const refresh = () => {
    void list.refetch()
    void qc.invalidateQueries({ queryKey: ['collections'] })
    void qc.invalidateQueries({ queryKey: ['books'] })
  }
  const toggle = async (c: Collection) => {
    try {
      if (c.contains) await api(`/api/collections/${c.id}/books/${book.id}`, { method: 'DELETE' })
      else await api(`/api/collections/${c.id}/books`, { body: { bookIds: [book.id] } })
      refresh()
    } catch (e) { toast((e as Error).message) }
  }
  if (creating) {
    return <CollectionEditDialog libraryId={book.libraryId} initialBookIds={[book.id]} onClose={() => setCreating(false)} onSaved={c => { toast(`Added to “${c.name}”`); setCreating(false); refresh() }} />
  }
  return (
    <Modal title="Add to collection" onClose={onClose} footer={<button className="btn primary" onClick={onClose}>Done</button>}>
      {list.isLoading ? <Spinner /> : (
        <div className="list">
          {list.data?.map(c => (
            <button key={c.id} className={`list-item check-row ${c.contains ? 'on' : ''}`} disabled={!c.canEdit} onClick={() => void toggle(c)}>
              <span className="check-box">{c.contains && <Check size={15} strokeWidth={3} />}</span>
              <span className="grow" style={{ textAlign: 'left' }}><b>{c.name}</b><div className="small faint">{c.count} book{c.count === 1 ? '' : 's'}{!c.canEdit ? ' · created by someone else' : ''}</div></span>
            </button>
          ))}
          {!list.data?.length && <p className="muted small" style={{ margin: '0 0 8px' }}><LibIcon size={14} style={{ verticalAlign: -2 }} /> This library has no collections yet.</p>}
          <button className="list-item check-row" onClick={() => setCreating(true)}>
            <span className="check-box add"><Plus size={15} /></span><span className="grow" style={{ textAlign: 'left' }}><b>New collection…</b></span>
          </button>
        </div>
      )}
    </Modal>
  )
}

/** From a book page (admins): put the book into an existing or new series, with its number. */
export function AddToSeriesDialog({ book, onClose, onDone }: { book: BookDetail; onClose(): void; onDone(): void }) {
  const series = useQuery({ queryKey: ['series', book.libraryId], queryFn: () => api<SeriesSummary[]>(`/api/series?library=${book.libraryId}`) })
  const [name, setName] = useState(book.series ?? '')
  const [index, setIndex] = useState(book.seriesIndex?.toString() ?? '')
  const [error, setError] = useState('')
  const existing = series.data?.find(s => s.name.toLowerCase() === name.trim().toLowerCase())
  const save = async (e: FormEvent) => {
    e.preventDefault()
    try {
      await api('/api/series/assign', { body: { series: existing?.name ?? name.trim(), bookIds: [book.id], ...(index.trim() ? { indexes: [Number(index)] } : {}) } })
      onDone()
    } catch (err) { setError((err as Error).message) }
  }
  return (
    <Modal title={book.series ? 'Change series' : 'Add to series'} onClose={onClose} footer={<>
      {book.series && <button className="btn ghost danger" style={{ marginRight: 'auto' }} onClick={async () => { await api('/api/series/remove', { body: { bookIds: [book.id] } }); onDone() }}>Remove from series</button>}
      <button className="btn" onClick={onClose}>Cancel</button>
      <button className="btn primary" form="series-form" disabled={!name.trim()}>Save</button>
    </>}>
      <form id="series-form" onSubmit={e => void save(e)}>
        <label className="field"><span>Series</span>
          <Combobox
            value={name} onChange={setName} autoFocus placeholder="Pick an existing series or type a new name"
            suggestions={series.data?.map(s => s.name) ?? []}
            describe={n => { const c = series.data?.find(s => s.name === n)?.count; return c ? `${c} book${c === 1 ? '' : 's'}` : undefined }}
          />
          <span className="small faint">{name.trim() ? (existing ? `Adds to “${existing.name}” (${existing.count} book${existing.count === 1 ? '' : 's'})` : 'Creates a new series') : ''}</span>
        </label>
        <label className="field" style={{ maxWidth: 160 }}><span>Book number</span>
          <input className="input" inputMode="decimal" value={index} onChange={e => setIndex(e.target.value)} placeholder={existing ? 'Next' : '1'} />
        </label>
        {error && <p className="error">{error}</p>}
      </form>
    </Modal>
  )
}
