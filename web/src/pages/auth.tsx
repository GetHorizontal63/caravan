import { useState, type FormEvent, type ReactNode } from 'react'
import { api, isNativeApp, serverUrl, setServerUrl, type User } from '../api'
import { APP_NAME, isCaravanServer } from '../brand'
import { logoFor, useAppearance } from '../theme'
import { useSession } from '../session'

const DECO: [string, string, string, string][] = [
  // left, top, colour, tilt
  ['6%', '12%', 'var(--terracotta)', '-14deg'], ['16%', '64%', 'var(--oasis)', '9deg'], ['78%', '8%', 'var(--amber)', '12deg'],
  ['86%', '58%', 'var(--saddle)', '-8deg'], ['48%', '84%', 'var(--dune)', '4deg'], ['60%', '-4%', 'var(--accent)', '-6deg'],
]

export function AuthCard({ title, subtitle, children }: { title: string; subtitle?: ReactNode; children: ReactNode }) {
  const { palette } = useAppearance()
  return (
    <div className="auth">
      <div className="auth-deco" aria-hidden>
        {DECO.map(([left, top, c, r], i) => (
          <span key={i} style={{ left, top, ['--c' as string]: c, ['--r' as string]: r, animationDelay: `${i * -3}s` }} />
        ))}
      </div>
      <div className="card">
        <div className="brand"><img src={logoFor(palette)} alt="" />{APP_NAME}</div>
        <h1>{title}</h1>
        {subtitle && <p className="muted">{subtitle}</p>}
        {children}
      </div>
    </div>
  )
}

function useSubmit<T>(fn: () => Promise<T>) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const submit = async (e: FormEvent) => {
    e.preventDefault()
    setBusy(true)
    setError('')
    try { await fn() } catch (err) { setError((err as Error).message) } finally { setBusy(false) }
  }
  return { busy, error, submit }
}

/** Native apps: choose which server to talk to (like Jellyfin's "Add server"). */
export function ConnectForm({ unreachable }: { unreachable?: boolean }) {
  const { refresh } = useSession()
  const [url, setUrl] = useState(serverUrl() || 'http://')
  const { busy, error, submit } = useSubmit(async () => {
    let u = url.trim().replace(/\/+$/, '')
    if (!/^https?:\/\//.test(u)) u = 'http://' + u
    if (!/:\d+$/.test(new URL(u).host) && !u.startsWith('https')) u += ':8420'
    let res: Response
    try {
      res = await fetch(u + '/api/system/info', { signal: AbortSignal.timeout(15000) })
    } catch (err) {
      const e = err as Error
      throw new Error(e.name === 'TimeoutError'
        ? `No answer from ${u} after 15 s. Is Tailscale/VPN on, and is ${APP_NAME} allowed through it?`
        : `Couldn't connect to ${u} (${e.message || e.name}). Check the address, port and network.`)
    }
    if (!res.ok) throw new Error(`${u} answered with HTTP ${res.status}, so it isn't a Caravan server (wrong port?)`)
    const info = await res.json().catch(() => null)
    if (!isCaravanServer(info)) throw new Error(`${u} is reachable but isn't a Caravan server (wrong port?)`)
    setServerUrl(u)
    await refresh()
  })
  return (
    <form onSubmit={submit}>
      {unreachable && <p className="error">Can't reach {serverUrl() || 'the server'}. Check the address or that the server is running.</p>}
      <label className="field"><span>Server address</span>
        <input className="input" value={url} onChange={e => setUrl(e.target.value)} placeholder="http://192.168.1.10:8420" autoFocus inputMode="url" autoCapitalize="off" autoCorrect="off" />
      </label>
      {error && <p className="error">{error}</p>}
      <button className="btn primary lg" style={{ width: '100%' }} disabled={busy}>{busy ? 'Connecting…' : 'Connect'}</button>
    </form>
  )
}

export function ConnectPage({ unreachable }: { unreachable?: boolean }) {
  const { refresh } = useSession()
  if (unreachable && !isNativeApp() && !serverUrl()) {
    return (
      <AuthCard title="Server unavailable" subtitle="The Caravan server isn't responding.">
        <button className="btn primary" onClick={() => void refresh()}>Try again</button>
      </AuthCard>
    )
  }
  return (
    <AuthCard title="Connect to a server" subtitle="Enter the address of your Caravan server.">
      <ConnectForm unreachable={unreachable} />
    </AuthCard>
  )
}

export function SetupPage() {
  const { signIn } = useSession()
  const [serverName, setServerName] = useState('Caravan')
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const { busy, error, submit } = useSubmit(async () => {
    if (password !== confirm) throw new Error('Passwords do not match')
    const r = await api<{ token: string; user: User }>('/api/setup', { body: { username, password, serverName } })
    signIn(r.token, r.user)
    location.hash = '#/admin/libraries?welcome=1'
  })
  return (
    <AuthCard title="Welcome!" subtitle="Let's set up your server. First, create the administrator account.">
      <form onSubmit={submit}>
        <label className="field"><span>Server name</span><input className="input" value={serverName} onChange={e => setServerName(e.target.value)} /></label>
        <label className="field"><span>Username</span><input className="input" value={username} onChange={e => setUsername(e.target.value)} autoFocus autoCapitalize="off" /></label>
        <label className="field"><span>Password</span><input className="input" type="password" value={password} onChange={e => setPassword(e.target.value)} /></label>
        <label className="field"><span>Confirm password</span><input className="input" type="password" value={confirm} onChange={e => setConfirm(e.target.value)} /></label>
        {error && <p className="error">{error}</p>}
        <button className="btn primary lg" style={{ width: '100%' }} disabled={busy || !username || !password}>Create account</button>
      </form>
    </AuthCard>
  )
}

export function LoginPage() {
  const { signIn, info } = useSession()
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const { busy, error, submit } = useSubmit(async () => {
    const device = isNativeApp() ? 'Satchel' : navigator.userAgent.slice(0, 120)
    const r = await api<{ token: string; user: User }>('/api/auth/login', { body: { username, password, device } })
    signIn(r.token, r.user)
  })
  return (
    <AuthCard title={`Sign in to ${info?.serverName ?? 'Caravan'}`}>
      <form onSubmit={submit}>
        <label className="field"><span>Username</span><input className="input" value={username} onChange={e => setUsername(e.target.value)} autoFocus autoCapitalize="off" autoComplete="username" /></label>
        <label className="field"><span>Password</span><input className="input" type="password" value={password} onChange={e => setPassword(e.target.value)} autoComplete="current-password" /></label>
        {error && <p className="error">{error}</p>}
        <button className="btn primary lg" style={{ width: '100%' }} disabled={busy || !username}>{busy ? 'Signing in…' : 'Sign in'}</button>
      </form>
      {isNativeApp() && (
        <button className="btn ghost small" style={{ marginTop: 14 }} onClick={() => { setServerUrl(null); location.reload() }}>Change server ({serverUrl()})</button>
      )}
    </AuthCard>
  )
}
