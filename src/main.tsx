import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
// Self-hosted fonts (was Google Fonts): same-origin, hashed, immutable-cached.
import '@fontsource/chakra-petch/500.css'
import '@fontsource/chakra-petch/600.css'
import '@fontsource/ibm-plex-mono/400.css'
import '@fontsource/ibm-plex-mono/600.css'
import '@fontsource/inter/400.css'
import '@fontsource/inter/500.css'
import '@fontsource/inter/600.css'
import './index.css'
import App from './App.tsx'

// Views are lazy-loaded, so a tab left open across a deploy 404s when it
// tries to fetch a chunk whose hashed filename no longer exists. Vite fires
// vite:preloadError for exactly this; reload once to pick up the new build.
// The timestamp guard stops a reload loop if a chunk is genuinely missing.
window.addEventListener('vite:preloadError', (event) => {
  const last = Number(sessionStorage.getItem('chunk-reload-at') ?? 0)
  if (Date.now() - last < 30_000) return // let the error surface instead of looping
  sessionStorage.setItem('chunk-reload-at', String(Date.now()))
  event.preventDefault()
  window.location.reload()
})

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
