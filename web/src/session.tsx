import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react'
import { api, getToken, needsServerUrl, setToken, type User } from './api'

interface SystemInfo { serverName: string; version: string; setupComplete: boolean }

type Status = 'loading' | 'connect' | 'unreachable' | 'offline' | 'setup' | 'login' | 'ready'

const USER_KEY = 'caravan.lastUser'
const cachedUser = (): User | null => { try { return JSON.parse(localStorage.getItem(USER_KEY) ?? 'null') } catch { return null } }
const cacheUser = (u: User | null) => { try { u ? localStorage.setItem(USER_KEY, JSON.stringify(u)) : localStorage.removeItem(USER_KEY) } catch { /* private mode */ } }

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
      // signed in before? then read what's saved on this device until the server is back
      const last = cachedUser()
      if (getToken() && last) { setUser(last); setStatus('offline'); return }
      setStatus('unreachable')
      return
    }
    if (!sys.setupComplete) { setStatus('setup'); return }
    if (!getToken()) { setStatus('login'); return }
    try {
      const me = await api<User>('/api/auth/me')
      cacheUser(me)
      setUser(me)
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
      cacheUser(null)
      setUser(null)
      setStatus('login')
    },
  }
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}
