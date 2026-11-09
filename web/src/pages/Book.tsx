import { useState, type CSSProperties, type ReactNode } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { BookOpen, Download, Heart, CheckCircle2, Search, Pencil, Image, RefreshCw, Trash2, MoreHorizontal, Layers, FolderPlus, ListOrdered, Share2, Lock, Users } from 'lucide-react'
import { api, authedUrl, coverUrl, formatBytes, type BookDetail, type BookSummary } from '../api'
import { Book3D, Shelf, useCoverColor } from '../components/books'
import { Spinner, toast } from '../components/ui'
import { CoverDialog, EditMetadataDialog, IdentifyDialog } from '../components/MetadataDialogs'
import { AddToCollectionDialog, AddToSeriesDialog } from '../components/GroupDialogs'
import { Menu, type MenuItem } from '../components/Dropdown'
import { ShareDialog } from '../components/ShareDialog'
import { useSession } from '../session'

const sourceLabel: Record<string, string> = { file: 'From file', openlibrary: 'Open Library', googlebooks: 'Google Books', manual: 'Edited', embedded: 'Embedded', upload: 'Uploaded', url: 'URL' }

function ProgressRing({ value }: { value: number }) {
  const r = 21, c = 2 * Math.PI * r
  return (
    <div className="progress-ring" title={`${Math.round(value * 100)}% read`}>
      <svg width="50" height="50">
        <circle cx="25" cy="25" r={r} fill="none" stroke="var(--line-strong)" strokeWidth="4" />
        <circle cx="25" cy="25" r={r} fill="none" stroke="var(--tint, var(--accent))" strokeWidth="4" strokeLinecap="round" strokeDasharray={c} strokeDashoffset={c * (1 - value)} />
      </svg>
      <span>{Math.round(value * 100)}%</span>
    </div>
  )
}

