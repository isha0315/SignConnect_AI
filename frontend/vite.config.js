import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  base: './',
  server: {
    host: '0.0.0.0',
    port: 5173,
    proxy: {
      '/socket.io': {
        target: 'http://127.0.0.1:5000',
        ws: true,
        changeOrigin: true
      },
      '/api': {
        target: 'http://127.0.0.1:5000',
        changeOrigin: true
      },
      '/static': {
        target: 'http://127.0.0.1:5000',
        changeOrigin: true
      },
      '/health': {
        target: 'http://127.0.0.1:5000',
        changeOrigin: true
      }
    }
  }
})
