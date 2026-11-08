/**
 * Android back button / back gesture in Satchel. Without this, Android just closes the app.
 * Order, like any native app:
 *   1. close whatever is open on top (dropdown, dialog, multi-select, reader panel or selection)
 *   2. go back to the previous screen
 *   3. from a screen reached directly (e.g. after a restart), go to Home
 *   4. on Home, send the app to the background (state is kept; Android may close it later)
 */
import { useEffect, useRef } from 'react'
import { isNativeApp } from './api'

type Handler = () => boolean
const handlers: Handler[] = []

/** Let a screen consume the back press (return true when it closed something). Newest screen first. */
export function useBackHandler(fn: Handler) {
  const latest = useRef(fn)
  latest.current = fn
  useEffect(() => {
    const h: Handler = () => latest.current()
    handlers.push(h)
    return () => { handlers.splice(handlers.indexOf(h), 1) }
  }, [])
}

const escape = () => window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }))

export function installNativeBack() {
  const App = (window as any).Capacitor?.Plugins?.App
  if (!isNativeApp() || !App?.addListener) return
  App.addListener('backButton', ({ canGoBack }: { canGoBack: boolean }) => {
    // 1. overlays already close on Escape
    if (document.querySelector('.dd-panel, .modal') || document.querySelector('[data-selected]')) { escape(); return }
    for (let i = handlers.length - 1; i >= 0; i--) if (handlers[i]()) return
    // 2-4
    const home = !location.hash || location.hash === '#/' || location.hash === '#'
    // the router numbers its history entries (idx 0 = first screen this session); the WebView's own
    // canGoBack doesn't see in-page navigation, so it's only a fallback
    const idx = (history.state as { idx?: unknown } | null)?.idx
    const inAppHistory = typeof idx === 'number' ? idx > 0 : canGoBack
    if (home) void App.minimizeApp?.()
    else if (inAppHistory) history.back()
    else location.replace('#/')
  })
}
