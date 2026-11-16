/**
 * 自定义控件调用保护（plan §6.10「调用保护」）。
 *
 * 宿主在调用自定义控件的生命周期方法（mount/update/propsChanged/resize/destroy）时
 * 统一经过本对象：
 *
 * - 每次调用都 try/catch 并用可注入的时钟计时；
 * - 10 秒内 3 次异常、单次超过 200ms、最近 2 秒 update 平均超过 16ms 时停用；
 * - 停用或卸载时，受保护地调用实例的 `destroy`（清空 DOM 由宿主负责）；
 * - `send`/`sendBytes` 共用每实例每秒 50 次的限速。
 *
 * 窗口都按注入的 `now()` 计算，不使用定时器，因此可以用假时钟测试。
 */

import type { CustomWidgetInstance } from '../types'

/** 受保护的生命周期调用类型。 */
export type CustomWidgetCallKind = 'mount' | 'update' | 'propsChanged' | 'resize' | 'destroy'

/** 一次异常的详细信息。 */
export interface CallGuardErrorInfo {
  kind: CustomWidgetCallKind
  message: string
  /** 发生时间（`now()` 的刻度）。 */
  at: number
  /** 本次调用耗时。 */
  durationMs: number
  /** 当前异常窗口内的累计次数（含本次）。 */
  count: number
}

/** 停用原因；UI 按文案显示（plan §9）。 */
export type CallGuardDisabledReason =
  | { reason: 'errors'; count: number; at: number }
  | { reason: 'slowCall'; call: CustomWidgetCallKind; durationMs: number; at: number }
  | { reason: 'slowAverage'; averageMs: number; count: number; at: number }

export interface CallGuardOptions {
  /** 时钟（毫秒）；默认 `performance.now()`，测试可注入假时钟。 */
  now?: () => number
  /** 异常计数窗口，默认 10000ms。 */
  errorWindowMs?: number
  /** 窗口内允许的异常次数，达到即停用，默认 3。 */
  errorLimit?: number
  /** 单次调用耗时上限，默认 200ms。 */
  slowCallMs?: number
  /** update 平均耗时窗口，默认 2000ms。 */
  averageWindowMs?: number
  /** update 平均耗时上限，默认 16ms。 */
  averageLimitMs?: number
  /** 发送限速窗口，默认 1000ms。 */
  sendWindowMs?: number
  /** 发送限速次数，默认 50。 */
  sendLimit?: number
  /** 每次异常（含 destroy 中的异常）都会回调，供 UI 显示错误浮层。 */
  onError?: (info: CallGuardErrorInfo) => void
  /** 实例被停用时回调，供 UI 显示「已停用」浮层。 */
  onDisabled?: (reason: CallGuardDisabledReason) => void
  /** `reset()` 重新启用时回调。 */
  onEnabled?: () => void
}

export interface CallGuard {
  /** 是否已停用。 */
  readonly disabled: boolean
  /** 停用原因；未停用时为 `undefined`。 */
  readonly disabledReason: CallGuardDisabledReason | undefined
  /** 最近一次异常；`reset()` 后清空。 */
  readonly lastError: CallGuardErrorInfo | undefined
  /** 绑定宿主创建的实例；停用时会调用它的 destroy。 */
  attach(instance: CustomWidgetInstance | undefined): void
  /** 受保护地执行一次生命周期调用；已停用时返回 `undefined` 且不执行。 */
  call<T>(kind: CustomWidgetCallKind, fn: () => T): T | undefined
  /** 发送限速：每秒最多 50 次，超出时 reject「发送过于频繁」。 */
  send<T>(fn: () => Promise<T> | T): Promise<T>
  /** 重新启用：清除停用状态、异常计数和耗时统计；宿主需要重新 mount。 */
  reset(): void
  /** 卸载：受保护地调用实例的 destroy 并解除绑定。 */
  destroy(): void
}

