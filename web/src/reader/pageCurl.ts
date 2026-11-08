/**
 * Page-curl page turning.
 *
 * Three stacked, live-rendered layers (previous / current / next page) sit in one container. While the
 * reader drags, the "turning" page is clipped along a fold line, and an SVG overlay draws the back of
 * the folded flap plus the shadows it casts. Nothing is rasterised, so text stays crisp and a drag starts
 * instantly.
 *
 * Geometry (local coordinates, x grows away from the spine): the grabbed point P0 on the page is carried
 * to the finger position F. The page is reflected across the perpendicular bisector of P0→F (the fold
 * line). The page stays attached along the spine, so F is constrained so that neither spine end-point
 * moves (paper doesn't stretch): |F − S| ≤ |P0 − S| for both spine ends S.
 *
 * Where you grab decides how the page bends:
 *   top / bottom corner → diagonal corner curl      top / bottom middle → the edge is lifted where grabbed
 *   right edge, middle  → near-vertical page flip    taps / keys         → quick curl from the bottom corner
 *
 * Two-page spreads: only the leaf turns, hinged at the spine. Its back is a live copy of the page printed there
 * (the next spread's left page going forward, the previous spread's right page going back). Going back is the
 * forward motion mirrored: the left page lifts from its own outer edge or corner and swings to the right. A point on the back is the leaf
 * point mirrored across the spine and then across the fold. Two reflections make a rotation, so the copy is
 * drawn with one CSS matrix and clipped to the flap.
 */

type Pt = { x: number; y: number }
export type Dir = 1 | -1
type Role = 'prev' | 'current' | 'next'

export interface CurlHost {
  /** Positioned element containing the page layers; the overlay is appended to it. */
  container: HTMLElement
  layer(role: Role): HTMLElement | null
  /** Is the neighbouring page rendered and does it exist? */
  ready(dir: Dir): boolean
  /** Make `current` show the neighbouring page (instantly). Resolves once it's painted. */
  commit(dir: Dir): Promise<void>
  /** Neighbour not ready yet: turn instantly instead. */
  fallback(dir: Dir): void
  /** Spine position in px from the left edge of the container (0 = single page, width/2 = two-page spread). */
  spine(): number
  /** Page colour (for the back of the flap). */
  paper(): string
  /** Right-to-left books turn the other way. */
  rtl(): boolean
  /**
   * Two-page spreads: element showing what is printed on the back of the turning leaf, rendered untransformed
   * at its final position: the next spread going forward, the previous spread going back. Return null if it
   * isn't ready; the back is then drawn as plain paper.
   */
  back?(dir: Dir): HTMLElement | null
}

/** 2D affine map p → (a·x + c·y + e, b·x + d·y + f), same layout as CSS matrix(). */
type Mat = [number, number, number, number, number, number]
const mul = (m: Mat, n: Mat): Mat => [
  m[0] * n[0] + m[2] * n[1], m[1] * n[0] + m[3] * n[1],
  m[0] * n[2] + m[2] * n[3], m[1] * n[2] + m[3] * n[3],
  m[0] * n[4] + m[2] * n[5] + m[4], m[1] * n[4] + m[3] * n[5] + m[5],
]
/** Reflection across the line through m with unit normal n. */
const reflectMat = (m: Pt, n: Pt): Mat => {
  const k = 2 * dot(m, n)
  return [1 - 2 * n.x * n.x, -2 * n.x * n.y, -2 * n.x * n.y, 1 - 2 * n.y * n.y, k * n.x, k * n.y]
}

const sub = (a: Pt, b: Pt): Pt => ({ x: a.x - b.x, y: a.y - b.y })
const len = (a: Pt) => Math.hypot(a.x, a.y)
const dot = (a: Pt, b: Pt) => a.x * b.x + a.y * b.y
const lerp = (a: number, b: number, t: number) => a + (b - a) * t
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v))
const easeOut = (t: number) => 1 - Math.pow(1 - t, 3)
const easeInOut = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2)

