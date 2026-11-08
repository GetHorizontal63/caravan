import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { useLocation } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Check, FolderPlus, ListOrdered, Plus, X } from 'lucide-react'
import { api, type BookSummary, type Collection, type SeriesSummary } from '../api'
import { useSession } from '../session'
import { Modal, Spinner, toast } from './ui'
import { Combobox } from './Dropdown'
import { CollectionEditDialog } from './GroupDialogs'

/**
 * Multi-select for book cards: right-click (mouse) or long-press (touch) starts a selection; while one is
 * active, taps toggle books instead of opening them. A floating bar then adds them to a collection or series.
 * Selections stay within one library (collections belong to a library).
 */

interface Selection {
  selected: BookSummary[]
  active: boolean
  isSelected(id: number): boolean
  toggle(book: BookSummary): void
  clear(): void
}

const Ctx = createContext<Selection>({ selected: [], active: false, isSelected: () => false, toggle: () => {}, clear: () => {} })
export const useSelection = () => useContext(Ctx)

export function SelectionProvider({ children }: { children: ReactNode }) {
  const [selected, setSelected] = useState<BookSummary[]>([])
  const loc = useLocation()
  const clear = useCallback(() => setSelected([]), [])
  const toggle = useCallback((book: BookSummary) => {
    setSelected(cur => {
      if (cur.some(b => b.id === book.id)) return cur.filter(b => b.id !== book.id)
      if (cur.length && cur[0].libraryId !== book.libraryId) {
        toast('A selection can only hold books from one library')
        return cur
      }
      return [...cur, book]
    })
  }, [])
  // a new page starts fresh
  useEffect(() => { setSelected([]) }, [loc.pathname])
  useEffect(() => {
    if (!selected.length) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape' && !document.querySelector('.modal')) clear() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [selected.length, clear])
  const value = useMemo<Selection>(() => ({
    selected,
    active: selected.length > 0,
    isSelected: id => selected.some(b => b.id === id),
    toggle,
    clear,
  }), [selected, toggle, clear])
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

const LONG_PRESS_MS = 480

/**
 * Pointer handlers for a selectable card. Returns props to spread onto the card's link.
 * - right-click / long-press: toggle selection (starts selection mode)
 * - click while selecting: toggle instead of navigating
 */
export function useSelectable(book: BookSummary) {
  const sel = useSelection()
  const timer = useRef<number | undefined>(undefined)
  const start = useRef<{ x: number; y: number } | null>(null)
  const fired = useRef(0) // timestamp of the last long-press, to swallow the click/contextmenu that follows

  const cancel = () => { clearTimeout(timer.current); timer.current = undefined; start.current = null }
  return {
    'data-selected': sel.isSelected(book.id) || undefined,
    'data-selecting': sel.active || undefined,
    onContextMenu: (e: React.MouseEvent) => {
      e.preventDefault()
      if (Date.now() - fired.current < 800) return // the long-press already handled it (Android fires both)
      sel.toggle(book)
    },
    onPointerDown: (e: React.PointerEvent) => {
      if (e.pointerType === 'mouse') return
      start.current = { x: e.clientX, y: e.clientY }
      timer.current = window.setTimeout(() => {
        fired.current = Date.now()
        timer.current = undefined
        navigator.vibrate?.(12)
        sel.toggle(book)
      }, LONG_PRESS_MS)
    },
    onPointerMove: (e: React.PointerEvent) => {
      if (start.current && Math.hypot(e.clientX - start.current.x, e.clientY - start.current.y) > 10) cancel()
    },
    onPointerUp: cancel,
    onPointerCancel: cancel,
    onClick: (e: React.MouseEvent) => {
      if (Date.now() - fired.current < 800) { e.preventDefault(); return }
      if (sel.active) { e.preventDefault(); sel.toggle(book) }
    },
  }
}

// ---------------------------------------------------------------- floating action bar

export function SelectionBar() {
  const sel = useSelection()
  const { user } = useSession()
  const [dialog, setDialog] = useState<'collection' | 'series' | null>(null)
  if (!sel.active) return null
  const n = sel.selected.length
  return (
    <>
      <div className="selection-bar" role="toolbar" aria-label="Selected books">
        <button className="icon-btn" onClick={sel.clear} aria-label="Clear selection" title="Clear selection (Esc)"><X size={18} /></button>
        <span className="sel-count"><b>{n}</b> selected</span>
        <span className="grow" />
        <button className="btn small" onClick={() => setDialog('collection')}><FolderPlus size={16} /><span>Add to collection</span></button>
        {user?.isAdmin && <button className="btn small" onClick={() => setDialog('series')}><ListOrdered size={16} /><span>Add to series</span></button>}
      </div>
      {dialog === 'collection' && <AddManyToCollection books={sel.selected} onClose={() => setDialog(null)} onDone={() => { setDialog(null); sel.clear() }} />}
      {dialog === 'series' && <AddManyToSeries books={sel.selected} onClose={() => setDialog(null)} onDone={() => { setDialog(null); sel.clear() }} />}
    </>
  )
}

function AddManyToCollection({ books, onClose, onDone }: { books: BookSummary[]; onClose(): void; onDone(): void }) {
  const qc = useQueryClient()
  const libraryId = books[0].libraryId
  const list = useQuery({ queryKey: ['collections', libraryId], queryFn: () => api<Collection[]>(`/api/libraries/${libraryId}/collections`) })
  const { user } = useSession()
  const [creating, setCreating] = useState(false)
  const ids = books.map(b => b.id)
  const refresh = () => { void qc.invalidateQueries({ queryKey: ['collections'] }); void qc.invalidateQueries({ queryKey: ['books'] }); void qc.invalidateQueries({ queryKey: ['collection'] }) }
  const add = async (c: Collection) => {
    try {
      const r = await api<{ added: number }>(`/api/collections/${c.id}/books`, { body: { bookIds: ids } })
      toast(r.added ? `Added ${r.added} book${r.added === 1 ? '' : 's'} to “${c.name}”` : `Already in “${c.name}”`)
      refresh()
      onDone()
    } catch (e) { toast((e as Error).message) }
  }
  if (creating) {
    return <CollectionEditDialog libraryId={libraryId} initialBookIds={ids} onClose={() => setCreating(false)} onSaved={c => { toast(`Created “${c.name}” with ${ids.length} book${ids.length === 1 ? '' : 's'}`); refresh(); onDone() }} />
  }
  return (
    <Modal title={`Add ${books.length} book${books.length === 1 ? '' : 's'} to a collection`} onClose={onClose}>
      {list.isLoading ? <Spinner /> : (
        <div className="list">
          {list.data?.map(c => {
            const editable = !!user?.isAdmin || c.createdBy === user?.id
            return (
              <button key={c.id} className="list-item check-row" disabled={!editable} onClick={() => void add(c)}>
                <span className="check-box"><Plus size={15} /></span>
                <span className="grow" style={{ textAlign: 'left' }}><b>{c.name}</b><div className="small faint">{c.count} book{c.count === 1 ? '' : 's'}{!editable ? ' · created by someone else' : ''}</div></span>
              </button>
            )
          })}
          <button className="list-item check-row" onClick={() => setCreating(true)}>
            <span className="check-box add"><Plus size={15} /></span><span className="grow" style={{ textAlign: 'left' }}><b>New collection with these books…</b></span>
          </button>
        </div>
      )}
    </Modal>
  )
}

function AddManyToSeries({ books, onClose, onDone }: { books: BookSummary[]; onClose(): void; onDone(): void }) {
  const qc = useQueryClient()
  const libraryId = books[0].libraryId
  const series = useQuery({ queryKey: ['series', libraryId], queryFn: () => api<SeriesSummary[]>(`/api/series?library=${libraryId}`) })
  const [name, setName] = useState('')
  const [start, setStart] = useState('')
  const [error, setError] = useState('')
  const existing = series.data?.find(s => s.name.toLowerCase() === name.trim().toLowerCase())
  const save = async () => {
    setError('')
    try {
      const first = start.trim() ? Number(start) : null
      if (first !== null && Number.isNaN(first)) throw new Error('The starting number must be a number')
      await api('/api/series/assign', {
        body: {
          series: existing?.name ?? name.trim(),
          bookIds: books.map(b => b.id),
          ...(first !== null ? { indexes: books.map((_, i) => first + i) } : {}),
        },
      })
      toast(`Added ${books.length} book${books.length === 1 ? '' : 's'} to “${existing?.name ?? name.trim()}”`)
      void qc.invalidateQueries({ queryKey: ['books'] })
      void qc.invalidateQueries({ queryKey: ['series'] })
      void qc.invalidateQueries({ queryKey: ['book'] })
      onDone()
    } catch (e) { setError((e as Error).message) }
  }
  return (
    <Modal title={`Add ${books.length} book${books.length === 1 ? '' : 's'} to a series`} onClose={onClose} footer={<>
      <button className="btn" onClick={onClose}>Cancel</button>
      <button className="btn primary" disabled={!name.trim()} onClick={() => void save()}>Add to series</button>
    </>}>
      <label className="field"><span>Series</span>
        <Combobox value={name} onChange={setName} autoFocus placeholder="Pick an existing series or type a new name"
          suggestions={series.data?.map(s => s.name) ?? []}
          describe={n => { const c = series.data?.find(s => s.name === n)?.count; return c ? `${c} book${c === 1 ? '' : 's'}` : undefined }} />
        <span className="small faint">{name.trim() ? (existing ? `Adds to “${existing.name}”` : 'Creates a new series') : ''}</span>
      </label>
      <label className="field" style={{ maxWidth: 200 }}><span>Number the first one</span>
        <input className="input" inputMode="decimal" value={start} onChange={e => setStart(e.target.value)} placeholder={existing ? 'After the last' : '1'} />
      </label>
      <div className="sel-order">
        <span className="small muted">In this order:</span>
        <ol>{books.map(b => <li key={b.id}><Check size={13} /> {b.title}</li>)}</ol>
      </div>
      {error && <p className="error">{error}</p>}
    </Modal>
  )
}