function defaultNow(): number {
  if (typeof performance !== 'undefined' && typeof performance.now === 'function') {
    return performance.now()
  }
  return Date.now()
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/** 创建调用保护器。 */
export function createCallGuard(options: CallGuardOptions = {}): CallGuard {
  const now = options.now ?? defaultNow
  const errorWindowMs = options.errorWindowMs ?? 10_000
  const errorLimit = Math.max(1, options.errorLimit ?? 3)
  const slowCallMs = options.slowCallMs ?? 200
  const averageWindowMs = options.averageWindowMs ?? 2000
  const averageLimitMs = options.averageLimitMs ?? 16
  const sendWindowMs = options.sendWindowMs ?? 1000
  const sendLimit = Math.max(1, options.sendLimit ?? 50)

  let disabled = false
  let disabledReason: CallGuardDisabledReason | undefined
  let lastError: CallGuardErrorInfo | undefined
  let attached: CustomWidgetInstance | undefined

  const errorTimes: number[] = []
  const updateDurations: Array<{ at: number; duration: number }> = []
  const sendTimes: number[] = []

  function reportError(
    kind: CustomWidgetCallKind,
    error: unknown,
    durationMs: number,
    at: number,
  ): void {
    errorTimes.push(at)
    while (errorTimes.length > 0 && at - (errorTimes[0] ?? at) > errorWindowMs) {
      errorTimes.shift()
    }
    lastError = { kind, message: errorMessage(error), at, durationMs, count: errorTimes.length }
    options.onError?.(lastError)
  }

  function safeDestroy(instance: CustomWidgetInstance | undefined): void {
    if (!instance?.destroy) return
    const started = now()
    try {
      instance.destroy()
    } catch (error) {
      options.onError?.({
        kind: 'destroy',
        message: errorMessage(error),
        at: now(),
        durationMs: now() - started,
        count: errorTimes.length,
      })
    }
  }

  function disable(reason: CallGuardDisabledReason): void {
    if (disabled) return
    disabled = true
    disabledReason = reason
    const instance = attached
    attached = undefined
    safeDestroy(instance)
    options.onDisabled?.(reason)
  }

  function pruneUpdateDurations(at: number): void {
    while (updateDurations.length > 0 && at - (updateDurations[0]?.at ?? at) > averageWindowMs) {
      updateDurations.shift()
    }
  }

  function averageUpdateDuration(): number | undefined {
    if (updateDurations.length === 0) return undefined
    let total = 0
    for (const entry of updateDurations) total += entry.duration
    return total / updateDurations.length
  }

  function call<T>(kind: CustomWidgetCallKind, fn: () => T): T | undefined {
    if (disabled) return undefined
    const started = now()
    let result: T | undefined
    let thrown: unknown
    let didThrow = false
    try {
      result = fn()
    } catch (error) {
      didThrow = true
      thrown = error
    }
    const at = now()
    const durationMs = at - started

    if (kind === 'update') {
      updateDurations.push({ at, duration: durationMs })
      pruneUpdateDurations(at)
    }

    if (didThrow) {
      reportError(kind, thrown, durationMs, at)
      if (errorTimes.length >= errorLimit)
        disable({ reason: 'errors', count: errorTimes.length, at })
    }
    if (!disabled && durationMs > slowCallMs) {
      disable({ reason: 'slowCall', call: kind, durationMs, at })
    }
    if (!disabled && kind === 'update') {
      const average = averageUpdateDuration()
      if (average !== undefined && average > averageLimitMs) {
        disable({ reason: 'slowAverage', averageMs: average, count: updateDurations.length, at })
      }
    }

    return didThrow ? undefined : result
  }

  return {
    get disabled(): boolean {
      return disabled
    },
    get disabledReason(): CallGuardDisabledReason | undefined {
      return disabledReason
    },
    get lastError(): CallGuardErrorInfo | undefined {
      return lastError
    },
    attach(instance: CustomWidgetInstance | undefined): void {
      attached = instance
    },
    call,
    send<T>(fn: () => Promise<T> | T): Promise<T> {
      const at = now()
      while (sendTimes.length > 0 && at - (sendTimes[0] ?? at) >= sendWindowMs) {
        sendTimes.shift()
      }
      if (sendTimes.length >= sendLimit) {
        return Promise.reject(new Error('发送过于频繁'))
      }
      sendTimes.push(at)
      return Promise.resolve().then(fn)
    },
    reset(): void {
      const wasDisabled = disabled
      disabled = false
      disabledReason = undefined
      lastError = undefined
      errorTimes.length = 0
      updateDurations.length = 0
      sendTimes.length = 0
      attached = undefined
      if (wasDisabled) options.onEnabled?.()
    },
    destroy(): void {
      const instance = attached
      attached = undefined
      safeDestroy(instance)
    },
  }
}
