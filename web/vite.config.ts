import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { execFileSync } from 'node:child_process'

let revision = process.env.APP_REVISION
if (!revision) {
  try { revision = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim() }
  catch { revision = 'unknown' }
}

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  define: { __APP_REVISION__: JSON.stringify(revision) },
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