/** Sutherland–Hodgman clip of a convex polygon against the half-plane side of a line. */
function clipHalf(poly: Pt[], m: Pt, n: Pt, positive: boolean): Pt[] {
  const side = (p: Pt) => dot(sub(p, m), n)
  const inside = (v: number) => (positive ? v > 0 : v <= 0)
  const out: Pt[] = []
  for (let i = 0; i < poly.length; i++) {
    const cur = poly[i], prev = poly[(i + poly.length - 1) % poly.length]
    const sc = side(cur), sp = side(prev)
    if (inside(sc)) {
      if (!inside(sp)) { const t = sp / (sp - sc); out.push({ x: lerp(prev.x, cur.x, t), y: lerp(prev.y, cur.y, t) }) }
      out.push(cur)
    } else if (inside(sp)) {
      const t = sp / (sp - sc); out.push({ x: lerp(prev.x, cur.x, t), y: lerp(prev.y, cur.y, t) })
    }
  }
  return out
}

const reflect = (p: Pt, m: Pt, n: Pt): Pt => { const d = dot(sub(p, m), n); return { x: p.x - 2 * d * n.x, y: p.y - 2 * d * n.y } }

function hexToRgb(c: string): [number, number, number] {
  const m = /^#?([0-9a-f]{6})$/i.exec(c.trim())
  if (!m) return [255, 255, 255]
  const v = parseInt(m[1], 16)
  return [(v >> 16) & 255, (v >> 8) & 255, v & 255]
}
const shade = (rgb: [number, number, number], t: number) => {
  // t < 0 darkens toward black, t > 0 lightens toward white
  const target = t < 0 ? 0 : 255
  const k = Math.abs(t)
  return `rgb(${rgb.map(c => Math.round(lerp(c, target, k))).join(',')})`
}

let uid = 0
const SVGNS = 'http://www.w3.org/2000/svg'

export class PageCurl {
  private host: CurlHost
  private svg: SVGSVGElement
  private els: Record<'under' | 'front' | 'flap' | 'edge', SVGPolygonElement | SVGPolylineElement>
  private grads: Record<'under' | 'front' | 'flap', SVGLinearGradientElement>
  private state: 'idle' | 'pending' | 'drag' | 'busy' | 'ignored' = 'idle'
  private dir: Dir = 1
  private start = { x: 0, y: 0, t: 0 }
  private p0: Pt = { x: 0, y: 0 }
  private f0: Pt = { x: 0, y: 0 }
  private f: Pt = { x: 0, y: 0 }
  private vel = 0
  private last = { x: 0, t: 0 }
  private turning: HTMLElement | null = null
  private under: HTMLElement | null = null
  private backEl: HTMLElement | null = null
  private fallbackDir: Dir | null = null
  private W = 0
  private H = 0
  private sx = 0
  private mirror = false
  /** Set after a drag so the click that follows the pointer-up isn't treated as a tap. */
  lastDragEnd = 0

  constructor(host: CurlHost) {
    this.host = host
    const id = `curl${++uid}`
    this.svg = document.createElementNS(SVGNS, 'svg')
    this.svg.setAttribute('class', 'curl-overlay')
    this.svg.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;pointer-events:none;z-index:5;overflow:visible'
    const defs = document.createElementNS(SVGNS, 'defs')
    const mkGrad = (name: string) => {
      const g = document.createElementNS(SVGNS, 'linearGradient')
      g.id = `${id}-${name}`
      g.setAttribute('gradientUnits', 'userSpaceOnUse')
      defs.append(g)
      return g
    }
    this.grads = { under: mkGrad('under'), front: mkGrad('front'), flap: mkGrad('flap') }
    this.svg.append(defs)
    const mkPoly = (name: 'under' | 'front' | 'flap', extra = '') => {
      const p = document.createElementNS(SVGNS, 'polygon')
      p.setAttribute('fill', `url(#${id}-${name})`)
      if (extra) p.setAttribute('style', extra)
      this.svg.append(p)
      return p
    }
    const under = mkPoly('under')
    const front = mkPoly('front')
    const flap = mkPoly('flap', 'filter: drop-shadow(0 0 10px rgba(0,0,0,.28)) drop-shadow(0 0 2px rgba(0,0,0,.18))')
    const edge = document.createElementNS(SVGNS, 'polyline')
    edge.setAttribute('fill', 'none')
    edge.setAttribute('stroke', 'rgba(255,255,255,.35)')
    edge.setAttribute('stroke-width', '1')
    this.svg.append(edge)
    this.els = { under, front, flap, edge }
    host.container.append(this.svg)
  }

