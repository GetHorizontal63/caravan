import { useEffect, useRef, useState } from 'react'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Upload, RefreshCw, Layers, Plus, LayoutGrid, LibraryBig } from 'lucide-react'
import { api, authedUrl, type Collection, type Library, type SeriesSummary } from '../api'
import { BookGrid, hue, SkeletonCards } from '../components/books'
import { Bookshelf } from '../components/Bookshelf'
import { CollectionCard } from './Collection'
import { NewSeriesDialog } from './Series'
import { CollectionEditDialog } from '../components/GroupDialogs'
import { Empty } from '../components/ui'
import { Select } from '../components/Dropdown'
import { Spinner, toast } from '../components/ui'
import { useSession } from '../session'

export const SORTS = [
  ['title', 'Title'], ['author', 'Author'], ['series', 'Series'], ['added', 'Date added'], ['recent', 'Recently read'], ['published', 'Publication date'],
] as const
export const STATUSES = [['', 'All'], ['unread', 'Unread'], ['reading', 'Reading'], ['finished', 'Finished'], ['favorite', 'Favorites']] as const

const LAYOUT_KEY = 'caravan.layout'
const savedLayout = () => { try { return localStorage.getItem(LAYOUT_KEY) === 'shelf' ? 'shelf' : 'grid' } catch { return 'grid' } }

export function Filters({ params, set, layout, setLayout }: { params: URLSearchParams; set(k: string, v: string): void; layout?: 'grid' | 'shelf'; setLayout?(l: 'grid' | 'shelf'): void }) {
  return (
    <div className="toolbar">
      {layout && setLayout && (
        <div className="layout-toggle" role="radiogroup" aria-label="Layout">
          <button role="radio" aria-checked={layout === 'grid'} className={layout === 'grid' ? 'on' : ''} onClick={() => setLayout('grid')} title="Covers"><LayoutGrid size={17} /></button>
          <button role="radio" aria-checked={layout === 'shelf'} className={layout === 'shelf' ? 'on' : ''} onClick={() => setLayout('shelf')} title="Bookshelf (spines)"><LibraryBig size={17} /></button>
        </div>
      )}
      <Select label="Sort by" value={params.get('sort') ?? 'title'} onChange={v => set('sort', v)} prefix="Sort:" options={SORTS.map(([value, label]) => ({ value, label }))} />
      <div className="chips">
        {STATUSES.map(([v, l]) => (
          <button key={v} className={`chip ${(params.get('status') ?? '') === v ? 'on' : ''}`} onClick={() => set('status', v)}>{l}</button>
        ))}
      </div>
    </div>
  )
}

export default function LibraryPage() {
  const { id } = useParams()
  const [params, setParams] = useSearchParams()
  const { user } = useSession()
  const qc = useQueryClient()
  const libs = useQuery({ queryKey: ['libraries'], queryFn: () => api<Library[]>('/api/libraries') })
  const lib = libs.data?.find(l => String(l.id) === id)
  const navigate = useNavigate()
  useEffect(() => { if (lib) try { localStorage.setItem('caravan.lastLibrary', String(lib.id)) } catch { /* private mode */ } }, [lib])
  const view = params.get('view') ?? 'books'
  const set = (k: string, v: string) => setParams(p => { v ? p.set(k, v) : p.delete(k); return p }, { replace: true })
  const layout = (params.get('layout') as 'grid' | 'shelf' | null) ?? savedLayout()
  const setLayout = (l: 'grid' | 'shelf') => { try { localStorage.setItem(LAYOUT_KEY, l) } catch { /* private mode */ } set('layout', l) }

  const fileInput = useRef<HTMLInputElement>(null)
  const [uploading, setUploading] = useState(false)
  const upload = async (files: FileList | null) => {
    if (!files?.length) return
    setUploading(true)
    const form = new FormData()
    for (const f of files) form.append('file', f, f.name)
    try {
      const r = await api<{ saved: string[] }>(`/api/libraries/${id}/upload`, { body: form })
      toast(`Uploaded ${r.saved.length} file(s) — scanning…`)
      setTimeout(() => void qc.invalidateQueries({ queryKey: ['books'] }), 4000)
    } catch (e) {
      toast((e as Error).message)
    } finally {
      setUploading(false)
    }
  }

  if (libs.isLoading) return <div className="center-screen"><Spinner /></div>
  if (!lib) return <p className="muted">Library not found.</p>

  return (
    <>
      <div className="page-title">
        <div className="grow">
          <h1>{lib.name}</h1>
          <div className="sub">{lib.count} {lib.kind === 'comics' ? 'comics' : 'books'}</div>
          {(libs.data?.length ?? 0) > 1 && (
            <div className="library-switch">
              <Select label="Library" prefix="Library:" value={String(lib.id)} onChange={v => navigate(`/library/${v}`)}
                options={libs.data!.map(l => ({ value: String(l.id), label: `${l.name} (${l.count})` }))} />
            </div>
          )}
        </div>
        {user?.isAdmin && (
          <>
            <input ref={fileInput} type="file" multiple hidden onChange={e => void upload(e.target.files)} />
            <button className="btn small" onClick={() => fileInput.current?.click()} disabled={uploading}><Upload size={16} />{uploading ? 'Uploading…' : 'Upload'}</button>
            <button className="btn small" onClick={() => api(`/api/libraries/${lib.id}/scan`, { method: 'POST' }).then(() => toast('Scan started')).catch(e => toast(e.message))}><RefreshCw size={16} />Scan</button>
          </>
        )}
      </div>
      <div className="tabs">
        <button className={view === 'books' ? 'active' : ''} onClick={() => set('view', '')}>Books</button>
        <button className={view === 'authors' ? 'active' : ''} onClick={() => set('view', 'authors')}>Authors</button>
        <button className={view === 'series' ? 'active' : ''} onClick={() => set('view', 'series')}>Series</button>
        <button className={view === 'collections' ? 'active' : ''} onClick={() => set('view', 'collections')}>Collections</button>
      </div>
      {view === 'books' && (
        <>
          <Filters params={params} set={set} layout={layout} setLayout={setLayout} />
          {layout === 'shelf'
            ? <Bookshelf comic={lib.kind === 'comics'} params={{ library: id, sort: params.get('sort') ?? 'title', status: params.get('status') ?? undefined }} />
            : <BookGrid params={{ library: id, sort: params.get('sort') ?? 'title', status: params.get('status') ?? undefined }} />}
        </>
      )}
      {view === 'authors' && <AuthorList />}
      {view === 'series' && <SeriesList libraryId={lib.id} canEdit={!!user?.isAdmin} />}
      {view === 'collections' && <CollectionList libraryId={lib.id} />}
    </>
  )
}

