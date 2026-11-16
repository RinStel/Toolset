import { createApp } from 'vue'
import { createPinia } from 'pinia'

import './shared/ui/styles/base.css'

import App from './App.vue'
import router from './app/router'
import { initAppearance } from './app/stores/appearance'
import { onStorageIssue, type StorageIssueKind } from './shared/lib/storage/namespace'
import { toast } from './shared/ui/services/toast'

/** Unhandled errors are de-duplicated within this window (plan §7.2). */
const DUPLICATE_ERROR_WINDOW = 5000

const recentErrors = new Map<string, number>()

function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message || error.name
  if (typeof error === 'string') return error
  try {
    return JSON.stringify(error)
  } catch {
    return String(error)
  }
}

function reportUnhandled(error: unknown): void {
  const message = errorMessage(error)
  // Chromium/Firefox 在同一布局周期内二次触发 ResizeObserver 时会抛此良性通知，并非应用故障。
  if (!message || message.includes('ResizeObserver loop')) return
  console.error('[unhandled]', error)
  const now = Date.now()
  const previous = recentErrors.get(message)
  if (previous !== undefined && now - previous < DUPLICATE_ERROR_WINDOW) return
  recentErrors.set(message, now)
  if (recentErrors.size > 100) {
    for (const [key, at] of recentErrors) {
      if (now - at >= DUPLICATE_ERROR_WINDOW) recentErrors.delete(key)
    }
  }
  toast.show({ type: 'error', message: `发生未处理的错误：${message}` })
}

/** Toast copy for structured storage issues (plan §7.2, §6.3). */
const STORAGE_ISSUE_MESSAGES: Record<StorageIssueKind, string> = {
  corrupt: '本地数据已损坏，已恢复默认值（原数据已备份）',
  quota: '本地存储空间不足，本次修改仅在当前页面有效',
  idb: '浏览器数据库不可用，已降级为内存存储',
}

onStorageIssue((issue) => {
  console.error('[storage]', issue)
  toast.show({
    type: issue.kind === 'corrupt' ? 'error' : 'warn',
    message: STORAGE_ISSUE_MESSAGES[issue.kind],
  })
})

// Register the appearance ideally before first paint side effects; main is the
// first place that has both the storage handler and the DOM available.
initAppearance()

const app = createApp(App)

app.config.errorHandler = (error, _instance, info) => {
  console.error(`[vue] ${info}`)
  reportUnhandled(error)
}

app.use(createPinia())
app.use(router)

window.addEventListener('error', (event) => {
  reportUnhandled(event.error ?? event.message)
})

window.addEventListener('unhandledrejection', (event) => {
  reportUnhandled(event.reason)
})

app.mount('#app')
