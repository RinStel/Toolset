import { fileURLToPath, URL } from 'node:url'

import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'

import chunkReport from './scripts/vite-chunk-report.ts'

// https://vite.dev/config/
export default defineConfig({
  base: './',
  plugins: [vue(), chunkReport()],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  build: {
    manifest: true,
  },
  worker: {
    format: 'es',
  },
})
