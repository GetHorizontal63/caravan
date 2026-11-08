import type { Annotation } from '../api'
import type { ReaderPrefs } from './prefs'

export interface TocItem {
  label: string
  href: string
  subitems?: TocItem[]
}

export interface Position {
  fraction: number
  locator: string
  chapter?: string
  chapterHref?: string
  /** e.g. "Page 12 of 340" */
  label?: string
  /** minutes left in the current chapter (reflowable books only) */
  minutesLeftInChapter?: number
}

export interface SearchHit {
  label: string
  locator: string
  excerpt: { pre: string; match: string; post: string }
}

export interface Selection {
  locator: string
  text: string
  /** viewport coordinates of the selection's top edge (for the popover) */
  x: number
  y: number
}

/** Imperative API every rendering engine exposes to the reader chrome. */
export interface EngineHandle {
  next(): void
  prev(): void
  /** right-to-left book: left/right taps and arrow keys are swapped */
  rtl?: boolean
  goTo(locator: string): void
  goToFraction(fraction: number): void
  search?(query: string): AsyncGenerator<SearchHit | { progress: number }>
  clearSearch?(): void
  addHighlight?(a: Annotation): void
  removeHighlight?(a: Annotation): void
  clearSelection?(): void
  /** Fractions where sections start, for slider tick marks. */
  sectionFractions?: number[]
}

/** Book-on-desk geometry chosen by the reader page. */
export interface BookLayout {
  /** two pages side by side (spine in the middle) */
  spread: boolean
  /** width of one page in px */
  pageW: number
}

export interface EngineProps {
  book: BookLayout | null
  data: Blob
  format: string
  prefs: ReaderPrefs
  initialLocator: string | null
  annotations: Annotation[]
  onReady(handle: EngineHandle, toc: TocItem[], meta: { dir?: string }): void
  onRelocate(pos: Position): void
  /** x as a fraction of the page area's width */
  onTap(x: number): void
  onSelection(sel: Selection | null): void
  onAnnotationClick(locator: string): void
  onKey(e: KeyboardEvent): void
  onError(message: string): void
}
