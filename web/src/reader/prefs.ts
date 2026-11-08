import { api } from '../api'
import literataUrl from '@fontsource-variable/literata/files/literata-latin-wght-normal.woff2?url'
import literataItalicUrl from '@fontsource-variable/literata/files/literata-latin-wght-italic.woff2?url'

/** Book documents live in iframes, so bundled fonts must be declared inside them with absolute URLs. */
const abs = (u: string) => new URL(u, location.href).href
const fontFaces = () => `
    @font-face { font-family: "Literata JR"; font-style: normal; font-weight: 200 900; font-display: swap; src: url("${abs(literataUrl)}") format("woff2"); }
    @font-face { font-family: "Literata JR"; font-style: italic; font-weight: 200 900; font-display: swap; src: url("${abs(literataItalicUrl)}") format("woff2"); }`

export type ReaderTheme = 'light' | 'sepia' | 'dark' | 'black'
export type FontChoice = 'publisher' | 'literata' | 'serif' | 'sans' | 'slab' | 'mono'
export type TurnStyle = 'curl' | 'slide' | 'none'

export interface ReaderPrefs {
  theme: ReaderTheme
  font: FontChoice
  fontSize: number      // percent
  lineHeight: number
  sideMargin: number    // percent of page width
  maxWidth: number      // px, line length cap
  justify: boolean
  hyphenate: boolean
  flow: 'paginated' | 'scrolled'
  columns: 1 | 2        // max columns on wide screens
  /** curl = realistic page turn, slide = horizontal slide, none = instant */
  turnStyle: TurnStyle
  /** show the text as a physical 5×7 book lying on a desk (vs. edge-to-edge) */
  bookMode: boolean
  /** desk surface preset, or "custom:<file>" for an uploaded image */
  deskBackground: string
  /** extra darkening of the desk, 0..0.8 (useful for busy photos) */
  deskDim: number
  brightness: number    // 0.3..1, overlay dimming
  keepAwake: boolean
  pdfFit: 'page' | 'width'
  rtlComics: boolean
}

export const defaultPrefs: ReaderPrefs = {
  theme: 'light',
  font: 'publisher',
  fontSize: 100,
  lineHeight: 1.5,
  sideMargin: 6,
  maxWidth: 720,
  justify: true,
  hyphenate: true,
  flow: 'paginated',
  columns: 2,
  turnStyle: 'curl',
  bookMode: true,
  deskBackground: 'walnut',
  deskDim: 0,
  brightness: 1,
  keepAwake: true,
  pdfFit: 'page',
  rtlComics: false,
}

export const themes: Record<ReaderTheme, { label: string; bg: string; fg: string; link: string; ui: 'light' | 'dark' }> = {
  light: { label: 'Light', bg: '#ffffff', fg: '#1d1d1f', link: '#2563eb', ui: 'light' },
  sepia: { label: 'Sepia', bg: '#f4ecd8', fg: '#5b4636', link: '#8a4b16', ui: 'light' },
  dark: { label: 'Dark', bg: '#1e1f24', fg: '#d6d6d6', link: '#8ab4f8', ui: 'dark' },
  black: { label: 'Black', bg: '#000000', fg: '#b9b9b9', link: '#8ab4f8', ui: 'dark' },
}

export const fonts: Record<FontChoice, { label: string; css: string }> = {
  publisher: { label: 'Original', css: '' },
  literata: { label: 'Literata', css: '"Literata JR", Georgia, serif' },
  serif: { label: 'Serif', css: 'Charter, "Bitstream Charter", "Sitka Text", Cambria, Georgia, serif' },
  sans: { label: 'Sans', css: 'system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif' },
  slab: { label: 'Slab', css: 'Rockwell, "Roboto Slab", "Courier New", serif' },
  mono: { label: 'Mono', css: 'ui-monospace, "Cascadia Mono", Menlo, Consolas, monospace' },
}

const KEY = 'jr.readerPrefs'

export function loadPrefs(serverPrefs?: Partial<ReaderPrefs>): ReaderPrefs {
  let local: Partial<ReaderPrefs> & { animated?: boolean } = {}
  try { local = JSON.parse(localStorage.getItem(KEY) ?? '{}') } catch { /* ignore */ }
  // device-local settings win (phone vs. desktop differ), server copy seeds new devices
  const merged = { ...defaultPrefs, ...serverPrefs, ...local } as ReaderPrefs & { animated?: boolean }
  // pre-0.2 setting: animated=false meant instant page turns
  if (!local.turnStyle && !serverPrefs?.turnStyle && merged.animated === false) merged.turnStyle = 'none'
  delete merged.animated
  return merged
}

let syncTimer: number | undefined
export function savePrefs(p: ReaderPrefs, allUserPrefs: Record<string, unknown>) {
  try { localStorage.setItem(KEY, JSON.stringify(p)) } catch { /* ignore */ }
  clearTimeout(syncTimer)
  syncTimer = window.setTimeout(() => {
    void api('/api/me/prefs', { method: 'PUT', body: { ...allUserPrefs, reader: p } }).catch(() => {})
  }, 1500)
}

/** CSS injected into every book document (foliate-js renderer). */
export function bookCss(p: ReaderPrefs): string {
  const t = themes[p.theme]
  const font = fonts[p.font].css
  const recolor = p.theme !== 'light'
  return `${fontFaces()}
    @namespace epub "http://www.idpf.org/2007/ops";
    html { color-scheme: ${t.ui}; font-size: ${p.fontSize}% !important; }
    html, body { background: ${t.bg} !important; color: ${t.fg} !important; }
    ${recolor ? `body *:not(img):not(svg):not(svg *):not(video) { color: inherit !important; background-color: transparent !important; border-color: color-mix(in srgb, ${t.fg} 30%, transparent) !important; }` : ''}
    a:link, a:visited { color: ${t.link} !important; }
    ${font ? `body, p, div, span, li, blockquote, td, dd, dt, h1, h2, h3, h4, h5, h6 { font-family: ${font} !important; }` : ''}
    p, li, blockquote, dd, div {
      line-height: ${p.lineHeight} !important;
      -webkit-hyphens: ${p.hyphenate ? 'auto' : 'manual'};
      hyphens: ${p.hyphenate ? 'auto' : 'manual'};
      -webkit-hyphenate-limit-before: 3; -webkit-hyphenate-limit-after: 2; -webkit-hyphenate-limit-lines: 2;
      hanging-punctuation: allow-end last;
      widows: 2; orphans: 2;
    }
    p { text-align: ${p.justify ? 'justify' : 'start'}; }
    [align="left"] { text-align: left; } [align="right"] { text-align: right; } [align="center"] { text-align: center; }
    pre { white-space: pre-wrap !important; }
    img, svg { max-width: 100%; height: auto; }
    ${p.theme === 'dark' || p.theme === 'black' ? 'img { filter: brightness(.88); }' : ''}
    aside[epub|type~="endnote"], aside[epub|type~="footnote"], aside[epub|type~="note"], aside[epub|type~="rearnote"] { display: none; }
    ::selection { background: color-mix(in srgb, ${t.link} 35%, transparent); }
  `
}

export const DESK_PRESETS: [string, string][] = [
  ['walnut', 'Walnut'], ['oak', 'Oak'], ['slate', 'Slate'], ['linen', 'Linen'], ['leather', 'Leather'], ['night', 'Night'],
]
