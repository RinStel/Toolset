import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { defineConfig, devices } from '@playwright/test'

const rootDir = fileURLToPath(new URL('./', import.meta.url))
const localLibDir = path.join(rootDir, '.pnpm-cache/pw-deps/root/usr/lib/x86_64-linux-gnu')
const localShareDir = path.join(rootDir, '.pnpm-cache/pw-deps/root/usr/share')
if (fs.existsSync(localLibDir)) {
  const nssDir = path.join(localLibDir, 'nss')
  const extraLibPath = fs.existsSync(nssDir) ? `${localLibDir}:${nssDir}` : localLibDir
  process.env.LD_LIBRARY_PATH = process.env.LD_LIBRARY_PATH
    ? `${extraLibPath}:${process.env.LD_LIBRARY_PATH}`
    : extraLibPath
}
if (fs.existsSync(localShareDir)) {
  if (!process.env.XDG_DATA_HOME) {
    process.env.XDG_DATA_HOME = localShareDir
  }
  const alsaDir = path.join(localShareDir, 'alsa')
  if (fs.existsSync(alsaDir) && !process.env.ALSA_CONFIG_DIR) {
    process.env.ALSA_CONFIG_DIR = alsaDir
  }
}

/**
 * Playwright 配置。只使用 Chromium；e2e 针对 `pnpm build` 后的静态产物运行。
 * 详见 plan.md §4.3。
 */
export default defineConfig({
  testDir: './tests/e2e',
  outputDir: './test-results',
  timeout: 120 * 1000,
  expect: { timeout: 10 * 1000 },
  forbidOnly: Boolean(process.env.CI),
  retries: 0,
  workers: 1,
  fullyParallel: false,
  reporter: [['list']],
  use: {
    baseURL: 'http://127.0.0.1:4173',
    actionTimeout: 15 * 1000,
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
  webServer: {
    // 显式绑定 127.0.0.1：Windows 上 `localhost` 可能只解析到 IPv6，导致下面的 url 探测超时。
    command: 'pnpm build && pnpm preview --host 127.0.0.1 --port 4173 --strictPort',
    url: 'http://127.0.0.1:4173',
    reuseExistingServer: false,
    timeout: 180 * 1000,
    stdout: 'pipe',
    stderr: 'pipe',
  },
})
