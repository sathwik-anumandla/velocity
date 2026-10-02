import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  base: './',
  server: {
    port: 5173,
    proxy: {
      '/chat': 'http://localhost:8001',
      '/sessions': 'http://localhost:8001',
      '/search': 'http://localhost:8001',
      '/health': 'http://localhost:8001',
      '/api': 'http://localhost:8001',
      '/memory': 'http://localhost:8001',
    }
  }
})
