import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    host: '127.0.0.1',
    port: 5174,
    proxy: {
      '/api': {
        target: 'http://127.0.0.1:3002',
        configure(proxy) {
          proxy.on('error', (_error, _request, response) => {
            if (!response.headersSent) {
              response.writeHead(502, { 'Content-Type': 'application/json' })
            }

            response.end(JSON.stringify({
              error: 'API server is not running.',
              detail: 'Start the app with npm run dev so the backend and frontend run together.',
            }))
          })
        },
      },
    },
  },
})
