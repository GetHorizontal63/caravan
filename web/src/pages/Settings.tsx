import { useEffect, useState, type FormEvent } from 'react'
import { Download, RefreshCw, Smartphone } from 'lucide-react'
import { SATCHEL_LATEST_URL, SATCHEL_RELEASES_URL } from '../brand'
import { openExternal, useSatchelUpdates } from '../components/SatchelUpdate'
import { api, isNativeApp, serverUrl, setServerUrl } from '../api'
import { useSession } from '../session'
import { toast } from '../components/ui'
import { MODES, PALETTES, logoFor, setAppearance, useAppearance } from '../theme'
import { loadPrefs, savePrefs, type ReaderPrefs } from '../reader/prefs'
import { ReaderSettingsForm } from '../reader/ReaderSettings'
import { OfflineDevice } from './Offline'

export default function SettingsPage() {
  const { user, setUser, info } = useSession()
  const [prefs, setPrefs] = useState<ReaderPrefs>(() => loadPrefs(user?.prefs?.reader))
  const [current, setCurrent] = useState('')
  const [password, setPassword] = useState('')

  const appearance = useAppearance()
  const updateReader = (p: ReaderPrefs) => { setPrefs(p); savePrefs(p, user!.prefs) }

  const changePassword = async (e: FormEvent) => {
    e.preventDefault()
    try {
      await api('/api/me/password', { body: { current, password } })
      setCurrent(''); setPassword('')
      toast('Password changed')
    } catch (err) { toast((err as Error).message) }
  }

  const origin = serverUrl() || location.origin
  return (
    <div style={{ maxWidth: 720 }}>
      <div className="page-title"><h1>Settings</h1></div>

      {isNativeApp() && <OfflineDevice />}
      <section className="card" style={{ marginBottom: 18 }}>
        <h3 style={{ marginBottom: 4 }}>Appearance</h3>
        <p className="small muted" style={{ marginTop: 0 }}>Saved on this device, so the web app and Satchel can each look their own way.</p>
        <div className="palette-picks">
          {PALETTES.map(p => (
            <button key={p.id} className={`palette-pick ${appearance.palette === p.id ? 'on' : ''}`} data-palette-preview={p.id} onClick={() => setAppearance({ palette: p.id })}>
              <img src={logoFor(p.id)} alt="" />
              <span className="grow">
                <b>{p.label}</b>
                <span className="swatches">{p.colors.map(c => <i key={c} style={{ background: c }} />)}<i style={{ background: '#1B2238' }} /><i style={{ background: '#F3E9D7' }} /></span>
              </span>
            </button>
          ))}
        </div>
        <div className="segmented" style={{ marginTop: 14 }} role="radiogroup" aria-label="Mode">
          {MODES.map(m => (
            <button key={m.id} role="radio" aria-checked={appearance.mode === m.id} className={appearance.mode === m.id ? 'on' : ''} onClick={() => setAppearance({ mode: m.id })}>{m.label}</button>
          ))}
        </div>
      </section>

      <section className="card" style={{ marginBottom: 18 }}>
        <h3 style={{ marginBottom: 4 }}>Reading defaults</h3>
        <p className="small muted" style={{ marginTop: 0 }}>Also adjustable while reading via the <b>Aa</b> button. Saved per device and synced to your account.</p>
        <ReaderSettingsForm prefs={prefs} onChange={updateReader} />
      </section>

      <section className="card" style={{ marginBottom: 18 }}>
        <h3 style={{ marginBottom: 12 }}>Account — {user?.username}</h3>
        <form onSubmit={e => void changePassword(e)}>
          <label className="field"><span>Current password</span><input className="input" type="password" value={current} onChange={e => setCurrent(e.target.value)} autoComplete="current-password" /></label>
          <label className="field"><span>New password</span><input className="input" type="password" value={password} onChange={e => setPassword(e.target.value)} autoComplete="new-password" /></label>
          <button className="btn" disabled={!current || password.length < 4}>Change password</button>
        </form>
      </section>

      <SatchelCard />

      <section className="card">
        <h3 style={{ marginBottom: 12 }}>Other apps</h3>
        <p className="small muted" style={{ marginTop: 0 }}>
          E-ink readers and apps such as KOReader, Moon+ Reader, Librera or Thorium can browse this library over OPDS. Add a catalog with this address and sign in with your Caravan account:
        </p>
        <code style={{ display: 'block', padding: 10, background: 'var(--bg)', borderRadius: 6, overflowWrap: 'anywhere' }}>{origin}/opds</code>
        <p className="small faint">Server: {info?.serverName} · version {info?.version}</p>
        {isNativeApp() && <button className="btn small" onClick={() => { setServerUrl(null); location.reload() }}>Switch server</button>}
      </section>
    </div>
  )
}

/** Caravan: where to get the Android app. Satchel: installed version + update check. */
function SatchelCard() {
  const u = useSatchelUpdates()
  const native = isNativeApp()
  const { check } = u
  useEffect(() => { void check() }, [check])
  const latest = u.latest
  const published = latest?.publishedAt ? new Date(latest.publishedAt).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' }) : ''
  return (
    <section className="card satchel-card" style={{ marginBottom: 18 }}>
      <div className="satchel-head">
        <span className="satchel-icon"><Smartphone size={22} /></span>
        <div className="grow">
          <h3>Satchel {native ? '' : 'for Android'}</h3>
          <div className="small muted">{native ? 'The Android app for Caravan.' : 'Read your Caravan library on Android, with the same shelves, progress and page-turning.'}</div>
        </div>
      </div>
      {native ? (
        <div className="satchel-status">
          <div className="small">
            Installed: <b>{u.installed?.versionName ?? 'development build'}</b>
            <div className="faint">
              {u.status === 'checking' ? 'Checking for updates…'
                : u.status === 'available' ? `Update available: ${latest?.name}`
                : u.status === 'current' ? "You're on the latest release."
                : u.status === 'none' ? (latest ? `Latest release: ${latest.name}` : 'No releases published yet.')
                : u.status === 'error' ? u.error : ''}
            </div>
          </div>
          <div className="row">
            {u.status === 'available' && latest && <button className="btn primary small" onClick={() => openExternal(latest.apkUrl ?? latest.url)}><Download size={15} />Update</button>}
            <button className="btn small" disabled={u.status === 'checking'} onClick={() => void check()}><RefreshCw size={15} />Check for updates</button>
            <button className="btn small ghost" onClick={() => openExternal(SATCHEL_RELEASES_URL)}>All releases</button>
          </div>
        </div>
      ) : (
        <div className="satchel-status">
          <div className="small faint">{latest ? `Latest: ${latest.name}${published ? ` · ${published}` : ''}` : u.status === 'checking' ? 'Checking GitHub…' : 'Releases are published on GitHub.'}</div>
          <div className="row">
            <a className="btn primary small" href={SATCHEL_LATEST_URL} target="_blank" rel="noopener"><Download size={15} />Get Satchel</a>
            <a className="btn small ghost" href={SATCHEL_RELEASES_URL} target="_blank" rel="noopener">All releases</a>
          </div>
        </div>
      )}
    </section>
  )
}
