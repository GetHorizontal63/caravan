import { useEffect, useState } from 'react'
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { Home, Library as LibraryIcon, Search, Settings, Shield, LogOut, Smartphone, BookHeart } from 'lucide-react'
import { api, isNativeApp, type Library } from '../api'
import { APP_NAME, SATCHEL_LATEST_URL } from '../brand'
import { SatchelUpdateRibbon } from './SatchelUpdate'
import { SelectionBar, SelectionProvider } from './selection'
import { useSession } from '../session'
import { ToastHost } from './ui'
import { logoFor, useAppearance } from '../theme'
import { syncOutbox } from '../offline'

export default function Layout() {
  const { user, signOut, info } = useSession()
  const nav = useNavigate()
  const loc = useLocation()
  const [q, setQ] = useState('')
  const libs = useQuery({ queryKey: ['libraries'], queryFn: () => api<Library[]>('/api/libraries') })

  const appearance = useAppearance()
  useEffect(() => { window.scrollTo(0, 0) }, [loc.pathname])
  // back online (or just started): send anything changed while offline
  useEffect(() => { void syncOutbox() }, [])

  // the Library tab goes back to the library you last looked at
  const lastId = (() => { try { return localStorage.getItem('caravan.lastLibrary') } catch { return null } })()
  const firstLib = libs.data?.find(l => String(l.id) === lastId) ?? libs.data?.[0]
  return (
    <SelectionProvider>
      <header className="app-header">
        <NavLink to="/" className="brand" title={info?.serverName}><img src={logoFor(appearance.palette)} alt="" />{APP_NAME}</NavLink>
        <nav className="top-nav">
          <NavLink to="/" end>Home</NavLink>
          {libs.data?.map(l => <NavLink key={l.id} to={`/library/${l.id}`}>{l.name}</NavLink>)}
          <NavLink to="/shelf">My Shelf</NavLink>
        </nav>
        <form className="header-search" onSubmit={e => { e.preventDefault(); if (q.trim()) nav(`/search?q=${encodeURIComponent(q.trim())}`) }}>
          <Search size={18} />
          <input className="input" placeholder="Search titles, authors, series, ISBN" value={q} onChange={e => setQ(e.target.value)} />
        </form>
        <div className="spacer" />
        {!isNativeApp() && (
          <a className="get-satchel" href={SATCHEL_LATEST_URL} target="_blank" rel="noopener" title="Get Satchel, the Android app">
            <Smartphone size={17} /><span>Get Satchel</span>
          </a>
        )}
        {user?.isAdmin && <NavLink to="/admin" className="icon-btn" title="Administration"><Shield size={20} /></NavLink>}
        <NavLink to="/settings" className="icon-btn" title="Settings"><Settings size={20} /></NavLink>
        <button className="icon-btn" title={`Sign out ${user?.username}`} onClick={() => void signOut()}><LogOut size={20} /></button>
        <span className="avatar" title={user?.username}>{user?.username?.[0]?.toUpperCase()}</span>
      </header>
      <SatchelUpdateRibbon />
      <main className="page" key={loc.pathname}>
        <Outlet />
      </main>
      <nav className="tabbar">
        <NavLink to="/" end><Home size={22} />Home</NavLink>
        <NavLink to={firstLib ? `/library/${firstLib.id}` : '/'} className={() => (loc.pathname.startsWith('/library') ? 'active' : '')}><LibraryIcon size={22} />Library</NavLink>
        <NavLink to="/shelf"><BookHeart size={22} />My Shelf</NavLink>
        <NavLink to="/search"><Search size={22} />Search</NavLink>
        <NavLink to="/settings"><Settings size={22} />Settings</NavLink>
      </nav>
      <SelectionBar />
      <ToastHost />
    </SelectionProvider>
  )
}
