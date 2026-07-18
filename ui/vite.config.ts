import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'

export default defineConfig({
  plugins: [react()],
  base: './',
  build: {
    outDir: '../web/ui',
    assetsDir: 'assets',
  },
  resolve: {
    alias: { '@': path.resolve(__dirname, './src') }
  },
  server: {
    port: 5173,
    proxy: {
      '/style_grid': 'http://127.0.0.1:8188',
      '/extensions/sd-comfyui-style-organizer/ui': {
        target: 'http://127.0.0.1:5173',
        rewrite: (p) => p.replace(
          '/extensions/sd-comfyui-style-organizer/ui', ''
        )
      }
    }
  }
})
