import { useRef, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { ImagePlus, Minus, Plus, Sun, X } from 'lucide-react'
import { api, authedUrl } from '../api'
// the form is also shown on the Settings page, before the reader (and its stylesheet) has loaded
import './reader.css'
import { Toggle } from '../components/ui'
import { DESK_PRESETS, fonts, themes, type FontChoice, type ReaderPrefs, type ReaderTheme, type TurnStyle } from './prefs'

function Stepper({ label, value, display, onChange, step, min, max }: { label: string; value: number; display: string; onChange(v: number): void; step: number; min: number; max: number }) {
  const clamp = (v: number) => Math.min(max, Math.max(min, Math.round(v * 100) / 100))
  return (
    <div className="stepper">
      <span>{label}</span>
      <div className="stepper-ctl">
        <button onClick={() => onChange(clamp(value - step))} disabled={value <= min} aria-label={`Decrease ${label}`}><Minus size={16} /></button>
        <span className="stepper-val">{display}</span>
        <button onClick={() => onChange(clamp(value + step))} disabled={value >= max} aria-label={`Increase ${label}`}><Plus size={16} /></button>
      </div>
    </div>
  )
}

function Segmented<T extends string | number>({ value, options, onChange }: { value: T; options: [T, string][]; onChange(v: T): void }) {
  return (
    <div className="segmented" role="radiogroup">
      {options.map(([v, l]) => (
        <button key={String(v)} role="radio" aria-checked={value === v} className={value === v ? 'on' : ''} onClick={() => onChange(v)}>{l}</button>
      ))}
    </div>
  )
}

/** Tiny animated previews so the page-turn choice is self-explanatory. */
const TURN_STYLES: [TurnStyle, string, string][] = [
  ['curl', 'Page curl', 'Drag from any edge or corner'],
  ['slide', 'Slide', 'Pages slide sideways'],
  ['none', 'Instant', 'No animation'],
]

/** Desk surface: presets, the user's uploaded photos, and a dimmer for busy images. */
function DeskPicker({ prefs: p, set }: { prefs: ReaderPrefs; set<K extends keyof ReaderPrefs>(k: K, v: ReaderPrefs[K]): void }) {
  const mine = useQuery({ queryKey: ['backgrounds'], queryFn: () => api<{ name: string }[]>('/api/me/backgrounds') })
  const input = useRef<HTMLInputElement>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const upload = async (file: File | undefined) => {
    if (!file) return
    setBusy(true); setError('')
    try {
      const fd = new FormData()
      fd.append('file', file)
      const r = await api<{ name: string }>('/api/me/backgrounds', { body: fd })
      await mine.refetch()
      set('deskBackground', `custom:${r.name}`)
    } catch (e) { setError((e as Error).message) } finally { setBusy(false) }
  }
  const remove = async (name: string) => {
    await api(`/api/me/backgrounds/${name}`, { method: 'DELETE' })
    if (p.deskBackground === `custom:${name}`) set('deskBackground', 'walnut')
    void mine.refetch()
  }
  return (
    <>
      <div className="rs-label">Desk</div>
      <div className="desk-swatches">
        {DESK_PRESETS.map(([id, label]) => (
          <button key={id} className={`desk-swatch desk ${p.deskBackground === id ? 'on' : ''}`} data-desk={id} onClick={() => set('deskBackground', id)}>
            <span>{label}</span>
          </button>
        ))}
        {mine.data?.map(({ name }) => (
          <div key={name} role="button" tabIndex={0} className={`desk-swatch desk ${p.deskBackground === `custom:${name}` ? 'on' : ''}`} data-desk="custom"
            style={{ ['--desk-image' as string]: `url("${authedUrl(`/api/me/backgrounds/${name}`)}")` }}
            onClick={() => set('deskBackground', `custom:${name}`)} onKeyDown={e => { if (e.key === 'Enter') set('deskBackground', `custom:${name}`) }}>
            <button className="del" aria-label="Delete this image" onClick={e => { e.stopPropagation(); void remove(name) }}><X size={13} /></button>
            <span>My photo</span>
          </div>
        ))}
        <button className="desk-swatch upload" onClick={() => input.current?.click()} disabled={busy} title="Use your own image">
          <ImagePlus size={20} />
          <span style={{ background: 'none', color: 'var(--text-dim)' }}>{busy ? 'Uploading…' : 'Your image'}</span>
        </button>
        <input ref={input} type="file" accept="image/*" hidden onChange={e => { void upload(e.target.files?.[0]); e.target.value = '' }} />
      </div>
      {error && <p className="error">{error}</p>}
      <div className="rs-group">
        <div className="stepper">
          <span>Dim the desk</span>
          <input type="range" className="range" min={0} max={0.8} step={0.05} value={p.deskDim} onChange={e => set('deskDim', Number(e.target.value))} />
        </div>
      </div>
    </>
  )
}

export function ReaderSettingsForm({ prefs: p, onChange, kind = 'all' }: { prefs: ReaderPrefs; onChange(p: ReaderPrefs): void; kind?: 'all' | 'reflow' | 'pdf' | 'comic' }) {
  const set = <K extends keyof ReaderPrefs>(k: K, v: ReaderPrefs[K]) => onChange({ ...p, [k]: v })
  const reflow = kind === 'all' || kind === 'reflow'
  return (
    <div className="reader-settings">
      <div className="rs-label">Theme</div>
      <div className="theme-swatches">
        {(Object.keys(themes) as ReaderTheme[]).map(t => (
          <button key={t} className={`swatch ${p.theme === t ? 'on' : ''}`} style={{ background: themes[t].bg, color: themes[t].fg }} onClick={() => set('theme', t)}>
            <span className="swatch-aa">Aa</span>
            <small>{themes[t].label}</small>
          </button>
        ))}
      </div>

      <div className="rs-label">View</div>
      <div className="view-modes">
        <button className={`view-mode ${p.bookMode ? 'on' : ''}`} onClick={() => set('bookMode', true)}>
          <span className="vm-art book-art"><i /><i /></span><b>Book on a desk</b><small>5×7 pages, real spreads</small>
        </button>
        <button className={`view-mode ${!p.bookMode ? 'on' : ''}`} onClick={() => set('bookMode', false)}>
          <span className="vm-art full-art"><i /></span><b>Full screen</b><small>Edge-to-edge text</small>
        </button>
      </div>

      {p.bookMode && <DeskPicker prefs={p} set={set} />}

      <div className="rs-label">Page turn</div>
      <div className="turn-styles">
        {TURN_STYLES.map(([v, l, hint]) => (
          <button key={v} className={`turn-style ${p.turnStyle === v ? 'on' : ''}`} onClick={() => set('turnStyle', v)}>
            <span className={`turn-demo ${v}`}><i /><i /></span>
            <b>{l}</b>
            <small>{hint}</small>
          </button>
        ))}
      </div>

      {reflow && (
        <>
          <div className="rs-label">Font</div>
          <div className="font-grid">
            {(Object.keys(fonts) as FontChoice[]).map(f => (
              <button key={f} className={`font-pick ${p.font === f ? 'on' : ''}`} onClick={() => set('font', f)}>
                <span style={{ fontFamily: fonts[f].css.replace('"Literata JR"', '"Literata Variable"') || undefined }}>Ag</span>
                <small>{fonts[f].label}</small>
              </button>
            ))}
          </div>
          <div className="rs-group">
            <Stepper label="Text size" value={p.fontSize} display={`${p.fontSize}%`} step={10} min={60} max={250} onChange={v => set('fontSize', v)} />
            <Stepper label="Line spacing" value={p.lineHeight} display={p.lineHeight.toFixed(1)} step={0.1} min={1} max={2.4} onChange={v => set('lineHeight', v)} />
            <Stepper label="Margins" value={p.sideMargin} display={`${p.sideMargin}%`} step={2} min={0} max={20} onChange={v => set('sideMargin', v)} />
            {!p.bookMode && <Stepper label="Line length" value={p.maxWidth} display={`${p.maxWidth}px`} step={60} min={420} max={1400} onChange={v => set('maxWidth', v)} />}
          </div>
          <div className="rs-label">Layout</div>
          <div className="row" style={{ gap: 8 }}>
            {!p.bookMode && <Segmented value={p.flow} options={[['paginated', 'Pages'], ['scrolled', 'Scroll']]} onChange={v => set('flow', v)} />}
            <Segmented value={p.columns} options={[[1, 'One page'], [2, p.bookMode ? 'Two pages when there\u2019s room' : '2 on wide screens']]} onChange={v => set('columns', v)} />
          </div>
          {!p.bookMode && p.flow === 'scrolled' && p.turnStyle === 'curl' && <p className="small faint" style={{ margin: '6px 0 0' }}>The page curl works in Pages layout.</p>}
          <div className="rs-group">
            <Toggle label="Justify text" checked={p.justify} onChange={v => set('justify', v)} />
            <Toggle label="Hyphenation" checked={p.hyphenate} onChange={v => set('hyphenate', v)} />
          </div>
        </>
      )}
      {(kind === 'all' || kind === 'pdf') && (
        <>
          <div className="rs-label">PDF</div>
          <Segmented value={p.pdfFit} options={[['page', 'Fit page'], ['width', 'Fit width']]} onChange={v => set('pdfFit', v)} />
          {p.pdfFit === 'width' && p.turnStyle === 'curl' && <p className="small faint" style={{ margin: '6px 0 0' }}>The page curl works with Fit page.</p>}
        </>
      )}
      {(kind === 'all' || kind === 'comic') && (
        <div className="rs-group"><Toggle label="Right-to-left (manga)" hint="Applies when a comic is opened" checked={p.rtlComics} onChange={v => set('rtlComics', v)} /></div>
      )}
      <div className="rs-group">
        <div className="stepper">
          <span className="row" style={{ gap: 8 }}><Sun size={16} />Brightness</span>
          <input type="range" className="range" min={0.3} max={1} step={0.05} value={p.brightness} onChange={e => set('brightness', Number(e.target.value))} />
        </div>
        <Toggle label="Keep screen on while reading" checked={p.keepAwake} onChange={v => set('keepAwake', v)} />
      </div>
    </div>
  )
}
