import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    // Local-dev stand-in for the production /api/wind serverless function: forward
    // to MET Norway with the required User-Agent so dev behaves like prod.
    proxy: {
      '/api/wind': {
        target: 'https://api.met.no',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api\/wind/, '/weatherapi/locationforecast/2.0/compact'),
        headers: { 'User-Agent': 'cph-wind/1.0 (+https://github.com/djboy26/cph-wind)' },
      },
    },
  },
})
