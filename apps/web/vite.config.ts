import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

const server = process.env.SERVER_ORIGIN ?? 'http://127.0.0.1:8080'

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/api': { target: server, changeOrigin: true },
      '/ws': { target: server, ws: true, changeOrigin: true },
    },
  },
  build: { outDir: 'dist', sourcemap: true },
})
