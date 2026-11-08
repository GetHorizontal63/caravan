import { useEffect, useRef } from 'react'
import { makeBook } from 'foliate-js/view.js'
import { Overlayer } from 'foliate-js/overlayer.js'
import { bookCss, themes, type ReaderPrefs } from './prefs'
import { PageCurl, type Dir } from './pageCurl'
import type { BookLayout, EngineHandle, EngineProps, SearchHit, TocItem } from './types'

const MIME: Record<string, string> = {
  epub: 'application/epub+zip', cbz: 'application/vnd.comicbook+zip', fb2: 'application/x-fictionbook+xml',
  fbz: 'application/x-zip-compressed-fb2', mobi: 'application/x-mobipocket-ebook', azw: 'application/vnd.amazon.ebook', azw3: 'application/vnd.amazon.ebook',
}

const natural = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' }).compare

/**
 * foliate's own CBZ loader sorts pages lexically and only accepts lowercase extensions.
 * Re-index pages in natural order with normalised names before handing them over.
 */
async function makeComic(file: File) {
  const { configure, ZipReader, BlobReader, BlobWriter } = await import('foliate-js/vendor/zip.js')
  const { makeComicBook } = await import('foliate-js/comic-book.js')
  configure({ useWebWorkers: false })
  const reader = new ZipReader(new BlobReader(file))
  const entries: any[] = await reader.getEntries()
  const images = entries
    .filter(e => !e.directory && /\.(jpe?g|png|gif|bmp|webp|avif|jxl|svg)$/i.test(e.filename) && !/(^|\/)(__MACOSX|\.)/.test(e.filename))
    .sort((a, b) => natural(a.filename, b.filename))
  const width = String(images.length).length
  const byName = new Map<string, any>()
  images.forEach((e, i) => byName.set(`${String(i).padStart(width, '0')}.${e.filename.split('.').pop()!.toLowerCase()}`, e))
  const mime = (n: string) => ({ jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', gif: 'image/gif', webp: 'image/webp', avif: 'image/avif', bmp: 'image/bmp', svg: 'image/svg+xml', jxl: 'image/jxl' } as Record<string, string>)[n.split('.').pop()!] ?? 'application/octet-stream'
  return makeComicBook({
    entries: [...byName.keys()].map(filename => ({ filename })),
    loadBlob: (name: string) => byName.get(name)?.getData(new BlobWriter(mime(name))) ?? null,
    getSize: (name: string) => byName.get(name)?.uncompressedSize ?? 0,
    getComment: async () => '',
  }, file)
}

const curlWanted = (p: ReaderPrefs, view: any) => p.turnStyle === 'curl' && (view?.isFixedLayout || p.bookMode || p.flow === 'paginated')

function applyPrefs(view: any, p: ReaderPrefs, isMain: boolean, book: BookLayout | null) {
  const r = view?.renderer
  if (!r) return
  if (view.isFixedLayout) {
    r.setAttribute('zoom', 'fit-page')
    return
  }
  r.setAttribute('flow', book ? 'paginated' : p.flow)
  r.setAttribute('gap', `${p.sideMargin}%`)
  if (book) {
    // one text column per printed page
    r.setAttribute('margin', '30px')
    r.setAttribute('max-inline-size', `${Math.floor(book.pageW)}px`)
    r.setAttribute('max-column-count', book.spread ? '2' : '1')
  } else {
    r.setAttribute('margin', '44px')
    r.setAttribute('max-inline-size', `${p.maxWidth}px`)
    r.setAttribute('max-column-count', String(p.columns))
  }
  // foliate's own slide animation is only used for the "slide" style; the curl turns pages instantly underneath
  if (isMain && p.turnStyle === 'slide') r.setAttribute('animated', '')
  else r.removeAttribute('animated')
  r.setStyles?.(bookCss(p))
}

const label = (x: unknown): string => typeof x === 'string' ? x : x && typeof x === 'object' ? String(Object.values(x)[0] ?? '') : ''
const nextFrame = () => new Promise<void>(r => requestAnimationFrame(() => requestAnimationFrame(() => r())))
const hasSelection = (doc: Document) => { const s = doc.getSelection(); return !!s && !s.isCollapsed }

type Role = 'prev' | 'current' | 'next' | 'nextBack' | 'prevBack'

export default function FoliateEngine(props: EngineProps) {
  const host = useRef<HTMLDivElement>(null)
  const layers = useRef<Record<Role, HTMLDivElement | null>>({ prev: null, current: null, next: null, nextBack: null, prevBack: null })
  // callbacks/prefs change every render; read them through a ref so the views are created once
  const cb = useRef(props)
  cb.current = props
  const s = useRef({
    main: null as any,
    prev: null as any,
    next: null as any,
    /** spreads only: copies of the next / previous spread used for the printed back of a turning leaf */
    nextBack: null as any,
    prevBack: null as any,
    backReady: { next: false, prev: false },
    backs: null as Promise<void> | null,
    ensureBacks: null as null | (() => Promise<void>),
    file: null as File | null,
    curl: null as PageCurl | null,
    ready: { prev: false, next: false },
    token: 0,
    chain: Promise.resolve() as Promise<unknown>,
    committing: false,
    neighbors: null as Promise<void> | null,
    disposed: false,
    ensureNeighbors: null as null | (() => Promise<void>),
    sync: null as null | (() => void),
  }).current

  useEffect(() => {
    const el = host.current!
    s.disposed = false
    const curlOn = () => !!s.curl && curlWanted(cb.current.prefs, s.main)

    const openInto = async (role: Role) => {
      const { format, prefs } = cb.current
      const view: any = document.createElement('foliate-view')
      view.style.cssText = 'display:block;width:100%;height:100%'
      const holder = layers.current[role]!
      const target = role === 'nextBack' || role === 'prevBack' ? (holder.firstElementChild as HTMLElement) : holder
      target.append(view)
      const book = format === 'cbz' ? await makeComic(s.file!) : await makeBook(s.file!)
      if (format === 'cbz' && prefs.rtlComics) book.dir = 'rtl'
      await view.open(book)
      // highlights are drawn on every layer so they don't pop in after a page turn
      view.addEventListener('draw-annotation', (e: CustomEvent) => {
        const { draw, annotation } = e.detail
        draw(Overlayer.highlight, { color: annotation.color ?? '#facc15' })
      })
      view.addEventListener('create-overlay', () => {
        for (const a of cb.current.annotations) if (a.kind === 'highlight' && a.locator) view.addAnnotation({ value: a.locator, color: a.color })
      })
      return view
    }

    /** Keep the hidden neighbour views one page behind / ahead of the main view. */
    const sync = () => {
      const token = ++s.token
      s.ready = { prev: false, next: false }
      s.chain = s.chain.then(async () => {
        if (token !== s.token || s.disposed || !s.main?.lastLocation?.cfi || !s.prev || !s.next) return
        const cfi = s.main.lastLocation.cfi
        const step = async (v: any, dir: Dir) => {
          await v.goTo(cfi)
          const before = v.lastLocation?.cfi
          await (dir === 1 ? v.next() : v.prev())
          const after = v.lastLocation?.cfi
          return !!after && after !== before
        }
        const [hasNext, hasPrev] = await Promise.all([step(s.next, 1), step(s.prev, -1)])
        if (token === s.token) s.ready = { next: hasNext, prev: hasPrev }
        if (s.nextBack && s.prevBack && token === s.token) {
          s.backReady = { next: false, prev: false }
          const [nb, pb] = await Promise.all([step(s.nextBack, 1), step(s.prevBack, -1)])
          if (token === s.token) s.backReady = { next: nb, prev: pb }
        }
      }).catch(e => console.warn('page-curl sync', e))
    }

    const ensureNeighbors = () => {
      if (s.neighbors) return s.neighbors
      s.neighbors = (async () => {
        const [prev, next] = await Promise.all([openInto('prev'), openInto('next')])
        if (s.disposed) return
        s.prev = prev
        s.next = next
        for (const v of [prev, next]) {
          applyPrefs(v, cb.current.prefs, false, cb.current.book)
          await v.init({ lastLocation: s.main.lastLocation?.cfi })
        }
        sync()
      })().catch(e => { console.warn('page-curl neighbours', e); s.neighbors = null })
      return s.neighbors
    }
    /** Two-page spreads also need copies for the printed back of the turning leaf. */
    const ensureBacks = () => {
      if (s.backs) return s.backs
      s.backs = (async () => {
        await ensureNeighbors()
        const [nb, pbv] = await Promise.all([openInto('nextBack'), openInto('prevBack')])
        if (s.disposed) return
        for (const v of [nb, pbv]) {
          applyPrefs(v, cb.current.prefs, false, cb.current.book)
          await v.init({ lastLocation: s.main.lastLocation?.cfi })
        }
        s.nextBack = nb
        s.prevBack = pbv
        sync()
      })().catch(e => { console.warn('page-curl backs', e); s.backs = null })
      return s.backs
    }
    s.ensureNeighbors = ensureNeighbors
    s.ensureBacks = ensureBacks
    s.sync = sync

    const turn = (dir: Dir) => {
      if (curlOn()) s.curl!.turn(dir)
      else void (dir === 1 ? s.main?.next() : s.main?.prev())
    }

    ;(async () => {
      try {
        const { data, format, prefs } = cb.current
        s.file = new File([data], `book.${format}`, { type: MIME[format] ?? data.type })
        const view = await openInto('current')
        if (s.disposed) return
        s.main = view

        view.addEventListener('relocate', (e: CustomEvent) => {
          const d = e.detail
          const loc = d.location
          const fxl = view.isFixedLayout
          const pages = d.section?.total ?? 0
          cb.current.onRelocate({
            fraction: fxl && pages ? (pages > 1 ? (d.section.current ?? 0) / (pages - 1) : 1) : d.fraction ?? 0,
            locator: d.cfi,
            chapter: fxl && format === 'cbz' ? undefined : d.tocItem?.label?.trim(),
            chapterHref: d.tocItem?.href,
            label: fxl
              ? `Page ${(d.section?.current ?? 0) + 1} of ${d.section?.total ?? '?'}`
              : d.pageItem?.label ? `Page ${d.pageItem.label}` : loc ? `${loc.current + 1} of ${loc.total}` : undefined,
            minutesLeftInChapter: !fxl && d.time?.section != null ? Math.round(d.time.section) : undefined,
          })
          if (!s.committing && s.prev) sync()
        })

        view.addEventListener('load', (e: CustomEvent) => {
          const { doc, index } = e.detail as { doc: Document; index: number }
          const win = doc.defaultView!
          const frame = () => (win.frameElement as HTMLElement | null)?.getBoundingClientRect()
          const toHost = (cx: number, cy: number): [number, number] => {
            const fr = frame(), hr = el.getBoundingClientRect()
            return [(fr?.left ?? 0) + cx - hr.left, (fr?.top ?? 0) + cy - hr.top]
          }

          doc.addEventListener('click', (ev: MouseEvent) => {
            if (ev.defaultPrevented || (ev.target as Element)?.closest?.('a[href]')) return
            if (hasSelection(doc)) return
            if (s.curl && performance.now() - s.curl.lastDragEnd < 400) return
            const [x] = toHost(ev.clientX, ev.clientY)
            cb.current.onTap(x / el.clientWidth)
          })
          doc.addEventListener('keydown', (ev: KeyboardEvent) => cb.current.onKey(ev))

          // ---- page-curl gestures (captured on the iframe window so foliate's own swipe never sees them)
          win.addEventListener('touchstart', (ev: TouchEvent) => {
            if (!curlOn()) return
            ev.stopPropagation()
            if (ev.touches.length > 1 || hasSelection(doc)) { s.curl!.cancel(); return }
            const t = ev.touches[0]
            s.curl!.down(...toHost(t.clientX, t.clientY))
          }, { capture: true, passive: true })
          win.addEventListener('touchmove', (ev: TouchEvent) => {
            if (!curlOn()) return
            ev.stopPropagation()
            if (hasSelection(doc)) { s.curl!.cancel(); return }
            const t = ev.touches[0]
            if (s.curl!.move(...toHost(t.clientX, t.clientY)) && ev.cancelable) ev.preventDefault()
          }, { capture: true, passive: false })
          win.addEventListener('touchend', (ev: TouchEvent) => { if (curlOn()) { ev.stopPropagation(); s.curl!.up() } }, { capture: true })
          win.addEventListener('touchcancel', (ev: TouchEvent) => { if (curlOn()) { ev.stopPropagation(); s.curl!.cancel() } }, { capture: true })

          // mouse: grab the page near its outer edges (the middle stays free for selecting text)
          let mouseTurn = false
          win.addEventListener('pointerdown', (ev: PointerEvent) => {
            if (!curlOn() || ev.pointerType !== 'mouse' || ev.button !== 0) return
            const [x, y] = toHost(ev.clientX, ev.clientY)
            const w = el.clientWidth
            if (x > w * 0.18 && x < w * 0.82) return
            mouseTurn = true
            s.curl!.down(x, y)
            try { doc.documentElement.setPointerCapture(ev.pointerId) } catch { /* not supported */ }
          }, true)
          win.addEventListener('mousedown', (ev: MouseEvent) => { if (mouseTurn) ev.preventDefault() }, true)
          win.addEventListener('pointermove', (ev: PointerEvent) => {
            if (mouseTurn && s.curl!.move(...toHost(ev.clientX, ev.clientY))) ev.preventDefault()
          }, true)
          win.addEventListener('pointerup', () => { if (mouseTurn) { mouseTurn = false; s.curl!.up() } }, true)

          // ---- text selection → highlight popover
          const checkSelection = () => setTimeout(() => {
            const sel = doc.getSelection()
            if (!sel || sel.isCollapsed || !sel.rangeCount) return
            const range = sel.getRangeAt(0)
            const text = sel.toString().trim()
            if (!text) return
            const rect = range.getBoundingClientRect()
            const fr = frame()
            cb.current.onSelection({ locator: view.getCFI(index, range), text, x: (fr?.left ?? 0) + rect.left + rect.width / 2, y: (fr?.top ?? 0) + rect.top })
          }, 30)
          doc.addEventListener('pointerup', checkSelection)
          doc.addEventListener('touchend', checkSelection)
          doc.addEventListener('selectionchange', () => { if (doc.getSelection()?.isCollapsed) cb.current.onSelection(null) })
        })

        view.addEventListener('show-annotation', (e: CustomEvent) => cb.current.onAnnotationClick(e.detail.value))
        view.addEventListener('external-link', (e: CustomEvent) => { e.preventDefault(); window.open(e.detail.href, '_blank', 'noopener') })

        applyPrefs(view, prefs, true, cb.current.book)
        await view.init({ lastLocation: cb.current.initialLocator ?? undefined, showTextStart: !cb.current.initialLocator })
        if (s.disposed) return

        s.curl = new PageCurl({
          container: el,
          layer: role => layers.current[role],
          ready: dir => s.ready[dir === 1 ? 'next' : 'prev'],
          commit: async dir => {
            s.committing = true
            try {
              await (dir === 1 ? s.main.next() : s.main.prev())
              await nextFrame()
            } finally {
              s.committing = false
              setTimeout(sync, 0) // runs after the curl has hidden the neighbour layers again
            }
          },
          fallback: dir => void (dir === 1 ? s.main.next() : s.main.prev()),
          spine: () => {
            const book = cb.current.book
            if (book) return book.spread ? el.clientWidth / 2 : 0
            return !s.main?.isFixedLayout && s.main?.renderer?.columnCount === 2 ? el.clientWidth / 2 : 0
          },
          back: dir => {
            if (dir === 1) return s.backReady.next ? layers.current.nextBack : null
            return s.backReady.prev ? layers.current.prevBack : null
          },
          paper: () => themes[cb.current.prefs.theme].bg,
          rtl: () => s.main?.book?.dir === 'rtl',
        })
        if (curlWanted(cb.current.prefs, view)) void (cb.current.book?.spread ? ensureBacks() : ensureNeighbors())

        const toToc = (items: any[] = []): TocItem[] => items.map(i => ({ label: label(i.label).trim(), href: i.href, subitems: i.subitems?.length ? toToc(i.subitems) : undefined }))
        const all = () => [s.main, s.prev, s.next, s.nextBack, s.prevBack].filter(Boolean)
        const handle: EngineHandle = {
          next: () => turn(1),
          prev: () => turn(-1),
          rtl: view.book?.dir === 'rtl',
          goTo: loc => void view.goTo(loc),
          goToFraction: f => void view.goToFraction(f),
          sectionFractions: view.getSectionFractions?.(),
          async *search(query: string) {
            for await (const r of view.search({ query })) {
              if (r === 'done') return
              if ('progress' in r) yield { progress: r.progress }
              else if (r.subitems) for (const sub of r.subitems) yield { label: r.label, locator: sub.cfi, excerpt: sub.excerpt } as SearchHit
            }
          },
          clearSearch: () => view.clearSearch(),
          addHighlight: a => { if (a.locator) for (const v of all()) void v.addAnnotation({ value: a.locator, color: a.color }) },
          removeHighlight: a => { if (a.locator) for (const v of all()) void v.deleteAnnotation({ value: a.locator }) },
          async findText(text, near) {
            const q = text.replace(/\s+/g, ' ').trim()
            if (q.length < 3) return null
            const [{ searchMatcher }, { textWalker }] = await Promise.all([import('foliate-js/search.js'), import('foliate-js/text-walker.js')])
            const match = searchMatcher(textWalker, { defaultLocale: view.language, matchCase: false, matchDiacritics: false, matchWholeWords: false })
            const sections: any[] = view.book.sections
            const fr: number[] = view.getSectionFractions?.() ?? []
            const guess = near == null || !fr.length ? 0 : Math.max(0, fr.findLastIndex(f => f <= near + 1e-9))
            // nearest sections first: the passage is usually about where it was in the other version
            const order = sections.map((_, i) => i).filter(i => sections[i].createDocument).sort((a, b) => Math.abs(a - guess) - Math.abs(b - guess))
            // long passages: find the start, then the end after it, and span both
            const head = q.slice(0, 120), tail = q.length > 160 ? q.slice(-120) : null
            for (const index of order) {
              const doc: Document = await sections[index].createDocument()
              const first = match(doc, head).next().value
              if (!first) continue
              let range = first.range
              if (tail) for (const m of match(doc, tail)) {
                if (m.range.compareBoundaryPoints(Range.START_TO_START, range) < 0) continue
                const r = doc.createRange()
                r.setStart(range.startContainer, range.startOffset)
                r.setEnd(m.range.endContainer, m.range.endOffset)
                range = r
                break
              }
              return view.getCFI(index, range) as string
            }
            return null
          },
          clearSelection: () => view.deselect(),
        }
        cb.current.onReady(handle, format === 'cbz' ? [] : toToc(view.book.toc), { dir: view.book.dir })
      } catch (e) {
        console.error(e)
        if (!s.disposed) cb.current.onError((e as Error).message || 'This book could not be opened')
      }
    })()

    // ---- gestures and clicks in the page margins (outside the book iframe)
    const local = (ev: { clientX: number; clientY: number }): [number, number] => {
      const r = el.getBoundingClientRect()
      return [ev.clientX - r.left, ev.clientY - r.top]
    }
    const onHostClick = (e: MouseEvent) => {
      if (s.curl && performance.now() - s.curl.lastDragEnd < 400) return
      cb.current.onTap(local(e)[0] / el.clientWidth)
    }
    const onTouchStart = (e: TouchEvent) => { if (!curlOn()) return; e.stopPropagation(); if (e.touches.length === 1) s.curl!.down(...local(e.touches[0])) }
    const onTouchMove = (e: TouchEvent) => { if (!curlOn()) return; e.stopPropagation(); if (s.curl!.move(...local(e.touches[0])) && e.cancelable) e.preventDefault() }
    const onTouchEnd = (e: TouchEvent) => { if (!curlOn()) return; e.stopPropagation(); s.curl!.up() }
    let mouseTurn = false
    const onPointerDown = (e: PointerEvent) => {
      if (!curlOn() || e.pointerType !== 'mouse' || e.button !== 0) return
      mouseTurn = true
      s.curl!.down(...local(e))
      el.setPointerCapture(e.pointerId)
    }
    const onPointerMove = (e: PointerEvent) => { if (mouseTurn && s.curl!.move(...local(e))) e.preventDefault() }
    const onPointerUp = () => { if (mouseTurn) { mouseTurn = false; s.curl!.up() } }
    el.addEventListener('click', onHostClick)
    el.addEventListener('touchstart', onTouchStart, { capture: true, passive: true })
    el.addEventListener('touchmove', onTouchMove, { capture: true, passive: false })
    el.addEventListener('touchend', onTouchEnd, { capture: true })
    el.addEventListener('pointerdown', onPointerDown, true)
    el.addEventListener('pointermove', onPointerMove, true)
    el.addEventListener('pointerup', onPointerUp, true)

    return () => {
      s.disposed = true
      el.removeEventListener('click', onHostClick)
      el.removeEventListener('touchstart', onTouchStart, { capture: true })
      el.removeEventListener('touchmove', onTouchMove, { capture: true })
      el.removeEventListener('touchend', onTouchEnd, { capture: true })
      el.removeEventListener('pointerdown', onPointerDown, true)
      el.removeEventListener('pointermove', onPointerMove, true)
      el.removeEventListener('pointerup', onPointerUp, true)
      s.curl?.destroy()
      for (const v of [s.main, s.prev, s.next, s.nextBack, s.prevBack]) {
        try { v?.close?.() } catch { /* already closed */ }
        v?.remove()
      }
      Object.assign(s, {
        main: null, prev: null, next: null, nextBack: null, prevBack: null, curl: null, neighbors: null, backs: null,
        ensureNeighbors: null, ensureBacks: null, sync: null, ready: { prev: false, next: false }, backReady: { next: false, prev: false },
      })
    }
  }, [props.data])

  // live preference changes
  useEffect(() => {
    if (!s.main?.renderer) return
    applyPrefs(s.main, props.prefs, true, props.book)
    for (const v of [s.prev, s.next, s.nextBack, s.prevBack]) if (v) applyPrefs(v, props.prefs, false, props.book)
    if (curlWanted(props.prefs, s.main)) void (props.book?.spread ? s.ensureBacks?.() : s.ensureNeighbors?.())
    s.sync?.()
  }, [props.prefs, props.book?.spread, props.book?.pageW])

  const bg = themes[props.prefs.theme].bg
  return (
    <div ref={host} className="engine page-stack">
      <div ref={e => { layers.current.prev = e }} className="page-layer" style={{ background: bg, visibility: 'hidden', zIndex: 0 }} aria-hidden />
      <div ref={e => { layers.current.next = e }} className="page-layer" style={{ background: bg, visibility: 'hidden', zIndex: 0 }} aria-hidden />
      <div ref={e => { layers.current.current = e }} className="page-layer" style={{ background: bg, zIndex: 2 }} />
      <div ref={e => { layers.current.nextBack = e }} className="page-layer back-layer" style={{ visibility: 'hidden', zIndex: 0 }} aria-hidden>
        <div className="page-layer" style={{ background: bg }} />
      </div>
      <div ref={e => { layers.current.prevBack = e }} className="page-layer back-layer" style={{ visibility: 'hidden', zIndex: 0 }} aria-hidden>
        <div className="page-layer" style={{ background: bg }} />
      </div>
    </div>
  )
}
