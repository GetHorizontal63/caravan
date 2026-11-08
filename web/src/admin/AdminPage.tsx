import { useEffect, useState, type FormEvent } from 'react'
import { NavLink, Route, Routes, useSearchParams } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Folder, FolderOpen, ArrowUp, Plus, RefreshCw, Trash2, Pencil, X } from 'lucide-react'
import { api, formatBytes, type Library } from '../api'
import { Modal, Spinner, Toggle, toast } from '../components/ui'
import { useSession } from '../session'

export default function AdminPage() {
  return (
    <div style={{ maxWidth: 1000 }}>
      <div className="page-title"><h1>Administration</h1></div>
      <nav className="tabs">
        <NavLink to="/admin" end>Dashboard</NavLink>
        <NavLink to="/admin/libraries">Libraries</NavLink>
        <NavLink to="/admin/users">Users</NavLink>
        <NavLink to="/admin/metadata">Metadata & server</NavLink>
      </nav>
      <Routes>
        <Route index element={<Dashboard />} />
        <Route path="libraries" element={<Libraries />} />
        <Route path="users" element={<Users />} />
        <Route path="metadata" element={<ServerSettings />} />
      </Routes>
    </div>
  )
}

interface ScanStatus { running: boolean; libraryName: string; total: number; processed: number; added: number; current: string; error: string; metadataPending: number }

function useScanStatus() {
  const qc = useQueryClient()
  const q = useQuery({
    queryKey: ['scan-status'],
    queryFn: () => api<ScanStatus>('/api/scan/status'),
    refetchInterval: d => (d.state.data?.running || d.state.data?.metadataPending ? 1500 : 10000),
  })
  const busy = !!(q.data?.running || q.data?.metadataPending)
  useEffect(() => {
    if (!busy) { void qc.invalidateQueries({ queryKey: ['stats'] }); void qc.invalidateQueries({ queryKey: ['libraries'] }); void qc.invalidateQueries({ queryKey: ['home'] }) }
  }, [busy, qc])
  return q.data
}

function ScanBanner() {
  const s = useScanStatus()
  if (!s?.running && !s?.metadataPending) return null
  return (
    <div className="card row" style={{ marginBottom: 18 }}>
      <Spinner />
      <div className="grow">
        {s.running
          ? <><b>Scanning {s.libraryName}</b> — {s.processed}/{s.total} files, {s.added} new<div className="small faint truncate">{s.current}</div></>
          : <><b>Fetching metadata</b> — {s.metadataPending} book(s) queued<div className="small faint">Looking up ISBNs and titles on Open Library and Google Books</div></>}
      </div>
    </div>
  )
}

function Dashboard() {
  const stats = useQuery({ queryKey: ['stats'], queryFn: () => api<Record<string, number>>('/api/stats') })
  const s = stats.data
  const run = (path: string, msg: string) => api(path, { method: 'POST' }).then(r => toast((r as any)?.queued !== undefined ? `${(r as any).queued} book(s) queued` : msg)).catch(e => toast(e.message))
  return (
    <>
      <ScanBanner />
      {s && (
        <div className="stats">
          <div className="stat"><b>{s.books}</b><span>Books</span></div>
          <div className="stat"><b>{s.authors}</b><span>Authors</span></div>
          <div className="stat"><b>{s.series}</b><span>Series</span></div>
          <div className="stat"><b>{formatBytes(s.bytes)}</b><span>Library size</span></div>
          <div className="stat"><b>{s.unmatched}</b><span>Not matched to a provider</span></div>
          <div className="stat"><b>{s.withoutCover}</b><span>Without cover</span></div>
          {s.missing > 0 && <div className="stat"><b>{s.missing}</b><span>Files missing</span></div>}
        </div>
      )}
      <div className="row">
        <button className="btn primary" onClick={() => void run('/api/scan', 'Scanning all libraries')}><RefreshCw size={16} />Scan all libraries</button>
        <button className="btn" onClick={() => void run('/api/metadata/refresh-all', '')}>Fetch missing metadata & covers</button>
      </div>
    </>
  )
}

// ---- libraries ---------------------------------------------------------------

