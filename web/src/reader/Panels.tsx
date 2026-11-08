import { useEffect, useRef, useState } from 'react'
import { Bookmark, Highlighter, Search, Trash2, X } from 'lucide-react'
import type { Annotation } from '../api'
import type { EngineHandle, SearchHit, TocItem } from './types'

export function Sheet({ title, onClose, children }: { title: string; onClose(): void; children: React.ReactNode }) {
  return (
    <>
      <div className="sheet-backdrop" onClick={onClose} />
      <aside className="sheet" role="dialog" aria-label={title}>
        <div className="sheet-head">
          <h3>{title}</h3>
          <button className="icon-btn" onClick={onClose} aria-label="Close"><X size={20} /></button>
        </div>
        <div className="sheet-body">{children}</div>
      </aside>
    </>
  )
}

export function TocList({ items, current, onPick, depth = 0 }: { items: TocItem[]; current?: string; onPick(href: string): void; depth?: number }) {
  return (
    <ul className="toc" style={{ paddingLeft: depth ? 14 : 0 }}>
      {items.map((it, i) => (
        <li key={`${it.href}-${i}`}>
          <button className={current && it.href === current ? 'current' : ''} onClick={() => onPick(it.href)}>{it.label || 'Untitled'}</button>
          {it.subitems && <TocList items={it.subitems} current={current} onPick={onPick} depth={depth + 1} />}
        </li>
      ))}
    </ul>
  )
}

export function NotesList({ items, onPick, onDelete }: { items: Annotation[]; onPick(a: Annotation): void; onDelete(a: Annotation): void }) {
  if (!items.length) return <p className="muted small">No bookmarks or highlights yet. Select text to highlight it, or tap the bookmark icon to save your place.</p>
  return (
    <ul className="notes">
      {items.map(a => (
        <li key={a.id}>
          <button className="grow" onClick={() => onPick(a)}>
            <div className="small faint row" style={{ gap: 6 }}>
              {a.kind === 'bookmark' ? <Bookmark size={14} /> : <Highlighter size={14} style={{ color: a.color ?? undefined }} />}
              {a.chapter ?? ''} · {new Date(a.createdAt).toLocaleDateString()}
              {a.native === false && a.originFormat && <span className="badge" title={a.locator ? 'Made in another version, found here' : 'Made in another version; opens at about the same place'}>{a.originFormat.toUpperCase()}{a.locator ? '' : ' · approx.'}</span>}
            </div>
            {a.text && <div className="note-text" style={{ borderColor: a.color ?? 'var(--line)' }}>{a.text}</div>}
            {a.note && <div className="small" style={{ marginTop: 4 }}>📝 {a.note}</div>}
          </button>
          <button className="icon-btn" onClick={() => onDelete(a)} aria-label="Delete"><Trash2 size={16} /></button>
        </li>
      ))}
    </ul>
  )
}

export function SearchPanel({ engine, onPick }: { engine: EngineHandle; onPick(locator: string): void }) {
  const [q, setQ] = useState('')
  const [hits, setHits] = useState<SearchHit[]>([])
  const [progress, setProgress] = useState<number | null>(null)
  const run = useRef(0)
  useEffect(() => () => { run.current++; engine.clearSearch?.() }, [engine])

  const search = async () => {
    if (!engine.search || !q.trim()) return
    const id = ++run.current
    setHits([]); setProgress(0)
    const found: SearchHit[] = []
    for await (const r of engine.search(q.trim())) {
      if (id !== run.current) return
      if ('progress' in r) setProgress(r.progress)
      else { found.push(r); if (found.length % 10 === 1) setHits([...found]) }
    }
    setHits(found); setProgress(null)
  }

  return (
    <>
      <form className="row" onSubmit={e => { e.preventDefault(); void search() }} style={{ marginBottom: 12, flexWrap: 'nowrap' }}>
        <input className="input" autoFocus placeholder="Search in book" value={q} onChange={e => setQ(e.target.value)} />
        <button className="btn primary" aria-label="Search"><Search size={18} /></button>
      </form>
      {progress !== null && <div className="progress-line" style={{ marginBottom: 10 }}><div style={{ width: `${progress * 100}%` }} /></div>}
      {progress === null && q && !hits.length && run.current > 0 && <p className="muted small">No results.</p>}
      <ul className="notes">
        {hits.map((h, i) => (
          <li key={i}>
            <button className="grow" onClick={() => onPick(h.locator)}>
              <div className="small faint">{h.label}</div>
              <div className="small">…{h.excerpt.pre}<mark>{h.excerpt.match}</mark>{h.excerpt.post}…</div>
            </button>
          </li>
        ))}
      </ul>
    </>
  )
}

export const HIGHLIGHT_COLORS = ['#facc15', '#4ade80', '#60a5fa', '#f472b6', '#fb923c']
