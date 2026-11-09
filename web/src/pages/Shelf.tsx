import { useRef, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Lock, Upload } from 'lucide-react'
import { api } from '../api'
import { BookGrid } from '../components/books'
import { Bookshelf } from '../components/Bookshelf'
import { Empty, Spinner, toast } from '../components/ui'
import { Filters } from './Library'

interface ShelfInfo { libraryId: number; count: number; sharedWithMe: number }

const LAYOUT_KEY = 'caravan.layout'
const savedLayout = () => { try { return localStorage.getItem(LAYOUT_KEY) === 'shelf' ? 'shelf' : 'grid' } catch { return 'grid' } }

/** Your private shelf: books only you can see, plus the ones other people shared with you. */
export default function ShelfPage() {
  const qc = useQueryClient()
  const [params, setParams] = useSearchParams()
  const set = (k: string, v: string) => setParams(p => { v ? p.set(k, v) : p.delete(k); return p }, { replace: true })
  const view = params.get('view') === 'shared' ? 'shared' : 'mine'
  const layout = (params.get('layout') as 'grid' | 'shelf' | null) ?? savedLayout()
  const setLayout = (l: 'grid' | 'shelf') => { try { localStorage.setItem(LAYOUT_KEY, l) } catch { /* private mode */ } set('layout', l) }
  const q = useQuery({ queryKey: ['shelf'], queryFn: () => api<ShelfInfo>('/api/shelf') })

  const input = useRef<HTMLInputElement>(null)
  const [uploading, setUploading] = useState(false)
  const upload = async (files: FileList | null) => {
    if (!files?.length) return
    setUploading(true)
    const form = new FormData()
    for (const f of files) form.append('file', f, f.name)
    try {
      const r = await api<{ saved: string[]; skipped: string[] }>('/api/shelf/upload', { body: form })
      toast(r.saved.length ? `Added ${r.saved.length} file${r.saved.length === 1 ? '' : 's'} to your shelf${r.skipped.length ? ` (${r.skipped.length} not a book format)` : ''}` : 'None of those are book files')
      // the scan takes a moment: refresh a couple of times
      for (const ms of [2500, 7000, 15000]) setTimeout(() => { void qc.invalidateQueries({ queryKey: ['books'] }); void qc.invalidateQueries({ queryKey: ['shelf'] }) }, ms)
    } catch (e) {
      toast((e as Error).message)
    } finally {
      setUploading(false)
      if (input.current) input.current.value = ''
    }
  }

  if (q.isLoading) return <div className="center-screen"><Spinner /></div>
  if (q.isError || !q.data) return <p className="error">{(q.error as Error)?.message ?? 'Could not load your shelf'}</p>
  const s = q.data
  const filter = { sort: params.get('sort') ?? 'title', status: params.get('status') ?? undefined }

  return (
    <>
      <div className="page-title">
        <div className="grow">
          <h1>My Shelf</h1>
          <div className="sub"><Lock size={13} style={{ verticalAlign: '-1px' }} /> Private to you · {s.count} book{s.count === 1 ? '' : 's'}{s.sharedWithMe ? ` · ${s.sharedWithMe} shared with you` : ''}</div>
        </div>
        <input ref={input} type="file" multiple hidden onChange={e => void upload(e.target.files)} />
        <button className="btn small" onClick={() => input.current?.click()} disabled={uploading}><Upload size={16} />{uploading ? 'Uploading…' : 'Add books'}</button>
      </div>
      <div className="tabs">
        <button className={view === 'mine' ? 'active' : ''} onClick={() => set('view', '')}>My books</button>
        <button className={view === 'shared' ? 'active' : ''} onClick={() => set('view', 'shared')}>Shared with me{s.sharedWithMe ? ` (${s.sharedWithMe})` : ''}</button>
      </div>

      {view === 'mine' ? (
        <>
          <Filters params={params} set={set} layout={layout} setLayout={setLayout} />
          {(() => {
            const empty = (
              <Empty title="Your shelf is empty">
                <p>Add your own books: only you can see them. Open any of them to share it with people you choose.</p>
                <button className="btn primary" onClick={() => input.current?.click()}><Upload size={16} />Add books</button>
              </Empty>
            )
            const p = { library: String(s.libraryId), ...filter }
            return layout === 'shelf' ? <Bookshelf params={p} empty={empty} /> : <BookGrid params={p} empty={empty} />
          })()}
        </>
      ) : (
        <>
          <Filters params={params} set={set} />
          <BookGrid params={{ shared: '1', ...filter }} empty={<Empty title="Nothing shared with you yet">When someone shares a book from their shelf with you, it appears here.</Empty>} />
        </>
      )}
    </>
  )
}
