import { useEffect, useRef, useState } from 'react'
import * as pdfjs from 'pdfjs-dist'
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url'
import { themes } from './prefs'
import { PageCurl, type Dir } from './pageCurl'
import type { EngineHandle, EngineProps, TocItem } from './types'

pdfjs.GlobalWorkerOptions.workerSrc = workerUrl

const FILTERS: Record<string, string> = {
  light: 'none',
  sepia: 'sepia(.35) brightness(.97)',
  dark: 'invert(.88) hue-rotate(180deg)',
  black: 'invert(1) hue-rotate(180deg)',
}

type Role = 'prev' | 'current' | 'next' | 'nextBack' | 'prevBack'
const ROLES: Role[] = ['prev', 'next', 'nextBack', 'prevBack', 'current']
interface Slot { el: HTMLDivElement; canvases: [HTMLCanvasElement, HTMLCanvasElement]; unit: number; gen: number }

/**
 * Pages are grouped into "units": one page in single-page mode, or a two-page spread (cover alone on the
 * right, then 2–3, 4–5, …). Five slots stay rendered so the page curl always has the neighbouring unit and,
 * for spreads, the printed back of the turning leaf. After a turn the slots rotate instead of re-rendering.
 */
export default function PdfEngine(props: EngineProps) {
  const host = useRef<HTMLDivElement>(null)
  const scroller = useRef<HTMLDivElement>(null)
  const slotEls = useRef<Record<Role, HTMLDivElement | null>>({ prev: null, current: null, next: null, nextBack: null, prevBack: null })
  const slots = useRef<Record<Role, Slot> | null>(null)
  const [doc, setDoc] = useState<pdfjs.PDFDocumentProxy | null>(null)
  const [page, setPage] = useState(1)
  const [zoom, setZoom] = useState(1)
  const [size, setSize] = useState({ w: 0, h: 0 })
  const outline = useRef<{ label: string; page: number }[]>([])
  const curl = useRef<PageCurl | null>(null)
  const cb = useRef(props)
  cb.current = props
  const spread = !!props.book?.spread && zoom === 1
  const st = useRef({ page, n: 0, zoom, spread })
  st.current = { page, n: doc?.numPages ?? 0, zoom, spread }

  // ---- units
  const unitCount = () => (st.current.spread ? Math.floor(st.current.n / 2) + 1 : st.current.n)
  const unitOf = (p: number) => (st.current.spread ? (p <= 1 ? 0 : Math.floor(p / 2)) : p - 1)
  /** page numbers shown by a unit; 0 = blank half */
  const pagesOf = (u: number): [number, number] => {
    const n = st.current.n
    if (!st.current.spread) return [u + 1, 0]
    if (u === 0) return [0, 1]
    return [2 * u <= n ? 2 * u : 0, 2 * u + 1 <= n ? 2 * u + 1 : 0]
  }
  const firstPage = (u: number) => { const [a, b] = pagesOf(u); return a || b || 1 }

  const curlOn = () => cb.current.prefs.turnStyle === 'curl' && st.current.zoom === 1 && (cb.current.prefs.pdfFit === 'page' || !!cb.current.book)

  useEffect(() => {
    const mk = (role: Role): Slot => {
      const el = slotEls.current[role]!
      const cs = el.querySelectorAll('canvas')
      return { el, canvases: [cs[0], cs[1]], unit: -1, gen: 0 }
    }
    slots.current = { prev: mk('prev'), current: mk('current'), next: mk('next'), nextBack: mk('nextBack'), prevBack: mk('prevBack') }
  }, [])

  // ---- load
  useEffect(() => {
    let disposed = false
    let task: pdfjs.PDFDocumentLoadingTask | undefined
    ;(async () => {
      try {
        task = pdfjs.getDocument({ data: new Uint8Array(await props.data.arrayBuffer()) })
        const d = await task.promise
        if (disposed) return
        const start = Number(/^page:(\d+)/.exec(cb.current.initialLocator ?? '')?.[1]) || 1
        setPage(Math.min(Math.max(1, start), d.numPages))
        setDoc(d)

        const toc: TocItem[] = []
        const flat: { label: string; page: number }[] = []
        const walk = async (items: any[] | null, into: TocItem[]) => {
          for (const it of items ?? []) {
            let p: number | undefined
            try {
              const dest = typeof it.dest === 'string' ? await d.getDestination(it.dest) : it.dest
              if (dest?.[0]) p = (await d.getPageIndex(dest[0])) + 1
            } catch { /* broken outline entry */ }
            const item: TocItem = { label: it.title, href: `page:${p ?? 1}` }
            into.push(item)
            if (p) flat.push({ label: it.title, page: p })
            if (it.items?.length) { item.subitems = []; await walk(it.items, item.subitems) }
          }
        }
        await walk(await d.getOutline(), toc)
        outline.current = flat.sort((a, b) => a.page - b.page)

        const goPage = (p: number) => setPage(Math.min(Math.max(1, p), d.numPages))
        const goUnit = (u: number) => { if (u >= 0 && u < unitCount()) goPage(firstPage(u)) }
        const turn = (dir: Dir) => {
          if (curlOn() && curl.current) curl.current.turn(dir)
          else goUnit(unitOf(st.current.page) + dir)
        }
        cb.current.onReady({
          next: () => turn(1),
          prev: () => turn(-1),
          goTo: loc => goPage(Number(/^page:(\d+)/.exec(loc)?.[1]) || 1),
          goToFraction: f => goPage(Math.round(f * (d.numPages - 1)) + 1),
        } satisfies EngineHandle, toc, {})
      } catch (e) {
        if (!disposed) cb.current.onError((e as Error).message || 'This PDF could not be opened')
      }
    })()
    return () => { disposed = true; void task?.destroy() }
  }, [props.data])

  // ---- report position (the last visible page of a spread counts as read)
  useEffect(() => {
    if (!doc) return
    const n = doc.numPages
    const [a, b] = spread ? pagesOf(unitOf(page)) : [page, 0]
    const last = Math.max(a, b) || page
    const chapter = [...outline.current].reverse().find(o => o.page <= last)?.label
    const label = spread && a && b ? `Pages ${a}–${b} of ${n}` : `Page ${a || b} of ${n}`
    cb.current.onRelocate({ fraction: n > 1 ? (last - 1) / (n - 1) : 1, locator: `page:${page}`, label, chapter })
    scroller.current?.scrollTo({ top: 0, left: 0 })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [doc, page, spread])

  // ---- size
  useEffect(() => {
    const el = scroller.current!
    const ro = new ResizeObserver(() => setSize({ w: el.clientWidth, h: el.clientHeight }))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  // ---- rendering
  const renderPage = async (canvas: HTMLCanvasElement, pageNum: number, boxW: number, boxH: number, isCurrent: () => boolean) => {
    // a missing page (the left of the cover spread) shows the inside of the book's cover board
    canvas.parentElement?.classList.toggle('blank', !pageNum)
    if (!doc || !pageNum) { canvas.width = 0; canvas.style.width = canvas.style.height = '0px'; return }
    const p = await doc.getPage(pageNum)
    if (!isCurrent()) return
    const base = p.getViewport({ scale: 1 })
    const fit = cb.current.prefs.pdfFit === 'width' && !cb.current.book ? boxW / base.width : Math.min(boxW / base.width, boxH / base.height)
    const dpr = Math.min(window.devicePixelRatio || 1, 3)
    const vp = p.getViewport({ scale: fit * st.current.zoom * dpr })
    // render offscreen, then swap in, so a slot never shows a half-drawn page
    const off = document.createElement('canvas')
    off.width = Math.floor(vp.width)
    off.height = Math.floor(vp.height)
    try { await p.render({ canvas: off, viewport: vp }).promise } catch { return }
    if (!isCurrent()) return
    canvas.width = off.width
    canvas.height = off.height
    canvas.style.width = `${Math.floor(vp.width / dpr)}px`
    canvas.style.height = `${Math.floor(vp.height / dpr)}px`
    canvas.style.transform = ''
    canvas.getContext('2d')!.drawImage(off, 0, 0)
  }

  const renderSlot = async (slot: Slot, unit: number, force = false) => {
    if (!doc || !size.w) return
    if (unit < 0 || unit >= unitCount()) { slot.unit = -1; for (const c of slot.canvases) c.width = 0; return }
    if (slot.unit === unit && !force) return
    slot.unit = unit
    const gen = ++slot.gen
    const ok = () => slot.gen === gen
    const [a, b] = pagesOf(unit)
    const boxW = st.current.spread ? size.w / 2 : size.w
    await Promise.all([renderPage(slot.canvases[0], a, boxW, size.h, ok), renderPage(slot.canvases[1], b, boxW, size.h, ok)])
  }

  /** Back-of-leaf slots are pixel copies of their source slot. */
  const copySlot = (dst: Slot, src: Slot) => {
    dst.unit = src.unit
    dst.gen++
    src.canvases.forEach((c, i) => {
      const d = dst.canvases[i]
      d.width = c.width
      d.height = c.height
      d.style.width = c.style.width
      d.style.height = c.style.height
      d.parentElement?.classList.toggle('blank', !!c.parentElement?.classList.contains('blank'))
      if (c.width) d.getContext('2d')!.drawImage(c, 0, 0)
    })
  }

  const refresh = async (force: boolean) => {
    const sl = slots.current
    if (!sl || !doc) return
    const u = unitOf(page)
    await renderSlot(sl.current, u, force)
    await Promise.all([renderSlot(sl.next, u + 1, force), renderSlot(sl.prev, u - 1, force)])
    const now = slots.current!
    if (st.current.spread) { copySlot(now.prevBack, now.prev); copySlot(now.nextBack, now.next) }
  }

  useEffect(() => { void refresh(true) }, [doc, zoom, size, props.prefs.pdfFit, spread]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { void refresh(false) }, [page]) // eslint-disable-line react-hooks/exhaustive-deps

  // ---- page curl
  useEffect(() => {
    const el = host.current!
    curl.current = new PageCurl({
      container: el,
      layer: role => slots.current?.[role].el ?? null,
      ready: dir => {
        const sl = slots.current
        if (!sl) return false
        const target = unitOf(st.current.page) + dir
        if (target < 0 || target >= unitCount()) return false
        const slot = dir === 1 ? sl.next : sl.prev
        return slot.unit === target
      },
      back: dir => {
        const sl = slots.current
        if (!sl || !st.current.spread) return null
        const slot = dir === 1 ? sl.nextBack : sl.prevBack
        return slot.unit === unitOf(st.current.page) + dir ? slot.el : null
      },
      commit: async dir => {
        const sl = slots.current!
        // rotate slots: the neighbour already shows the new unit
        slots.current = dir === 1
          ? { ...sl, prev: sl.current, current: sl.next, next: sl.prev }
          : { ...sl, prev: sl.next, current: sl.prev, next: sl.current }
        const now = slots.current.current
        now.el.style.zIndex = '2'
        now.el.style.visibility = 'visible'
        now.el.style.clipPath = ''
        setPage(firstPage(unitOf(st.current.page) + dir))
        await new Promise(r => requestAnimationFrame(() => r(null)))
      },
      fallback: dir => setPage(p => firstPage(Math.min(Math.max(0, unitOf(p) + dir), unitCount() - 1))),
      spine: () => (st.current.spread ? el.clientWidth / 2 : 0),
      paper: () => themes[cb.current.prefs.theme].bg,
      rtl: () => false,
    })
    return () => { curl.current?.destroy(); curl.current = null }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // ---- gestures: page curl, or swipe / pinch / ctrl+wheel when zoomed
  useEffect(() => {
    const el = scroller.current!
    const box = () => host.current!.getBoundingClientRect()
    let start: { x: number; y: number; t: number; dist?: number } | null = null
    let pinch = 1
    let mouseTurn = false
    const dist = (t: TouchList) => Math.hypot(t[0].clientX - t[1].clientX, t[0].clientY - t[1].clientY)
    const local = (x: number, y: number): [number, number] => { const r = box(); return [x - r.left, y - r.top] }
    const cur = () => slots.current?.current.el

    const onStart = (e: TouchEvent) => {
      if (e.touches.length === 2) { curl.current?.cancel(); start = { x: 0, y: 0, t: Date.now(), dist: dist(e.touches) }; return }
      start = { x: e.touches[0].clientX, y: e.touches[0].clientY, t: Date.now() }
      if (curlOn()) curl.current?.down(...local(start.x, start.y))
    }
    const onMove = (e: TouchEvent) => {
      if (start?.dist && e.touches.length === 2) {
        e.preventDefault()
        pinch = dist(e.touches) / start.dist
        const c = cur()
        if (c) c.style.transform = `scale(${pinch})`
        return
      }
      if (curlOn() && curl.current?.move(...local(e.touches[0].clientX, e.touches[0].clientY)) && e.cancelable) e.preventDefault()
    }
    const onEnd = (e: TouchEvent) => {
      if (!start) return
      if (start.dist) {
        const c = cur()
        if (c) c.style.transform = ''
        setZoom(z => Math.min(5, Math.max(1, z * pinch)))
        pinch = 1
        start = null
        return
      }
      if (curlOn()) { curl.current?.up(); start = null; return }
      const t = e.changedTouches[0]
      const dx = t.clientX - start.x
      const dy = t.clientY - start.y
      const atLeft = el.scrollLeft <= 1
      const atRight = el.scrollLeft + el.clientWidth >= el.scrollWidth - 1
      if (Math.abs(dx) > 50 && Math.abs(dy) < 60 && Date.now() - start.t < 600) {
        if (dx < 0 && atRight) cb.current.onTap(1)
        if (dx > 0 && atLeft) cb.current.onTap(0)
      }
      start = null
    }
    const onWheel = (e: WheelEvent) => {
      if (!e.ctrlKey) return
      e.preventDefault()
      setZoom(z => Math.min(5, Math.max(1, z * (e.deltaY < 0 ? 1.1 : 0.9))))
    }
    const onPointerDown = (e: PointerEvent) => {
      if (!curlOn() || e.pointerType !== 'mouse' || e.button !== 0) return
      mouseTurn = true
      curl.current?.down(...local(e.clientX, e.clientY))
      el.setPointerCapture(e.pointerId)
    }
    const onPointerMove = (e: PointerEvent) => { if (mouseTurn && curl.current?.move(...local(e.clientX, e.clientY))) e.preventDefault() }
    const onPointerUp = () => { if (mouseTurn) { mouseTurn = false; curl.current?.up() } }
    const onClick = (e: MouseEvent) => {
      if (curl.current && performance.now() - curl.current.lastDragEnd < 400) return
      cb.current.onTap(local(e.clientX, e.clientY)[0] / box().width)
    }
    el.addEventListener('touchstart', onStart, { passive: true })
    el.addEventListener('touchmove', onMove, { passive: false })
    el.addEventListener('touchend', onEnd)
    el.addEventListener('wheel', onWheel, { passive: false })
    el.addEventListener('pointerdown', onPointerDown)
    el.addEventListener('pointermove', onPointerMove)
    el.addEventListener('pointerup', onPointerUp)
    el.addEventListener('click', onClick)
    return () => {
      el.removeEventListener('touchstart', onStart)
      el.removeEventListener('touchmove', onMove)
      el.removeEventListener('touchend', onEnd)
      el.removeEventListener('wheel', onWheel)
      el.removeEventListener('pointerdown', onPointerDown)
      el.removeEventListener('pointermove', onPointerMove)
      el.removeEventListener('pointerup', onPointerUp)
      el.removeEventListener('click', onClick)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const bg = themes[props.prefs.theme].bg
  const filter = FILTERS[props.prefs.theme]
  const scrollable = zoom > 1 || (props.prefs.pdfFit === 'width' && !props.book)
  const sheet = (
    <div className={`pdf-spread ${spread ? 'is-spread' : 'is-single'}`}>
      <div className="pdf-box l"><canvas style={{ filter }} /></div>
      <div className="pdf-box r"><canvas style={{ filter }} /></div>
    </div>
  )
  return (
    <div ref={scroller} className={`engine pdf-engine ${scrollable ? 'scrollable' : ''}`} style={{ ['--paper' as string]: bg }}>
      <div ref={host} className="page-stack">
        {ROLES.map(role => {
          const isBack = role === 'nextBack' || role === 'prevBack'
          return (
            <div
              key={role}
              ref={e => { slotEls.current[role] = e }}
              className={`page-layer pdf-page ${isBack ? 'back-layer' : ''}`}
              style={{ visibility: role === 'current' ? 'visible' : 'hidden', zIndex: role === 'current' ? 2 : 0 }}
            >
              {sheet}
            </div>
          )
        })}
      </div>
      {zoom > 1 && <button className="btn small pdf-zoom-reset" onClick={e => { e.stopPropagation(); setZoom(1) }}>Reset zoom</button>}
    </div>
  )
}
