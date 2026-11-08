import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react'
import { api, getToken, needsServerUrl, setToken, type User } from './api'

interface SystemInfo { serverName: string; version: string; setupComplete: boolean }

type Status = 'loading' | 'connect' | 'unreachable' | 'setup' | 'login' | 'ready'

interface Session {
  status: Status
  user: User | null
  info: SystemInfo | null
  signIn(token: string, user: User): void
  signOut(): Promise<void>
  refresh(): Promise<void>
  setUser(u: User): void
}

const Ctx = createContext<Session>(null!)
export const useSession = () => useContext(Ctx)

export function SessionProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<Status>('loading')
  const [user, setUser] = useState<User | null>(null)
  const [info, setInfo] = useState<SystemInfo | null>(null)

  const refresh = useCallback(async () => {
    if (needsServerUrl()) { setStatus('connect'); return }
    let sys: SystemInfo
    try {
      sys = await api<SystemInfo>('/api/system/info')
      setInfo(sys)
    } catch {
      setStatus('unreachable')
      return
    }
    if (!sys.setupComplete) { setStatus('setup'); return }
    if (!getToken()) { setStatus('login'); return }
    try {
      setUser(await api<User>('/api/auth/me'))
      setStatus('ready')
    } catch {
      setStatus('login')
    }
  }, [])

  useEffect(() => {
    void refresh()
    const onOut = () => { setUser(null); setStatus('login') }
    window.addEventListener('jr:signed-out', onOut)
    return () => window.removeEventListener('jr:signed-out', onOut)
  }, [refresh])

  const value: Session = {
    status, user, info, refresh, setUser,
    signIn(token, u) { setToken(token); setUser(u); setStatus('ready') },
    async signOut() {
      try { await api('/api/auth/logout', { method: 'POST' }) } catch { /* already gone */ }
      setToken(null)
      setUser(null)
      setStatus('login')
    },
  }
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}
