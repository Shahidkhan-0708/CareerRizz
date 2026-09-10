import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import path from 'path'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  server: {
    port: 5173,
    proxy: {
      '/api': `http://127.0.0.1:${process.env.VITE_API_PORT || 5000}`,
      '/auth': `http://127.0.0.1:${process.env.VITE_API_PORT || 5000}`,
      '/health': `http://127.0.0.1:${process.env.VITE_API_PORT || 5000}`,
      '/webhooks': `http://127.0.0.1:${process.env.VITE_API_PORT || 5000}`,
    },
  },
})