  destroy() { this.svg.remove(); this.reset() }

  get busy() { return this.state === 'drag' || this.state === 'busy' }

  // ---------------------------------------------------------------- coordinates
  //
  // Every turn is modelled as a *forward* turn in a local frame: the grabbed edge is the outer edge (x = W)
  // and the leaf swings toward the spine. A backward turn is the same motion seen in a mirror, so the left
  // page lifts from its own outer edge and swings right. Right-to-left books swap the two.

  private spineScreen = 0
  private startScreen = { x: 0, y: 0 }

  private measure() {
    const r = this.host.container.getBoundingClientRect()
    this.W = r.width
    this.H = r.height
    this.spineScreen = this.host.spine()
  }
  /** Choose the frame for a turn direction: mirrored for backward turns (and for right-to-left books). */
  private setFrame(dir: Dir) {
    this.mirror = this.host.rtl() !== (dir === -1)
    // single pages hinge on the side away from the grabbed edge; spreads hinge in the middle
    this.sx = this.spineScreen === 0 ? 0 : this.mirror ? this.W - this.spineScreen : this.spineScreen
  }
  /** container x → local x */
  private lx(x: number) { return this.mirror ? this.W - x : x }

  // ---------------------------------------------------------------- input

  /** Pointer went down at container coordinates. */
  down(x: number, y: number) {
    if (this.state === 'drag' || this.state === 'busy') return
    this.measure()
    this.state = 'pending'
    this.fallbackDir = null
    this.startScreen = { x, y }
    this.start = { x, y, t: performance.now() }
  }

  /** Returns true when the gesture is a page turn (caller should preventDefault). */
  move(x: number, y: number): boolean {
    if (this.state === 'pending') {
      const dx = x - this.startScreen.x, dy = y - this.startScreen.y
      if (Math.hypot(dx, dy) < 10) return false
      // Pulling the top edge down (or the bottom edge up) also lifts the page; in the middle of the page a
      // mostly vertical drag isn't a page turn.
      const band = this.startScreen.y < this.H * 0.16 ? 'top' : this.startScreen.y > this.H * 0.84 ? 'bottom' : 'middle'
      const edgePull = (band === 'top' && dy > 0) || (band === 'bottom' && dy < 0)
      if (Math.abs(dy) > Math.abs(dx) * 1.2 && !edgePull) { this.state = 'ignored'; return false }
      // direction: which way the hand moves; a near-vertical edge pull goes by which half was grabbed
      const rtl = this.host.rtl()
      const towardLeft = Math.abs(dx) > 6 ? dx < 0 : this.startScreen.x > this.W / 2
      const dir: Dir = towardLeft !== rtl ? 1 : -1
      if (!this.host.ready(dir)) { this.state = 'ignored'; this.fallbackDir = dir; return true }
      this.setFrame(dir)
      this.start = { x: this.lx(this.startScreen.x), y: this.startScreen.y, t: this.start.t }
      this.last = { x: this.start.x, t: this.start.t }
      this.begin(dir)
    }
    if (this.state !== 'drag') return this.state === 'ignored' && this.fallbackDir !== null
    const lx = this.lx(x)
    const now = performance.now()
    const dt = Math.max(1, now - this.last.t)
    this.vel = this.vel * 0.6 + ((lx - this.last.x) / dt) * 0.4
    this.last = { x: lx, t: now }
    this.f = this.constrain({ x: this.f0.x + (lx - this.start.x), y: this.f0.y + (y - this.start.y) })
    this.render()
    return true
  }

  /** Returns 'tap' if the pointer never moved, so the caller can handle tap zones. */
  up(): 'tap' | 'turn' | 'none' {
    const st = this.state
    if (st === 'pending') { this.state = 'idle'; return 'tap' }
    if (st === 'ignored') {
      this.state = 'idle'
      if (this.fallbackDir) { this.lastDragEnd = performance.now(); this.host.fallback(this.fallbackDir); return 'turn' }
      return 'none'
    }
    if (st !== 'drag') return 'none'
    this.lastDragEnd = performance.now()
    const end = this.endPoint()
    const p = this.progress()
    const v = this.vel // local frame: negative = toward the spine
    const commit = v < -0.3 || (p > 0.28 && v < 0.25)
    const target = commit ? end : this.p0
    const remaining = Math.min(1, len(sub(target, this.f)) / Math.max(1, len(sub(end, this.p0))))
    this.state = 'busy'
    this.animate(this.f, target, 160 + 320 * remaining, easeOut, () => void this.finish(commit))
    return 'turn'
  }

