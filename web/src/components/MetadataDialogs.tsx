import { useState, type FormEvent } from 'react'
import { api, type BookDetail, type RemoteBook } from '../api'
import { Modal, Spinner, Toggle } from './ui'

const providerLabel = { openlibrary: 'Open Library', googlebooks: 'Google Books' } as const

/** Jellyfin-style "Identify": search providers by ISBN or title/author, pick the right edition. */
export function IdentifyDialog({ book, onClose, onDone }: { book: BookDetail; onClose(): void; onDone(b: BookDetail): void }) {
  const [isbn, setIsbn] = useState(book.isbn13 ?? '')
  const [title, setTitle] = useState(book.title)
  const [author, setAuthor] = useState(book.authors[0] ?? '')
  const [results, setResults] = useState<RemoteBook[] | null>(null)
  const [selected, setSelected] = useState<RemoteBook | null>(null)
  const [replaceCover, setReplaceCover] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const search = async (e?: FormEvent, byIsbn = false) => {
    e?.preventDefault()
    setBusy(true); setError(''); setSelected(null)
    try {
      const qs = byIsbn && isbn ? new URLSearchParams({ isbn }) : new URLSearchParams({ title, ...(author ? { author } : {}) })
      setResults(await api<RemoteBook[]>(`/api/metadata/search?${qs}`))
    } catch (err) { setError((err as Error).message) } finally { setBusy(false) }
  }

  const apply = async () => {
    if (!selected) return
    setBusy(true); setError('')
    try {
      onDone(await api<BookDetail>(`/api/books/${book.id}/identify`, { body: { candidate: selected, replaceCover } }))
    } catch (err) { setError((err as Error).message); setBusy(false) }
  }

  return (
    <Modal title="Identify book" onClose={onClose} wide footer={<>
      <div className="grow"><Toggle label="Replace cover" checked={replaceCover} onChange={setReplaceCover} /></div>
      <button className="btn" onClick={onClose}>Cancel</button>
      <button className="btn primary" disabled={!selected || busy} onClick={() => void apply()}>Apply</button>
    </>}>
      <form className="row" onSubmit={e => void search(e, true)} style={{ marginBottom: 12 }}>
        <input className="input grow" placeholder="ISBN-10 or ISBN-13" value={isbn} onChange={e => setIsbn(e.target.value)} inputMode="numeric" />
        <button className="btn" disabled={!isbn || busy}>Search ISBN</button>
      </form>
      <form className="row" onSubmit={e => void search(e)} style={{ marginBottom: 18 }}>
        <input className="input grow" placeholder="Title" value={title} onChange={e => setTitle(e.target.value)} />
        <input className="input grow" placeholder="Author" value={author} onChange={e => setAuthor(e.target.value)} />
        <button className="btn primary" disabled={!title || busy}>Search</button>
      </form>
      {error && <p className="error">{error}</p>}
      {busy && <div className="center-screen"><Spinner /></div>}
      {!busy && results?.length === 0 && <p className="muted">No matches. Try fewer words, or just the author's surname.</p>}
      {!busy && !!results?.length && (
        <div className="candidates">
          {results.map(r => (
            <button key={`${r.provider}:${r.providerId}`} className={`candidate ${selected === r ? 'selected' : ''}`} onClick={() => setSelected(r)}>
              <div className="cover">
                {r.coverUrl ? <img src={r.coverUrl} alt="" loading="lazy" referrerPolicy="no-referrer" /> : <div className="placeholder" style={{ background: 'var(--line)' }}><span className="t">{r.title}</span></div>}
              </div>
              <div className="t">{r.title}</div>
              <div className="small muted">{r.authors.join(', ')}</div>
              <div className="small faint">{[r.published?.slice(0, 4), r.publisher].filter(Boolean).join(' · ')}</div>
              <div className="row" style={{ marginTop: 6, gap: 6 }}>
                <span className="badge">{providerLabel[r.provider]}</span>
                {r.score != null && <span className="badge">{Math.round(r.score * 100)}%</span>}
              </div>
              {r.isbn13 && <div className="small faint">ISBN {r.isbn13}</div>}
            </button>
          ))}
        </div>
      )}
    </Modal>
  )
}

export function EditMetadataDialog({ book, onClose, onDone }: { book: BookDetail; onClose(): void; onDone(b: BookDetail): void }) {
  const [f, setF] = useState({
    title: book.title, subtitle: book.subtitle ?? '', authors: book.authors.join('; '), series: book.series ?? '',
    seriesIndex: book.seriesIndex?.toString() ?? '', publisher: book.publisher ?? '', published: book.published ?? '',
    language: book.language ?? '', isbn: book.isbn13 ?? '', pageCount: book.pageCount?.toString() ?? '',
    tags: book.tags.join(', '), description: book.description ?? '', locked: book.metadataLocked,
  })
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const bind = (k: keyof typeof f) => ({ value: f[k] as string, onChange: (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value }) })

  const save = async (e: FormEvent) => {
    e.preventDefault()
    setBusy(true); setError('')
    try {
      onDone(await api<BookDetail>(`/api/books/${book.id}`, {
        method: 'PATCH',
        body: {
          ...f,
          authors: f.authors.split(/\s*;\s*/).filter(Boolean),
          tags: f.tags.split(/\s*,\s*/).filter(Boolean),
          seriesIndex: f.seriesIndex ? Number(f.seriesIndex) : null,
          pageCount: f.pageCount ? Number(f.pageCount) : null,
        },
      }))
    } catch (err) { setError((err as Error).message); setBusy(false) }
  }

  return (
    <Modal title="Edit metadata" onClose={onClose} footer={<>
      <button className="btn" onClick={onClose}>Cancel</button>
      <button className="btn primary" form="edit-meta" disabled={busy}>Save</button>
    </>}>
      <form id="edit-meta" onSubmit={e => void save(e)}>
        <label className="field"><span>Title</span><input className="input" {...bind('title')} /></label>
        <label className="field"><span>Subtitle</span><input className="input" {...bind('subtitle')} /></label>
        <label className="field"><span>Authors (separate with ;)</span><input className="input" {...bind('authors')} /></label>
        <div className="row">
          <label className="field grow"><span>Series</span><input className="input" {...bind('series')} /></label>
          <label className="field" style={{ width: 90 }}><span>#</span><input className="input" inputMode="decimal" {...bind('seriesIndex')} /></label>
        </div>
        <div className="row">
          <label className="field grow"><span>ISBN</span><input className="input" {...bind('isbn')} /></label>
          <label className="field grow"><span>Published</span><input className="input" placeholder="YYYY-MM-DD" {...bind('published')} /></label>
        </div>
        <div className="row">
          <label className="field grow"><span>Publisher</span><input className="input" {...bind('publisher')} /></label>
          <label className="field" style={{ width: 90 }}><span>Language</span><input className="input" {...bind('language')} /></label>
          <label className="field" style={{ width: 90 }}><span>Pages</span><input className="input" inputMode="numeric" {...bind('pageCount')} /></label>
        </div>
        <label className="field"><span>Tags (separate with ,)</span><input className="input" {...bind('tags')} /></label>
        <label className="field"><span>Description</span><textarea className="textarea" rows={6} {...bind('description')} /></label>
        <Toggle label="Lock metadata" hint="Prevents automatic provider updates and rescans from overwriting your edits." checked={f.locked} onChange={v => setF({ ...f, locked: v })} />
        {error && <p className="error">{error}</p>}
      </form>
    </Modal>
  )
}

export function CoverDialog({ book, onClose, onDone }: { book: BookDetail; onClose(): void; onDone(b: BookDetail): void }) {
  const [url, setUrl] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const run = async (body: FormData | { url: string }) => {
    setBusy(true); setError('')
    try { onDone(await api<BookDetail>(`/api/books/${book.id}/cover`, { body })) } catch (e) { setError((e as Error).message); setBusy(false) }
  }
  return (
    <Modal title="Change cover" onClose={onClose}>
      <label className="field"><span>Upload an image</span>
        <input type="file" accept="image/*" onChange={e => { const file = e.target.files?.[0]; if (file) { const fd = new FormData(); fd.append('file', file); void run(fd) } }} />
      </label>
      <form className="row" onSubmit={e => { e.preventDefault(); void run({ url }) }}>
        <input className="input grow" placeholder="…or paste an image URL" value={url} onChange={e => setUrl(e.target.value)} />
        <button className="btn primary" disabled={!url || busy}>Use URL</button>
      </form>
      {busy && <Spinner />}
      {error && <p className="error">{error}</p>}
    </Modal>
  )
}