export default function BookPage() {
  const { id } = useParams()
  const nav = useNavigate()
  const qc = useQueryClient()
  const { user } = useSession()
  const q = useQuery({ queryKey: ['book', id], queryFn: () => api<BookDetail>(`/api/books/${id}`) })
  const b = q.data
  const tint = useCoverColor(b ? coverUrl(b) : undefined)
  const series = useQuery({
    queryKey: ['books', { series: b?.series }],
    queryFn: () => api<{ items: BookSummary[] }>(`/api/books?${new URLSearchParams({ series: b!.series!, sort: 'series', limit: '40' })}`),
    enabled: !!b?.series,
  })
  const firstAuthor = b?.authorIds[0]
  const byAuthor = useQuery({
    queryKey: ['books', { author: firstAuthor?.id }],
    queryFn: () => api<{ items: BookSummary[] }>(`/api/books?${new URLSearchParams({ author: String(firstAuthor!.id), sort: 'series', limit: '40' })}`),
    enabled: !!firstAuthor,
  })
  const [dialog, setDialog] = useState<'identify' | 'edit' | 'cover' | 'collection' | 'series' | 'share' | null>(null)
  const [expanded, setExpanded] = useState(false)
  const [picked, setPicked] = useState<number | null>(null)

  const update = (nb: BookDetail) => {
    qc.setQueryData(['book', id], nb)
    void qc.invalidateQueries({ queryKey: ['books'] })
    void qc.invalidateQueries({ queryKey: ['home'] })
    setDialog(null)
  }
  const setState = async (patch: { finished?: boolean; favorite?: boolean }) => update(await api<BookDetail>(`/api/books/${id}/state`, { body: patch }))

  if (q.isLoading) return <div className="center-screen"><Spinner /></div>
  if (q.isError || !b) return <p className="error">{(q.error as Error)?.message ?? 'Not found'}</p>
  const pct = Math.round(b.progress * 100)
  const cover = coverUrl(b)
  // which version to read / download: the one picked, else the one last read, else the preferred one
  const files = b.files ?? []
  const chosen = files.find(f => f.id === picked) ?? files.find(f => f.id === b.locatorFileId) ?? files[0]
  const fileQuery = chosen && files.length > 1 ? `?file=${chosen.id}` : ''

  // admins manage books in the shared libraries (and their own shelf); nobody manages someone else's shelf
  const canAdmin = !!user?.isAdmin && (!b.shelf || b.shelf.mine)
  const adminItems: MenuItem[] = canAdmin ? ([
                  { label: 'Identify…', icon: <Search size={16} />, onSelect: () => setDialog('identify') },
                  { label: 'Edit metadata…', icon: <Pencil size={16} />, onSelect: () => setDialog('edit') },
                  { label: 'Change cover…', icon: <Image size={16} />, onSelect: () => setDialog('cover') },
                  { label: b.series ? 'Change series…' : 'Add to series…', icon: <ListOrdered size={16} />, onSelect: () => setDialog('series') },
                  {
                    label: 'Refresh metadata', icon: <RefreshCw size={16} />, onSelect: async () => {
                      const r = await api<{ found: boolean; book: BookDetail }>(`/api/books/${b.id}/refresh`, { method: 'POST' })
                      toast(r.found ? 'Metadata refreshed' : 'No confident match — try Identify')
                      update(r.book)
                    },
                  },
                  {
                    label: 'Remove from library', icon: <Trash2 size={16} />, danger: true, onSelect: async () => {
                      if (!confirm('Remove this book from the library? The file on disk is not deleted, and it will come back on the next scan unless you move it.')) return
                      await api(`/api/books/${b.id}`, { method: 'DELETE' })
                      void qc.invalidateQueries()
                      nav(-1)
                    },
                  },
                ] as MenuItem[]).filter(i => !(b.shelf && i.label === 'Remove from library')) : []
  const shelfItems: MenuItem[] = b.shelf?.mine ? [
    { label: b.shelf.sharedWith ? `Sharing (${b.shelf.sharedWith})…` : 'Share…', icon: <Share2 size={16} />, onSelect: () => setDialog('share') },
    {
      label: 'Remove from my shelf', icon: <Trash2 size={16} />, danger: true, onSelect: async () => {
        if (!confirm(`Remove “${b.title}” from your shelf? The file is deleted, and people you shared it with lose access.`)) return
        await api(`/api/shelf/books/${b.id}`, { method: 'DELETE' })
        void qc.invalidateQueries()
        nav('/shelf')
      },
    },
  ] : []
  const menuItems = [...adminItems, ...shelfItems]

  const facts: [string, ReactNode][] = [
    ['Format', files.length > 1 ? files.map(f => f.label).join(' · ') : chosen?.label ?? b.formatLabel],
    ['Published', b.published?.slice(0, 10)],
    ['Publisher', b.publisher],
    ['Pages', b.pageCount],
    ['Language', b.language?.toUpperCase()],
    ['ISBN', b.isbn13],
    ['Size', formatBytes(chosen?.size ?? b.size)],
    ['Metadata', sourceLabel[b.metadataSource] ?? b.metadataSource],
  ]
  const others = (list?: BookSummary[]) => (list ?? []).filter(x => x.id !== b.id)
  const seriesBooks = others(series.data?.items)
  const authorBooks = others(byAuthor.data?.items).filter(x => !seriesBooks.some(s => s.id === x.id))

  return (
    <div style={tint ? ({ '--tint': tint } as CSSProperties) : undefined}>
      <div className="detail-hero">
        {cover && <div className="backdrop" style={{ backgroundImage: `url("${cover}")` }} />}
        <div className="detail">
          <Book3D book={b} />
          <div style={{ minWidth: 0 }}>
            <h1>{b.title}</h1>
            {b.subtitle && <div className="subtitle">{b.subtitle}</div>}
            <div className="authors">
              {b.authorIds.map((a, i) => <span key={a.id}>{i > 0 && ', '}<Link to={`/search?author=${a.id}&label=${encodeURIComponent(a.name)}&sort=series`}>{a.name}</Link></span>)}
            </div>
            {b.shelf && (
              <div className="shelf-badge">
                {b.shelf.mine
                  ? <>{b.shelf.sharedWith ? <Users size={14} /> : <Lock size={14} />}On your shelf · {b.shelf.sharedWith ? `shared with ${b.shelf.sharedWith} ${b.shelf.sharedWith === 1 ? 'person' : 'people'}` : 'only you can see it'}</>
                  : <><Users size={14} />Shared with you by {b.shelf.ownerName ?? 'another reader'}</>}
              </div>
            )}
            {b.series && (
              <Link className="series" to={`/series/${encodeURIComponent(b.series)}?library=${b.libraryId}`}>
                <Layers size={14} />{b.series}{b.seriesIndex != null && ` · Book ${b.seriesIndex}`}
              </Link>
            )}

            <div className="actions">
              <button className="btn primary lg" onClick={() => nav(`/read/${b.id}${fileQuery}`)}>
                <BookOpen size={20} />{b.finished ? 'Read again' : pct > 0 ? 'Continue reading' : 'Start reading'}
              </button>
              {pct > 0 && !b.finished && <ProgressRing value={b.progress} />}
              <a className="icon-btn" href={authedUrl(`/api/books/${b.id}/file`, { file: chosen?.id })} download title={`Download ${chosen?.label ?? ''}`.trim()}><Download size={21} /></a>
              <button className="icon-btn" title="Add to collection" onClick={() => setDialog('collection')}><FolderPlus size={21} /></button>
              <button className={`icon-btn ${b.favorite ? 'active' : ''}`} title="Favorite" onClick={() => void setState({ favorite: !b.favorite })} style={b.favorite ? { color: 'var(--accent)' } : undefined}>
                <Heart size={21} fill={b.favorite ? 'currentColor' : 'none'} />
              </button>
              <button className={`icon-btn ${b.finished ? 'active' : ''}`} title={b.finished ? 'Mark unread' : 'Mark finished'} onClick={() => void setState({ finished: !b.finished })} style={b.finished ? { color: 'var(--ok)' } : undefined}>
                <CheckCircle2 size={21} />
              </button>
              {b.shelf?.mine && <button className="icon-btn" title={b.shelf.sharedWith ? `Shared with ${b.shelf.sharedWith}` : 'Share'} onClick={() => setDialog('share')} style={b.shelf.sharedWith ? { color: 'var(--accent)' } : undefined}><Share2 size={21} /></button>}
              {menuItems.length > 0 && <Menu label="Manage book" trigger={<MoreHorizontal size={22} />} items={menuItems} />}
            </div>

            {files.length > 1 && (
              <div className="versions" role="radiogroup" aria-label="Version to read or download">
                <span className="versions-label">Version</span>
                {files.map(f => (
                  <button key={f.id} role="radio" aria-checked={chosen?.id === f.id} className={`version ${chosen?.id === f.id ? 'on' : ''}`} onClick={() => setPicked(f.id)} title={f.fileName}>
                    <b>{f.label}</b>
                    <span>{formatBytes(f.size)}{f.id === b.locatorFileId && pct > 0 ? ' · last read' : ''}</span>
                  </button>
                ))}
              </div>
            )}

            {b.description && (
              <>
                <div className={`description ${expanded || b.description.length <= 400 ? '' : 'clamped'}`}>{b.description}</div>
                {b.description.length > 400 && <button className="btn ghost small" style={{ paddingLeft: 0, marginTop: 4 }} onClick={() => setExpanded(e => !e)}>{expanded ? 'Show less' : 'Read more'}</button>}
              </>
            )}

            <div className="fact-chips">
              {facts.filter(([, v]) => v !== null && v !== undefined && v !== '').map(([k, v]) => (
                <div key={k} className="fact"><b>{k}</b><span>{v}</span></div>
              ))}
            </div>
            {!!b.tags.length && (
              <div className="tags">{b.tags.map(t => <Link key={t} className="chip" to={`/search?tag=${encodeURIComponent(t)}&label=${encodeURIComponent(t)}`}>{t}</Link>)}</div>
            )}
          </div>
        </div>
      </div>

      {b.series && <Shelf title={`More in ${b.series}`} books={seriesBooks} />}
      {firstAuthor && <Shelf title={`More by ${firstAuthor.name}`} books={authorBooks} more={`/search?author=${firstAuthor.id}&label=${encodeURIComponent(firstAuthor.name)}&sort=series`} />}

      {dialog === 'identify' && <IdentifyDialog book={b} onClose={() => setDialog(null)} onDone={update} />}
      {dialog === 'edit' && <EditMetadataDialog book={b} onClose={() => setDialog(null)} onDone={update} />}
      {dialog === 'cover' && <CoverDialog book={b} onClose={() => setDialog(null)} onDone={update} />}
      {dialog === 'collection' && <AddToCollectionDialog book={b} onClose={() => setDialog(null)} />}
      {dialog === 'share' && <ShareDialog bookId={b.id} title={b.title} onClose={() => setDialog(null)} />}
      {dialog === 'series' && <AddToSeriesDialog book={b} onClose={() => setDialog(null)} onDone={() => {
        setDialog(null)
        void qc.invalidateQueries({ queryKey: ['book', id] })
        void qc.invalidateQueries({ queryKey: ['books'] })
        void qc.invalidateQueries({ queryKey: ['series'] })
      }} />}
    </div>
  )
}