  cancel() {
    if (this.state === 'pending' || this.state === 'ignored') this.state = 'idle'
  }

  /** Animated turn for taps and keys: a quick curl from the outer bottom corner of the turning page. */
  turn(dir: Dir) {
    if (this.state === 'drag' || this.state === 'busy') return
    this.measure()
    if (!this.host.ready(dir)) { this.host.fallback(dir); return }
    this.setFrame(dir)
    this.start = { x: this.W, y: this.H * 0.92, t: performance.now() }
    this.begin(dir)
    this.state = 'busy'
    const from = this.p0
    const to = this.endPoint()
    const lift = this.H * 0.22
    const t0 = performance.now(), dur = 520
    const step = (now: number) => {
      const t = Math.min(1, (now - t0) / dur)
      const e = easeInOut(t)
      const pt = { x: lerp(from.x, to.x, e), y: lerp(from.y, to.y, e) - Math.sin(Math.PI * e) * lift }
      this.f = this.constrain(pt)
      this.render()
      if (t < 1) requestAnimationFrame(step)
      else void this.finish(true)
    }
    requestAnimationFrame(step)
  }

  // ---------------------------------------------------------------- mechanics

  private begin(dir: Dir) {
    this.dir = dir
    const { W, H, sx } = this
    const pageW = W - sx
    const ys = this.start.y / H
    let p0: Pt
    if (ys < 0.16) {
      // top band: corner if near the outer edge, otherwise lift the top edge where it was grabbed
      p0 = { x: this.start.x > sx + pageW * 0.7 ? W : Math.max(this.start.x, sx + pageW * 0.4), y: 0 }
    } else if (ys > 0.84) {
      p0 = { x: this.start.x > sx + pageW * 0.7 ? W : Math.max(this.start.x, sx + pageW * 0.4), y: H }
    } else {
      // middle of the edge: an almost straight flip that tilts with vertical finger movement
      p0 = { x: W, y: clamp(this.start.y, H * 0.05, H * 0.95) }
    }
    this.p0 = p0
    this.f0 = { ...p0 }
    this.f = { ...p0 }
    this.vel = 0

    // the current page always lifts away; the neighbour in the turn direction is revealed underneath
    this.turning = this.host.layer('current')
    this.under = this.host.layer(dir === 1 ? 'next' : 'prev')
    for (const el of [this.under, this.turning]) if (el) { el.style.visibility = 'visible'; el.style.willChange = 'clip-path' }
    if (this.under) this.under.style.zIndex = '1'
    if (this.turning) this.turning.style.zIndex = '2'
    this.backEl = this.sx > 0 ? this.host.back?.(dir) ?? null : null
    if (this.backEl) {
      const b = this.backEl
      b.style.visibility = 'visible'
      b.style.zIndex = '4' // above the static gutter shading (3), below the overlay (5)
      b.style.transformOrigin = '0 0'
      b.style.willChange = 'transform, clip-path'
      b.style.filter = 'drop-shadow(0 0 12px rgba(0,0,0,.3)) drop-shadow(0 0 2px rgba(0,0,0,.2))'
    }
    this.state = 'drag'
    this.render()
  }

  /** Where F ends up when the page has turned completely: P0 mirrored across the spine. */
  private endPoint(): Pt { return { x: 2 * this.sx - this.p0.x, y: this.p0.y } }

  private progress() {
    const end = this.endPoint()
    return clamp((this.p0.x - this.f.x) / Math.max(1, this.p0.x - end.x), 0, 1)
  }

