import { lazy, Suspense } from 'react'
import { Navigate, Route, Routes, useParams, useSearchParams } from 'react-router-dom'
import { useSession } from './session'
import Layout from './components/Layout'
import { Spinner } from './components/ui'
import ConnectPage from './pages/Connect'
import SetupPage from './pages/Setup'
import LoginPage from './pages/Login'
import HomePage from './pages/Home'
import LibraryPage from './pages/Library'
import BookPage from './pages/Book'
import SearchPage from './pages/Search'
import SettingsPage from './pages/Settings'
import CollectionPage from './pages/Collection'
import SeriesPage from './pages/Series'
import ShelfPage from './pages/Shelf'
import OfflineApp from './pages/Offline'

// The reader pulls in foliate-js and pdf.js; admin is rarely used. Load both on demand.
const ReaderPage = lazy(() => import('./reader/ReaderPage'))
const AdminPage = lazy(() => import('./admin/AdminPage'))

/** A fresh reader per book: switching books must not carry over engine, position or panels. */
function ReaderRoute() {
  const { id } = useParams()
  const [params] = useSearchParams()
  return <ReaderPage key={`${id}:${params.get('file') ?? ''}`} />
}

export default function App() {
  const { status, user } = useSession()

  if (status === 'loading') return <div className="center-screen"><Spinner /></div>
  if (status === 'connect' || status === 'unreachable') return <ConnectPage unreachable={status === 'unreachable'} />
  if (status === 'offline') return <Suspense fallback={<div className="center-screen"><Spinner /></div>}><OfflineApp reader={<ReaderRoute />} /></Suspense>
  if (status === 'setup') return <SetupPage />
  if (status === 'login') return <LoginPage />

  return (
    <Suspense fallback={<div className="center-screen"><Spinner /></div>}>
      <Routes>
        <Route path="/read/:id" element={<ReaderRoute />} />
        <Route element={<Layout />}>
          <Route index element={<HomePage />} />
          <Route path="library/:id" element={<LibraryPage />} />
          <Route path="book/:id" element={<BookPage />} />
          <Route path="search" element={<SearchPage />} />
          <Route path="collection/:id" element={<CollectionPage />} />
          <Route path="series/:name" element={<SeriesPage />} />
          <Route path="settings" element={<SettingsPage />} />
          <Route path="shelf" element={<ShelfPage />} />
          <Route path="admin/*" element={user?.isAdmin ? <AdminPage /> : <Navigate to="/" />} />
          <Route path="*" element={<Navigate to="/" />} />
        </Route>
      </Routes>
    </Suspense>
  )
}
