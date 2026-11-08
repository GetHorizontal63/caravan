import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { ArrowLeft, List, Bookmark, BookmarkCheck, Search, Type, Maximize, Minimize, ChevronLeft, ChevronRight, Copy, StickyNote, Trash2 } from 'lucide-react'
import { api, authedUrl, getToken, serverUrl, type Annotation, type BookDetail } from '../api'
import { useSession } from '../session'
import { Spinner } from '../components/ui'
import { loadPrefs, savePrefs, themes, type ReaderPrefs } from './prefs'
import { ReaderSettingsForm } from './ReaderSettings'
import { HIGHLIGHT_COLORS, NotesList, SearchPanel, Sheet, TocList } from './Panels'
import type { BookLayout, EngineHandle, Position, Selection, TocItem } from './types'
import './reader.css'

const FoliateEngine = lazy(() => import('./FoliateEngine'))
const PdfEngine = lazy(() => import('./PdfEngine'))

type Panel = null | 'toc' | 'notes' | 'search' | 'settings'

async function fetchContent(id: string): Promise<{ blob: Blob; format: string }> {
  const res = await fetch(`${serverUrl()}/api/books/${id}/content`, { headers: { Authorization: `Bearer ${getToken()}` } })
  if (!res.ok) throw new Error(res.status === 415 ? 'This format cannot be read in the browser — download it instead.' : `Could not load book (${res.status})`)
  return { blob: await res.blob(), format: res.headers.get('X-Book-Format') ?? 'epub' }
}