  private constrain(f: Pt): Pt {
    const s1 = { x: this.sx, y: 0 }, s2 = { x: this.sx, y: this.H }
    const r1 = len(sub(this.p0, s1)), r2 = len(sub(this.p0, s2))
    let p = { ...f }
    for (let i = 0; i < 4; i++) {
      for (const [s, r] of [[s1, r1], [s2, r2]] as const) {
        const d = sub(p, s), l = len(d)
        if (l > r) p = { x: s.x + (d.x * r) / l, y: s.y + (d.y * r) / l }
      }
    }
    return p
  }

  private animate(from: Pt, to: Pt, ms: number, ease: (t: number) => number, done: () => void) {
    const t0 = performance.now()
    const step = (now: number) => {
      const t = Math.min(1, (now - t0) / ms)
      const e = ease(t)
      this.f = this.constrain({ x: lerp(from.x, to.x, e), y: lerp(from.y, to.y, e) })
      this.render()
      if (t < 1) requestAnimationFrame(step)
      else done()
    }
    requestAnimationFrame(step)
  }

  private async finish(commit: boolean) {
    if (commit) {
      try { await this.host.commit(this.dir) } catch { /* engine handles errors */ }
    }
    this.reset()
  }

  private reset() {
    for (const role of ['prev', 'current', 'next'] as const) {
      const el = this.host.layer(role)
      if (!el) continue
      el.style.clipPath = ''
      el.style.willChange = ''
      el.style.zIndex = role === 'current' ? '2' : '0'
      el.style.visibility = role === 'current' ? 'visible' : 'hidden'
    }
    for (const p of Object.values(this.els)) p.setAttribute('points', '')
    if (this.backEl) {
      const b = this.backEl
      b.style.visibility = 'hidden'
      b.style.zIndex = '0'
      b.style.transform = b.style.filter = b.style.willChange = ''
      this.clipTarget(b).style.clipPath = ''
    }
    this.turning = this.under = this.backEl = null
    this.state = 'idle'
  }

  // ---------------------------------------------------------------- drawing

  /** The back layer is a wrapper (it carries the shadow filter); its child gets the clip, so the shadow follows it. */
  private clipTarget(el: HTMLElement) { return (el.firstElementChild as HTMLElement | null) ?? el }