function FolderPicker({ onPick, onClose }: { onPick(path: string): void; onClose(): void }) {
  const [path, setPath] = useState('')
  const [manual, setManual] = useState('')
  const q = useQuery({ queryKey: ['browse', path], queryFn: () => api<{ path: string; parent: string | null; dirs: { name: string; path: string }[]; books?: number }>(`/api/fs/browse?path=${encodeURIComponent(path)}`) })
  return (
    <Modal title="Choose a folder" onClose={onClose} footer={<>
      <button className="btn" onClick={onClose}>Cancel</button>
      <button className="btn primary" disabled={!path} onClick={() => onPick(path)}>Use this folder</button>
    </>}>
      <form className="row" style={{ marginBottom: 12, flexWrap: 'nowrap' }} onSubmit={e => { e.preventDefault(); if (manual) setPath(manual) }}>
        <input className="input" placeholder="Type a path, e.g. /books or D:\Books or \\nas\share" value={manual} onChange={e => setManual(e.target.value)} />
        <button className="btn">Go</button>
      </form>
      <div className="small muted" style={{ marginBottom: 8 }}>{path || 'Locations'}{q.data?.books ? ` · ${q.data.books} book file(s) here` : ''}</div>
      <div className="folder-list">
        {q.data?.parent !== null && q.data?.parent !== undefined && <button onClick={() => setPath(q.data!.parent!)}><ArrowUp size={16} />..</button>}
        {q.isLoading && <div style={{ padding: 12 }}><Spinner /></div>}
        {q.isError && <div className="error" style={{ padding: 12 }}>{(q.error as Error).message}</div>}
        {q.data?.dirs.map(d => <button key={d.path} onClick={() => setPath(d.path)}><Folder size={16} />{d.name}</button>)}
        {q.data && !q.data.dirs.length && <div className="faint small" style={{ padding: 12 }}>No sub-folders</div>}
      </div>
    </Modal>
  )
}

function LibraryEditor({ lib, onClose }: { lib?: Library; onClose(): void }) {
  const qc = useQueryClient()
  const [name, setName] = useState(lib?.name ?? '')
  const [kind, setKind] = useState<'books' | 'comics'>(lib?.kind ?? 'books')
  const [paths, setPaths] = useState<string[]>(lib?.paths ?? [])
  const [fetchMetadata, setFetch] = useState(lib?.fetchMetadata ?? true)
  const [picking, setPicking] = useState(false)
  const [error, setError] = useState('')
  const save = async (e: FormEvent) => {
    e.preventDefault()
    setError('')
    try {
      await api(lib ? `/api/libraries/${lib.id}` : '/api/libraries', { method: lib ? 'PUT' : 'POST', body: { name, kind, paths, fetchMetadata } })
      void qc.invalidateQueries({ queryKey: ['libraries'] })
      toast(lib ? 'Library saved' : 'Library added — scanning now')
      onClose()
    } catch (err) { setError((err as Error).message) }
  }
  return (
    <>
      <Modal title={lib ? `Edit ${lib.name}` : 'Add library'} onClose={onClose} footer={<>
        <button className="btn" onClick={onClose}>Cancel</button>
        <button className="btn primary" form="lib-form" disabled={!name || !paths.length}>Save</button>
      </>}>
        <form id="lib-form" onSubmit={e => void save(e)}>
          <label className="field"><span>Name</span><input className="input" value={name} onChange={e => setName(e.target.value)} placeholder="Books" autoFocus /></label>
          <div className="field"><span>Content type</span>
            <div className="chips">
              <button type="button" className={`chip ${kind === 'books' ? 'on' : ''}`} onClick={() => setKind('books')}>Books</button>
              <button type="button" className={`chip ${kind === 'comics' ? 'on' : ''}`} onClick={() => setKind('comics')}>Comics & manga</button>
            </div>
          </div>
          <div className="field"><span>Folders</span>
            <div className="list">
              {paths.map(p => (
                <div key={p} className="list-item"><FolderOpen size={16} /><span className="grow" style={{ overflowWrap: 'anywhere' }}>{p}</span>
                  <button type="button" className="icon-btn" onClick={() => setPaths(paths.filter(x => x !== p))} aria-label="Remove"><X size={16} /></button></div>
              ))}
            </div>
            <button type="button" className="btn small" style={{ justifySelf: 'start' }} onClick={() => setPicking(true)}><Plus size={14} />Add folder</button>
          </div>
          <Toggle label="Fetch metadata online" hint="Look up ISBNs and titles on Open Library / Google Books to fill in descriptions, covers and more." checked={fetchMetadata} onChange={setFetch} />
          {error && <p className="error">{error}</p>}
        </form>
      </Modal>
      {picking && <FolderPicker onClose={() => setPicking(false)} onPick={p => { if (!paths.includes(p)) setPaths([...paths, p]); setPicking(false) }} />}
    </>
  )
}

