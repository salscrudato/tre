import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { VitePWA } from 'vite-plugin-pwa'

// Vite configuration for Tre. Tailwind v4 runs through its dedicated Vite plugin.
// vite-plugin-pwa makes the app installable and precaches the shell; Firestore data
// stays live through its own offline persistence, not the service worker.

// Cross-Origin-Opener-Policy must let the Google sign-in popup talk back to the
// opener. The browser default "same-origin" isolates the popup so Firebase cannot
// read window.closed, which silently breaks signInWithPopup on localhost.
// "same-origin-allow-popups" keeps the page isolated from other sites while letting
// our own popup communicate; COEP stays unsafe-none so the SDK's requests are not
// blocked. Mirrored in firebase.json for the deployed site.
const authPopupHeaders = {
  'Cross-Origin-Opener-Policy': 'same-origin-allow-popups',
  'Cross-Origin-Embedder-Policy': 'unsafe-none',
}

export default defineConfig({
  server: { headers: authPopupHeaders },
  preview: { headers: authPopupHeaders },
  build: {
    rollupOptions: {
      output: {
        // Split the heavy Firebase SDK into its own cacheable chunks. React,
        // react-dom, and scheduler must stay together (splitting them breaks the
        // scheduler), so everything else from node_modules shares one vendor chunk.
        manualChunks(id) {
          if (!id.includes('node_modules')) return undefined
          if (id.includes('@firebase/firestore') || id.includes('firebase/firestore')) {
            return 'firebase-firestore'
          }
          if (id.includes('firebase') || id.includes('@firebase') || id.includes('protobufjs')) {
            return 'firebase-core'
          }
          return 'vendor'
        },
      },
    },
  },
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['favicon.svg', 'apple-touch-icon-180.png'],
      manifest: {
        id: '/',
        name: 'Tre',
        short_name: 'Tre',
        description: 'See what spending today could become if invested, and save toward a home.',
        start_url: '/',
        scope: '/',
        display: 'standalone',
        theme_color: '#1fa85a',
        background_color: '#f5f5f7',
        icons: [
          { src: 'icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,woff2,png,svg,ico,webmanifest}'],
        navigateFallback: '/index.html',
        cleanupOutdatedCaches: true,
        maximumFileSizeToCacheInBytes: 4 * 1024 * 1024,
      },
    }),
  ],
})
