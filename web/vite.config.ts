import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// In dev, the API runs on :8420 (npm run dev:server) and Vite proxies to it.
export default defineConfig({
  plugins: [react()],
  base: './',
  server: {
    port: 5173,
    host: true,
    proxy: {
      '/api': 'http://localhost:8420',
      '/opds': 'http://localhost:8420',
    },
  },
  build: {
    target: 'es2022',
    chunkSizeWarningLimit: 1500,
  },
})
