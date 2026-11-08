import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState, type ReactNode, type RefObject } from 'react'
import { createPortal } from 'react-dom'
import { Check, ChevronDown } from 'lucide-react'

/**
 * Dropdown primitives that look like the rest of the app and always open in the right place.
 *
 * Native <select>/<datalist> popups are drawn by the OS (unstyled), and absolutely positioned menus get
 * clipped by `overflow: hidden` parents or displaced by transformed ancestors (animated modals). These render
 * into a portal at document level, positioned from the anchor's on-screen rect: below the anchor when there's
 * room, otherwise above, clamped to the viewport, and re-positioned on scroll/resize.
 */

interface PanelProps {
  anchor: RefObject<HTMLElement | null>
  open: boolean
  onClose(): void
  children: ReactNode
  /** match the anchor's width (selects, comboboxes) instead of sizing to content (menus) */
  matchWidth?: boolean
  align?: 'start' | 'end'
  className?: string
  role?: string
  id?: string
}

const GAP = 6
const MARGIN = 8

export function DropdownPanel({ anchor, open, onClose, children, matchWidth, align = 'start', className = '', role, id }: PanelProps) {
  const panel = useRef<HTMLDivElement>(null)
  // first frame: off-screen at natural size so it can be measured, then placed next to the anchor
  const [style, setStyle] = useState<React.CSSProperties>({ position: 'fixed', left: 0, top: 0, visibility: 'hidden' })

  const place = useCallback(() => {
    const a = anchor.current, p = panel.current
    if (!a || !p) return
    const r = a.getBoundingClientRect()
    const vw = window.innerWidth, vh = window.innerHeight
    // lists are at least as wide as their anchor but grow to fit their longest option
    const width = Math.min(Math.max(p.offsetWidth, matchWidth ? r.width : 220, 160), vw - 2 * MARGIN)
    const below = vh - r.bottom - GAP - MARGIN
    const above = r.top - GAP - MARGIN
    const natural = p.scrollHeight
    const flip = natural > below && above > below
    const maxHeight = Math.max(120, Math.min(natural, flip ? above : below, 360))
    let left = align === 'end' ? r.right - width : r.left
    left = Math.min(Math.max(MARGIN, left), vw - width - MARGIN)
    setStyle({
      position: 'fixed',
      left,
      width,
      maxWidth: vw - 2 * MARGIN,
      maxHeight,
      ...(flip ? { bottom: vh - r.top + GAP } : { top: r.bottom + GAP }),
      transformOrigin: flip ? 'bottom' : 'top',
    })
  }, [anchor, matchWidth, align])

  useLayoutEffect(() => { if (!open) setStyle({ position: 'fixed', left: 0, top: 0, visibility: 'hidden' }) }, [open])
  useLayoutEffect(() => { if (open) place() }, [open, place, children])

  useEffect(() => {
    if (!open) return
    const onDown = (e: PointerEvent) => {
      const t = e.target as Node
      if (panel.current?.contains(t) || anchor.current?.contains(t)) return
      onClose()
    }
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.stopPropagation(); onClose(); anchor.current?.focus() } }
    window.addEventListener('pointerdown', onDown, true)
    window.addEventListener('keydown', onKey, true)
    window.addEventListener('resize', place)
    window.addEventListener('scroll', place, true) // capture: also scrolling inside modals
    return () => {
      window.removeEventListener('pointerdown', onDown, true)
      window.removeEventListener('keydown', onKey, true)
      window.removeEventListener('resize', place)
      window.removeEventListener('scroll', place, true)
    }
  }, [open, onClose, place, anchor])

  if (!open) return null
  return createPortal(
    <div ref={panel} id={id} role={role} className={`dd-panel ${className}`} style={style} onPointerDown={e => e.stopPropagation()}>
      {children}
    </div>,
    document.body,
  )
}

// ---------------------------------------------------------------- Select

export interface Option<T extends string> { value: T; label: string }

export function Select<T extends string>({ value, options, onChange, label, prefix, className = '' }: {
  value: T
  options: Option<T>[]
  onChange(v: T): void
  /** accessible name */
  label: string
  /** shown before the current value on the button only, e.g. "Sort:" */
  prefix?: string
  className?: string
}) {
  const btn = useRef<HTMLButtonElement>(null)
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState(0)
  const id = useId()
  const current = options.find(o => o.value === value)
  useEffect(() => { if (open) setActive(Math.max(0, options.findIndex(o => o.value === value))) }, [open, options, value])

  const pick = (o: Option<T>) => { onChange(o.value); setOpen(false); btn.current?.focus() }
  const onKey = (e: React.KeyboardEvent) => {
    if (!open && ['ArrowDown', 'ArrowUp', 'Enter', ' '].includes(e.key)) { e.preventDefault(); setOpen(true); return }
    if (!open) return
    if (e.key === 'ArrowDown') { e.preventDefault(); setActive(i => Math.min(options.length - 1, i + 1)) }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setActive(i => Math.max(0, i - 1)) }
    else if (e.key === 'Home') { e.preventDefault(); setActive(0) }
    else if (e.key === 'End') { e.preventDefault(); setActive(options.length - 1) }
    else if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); pick(options[active]) }
    else if (e.key === 'Tab') setOpen(false)
    else if (e.key.length === 1) {
      const i = options.findIndex(o => o.label.toLowerCase().startsWith(e.key.toLowerCase()))
      if (i >= 0) setActive(i)
    }
  }
  return (
    <>
      <button
        ref={btn} type="button" className={`dd-trigger ${open ? 'open' : ''} ${className}`}
        aria-haspopup="listbox" aria-expanded={open} aria-controls={id} aria-label={label}
        onClick={() => setOpen(o => !o)} onKeyDown={onKey}
      >
        <span className="truncate">{prefix && <span className="dd-prefix">{prefix} </span>}{current?.label ?? 'Choose…'}</span>
        <ChevronDown size={16} className="dd-chevron" />
      </button>
      <DropdownPanel anchor={btn} open={open} onClose={() => setOpen(false)} matchWidth role="listbox" id={id}>
        {options.map((o, i) => (
          <div
            key={o.value} role="option" aria-selected={o.value === value}
            className={`dd-option ${i === active ? 'active' : ''} ${o.value === value ? 'selected' : ''}`}
            onPointerEnter={() => setActive(i)} onClick={() => pick(o)}
          >
            <span className="grow truncate">{o.label}</span>
            {o.value === value && <Check size={15} />}
          </div>
        ))}
      </DropdownPanel>
    </>
  )
}