function Libraries() {
  const qc = useQueryClient()
  const [params] = useSearchParams()
  const libs = useQuery({ queryKey: ['libraries'], queryFn: () => api<Library[]>('/api/libraries') })
  const [editing, setEditing] = useState<Library | 'new' | null>(params.get('welcome') ? 'new' : null)
  return (
    <>
      <ScanBanner />
      {params.get('welcome') && !libs.data?.length && <p className="muted">Next, add a folder that contains your e-books. Subfolders are included, and Calibre libraries are supported.</p>}
      <div className="list" style={{ marginBottom: 14 }}>
        {libs.data?.map(l => (
          <div key={l.id} className="list-item">
            <div className="grow">
              <div style={{ fontWeight: 600 }}>{l.name} <span className="badge">{l.kind}</span></div>
              <div className="small faint" style={{ overflowWrap: 'anywhere' }}>{l.paths?.join(' · ')}</div>
              <div className="small muted">{l.count} books{l.lastScan ? ` · scanned ${new Date(l.lastScan).toLocaleString()}` : ''}</div>
            </div>
            <button className="icon-btn" title="Scan" onClick={() => api(`/api/libraries/${l.id}/scan`, { method: 'POST' }).then(() => { toast('Scan started'); void qc.invalidateQueries({ queryKey: ['scan-status'] }) }).catch(e => toast(e.message))}><RefreshCw size={18} /></button>
            <button className="icon-btn" title="Edit" onClick={() => setEditing(l)}><Pencil size={18} /></button>
            <button className="icon-btn" title="Delete" onClick={async () => {
              if (!confirm(`Remove the library "${l.name}"? Files on disk are not touched, but reading progress for its books is lost.`)) return
              await api(`/api/libraries/${l.id}`, { method: 'DELETE' })
              void qc.invalidateQueries()
            }}><Trash2 size={18} /></button>
          </div>
        ))}
      </div>
      <button className="btn primary" onClick={() => setEditing('new')}><Plus size={16} />Add library</button>
      {editing && <LibraryEditor lib={editing === 'new' ? undefined : editing} onClose={() => setEditing(null)} />}
    </>
  )
}

// ---- users ---------------------------------------------------------------