function AuthorList() {
  const q = useQuery({ queryKey: ['authors'], queryFn: () => api<{ id: number; name: string; count: number }[]>('/api/authors') })
  if (q.isLoading) return <Spinner />
  return (
    <div className="list">
      {q.data?.map(a => (
        <Link key={a.id} to={`/search?author=${a.id}&label=${encodeURIComponent(a.name)}&sort=series`} className="list-item">
          <span className="initial" style={{ background: `linear-gradient(135deg, hsl(${hue(a.name)} 45% 45%), hsl(${(hue(a.name) + 40) % 360} 50% 30%))` }}>{a.name[0]}</span>
          <span className="grow" style={{ fontWeight: 600 }}>{a.name}</span><span className="badge">{a.count}</span>
        </Link>
      ))}
    </div>
  )
}

function SeriesList({ libraryId, canEdit }: { libraryId: number; canEdit: boolean }) {
  const q = useQuery({ queryKey: ['series', libraryId], queryFn: () => api<SeriesSummary[]>(`/api/series?library=${libraryId}`) })
  const [creating, setCreating] = useState(false)
  return (
    <>
      {canEdit && <div className="row" style={{ marginBottom: 18 }}><button className="btn" onClick={() => setCreating(true)}><Plus size={16} />New series</button></div>}
      {q.isLoading ? <div className="grid"><SkeletonCards count={6} /></div> : !q.data?.length ? (
        <Empty title="No series yet">Series come from book metadata (Calibre, EPUB 3, ComicInfo) or providers{canEdit ? ', or create one yourself.' : '.'}</Empty>
      ) : (
        <div className="grid">
          {q.data.map(s => (
            <Link key={s.name} to={`/series/${encodeURIComponent(s.name)}?library=${libraryId}`} className="book-card series-card">
              <div className="stacked">
                <div className="cover">
                  {s.coverBook ? <img src={authedUrl(`/api/books/${s.coverBook}/cover`, { v: s.coverFile?.replace(/\.jpg$/, '') })} alt="" loading="lazy" /> : <div className="placeholder" style={{ background: `linear-gradient(160deg, hsl(${hue(s.name)} 42% 36%), hsl(${(hue(s.name) + 35) % 360} 48% 18%))` }}><Layers /></div>}
                </div>
              </div>
              <div className="meta"><div className="title">{s.name}</div><div className="author">{s.count} book{s.count === 1 ? '' : 's'}</div></div>
            </Link>
          ))}
        </div>
      )}
      {creating && <NewSeriesDialog libraryId={libraryId} onClose={() => setCreating(false)} />}
    </>
  )
}

function CollectionList({ libraryId }: { libraryId: number }) {
  const qc = useQueryClient()
  const q = useQuery({ queryKey: ['collections', libraryId], queryFn: () => api<Collection[]>(`/api/libraries/${libraryId}/collections`) })
  const [creating, setCreating] = useState(false)
  return (
    <>
      <div className="row" style={{ marginBottom: 18 }}><button className="btn" onClick={() => setCreating(true)}><Plus size={16} />New collection</button></div>
      {q.isLoading ? <div className="grid"><SkeletonCards count={6} /></div> : !q.data?.length ? (
        <Empty title="No collections yet">Group books your way: a reading list, a theme, award winners, books to lend…</Empty>
      ) : (
        <div className="grid">{q.data.map(c => <CollectionCard key={c.id} c={c} />)}</div>
      )}
      {creating && <CollectionEditDialog libraryId={libraryId} onClose={() => setCreating(false)} onSaved={() => { setCreating(false); void qc.invalidateQueries({ queryKey: ['collections'] }) }} />}
    </>
  )
}
