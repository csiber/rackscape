import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// In dev, /api is proxied to the Rackscape server (npm run server) when it runs.
export default defineConfig({
  // relative asset URLs: the same build works at /, under a sub-path or on GitHub Pages
  base: './',
  plugins: [react()],
  server: {
    proxy: { '/api': { target: 'http://127.0.0.1:8080', changeOrigin: false } },
  },
  build: { chunkSizeWarningLimit: 1600 },
})
