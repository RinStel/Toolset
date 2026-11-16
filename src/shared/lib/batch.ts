/** Schedules `callback` to run after `delayMs`; returns a cancel function. */
export type BatchScheduler = (callback: () => void, delayMs: number) => () => void

export interface BatcherOptions<T> {
  /** Time window in milliseconds; the timer starts when the first item arrives. */
  windowMs: number
  /** Called with all items collected in one window (never with an empty array). */
  onFlush: (items: T[]) => void
  /** Flush early once this many items are pending. */
  maxItems?: number
  /** Defaults to `setTimeout`; injectable so tests can use fake timers or a manual queue. */
  scheduler?: BatchScheduler
}

export interface Batcher<T> {
  push(item: T): void
  /** Flushes pending items immediately (no-op when nothing is pending). */
  flush(): void
  /** Drops pending items without calling `onFlush`. */
  clear(): void
  /** Drops pending items and ignores future pushes. */
  dispose(): void
  /** Number of pending items. */
  size(): number
}

const defaultScheduler: BatchScheduler = (callback, delayMs) => {
  const timer = setTimeout(callback, delayMs)
  return () => {
    clearTimeout(timer)
  }
}

/**
 * Collects events in a time window and emits them as one batch. Used for log
 * rendering (50ms) and discard statistics (100ms), but intentionally generic.
 */
export function createBatcher<T>(options: BatcherOptions<T>): Batcher<T> {
  const schedule = options.scheduler ?? defaultScheduler
  let pending: T[] = []
  let cancelTimer: (() => void) | null = null
  let disposed = false

  function stopTimer(): void {
    if (!cancelTimer) return
    cancelTimer()
    cancelTimer = null
  }

  function flush(): void {
    stopTimer()
    if (pending.length === 0) return
    const items = pending
    pending = []
    options.onFlush(items)
  }

  return {
    push(item) {
      if (disposed) return
      pending.push(item)
      if (options.maxItems !== undefined && pending.length >= options.maxItems) {
        flush()
        return
      }
      if (cancelTimer) return
      cancelTimer = schedule(flush, options.windowMs)
    },
    flush,
    clear() {
      stopTimer()
      pending = []
    },
    dispose() {
      stopTimer()
      pending = []
      disposed = true
    },
    size() {
      return pending.length
    },
  }
}
