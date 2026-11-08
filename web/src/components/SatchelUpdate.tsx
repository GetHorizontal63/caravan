import { useCallback, useEffect, useState } from 'react'
import { Download, Sparkles, X } from 'lucide-react'
import { isNativeApp } from '../api'
import { SATCHEL_LATEST_API, SATCHEL_RELEASES_URL } from '../brand'

/** Build stamp baked into Satchel by push.py (www/satchel-build.json). Absent in Caravan's web build. */
export interface SatchelBuild { versionName: string; versionCode: number; tag?: string }

export interface SatchelRelease {
  tag: string
  name: string
  versionCode: number | null
  url: string          // release page
  apkUrl: string | null
  publishedAt: string
  notes: string
}

const buildOf = (tag: string) => { const m = /build[.-]?(\d+)/i.exec(tag); return m ? Number(m[1]) : null }

let installedPromise: Promise<SatchelBuild | null> | null = null
export function installedSatchel(): Promise<SatchelBuild | null> {
  if (!isNativeApp()) return Promise.resolve(null)
  return (installedPromise ??= fetch('./satchel-build.json', { cache: 'no-store' })
    .then(r => (r.ok ? (r.json() as Promise<SatchelBuild>) : null))
    .catch(() => null))
}

export async function latestSatchel(): Promise<SatchelRelease | null> {
  const res = await fetch(SATCHEL_LATEST_API, { headers: { Accept: 'application/vnd.github+json' } })
  if (res.status === 404) return null // no releases yet
  if (!res.ok) throw new Error(res.status === 403 ? 'GitHub rate limit reached — try again later' : `GitHub answered ${res.status}`)
  const r = await res.json()
  const apk = (r.assets ?? []).find((a: { name: string }) => /\.apk$/i.test(a.name))
  return {
    tag: r.tag_name,
    name: r.name || r.tag_name,
    versionCode: buildOf(r.tag_name),
    url: r.html_url || SATCHEL_RELEASES_URL,
    apkUrl: apk?.browser_download_url ?? null,
    publishedAt: r.published_at,
    notes: r.body ?? '',
  }
}

/** Open a link outside the app (Satchel hands it to the system browser; Caravan opens a new tab). */
export function openExternal(url: string) {
  if (isNativeApp()) window.location.href = url
  else window.open(url, '_blank', 'noopener')
}

type CheckState = { status: 'idle' | 'checking' | 'current' | 'available' | 'error' | 'none'; installed: SatchelBuild | null; latest: SatchelRelease | null; error?: string; checkedAt?: number }

const LAST_CHECK = 'satchel.lastCheck'
const DISMISSED = 'satchel.dismissed'
const store = {
  get: (k: string) => { try { return localStorage.getItem(k) } catch { return null } },
  set: (k: string, v: string) => { try { localStorage.setItem(k, v) } catch { /* private mode */ } },
}

/** Compares the installed Satchel build with the newest GitHub release. */
export function useSatchelUpdates() {
  const [state, setState] = useState<CheckState>({ status: 'idle', installed: null, latest: null })
  const check = useCallback(async () => {
    setState(s => ({ ...s, status: 'checking', error: undefined }))
    try {
      const [installed, latest] = await Promise.all([installedSatchel(), latestSatchel()])
      store.set(LAST_CHECK, String(Date.now()))
      const newer = !!latest?.versionCode && (!installed || latest.versionCode > installed.versionCode)
      setState({ status: !latest ? 'none' : newer && installed ? 'available' : installed ? 'current' : 'none', installed, latest, checkedAt: Date.now() })
    } catch (e) {
      setState(s => ({ ...s, status: 'error', error: (e as Error).message }))
    }
  }, [])
  return { ...state, check }
}

/**
 * Satchel only: a ribbon under the header when a newer release is on GitHub.
 * Checks at launch, when the app comes back to the foreground (at most hourly), and every 6 hours.
 */
export function SatchelUpdateRibbon() {
  const u = useSatchelUpdates()
  const [dismissed, setDismissed] = useState(() => store.get(DISMISSED))
  const { check } = u

  useEffect(() => {
    if (!isNativeApp()) return
    void check()
    const onShow = () => {
      if (document.visibilityState !== 'visible') return
      if (Date.now() - Number(store.get(LAST_CHECK) ?? 0) > 3600_000) void check()
    }
    document.addEventListener('visibilitychange', onShow)
    const t = setInterval(() => void check(), 6 * 3600_000)
    return () => { document.removeEventListener('visibilitychange', onShow); clearInterval(t) }
  }, [check])

  if (!isNativeApp() || u.status !== 'available' || !u.latest || dismissed === u.latest.tag) return null
  const latest = u.latest
  return (
    <div className="update-ribbon" role="status">
      <Sparkles size={18} className="ribbon-icon" />
      <div className="grow" style={{ minWidth: 0 }}>
        <b>Satchel update available</b>
        <span className="ribbon-sub">{latest.name}{u.installed ? ` — you have ${u.installed.versionName}` : ''}</span>
      </div>
      <button className="btn small ribbon-go" onClick={() => openExternal(latest.apkUrl ?? latest.url)}><Download size={15} />Update</button>
      <button className="icon-btn ribbon-close" aria-label="Remind me later" title="Later" onClick={() => { store.set(DISMISSED, latest.tag); setDismissed(latest.tag) }}><X size={17} /></button>
    </div>
  )
}
