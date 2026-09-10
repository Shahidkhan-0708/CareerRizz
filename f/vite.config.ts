import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import path from 'path'
import fs from 'fs'

import type { Plugin, ViteDevServer } from 'vite'
import type { IncomingMessage, ServerResponse } from 'http'

/**
 * In dev mode, serve `public/landing.html` at `/` so the marketing page
 * is accessible on the same port as the React console.  All other routes
 * (e.g. /login, /signup, /dashboard) still hit the SPA fallback.
 */
function landingPagePlugin(): Plugin {
  return {
    name: 'landing-page',
    configureServer(server: ViteDevServer) {
      server.middlewares.use((req: IncomingMessage, _res: ServerResponse, next: () => void) => {
        if (req.url === '/' || req.url === '/index.html') {
          const landing = path.resolve(import.meta.dirname, 'public', 'landing.html')
          if (fs.existsSync(landing)) {
            req.url = '/landing.html'
          }
        }
        next()
      })
    },
  }
}

export default defineConfig({
  plugins: [landingPagePlugin(), react(), tailwindcss()],
  resolve: {
    alias: {
      '@': path.resolve(import.meta.dirname, './src'),
    },
  },
  server: {
    port: 5174,
    proxy: {
      '/api': `http://127.0.0.1:${process.env.VITE_API_PORT || 5000}`,
      '/auth': `http://127.0.0.1:${process.env.VITE_API_PORT || 5000}`,
      '/health': `http://127.0.0.1:${process.env.VITE_API_PORT || 5000}`,
    },
  },
  build: {
    rollupOptions: {
      output: {
        // Long-cacheable vendor chunks (react, router, icons) separate from app code.
        manualChunks: (id) => {
          if (id.includes('node_modules/lucide-react')) return 'icons'
          if (id.includes('node_modules/react') || id.includes('node_modules/react-router')) return 'vendor'
          if (id.includes('node_modules/sonner')) return 'vendor'
          return undefined
        },
      },
    },
  },
})
