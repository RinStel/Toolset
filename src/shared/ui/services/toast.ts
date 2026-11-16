import { shallowReactive } from 'vue'

export type ToastType = 'info' | 'success' | 'warn' | 'error'

export interface ToastOptions {
  type: ToastType
  message: string
  /**
   * Visible duration in milliseconds. Defaults to 4000, or 8000 for `error`
   * toasts. `0` keeps the toast until it is dismissed manually.
   */
  duration?: number
}

export interface ToastItem {
  id: number
  type: ToastType
  message: string
}

/** At most this many toasts are visible at the same time (plan §7.3). */
export const MAX_TOASTS = 5
export const DEFAULT_TOAST_DURATION = 4000
export const ERROR_TOAST_DURATION = 8000

const items = shallowReactive<ToastItem[]>([])
const timers = new Map<number, ReturnType<typeof setTimeout>>()
let nextId = 1

/** Reactive list rendered by `ServiceHost.vue`; treat it as read-only. */
export const toasts: readonly ToastItem[] = items

function clearTimer(id: number): void {
  const timer = timers.get(id)
  if (timer === undefined) return
  clearTimeout(timer)
  timers.delete(id)
}

function dismiss(id: number): void {
  clearTimer(id)
  const index = items.findIndex((item) => item.id === id)
  if (index >= 0) items.splice(index, 1)
}

function show(options: ToastOptions): number {
  const id = nextId
  nextId += 1
  items.push({ id, type: options.type, message: options.message })
  while (items.length > MAX_TOASTS) {
    const oldest = items[0]
    if (!oldest) break
    dismiss(oldest.id)
  }
  const duration =
    options.duration ?? (options.type === 'error' ? ERROR_TOAST_DURATION : DEFAULT_TOAST_DURATION)
  if (duration > 0) {
    timers.set(
      id,
      setTimeout(() => {
        dismiss(id)
      }, duration),
    )
  }
  return id
}

function clear(): void {
  for (const item of [...items]) dismiss(item.id)
}

/** Shared toast service; rendered by `ServiceHost.vue`. */
export const toast = {
  show,
  dismiss,
  clear,
}
