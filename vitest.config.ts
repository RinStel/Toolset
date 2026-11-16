import { fileURLToPath } from 'node:url'

import vue from '@vitejs/plugin-vue'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  plugins: [vue()],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  test: {
    // 默认 node 环境；需要 DOM 的测试文件在文件头用 `// @vitest-environment happy-dom`。
    environment: 'node',
    // 沙箱环境禁止 child_process.fork 的管道通信（spawn EPERM），使用 worker_threads 池。
    pool: 'threads',
    // Node 25+/26+ 默认挂载未初始化的实验性 WebStorage getter，会阻止 happy-dom 注入 window.localStorage。
    execArgv: ['--no-experimental-webstorage'],
    root: fileURLToPath(new URL('./', import.meta.url)),
    include: [
      'tests/unit/**/*.test.ts',
      'tests/architecture/**/*.test.ts',
      'tests/components/**/*.test.ts',
    ],
    exclude: ['**/node_modules/**', '**/dist/**', 'tests/e2e/**'],
    testTimeout: 15000,
    hookTimeout: 15000,
  },
})
