import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { HashRouter } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { SessionProvider } from './session'
import App from './App'
import '@fontsource-variable/inter'
import '@fontsource-variable/fraunces'
import '@fontsource-variable/literata'
import './styles.css'
import { applyAppearance } from './theme'
import { installNativeBack } from './nativeBack'
import { startOfflineSync } from './offline'

// before the first paint, so there's no flash of the wrong colours
applyAppearance()
// Satchel: Android back button / gesture navigates instead of closing the app
installNativeBack()

const queryClient = new QueryClient({
  defaultOptions: { queries: { staleTime: 30_000, retry: 1, refetchOnWindowFocus: false } },
})

// changes made offline (position, bookmarks, highlights, notes) are sent when the server is reachable again
startOfflineSync(() => void queryClient.invalidateQueries())

// Hash routing works identically when served by the server, from file:// in Electron, and inside Capacitor.
createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <SessionProvider>
        <HashRouter>
          <App />
        </HashRouter>
      </SessionProvider>
    </QueryClientProvider>
  </StrictMode>,
)
