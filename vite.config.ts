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

// Preload the self-hosted Inter woff2 so the browser starts fetching it in parallel with
// the app CSS instead of only after CSS parses. The filename is content-hashed at build, so
// the URL is read from the emitted bundle rather than hardcoded. Build only (no-op in dev).
function preloadInterFont() {
  return {
    name: 'preload-inter-font',
    transformIndexHtml(_html: string, ctx: { bundle?: Record<string, unknown> }) {
      const bundle = ctx.bundle
      if (!bundle) return
      const fontFile = Object.keys(bundle).find((file) => /inter-.*\.woff2$/.test(file))
      if (!fontFile) return
      return [
        {
          tag: 'link',
          attrs: { rel: 'preload', as: 'font', type: 'font/woff2', crossorigin: '', href: `/${fontFile}` },
          injectTo: 'head' as const,
        },
      ]
    },
  }
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
          // Only the lazy Settings route imports Plaid Link; leaving it out of the eager
          // vendor chunk keeps it off the critical path.
          if (id.includes('react-plaid-link')) return undefined
          return 'vendor'
        },
      },
    },
  },
  plugins: [
    react(),
    tailwindcss(),
    preloadInterFont(),
    VitePWA({
      registerType: 'autoUpdate',
      // We register the service worker ourselves in main.tsx so we can also check for a
      // new version when the app returns to the foreground (see registerSW there).
      // No includeAssets: globPatterns below already precaches the public assets, and
      // listing them twice duplicated their precache entries.
      injectRegister: false,
      manifest: {
        id: '/',
        name: 'Tre',
        short_name: 'Tre',
        description: 'See what spending today could become if invested, and save toward a home.',
        start_url: '/',
        scope: '/',
        display: 'standalone',
        theme_color: '#f5f5f7',
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
        // Never let the SW hijack Firebase reserved paths (/__/auth/* et al).
        navigateFallbackDenylist: [/^\/__\//],
        cleanupOutdatedCaches: true,
        maximumFileSizeToCacheInBytes: 4 * 1024 * 1024,
        // A new version activates and claims open clients immediately, so an installed
        // home-screen app never serves a stale shell once the update has downloaded. The
        // page then reloads to the fresh content (see the controllerchange handler in
        // main.tsx).
        skipWaiting: true,
        clientsClaim: true,
      },
    }),
  ],
})