function Users() {
  const { user: me } = useSession()
  const qc = useQueryClient()
  const users = useQuery({ queryKey: ['users'], queryFn: () => api<{ id: number; username: string; isAdmin: number; lastSeen: number | null }[]>('/api/users') })
  const [adding, setAdding] = useState(false)
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [isAdmin, setIsAdmin] = useState(false)
  const add = async (e: FormEvent) => {
    e.preventDefault()
    try {
      await api('/api/users', { body: { username, password, isAdmin } })
      setAdding(false); setUsername(''); setPassword(''); setIsAdmin(false)
      void qc.invalidateQueries({ queryKey: ['users'] })
    } catch (err) { toast((err as Error).message) }
  }
  return (
    <>
      <table className="table" style={{ marginBottom: 16 }}>
        <thead><tr><th>User</th><th>Role</th><th>Last active</th><th /></tr></thead>
        <tbody>
          {users.data?.map(u => (
            <tr key={u.id}>
              <td>{u.username}</td>
              <td>{u.isAdmin ? 'Administrator' : 'Reader'}</td>
              <td className="muted">{u.lastSeen ? new Date(u.lastSeen).toLocaleString() : 'Never'}</td>
              <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                <button className="btn small ghost" onClick={async () => { const p = prompt(`New password for ${u.username}`); if (p) { await api(`/api/users/${u.id}`, { method: 'PATCH', body: { password: p } }); toast('Password reset') } }}>Reset password</button>
                {u.id !== me?.id && <>
                  <button className="btn small ghost" onClick={async () => { await api(`/api/users/${u.id}`, { method: 'PATCH', body: { isAdmin: !u.isAdmin } }); void qc.invalidateQueries({ queryKey: ['users'] }) }}>{u.isAdmin ? 'Make reader' : 'Make admin'}</button>
                  <button className="btn small ghost danger" onClick={async () => { if (confirm(`Delete ${u.username}?`)) { await api(`/api/users/${u.id}`, { method: 'DELETE' }); void qc.invalidateQueries({ queryKey: ['users'] }) } }}>Delete</button>
                </>}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <button className="btn primary" onClick={() => setAdding(true)}><Plus size={16} />Add user</button>
      {adding && (
        <Modal title="Add user" onClose={() => setAdding(false)} footer={<><button className="btn" onClick={() => setAdding(false)}>Cancel</button><button className="btn primary" form="user-form">Create</button></>}>
          <form id="user-form" onSubmit={e => void add(e)}>
            <label className="field"><span>Username</span><input className="input" value={username} onChange={e => setUsername(e.target.value)} autoFocus autoCapitalize="off" /></label>
            <label className="field"><span>Password</span><input className="input" type="password" value={password} onChange={e => setPassword(e.target.value)} /></label>
            <Toggle label="Administrator" hint="Can manage libraries, metadata and users" checked={isAdmin} onChange={setIsAdmin} />
          </form>
        </Modal>
      )}
    </>
  )
}

// ---- server settings ------------------------------------------------------------

interface Settings { serverName: string; googleBooksApiKey: string; merriamWebsterApiKey: string; autoFetchMetadata: boolean; scanIntervalHours: number; providers: string[]; supportedExtensions: string[] }

function ServerSettings() {
  const q = useQuery({ queryKey: ['settings'], queryFn: () => api<Settings>('/api/settings') })
  const [s, setS] = useState<Settings | null>(null)
  useEffect(() => { if (q.data) setS(q.data) }, [q.data])
  const { refresh } = useSession()
  if (!s) return <Spinner />
  const save = async () => {
    await api('/api/settings', { method: 'PUT', body: { serverName: s.serverName, googleBooksApiKey: s.googleBooksApiKey, merriamWebsterApiKey: s.merriamWebsterApiKey, autoFetchMetadata: s.autoFetchMetadata, scanIntervalHours: s.scanIntervalHours, providers: s.providers } })
    toast('Settings saved')
    void refresh()
  }
  const moveUp = (i: number) => { const p = [...s.providers]; [p[i - 1], p[i]] = [p[i], p[i - 1]]; setS({ ...s, providers: p }) }
  const label: Record<string, string> = { openlibrary: 'Open Library', googlebooks: 'Google Books' }
  return (
    <div className="card">
      <label className="field"><span>Server name</span><input className="input" value={s.serverName} onChange={e => setS({ ...s, serverName: e.target.value })} /></label>
      <Toggle label="Fetch metadata automatically" hint="New books are matched by ISBN first, then by title and author." checked={s.autoFetchMetadata} onChange={v => setS({ ...s, autoFetchMetadata: v })} />
      <div className="field" style={{ marginTop: 10 }}><span>Provider priority (first wins, others fill gaps)</span>
        <div className="list">
          {s.providers.map((p, i) => (
            <div key={p} className="list-item"><span className="grow">{i + 1}. {label[p] ?? p}</span>{i > 0 && <button className="btn small ghost" onClick={() => moveUp(i)}>Move up</button>}</div>
          ))}
        </div>
      </div>
      <label className="field"><span>Google Books API key</span>
        <input className="input" value={s.googleBooksApiKey} onChange={e => setS({ ...s, googleBooksApiKey: e.target.value })} placeholder="Recommended — without a key Google shares a tiny anonymous quota" />
        <span className="small faint">Free from Google Cloud Console → APIs &amp; Services → enable “Books API” → Credentials → API key.</span>
      </label>
      <label className="field"><span>Merriam-Webster dictionary key</span>
        <input className="input" value={s.merriamWebsterApiKey ?? ''} onChange={e => setS({ ...s, merriamWebsterApiKey: e.target.value })} placeholder="Turns on “Define” for selected words in the reader" />
        <span className="small faint">Free at dictionaryapi.com → Register → request a key for the <b>Collegiate Dictionary</b> (1,000 look-ups a day; Caravan caches every word for 30 days).</span>
      </label>
      <label className="field"><span>Rescan libraries every (hours, 0 = never)</span>
        <input className="input" type="number" min={0} style={{ width: 120 }} value={s.scanIntervalHours} onChange={e => setS({ ...s, scanIntervalHours: Number(e.target.value) })} />
      </label>
      <p className="small muted">Supported file types: {s.supportedExtensions.join(', ')}</p>
      <button className="btn primary" onClick={() => void save()}>Save</button>
    </div>
  )
}
