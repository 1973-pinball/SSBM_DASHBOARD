import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

// https://vite.dev/config/
export default defineConfig({
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
        navigateFallback: '/index.html',
      },
    }),
  ],
})
