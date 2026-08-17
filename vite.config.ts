import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

// https://vite.dev/config/
export default defineConfig({
  // Stamp the build with the commit it came from. Vercel sets this; locally it
  // reads "dev". The footer renders it, which is the only reliable way to tell
  // whether a browser is running the latest deploy — a precached shell can
  // outlive several of them, and asset hashes aren't something you can eyeball.
  define: {
    __BUILD_ID__: JSON.stringify(
      process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 7) ?? 'dev',
    ),
  },
  plugins: [
    react(),
    VitePWA({
      // New deploys activate on next load instead of serving a stale shell
      // forever; pairs with the vite:preloadError reload guard in main.tsx.
      registerType: 'autoUpdate',
      manifest: {
        name: 'SSBM Dashboard',
        short_name: 'SSBM Dash',
        description:
          'Slippi replay stats, parsed in your browser — win rates, matchups, and execution trends.',
        display: 'standalone',
        background_color: '#121022',
        theme_color: '#121022',
        icons: [
          { src: '/pwa-192x192.png', sizes: '192x192', type: 'image/png' },
          { src: '/pwa-512x512.png', sizes: '512x512', type: 'image/png' },
          { src: '/pwa-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        // Precache every build asset (all views are lazy chunks — offline needs
        // them all); fonts are hashed woff2 files, safe to cache immutably.
        globPatterns: ['**/*.{js,css,html,svg,png,woff2}'],
        // public/share holds the generated share images — multi-megabyte GIFs
        // plus their posters. They're for sending to other people, not for
        // running the app, so they stay out of the offline bundle.
        globIgnores: ['**/share/**'],
        navigateFallback: '/index.html',
      },
    }),
  ],
})