  private render() {
    const { W, H } = this
    const toScreen = (pts: Pt[]) => pts.map(p => ({ x: this.mirror ? W - p.x : p.x, y: p.y }))
    const attr = (pts: Pt[]) => toScreen(pts).map(p => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ')
    const d = sub(this.p0, this.f)
    const dist = len(d)
    if (!this.turning) return
    if (dist < 0.5) {
      this.turning.style.clipPath = ''
      for (const p of Object.values(this.els)) p.setAttribute('points', '')
      if (this.backEl) this.clipTarget(this.backEl).style.clipPath = 'polygon(0 0, 0 0, 0 0)'
      return
    }
    const n = { x: d.x / dist, y: d.y / dist } // points from the fold toward the grabbed point
    const m = { x: (this.p0.x + this.f.x) / 2, y: (this.p0.y + this.f.y) / 2 }
    const rect = [{ x: 0, y: 0 }, { x: W, y: 0 }, { x: W, y: H }, { x: 0, y: H }]
    const remaining = clipHalf(rect, m, n, false)
    const lifted = clipHalf(rect, m, n, true)
    const flap = lifted.map(p => reflect(p, m, n))

    this.turning.style.clipPath = remaining.length >= 3
      ? `polygon(${toScreen(remaining).map(p => `${p.x.toFixed(1)}px ${p.y.toFixed(1)}px`).join(',')})`
      : 'polygon(0 0, 0 0, 0 0)'

    // how strongly to draw shadows: fade in at the start, out at the very end
    const prog = this.progress()
    const k = Math.min(1, prog * 6) * Math.min(1, (1 - prog) * 4 + 0.15)
    const paper = hexToRgb(this.host.paper())
    const dark = paper[0] + paper[1] + paper[2] < 200 // dark themes need lighter flap shading
    const setGrad = (g: SVGLinearGradientElement, from: Pt, dirv: Pt, length: number, stops: [number, string][]) => {
      const [a, b] = toScreen([from, { x: from.x + dirv.x * length, y: from.y + dirv.y * length }])
      g.setAttribute('x1', String(a.x)); g.setAttribute('y1', String(a.y))
      g.setAttribute('x2', String(b.x)); g.setAttribute('y2', String(b.y))
      g.replaceChildren(...stops.map(([o, c]) => {
        const s = document.createElementNS(SVGNS, 'stop')
        s.setAttribute('offset', String(clamp(o, 0, 1)))
        s.setAttribute('stop-color', c)
        return s
      }))
    }
    const negN = { x: -n.x, y: -n.y }
    const flapLen = Math.max(1, ...flap.map(p => Math.abs(dot(sub(p, m), n))))

    // 1. shadow cast by the flap onto the newly revealed page (on the +n side of the fold)
    const shadowLen = Math.min(160, dist * 0.6 + 24)
    setGrad(this.grads.under, m, n, shadowLen, [
      [0, `rgba(0,0,0,${0.5 * k})`], [0.25, `rgba(0,0,0,${0.22 * k})`], [1, 'rgba(0,0,0,0)'],
    ])
    // 2. the front page darkens slightly where it bends toward the fold
    setGrad(this.grads.front, m, negN, Math.min(70, flapLen + 30), [
      [0, `rgba(0,0,0,${0.22 * k})`], [0.35, `rgba(0,0,0,${0.06 * k})`], [1, 'rgba(0,0,0,0)'],
    ])
    // 3. back of the flap
    const px = (v: number) => v / flapLen
    if (this.backEl) {
      // real content: spine reflection, then fold reflection (in local coords), conjugated by the RTL mirror
      const spineM = reflectMat({ x: this.sx, y: 0 }, { x: 1, y: 0 })
      let t = mul(reflectMat(m, n), spineM)
      if (this.mirror) { const mir: Mat = [-1, 0, 0, 1, W, 0]; t = mul(mir, mul(t, mir)) }
      this.backEl.style.transform = `matrix(${t.map(v => v.toFixed(5)).join(',')})`
      const backClip = lifted.map(p => ({ x: 2 * this.sx - p.x, y: p.y }))
      this.clipTarget(this.backEl).style.clipPath = backClip.length >= 3
        ? `polygon(${toScreen(backClip).map(p => `${p.x.toFixed(1)}px ${p.y.toFixed(1)}px`).join(',')})`
        : 'polygon(0 0, 0 0, 0 0)'
      // translucent shading over the printed back: crease shadow, a soft highlight where the paper bends
      setGrad(this.grads.flap, m, negN, flapLen, [
        [0, `rgba(0,0,0,${dark ? 0.45 : 0.3})`],
        [px(10), `rgba(0,0,0,${dark ? 0.18 : 0.1})`],
        [px(Math.min(46, flapLen * 0.3)), `rgba(255,255,255,${dark ? 0.06 : 0.16})`],
        [0.6, 'rgba(255,255,255,0)'],
        [1, `rgba(0,0,0,${dark ? 0.12 : 0.06})`],
      ])
      this.els.flap.setAttribute('style', '')
    } else {
      setGrad(this.grads.flap, m, negN, flapLen, [
        [0, shade(paper, dark ? 0.04 : -0.28)],
        [px(6), shade(paper, dark ? 0.1 : -0.1)],
        [px(Math.min(40, flapLen * 0.25)), shade(paper, dark ? 0.16 : 0.06)],
        [0.55, shade(paper, dark ? 0.08 : -0.02)],
        [1, shade(paper, dark ? 0.02 : -0.1)],
      ])
      this.els.flap.setAttribute('style', 'filter: drop-shadow(0 0 10px rgba(0,0,0,.28)) drop-shadow(0 0 2px rgba(0,0,0,.18))')
    }

    this.els.under.setAttribute('points', lifted.length >= 3 ? attr(lifted) : '')
    this.els.front.setAttribute('points', remaining.length >= 3 ? attr(remaining) : '')
    this.els.flap.setAttribute('points', flap.length >= 3 ? attr(flap) : '')
    // soft highlight along the fold line (where the paper is curved)
    const foldPts = clipHalf(rect, m, n, false).filter(p => Math.abs(dot(sub(p, m), n)) < 0.5)
    this.els.edge.setAttribute('points', foldPts.length >= 2 ? attr(foldPts) : '')
    this.els.edge.setAttribute('stroke', dark ? 'rgba(255,255,255,.12)' : 'rgba(255,255,255,.55)')
  }
}