// ---------------------------------------------------------------- Combobox (free text + suggestions)

export function Combobox({ value, onChange, suggestions, placeholder, autoFocus, describe }: {
  value: string
  onChange(v: string): void
  suggestions: string[]
  placeholder?: string
  autoFocus?: boolean
  /** optional secondary text per suggestion (e.g. "3 books") */
  describe?(s: string): string | undefined
}) {
  const input = useRef<HTMLInputElement>(null)
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState(-1)
  const id = useId()
  const q = value.trim().toLowerCase()
  const matches = suggestions.filter(s => !q || s.toLowerCase().includes(q)).slice(0, 50)
  const exact = suggestions.some(s => s.toLowerCase() === q)
  const show = open && matches.length > 0 && !(exact && matches.length === 1)
  useEffect(() => setActive(-1), [value])

  const pick = (s: string) => { onChange(s); setOpen(false) }
  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); setOpen(true); setActive(i => Math.min(matches.length - 1, i + 1)) }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setActive(i => Math.max(0, i - 1)) }
    else if (e.key === 'Enter' && show && active >= 0) { e.preventDefault(); pick(matches[active]) }
    else if (e.key === 'Tab') setOpen(false)
  }
  return (
    <>
      <input
        ref={input} className="input" value={value} placeholder={placeholder} autoFocus={autoFocus} autoComplete="off"
        role="combobox" aria-expanded={show} aria-controls={id} aria-autocomplete="list"
        onChange={e => { onChange(e.target.value); setOpen(true) }}
        onFocus={() => setOpen(true)} onClick={() => setOpen(true)} onKeyDown={onKey}
      />
      <DropdownPanel anchor={input} open={show} onClose={() => setOpen(false)} matchWidth role="listbox" id={id}>
        {matches.map((s, i) => (
          <div key={s} role="option" aria-selected={i === active} className={`dd-option ${i === active ? 'active' : ''}`}
            onPointerEnter={() => setActive(i)} onPointerDown={e => e.preventDefault() /* keep focus in the input */} onClick={() => pick(s)}>
            <span className="grow truncate">{s}</span>
            {describe?.(s) && <span className="dd-meta">{describe(s)}</span>}
          </div>
        ))}
      </DropdownPanel>
    </>
  )
}

// ---------------------------------------------------------------- Menu (action list from a trigger button)

export interface MenuItem { label: string; icon?: ReactNode; onSelect(): void; danger?: boolean }

export function Menu({ trigger, items, label, align = 'end' }: { trigger: ReactNode; items: MenuItem[]; label: string; align?: 'start' | 'end' }) {
  const btn = useRef<HTMLButtonElement>(null)
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState(-1)
  const id = useId()
  const run = (it: MenuItem) => { setOpen(false); it.onSelect() }
  const onKey = (e: React.KeyboardEvent) => {
    if (!open && (e.key === 'ArrowDown' || e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); setOpen(true); setActive(0); return }
    if (!open) return
    if (e.key === 'ArrowDown') { e.preventDefault(); setActive(i => (i + 1) % items.length) }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setActive(i => (i - 1 + items.length) % items.length) }
    else if (e.key === 'Enter' && active >= 0) { e.preventDefault(); run(items[active]) }
    else if (e.key === 'Tab') setOpen(false)
  }
  return (
    <>
      <button ref={btn} type="button" className={`icon-btn ${open ? 'active' : ''}`} aria-label={label} title={label}
        aria-haspopup="menu" aria-expanded={open} aria-controls={id} onClick={() => { setOpen(o => !o); setActive(-1) }} onKeyDown={onKey}>
        {trigger}
      </button>
      <DropdownPanel anchor={btn} open={open} onClose={() => setOpen(false)} align={align} role="menu" id={id} className="dd-menu">
        {items.map((it, i) => (
          <div key={it.label} role="menuitem" tabIndex={-1} className={`dd-option ${i === active ? 'active' : ''} ${it.danger ? 'danger' : ''}`}
            onPointerEnter={() => setActive(i)} onClick={() => run(it)}>
            {it.icon}<span className="grow">{it.label}</span>
          </div>
        ))}
      </DropdownPanel>
    </>
  )
}
