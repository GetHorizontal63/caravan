import { useSyncExternalStore } from 'react'
import { isNativeApp } from './api'

/**
 * Appearance = palette × mode, chosen per device (web and Satchel can differ).
 *
 * Palettes (accents only; Night Ink, Sand and Dune are shared by both):
 *   terracotta: Terracotta #B8472F + Amber #E8A33D
 *   oasis:      Oasis Teal #1F6F6A + Saddle #7A4B2C
 * Modes: dark (Night Ink), light (Sand), or follow the system.
 *
 * Both palettes are available in both apps; each app simply starts on its own (Caravan: terracotta,
 * Satchel: oasis).
 */
export type Palette = 'terracotta' | 'oasis'
export type Mode = 'dark' | 'light' | 'system'
export interface Appearance { palette: Palette; mode: Mode }

export const PALETTES: { id: Palette; label: string; colors: [string, string] }[] = [
  { id: 'terracotta', label: 'Terracotta & Amber', colors: ['#B8472F', '#E8A33D'] },
  { id: 'oasis', label: 'Oasis & Saddle', colors: ['#1F6F6A', '#7A4B2C'] },
]
export const MODES: { id: Mode; label: string }[] = [
  { id: 'dark', label: 'Dark' }, { id: 'light', label: 'Light' }, { id: 'system', label: 'System' },
]

const KEY = 'caravan.appearance'
const defaults = (): Appearance => ({ palette: isNativeApp() ? 'oasis' : 'terracotta', mode: 'dark' })

function read(): Appearance {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) ?? 'null') as Partial<Appearance> | null
    const d = defaults()
    return {
      palette: v?.palette === 'terracotta' || v?.palette === 'oasis' ? v.palette : d.palette,
      mode: v?.mode === 'dark' || v?.mode === 'light' || v?.mode === 'system' ? v.mode : d.mode,
    }
  } catch {
    return defaults()
  }
}

let current: Appearance = read()
const listeners = new Set<() => void>()
const media = typeof matchMedia === 'function' ? matchMedia('(prefers-color-scheme: light)') : null

/** dark/light actually in effect (resolves "system") */
export const effectiveMode = (a: Appearance = current): 'dark' | 'light' => (a.mode === 'system' ? (media?.matches ? 'light' : 'dark') : a.mode)

export function applyAppearance(a: Appearance = current) {
  const root = document.documentElement
  root.dataset.theme = a.mode
  root.dataset.palette = a.palette
  // browser chrome / Android task switcher colour
  const meta = document.querySelector('meta[name="theme-color"]')
  meta?.setAttribute('content', effectiveMode(a) === 'light' ? '#F3E9D7' : '#1B2238')
  // Satchel: the Android bars are always Night Ink (window background), so their icons stay light in every mode
  const bars = (window as any).Capacitor?.Plugins?.SystemBars
  void bars?.setStyle?.({ style: 'DARK' })?.catch?.(() => {})
}

export function setAppearance(patch: Partial<Appearance>) {
  current = { ...current, ...patch }
  try { localStorage.setItem(KEY, JSON.stringify(current)) } catch { /* private mode */ }
  applyAppearance(current)
  listeners.forEach(l => l())
}

media?.addEventListener?.('change', () => { if (current.mode === 'system') { applyAppearance(current); listeners.forEach(l => l()) } })

export function useAppearance(): Appearance {
  return useSyncExternalStore(cb => { listeners.add(cb); return () => listeners.delete(cb) }, () => current)
}

/** Logo that follows the chosen palette. */
export const logoFor = (p: Palette) => `./icon-${p}.svg`
