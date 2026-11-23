import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import path from 'path'

export default defineConfig({
  plugins: [react()],
  base: './',
  test: {
    setupFiles: ['./vitest.setup.ts'],
    // Host tests import web/js/style_grid.js, which imports ComfyUI's frontend modules.
    alias: {
      '/scripts/app.js': path.resolve(__dirname, './test-stubs/comfy-app.js'),
      '/scripts/api.js': path.resolve(__dirname, './test-stubs/comfy-api.js'),
    },
  },
  build: {
    outDir: '../web/ui',
    assetsDir: 'assets',
    emptyOutDir: true,
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
