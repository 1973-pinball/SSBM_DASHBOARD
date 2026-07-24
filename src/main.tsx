import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
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