export default function ReaderPage() {
  const { id = '' } = useParams()
  const nav = useNavigate()
  const qc = useQueryClient()
  const { user, setUser } = useSession()

  const book = useQuery({ queryKey: ['book', id], queryFn: () => api<BookDetail>(`/api/books/${id}`), staleTime: 0 })
  const content = useQuery({ queryKey: ['content', id], queryFn: () => fetchContent(id), staleTime: Infinity, gcTime: 60_000, retry: 0 })
  const notesQ = useQuery({ queryKey: ['annotations', id], queryFn: () => api<Annotation[]>(`/api/books/${id}/annotations`) })

  const [prefs, setPrefs] = useState<ReaderPrefs>(() => loadPrefs(user?.prefs?.reader))
  const [engine, setEngine] = useState<EngineHandle | null>(null)
  const [toc, setToc] = useState<TocItem[]>([])
  const [pos, setPos] = useState<Position | null>(null)
  const [chrome, setChrome] = useState(true)
  const [panel, setPanel] = useState<Panel>(null)
  const [selection, setSelection] = useState<Selection | null>(null)
  const [activeNote, setActiveNote] = useState<Annotation | null>(null)
  const [error, setError] = useState('')
  const [fullscreen, setFullscreen] = useState(!!document.fullscreenElement)
  const [scrub, setScrub] = useState<number | null>(null)

  // ---- book-on-desk geometry: 5×7 pages, two side by side when there's room
  const stageRef = useRef<HTMLDivElement>(null)
  const [stage, setStage] = useState({ w: 0, h: 0 })
  useEffect(() => {
    const el = stageRef.current
    if (!el) return
    const ro = new ResizeObserver(() => setStage(o => (o.w === el.clientWidth && o.h === el.clientHeight ? o : { w: el.clientWidth, h: el.clientHeight })))
    ro.observe(el)
    return () => ro.disconnect()
  })
  const bookLayout: BookLayout | null = useMemo(() => {
    if (!prefs.bookMode || !stage.w) return null
    const availW = stage.w - 40 // room for the cover board and page edges
    const availH = stage.h - 24
    const spread = prefs.columns === 2 && availW / availH > 1.15
    const pageW = Math.floor(Math.max(120, Math.min(spread ? availW / 2 : availW, (availH * 5) / 7)))
    return { spread, pageW }
  }, [prefs.bookMode, prefs.columns, stage.w, stage.h])

  const notes = notesQ.data ?? []
  const setNotes = (fn: (a: Annotation[]) => Annotation[]) => qc.setQueryData(['annotations', id], (old: Annotation[] | undefined) => fn(old ?? []))

  // ---- progress sync -------------------------------------------------------
  const pending = useRef<Position | null>(null)
  const flush = useCallback((keepalive = false) => {
    const p = pending.current
    if (!p) return
    pending.current = null
    void api(`/api/books/${id}/progress`, { method: 'PUT', body: { locator: p.locator, fraction: p.fraction }, keepalive }).catch(() => {})
  }, [id])
  useEffect(() => {
    const t = setInterval(() => flush(), 4000)
    const onHide = () => { if (document.visibilityState === 'hidden') flush(true) }
    document.addEventListener('visibilitychange', onHide)
    window.addEventListener('pagehide', onHide)
    return () => {
      clearInterval(t)
      document.removeEventListener('visibilitychange', onHide)
      window.removeEventListener('pagehide', onHide)
      flush(true)
      void qc.invalidateQueries({ queryKey: ['home'] })
      void qc.invalidateQueries({ queryKey: ['books'] })
      void qc.invalidateQueries({ queryKey: ['book', id] })
    }
  }, [flush, qc, id])

  const onRelocate = useCallback((p: Position) => {
    setPos(p)
    pending.current = p
  }, [])

  // ---- prefs ---------------------------------------------------------------
  const updatePrefs = (p: ReaderPrefs) => {
    setPrefs(p)
    savePrefs(p, user?.prefs ?? {})
    if (user) setUser({ ...user, prefs: { ...user.prefs, reader: p } })
  }

  // ---- keep screen awake -------------------------------------------------------
  useEffect(() => {
    if (!prefs.keepAwake || !('wakeLock' in navigator)) return
    let lock: WakeLockSentinel | undefined
    const acquire = () => { if (document.visibilityState === 'visible') navigator.wakeLock.request('screen').then(l => { lock = l }).catch(() => {}) }
    acquire()
    document.addEventListener('visibilitychange', acquire)
    return () => { document.removeEventListener('visibilitychange', acquire); void lock?.release() }
  }, [prefs.keepAwake])

  // auto-hide chrome a moment after opening
  useEffect(() => {
    if (!engine) return
    const t = setTimeout(() => setChrome(false), 2500)
    return () => clearTimeout(t)
  }, [engine])

  useEffect(() => {
    const onFs = () => setFullscreen(!!document.fullscreenElement)
    document.addEventListener('fullscreenchange', onFs)
    return () => document.removeEventListener('fullscreenchange', onFs)
  }, [])

  // ---- input ---------------------------------------------------------------
  const dismiss = () => {
    if (selection || activeNote) { setSelection(null); setActiveNote(null); engine?.clearSelection?.(); return true }
    if (panel) { setPanel(null); return true }
    return false
  }
  const onTap = (x: number) => {
    if (dismiss()) return
    if (chrome) { setChrome(false); return }
    const rtl = !!engine?.rtl
    if (x < 0.3) rtl ? engine?.next() : engine?.prev()
    else if (x > 0.7) rtl ? engine?.prev() : engine?.next()
    else setChrome(true)
  }
  const onKey = (e: KeyboardEvent) => {
    if ((e.target as HTMLElement)?.closest?.('input, textarea, select')) return
    switch (e.key) {
      case 'ArrowLeft': engine?.rtl ? engine.next() : engine?.prev(); break
      case 'ArrowRight': engine?.rtl ? engine.prev() : engine?.next(); break
      case 'PageUp': engine?.prev(); break
      case 'PageDown': case ' ': engine?.next(); break
      case 'Escape': if (!dismiss()) setChrome(c => !c); break
      default: return
    }
    e.preventDefault()
  }
  const keyRef = useRef(onKey)
  keyRef.current = onKey
  useEffect(() => {
    const h = (e: KeyboardEvent) => keyRef.current(e)
    window.addEventListener('keydown', h)
    return () => window.removeEventListener('keydown', h)
  }, [])

  // ---- annotations ---------------------------------------------------------------
  const bookmarkHere = notes.find(n => n.kind === 'bookmark' && pos && n.locator === pos.locator)
  const toggleBookmark = async () => {
    if (!pos) return
    if (bookmarkHere) {
      await api(`/api/annotations/${bookmarkHere.id}`, { method: 'DELETE' })
      setNotes(ns => ns.filter(n => n.id !== bookmarkHere.id))
    } else {
      const a = { kind: 'bookmark' as const, locator: pos.locator, chapter: pos.chapter ?? pos.label ?? null, text: null, note: null, color: null }
      const r = await api<{ id: number }>(`/api/books/${id}/annotations`, { body: a })
      setNotes(ns => [...ns, { ...a, id: r.id, createdAt: Date.now() }])
    }
  }
  const highlight = async (color: string, note?: string) => {
    if (!selection) return
    const a = { kind: 'highlight' as const, locator: selection.locator, text: selection.text, note: note ?? null, color, chapter: pos?.chapter ?? null }
    const r = await api<{ id: number }>(`/api/books/${id}/annotations`, { body: a })
    const full = { ...a, id: r.id, createdAt: Date.now() }
    setNotes(ns => [...ns, full])
    engine?.addHighlight?.(full)
    engine?.clearSelection?.()
    setSelection(null)
  }
  const deleteNote = async (a: Annotation) => {
    await api(`/api/annotations/${a.id}`, { method: 'DELETE' })
    setNotes(ns => ns.filter(n => n.id !== a.id))
    if (a.kind === 'highlight') engine?.removeHighlight?.(a)
    setActiveNote(null)
  }
  const editNote = async (a: Annotation) => {
    const note = prompt('Note', a.note ?? '')
    if (note === null) return
    await api(`/api/annotations/${a.id}`, { method: 'PATCH', body: { note } })
    setNotes(ns => ns.map(n => (n.id === a.id ? { ...n, note } : n)))
    setActiveNote(null)
  }

  const go = (loc: string) => { engine?.goTo(loc); setPanel(null); setChrome(false) }

  // ---- render ---------------------------------------------------------------
  const theme = themes[prefs.theme]
  const b = book.data
  const kind = b?.engine === 'pdf' ? 'pdf' : b?.comic ? 'comic' : 'reflow'
  const Engine = b?.engine === 'pdf' ? PdfEngine : FoliateEngine
  const shownFraction = scrub ?? pos?.fraction ?? 0
  const highlightsForEngine = useMemo(() => notes.filter(n => n.kind === 'highlight'), [notes])

  const fail = error || (content.error as Error | null)?.message || (book.error as Error | null)?.message
  return (
    <div className={`reader ui-${theme.ui}`} style={{ background: theme.bg, color: theme.fg }}>
      {fail ? (
        <div className="center-screen">
          <div style={{ textAlign: 'center', maxWidth: 420 }}>
            <p>{fail}</p>
            <div className="row" style={{ justifyContent: 'center' }}>
              <button className="btn" onClick={() => nav(-1)}>Back</button>
              <a className="btn primary" href={authedUrl(`/api/books/${id}/file`)} download>Download file</a>
            </div>
          </div>
        </div>
      ) : !b || !content.data || !notesQ.isFetched ? (
        <div className="center-screen"><Spinner /></div>
      ) : (
        prefs.bookMode ? (
          <div
            className={`desk desk-${theme.ui}`}
            data-desk={prefs.deskBackground.startsWith('custom:') ? 'custom' : prefs.deskBackground}
            style={{
              ['--desk-dim' as string]: String(prefs.deskDim),
              ...(prefs.deskBackground.startsWith('custom:') ? { ['--desk-image' as string]: `url("${authedUrl(`/api/me/backgrounds/${prefs.deskBackground.slice(7)}`)}")` } : {}),
            }}
          >
            <div ref={stageRef} className="desk-stage" onClick={e => { if (e.target === e.currentTarget) onTap(0.5) }}>
              {bookLayout && <div
                className={`book ${bookLayout.spread ? 'spread' : 'single'}`}
                style={{ width: bookLayout.pageW * (bookLayout.spread ? 2 : 1), height: Math.round((bookLayout.pageW * 7) / 5), ['--read' as string]: String(pos?.fraction ?? 0), ['--paper' as string]: theme.bg }}
              >
                <div className="board" />
                {bookLayout.spread && <div className="edge left" />}
                <div className="edge right" />
                <Suspense fallback={<div className="center-screen"><Spinner /></div>}>
                  <Engine
                    book={bookLayout}
                    data={content.data.blob}
                    format={content.data.format}
                    prefs={prefs}
                    initialLocator={b.finished ? null : b.locator}
                    annotations={highlightsForEngine}
                    onReady={(h, t) => { setEngine(h); setToc(t) }}
                    onRelocate={onRelocate}
                    onTap={onTap}
                    onSelection={s => { setSelection(s); setActiveNote(null) }}
                    onAnnotationClick={loc => setActiveNote(notes.find(n => n.locator === loc) ?? null)}
                    onKey={onKey}
                    onError={setError}
                  />
                </Suspense>
                <div className="gutter" />
              </div>}
            </div>
            <div className="book-counter">
              {pos?.chapter && <span className="chapter">{pos.chapter}</span>}
              <span>{[pos?.label, pos ? `${Math.round(pos.fraction * 100)}%` : null].filter(Boolean).join('  ·  ')}</span>
            </div>
          </div>
        ) : (
        <Suspense fallback={<div className="center-screen"><Spinner /></div>}>
          <Engine
            book={bookLayout}
            data={content.data.blob}
            format={content.data.format}
            prefs={prefs}
            initialLocator={b.finished ? null : b.locator}
            annotations={highlightsForEngine}
            onReady={(h, t) => { setEngine(h); setToc(t) }}
            onRelocate={onRelocate}
            onTap={onTap}
            onSelection={s => { setSelection(s); setActiveNote(null) }}
            onAnnotationClick={loc => setActiveNote(notes.find(n => n.locator === loc) ?? null)}
            onKey={onKey}
            onError={setError}
          />
        </Suspense>
        )
      )}

      {!engine && !fail && b && <div className="reader-loading"><Spinner /></div>}

      {/* always-visible slim footer */}
      {!chrome && pos && !prefs.bookMode && (
        <div className="reader-foot-slim">
          <span className="truncate">{pos.chapter ?? ''}</span>
          <span>{pos.minutesLeftInChapter != null && pos.minutesLeftInChapter > 0 ? `${pos.minutesLeftInChapter} min left · ` : ''}{Math.round(pos.fraction * 100)}%</span>
        </div>
      )}

      {prefs.brightness < 1 && <div className="dimmer" style={{ opacity: 1 - prefs.brightness }} />}

      {chrome && (
        <>
          <header className="reader-bar top">
            <button className="icon-btn" onClick={() => nav(`/book/${id}`, { replace: true })} aria-label="Back"><ArrowLeft size={22} /></button>
            <div className="grow truncate">
              <div className="truncate book-title">{b?.title}</div>
              {pos?.chapter && <div className="truncate small" style={{ opacity: .7 }}>{pos.chapter}</div>}
            </div>
            <button className="icon-btn" onClick={() => setPanel('toc')} aria-label="Contents" disabled={!engine}><List size={21} /></button>
            <button className={`icon-btn ${bookmarkHere ? 'active' : ''}`} onClick={() => void toggleBookmark()} aria-label="Bookmark" disabled={!pos}>
              {bookmarkHere ? <BookmarkCheck size={21} /> : <Bookmark size={21} />}
            </button>
            {engine?.search && <button className="icon-btn" onClick={() => setPanel('search')} aria-label="Search"><Search size={21} /></button>}
            <button className="icon-btn" onClick={() => setPanel('settings')} aria-label="Display settings"><Type size={21} /></button>
            {document.fullscreenEnabled && (
              <button className="icon-btn hide-mobile" aria-label="Full screen" onClick={() => (document.fullscreenElement ? document.exitFullscreen() : document.documentElement.requestFullscreen())}>
                {fullscreen ? <Minimize size={20} /> : <Maximize size={20} />}
              </button>
            )}
          </header>
          <footer className="reader-bar bottom">
            <div className="row" style={{ flexWrap: 'nowrap', width: '100%' }}>
              <button className="icon-btn" onClick={() => engine?.prev()} aria-label="Previous page"><ChevronLeft size={22} /></button>
              <div className="grow">
                <input
                  type="range" className="scrubber" min={0} max={1} step={0.0005} value={shownFraction}
                  style={{ ['--fill' as string]: `${shownFraction * 100}%` }}
                  onChange={e => setScrub(Number(e.target.value))}
                  onPointerUp={() => { if (scrub !== null) { engine?.goToFraction(scrub); setScrub(null) } }}
                  onKeyUp={() => { if (scrub !== null) { engine?.goToFraction(scrub); setScrub(null) } }}
                  aria-label="Position in book"
                />
                <div className="row small" style={{ justifyContent: 'space-between', opacity: .75 }}>
                  <span className="truncate">{pos?.label ?? ''}</span>
                  <span>{Math.round(shownFraction * 100)}%</span>
                </div>
              </div>
              <button className="icon-btn" onClick={() => engine?.next()} aria-label="Next page"><ChevronRight size={22} /></button>
            </div>
          </footer>
        </>
      )}

      {/* selection popover */}
      {selection && (
        <div className="popover" style={{ left: Math.min(Math.max(selection.x, 130), window.innerWidth - 130), top: Math.max(selection.y - 58, 8) }}>
          {HIGHLIGHT_COLORS.map(c => <button key={c} className="dot" style={{ background: c }} onClick={() => void highlight(c)} aria-label="Highlight" />)}
          <button className="icon-btn" onClick={() => { const n = prompt('Add a note'); if (n !== null) void highlight(HIGHLIGHT_COLORS[0], n) }} aria-label="Highlight with note"><StickyNote size={18} /></button>
          <button className="icon-btn" onClick={() => { void navigator.clipboard?.writeText(selection.text); setSelection(null); engine?.clearSelection?.() }} aria-label="Copy"><Copy size={18} /></button>
        </div>
      )}
      {activeNote && (
        <div className="popover" style={{ left: '50%', bottom: 90 }}>
          <span className="small truncate" style={{ maxWidth: 180 }}>{activeNote.note || activeNote.text}</span>
          <button className="icon-btn" onClick={() => void editNote(activeNote)} aria-label="Edit note"><StickyNote size={18} /></button>
          <button className="icon-btn" onClick={() => void deleteNote(activeNote)} aria-label="Delete highlight"><Trash2 size={18} /></button>
        </div>
      )}

      {panel === 'toc' && (
        <Sheet title="Contents" onClose={() => setPanel(null)}>
          <div className="tabs" style={{ marginBottom: 10 }}>
            <button className="active">Chapters</button>
            <button onClick={() => setPanel('notes')}>Bookmarks & highlights ({notes.length})</button>
          </div>
          {toc.length ? <TocList items={toc} current={pos?.chapterHref} onPick={go} /> : <p className="muted small">This book has no table of contents.</p>}
        </Sheet>
      )}
      {panel === 'notes' && (
        <Sheet title="Bookmarks & highlights" onClose={() => setPanel(null)}>
          <div className="tabs" style={{ marginBottom: 10 }}>
            <button onClick={() => setPanel('toc')}>Chapters</button>
            <button className="active">Bookmarks & highlights ({notes.length})</button>
          </div>
          <NotesList items={notes} onPick={a => go(a.locator)} onDelete={a => void deleteNote(a)} />
        </Sheet>
      )}
      {panel === 'search' && engine && <Sheet title="Search" onClose={() => setPanel(null)}><SearchPanel engine={engine} onPick={go} /></Sheet>}
      {panel === 'settings' && <Sheet title="Display" onClose={() => setPanel(null)}><ReaderSettingsForm prefs={prefs} onChange={updatePrefs} kind={kind} /></Sheet>}
    </div>
  )
}
