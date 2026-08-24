import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { registerSW } from 'virtual:pwa-register'
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

/**
 * The service worker precaches the whole shell, so a tab that stays open never
 * sees a new deploy: it keeps serving what it cached, however far behind that
 * falls. registerType 'autoUpdate' fixes this on the *next* load, which is no
 * help to a dashboard left open all evening — hence an explicit poll.
 *
 * Only while visible and online: a backgrounded tab has nobody to show the new
 * build to, and an offline check just fails. Picking up a new worker triggers
 * the reload autoUpdate already performs, so this changes when that happens,
 * not what happens.
 */
const UPDATE_CHECK_MS = 60 * 60 * 1000

registerSW({
  immediate: true,
  // Keep an update from reloading through an active folder parse. App owns the
  // user-facing prompt and only offers the reload once local work is idle.
  onNeedReload() {
    window.dispatchEvent(new CustomEvent('ssbm:update-ready'))
  },
  onOfflineReady() {
    window.dispatchEvent(new CustomEvent('ssbm:offline-ready'))
  },
  onRegisteredSW(_swUrl, registration) {
    if (!registration) return
    setInterval(() => {
      if (document.visibilityState !== 'visible' || !navigator.onLine) return
      void registration.update()
    }, UPDATE_CHECK_MS)
  },
})

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
