/**
 * Repeated sending scheduler (plan §6.6).
 *
 * The bytes are snapshotted when the task starts. A `setTimeout` chain waits for
 * the previous write to finish and then waits `intervalMs`, so a slow write never
 * piles up extra frames.
 */

/** See plan §6.6. `count = null` sends forever. */
export interface RepeatOptions {
  bytes: Uint8Array
  /** 10–60000 ms. */
  intervalMs: number
  count: number | null
}

/** Status reported to the UI while running. */
export interface RepeatStatus {
  sent: number
  count: number | null
  intervalMs: number
}

/** Why a repeat task stopped. */
export type RepeatStopReason = 'user' | 'count' | 'write-error' | 'not-open' | 'disposed'

/** Minimal timer functions so tests can inject their own. */
export interface RepeatScheduler {
  setTimeout(callback: () => void, delayMs: number): ReturnType<typeof setTimeout>
  clearTimeout(handle: ReturnType<typeof setTimeout>): void
}

export interface RepeatRunnerOptions {
  send(bytes: Uint8Array): Promise<void>
  /** Returns false when the session is no longer open. */
  isActive(): boolean
  onStatus?(status: RepeatStatus): void
  onStop?(reason: RepeatStopReason): void
  scheduler?: RepeatScheduler
}

export interface RepeatRunner {
  start(options: RepeatOptions): void
  /** Stops the task; `onStop` is called when it was running. */
  stop(): void
  readonly status: RepeatStatus | null
  readonly running: boolean
}

/** Bounds from plan §6.6. */
export const REPEAT_INTERVAL_MIN = 10
export const REPEAT_INTERVAL_MAX = 60_000

const defaultScheduler: RepeatScheduler = {
  setTimeout(callback, delayMs) {
    return setTimeout(callback, delayMs)
  },
  clearTimeout(handle) {
    clearTimeout(handle)
  },
}

function validateOptions(options: RepeatOptions): void {
  if (!(options.bytes instanceof Uint8Array)) {
    throw new RangeError('重复发送的内容必须是字节数组')
  }
  if (
    !Number.isInteger(options.intervalMs) ||
    options.intervalMs < REPEAT_INTERVAL_MIN ||
    options.intervalMs > REPEAT_INTERVAL_MAX
  ) {
    throw new RangeError(
      `重复间隔必须是 ${REPEAT_INTERVAL_MIN}–${REPEAT_INTERVAL_MAX} 之间的整数毫秒`,
    )
  }
  if (options.count !== null && (!Number.isInteger(options.count) || options.count < 1)) {
    throw new RangeError('重复次数必须是正整数或 null')
  }
}

/** Creates one repeat task slot; a runner handles one task at a time. */
export function createRepeatRunner(options: RepeatRunnerOptions): RepeatRunner {
  const scheduler = options.scheduler ?? defaultScheduler
  let stopped = true
  let sent = 0
  let intervalMs = REPEAT_INTERVAL_MIN
  let count: number | null = null
  let snapshot: Uint8Array = new Uint8Array(0)

  let timer: ReturnType<typeof setTimeout> | null = null
  let wake: (() => void) | null = null

  function clearWait(): void {
    if (timer !== null) {
      scheduler.clearTimeout(timer)
      timer = null
    }
    const resolver = wake
    wake = null
    resolver?.()
  }

  function wait(delayMs: number): Promise<void> {
    return new Promise<void>((resolve) => {
      let settled = false
      const finish = (): void => {
        if (settled) return
        settled = true
        timer = null
        wake = null
        resolve()
      }
      wake = finish
      timer = scheduler.setTimeout(finish, delayMs)
    })
  }

  function stop(reason: RepeatStopReason): void {
    if (stopped) return
    stopped = true
    clearWait()
    options.onStatus?.(statusValue())
    options.onStop?.(reason)
  }

  function statusValue(): RepeatStatus {
    return { sent, count, intervalMs }
  }

  async function run(): Promise<void> {
    while (!stopped) {
      if (!options.isActive()) {
        stop('not-open')
        return
      }
      try {
        await options.send(snapshot)
      } catch {
        stop('write-error')
        return
      }
      if (stopped) return
      sent += 1
      options.onStatus?.(statusValue())
      if (count !== null && sent >= count) {
        stop('count')
        return
      }
      await wait(intervalMs)
    }
  }

  return {
    start(input) {
      validateOptions(input)
      if (!stopped) throw new Error('重复发送任务已在运行')
      snapshot = Uint8Array.from(input.bytes)
      intervalMs = input.intervalMs
      count = input.count
      sent = 0
      stopped = false
      options.onStatus?.(statusValue())
      void run()
    },
    stop() {
      stop('user')
    },
    get status(): RepeatStatus | null {
      return stopped ? null : statusValue()
    },
    get running(): boolean {
      return !stopped
    },
  }
}
