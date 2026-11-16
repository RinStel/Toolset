/**
 * 仪表盘刷新调度（plan §8.10「刷新调度」）。
 *
 * 一个 Pane 一个调度器：
 * - 用 `requestAnimationFrame` 驱动，按设置中的 fps（15/30/60）节流；
 * - 页面隐藏时停止（不消耗 CPU），恢复可见时立即刷新一次；
 * - 「暂停全部」时不调用 `onFrame`，但数据仍在 series 中继续记录；
 * - Pane 切到终端视图或被 `KeepAlive` 卸载时由调用方的 `onBeforeUnmount` /
 *   `onDeactivated` 停止。
 */

import { serialSettings } from '../../stores/settings'

/** 刷新调度器可注入的时钟 / rAF（测试用）。 */
export interface FrameLoopEnvironment {
  now?: () => number
  requestAnimationFrame?: (callback: (timestamp: number) => void) => number
  cancelAnimationFrame?: (handle: number) => void
  isDocumentHidden?: () => boolean
  addVisibilityListener?: (listener: () => void) => () => void
}

export interface FrameLoopOptions {
  /** 目标帧率，默认读取工具设置（15/30/60）。 */
  fps?: () => number
  /** 每一帧的回调；`now` 为毫秒时间戳。 */
  onFrame: (now: number) => void
  /** 测试注入。 */
  environment?: FrameLoopEnvironment
  /** 单帧回调抛异常时的上报函数（默认 `console.error`）。 */
  onError?: (error: unknown) => void
}

/** 调度器接口。 */
export interface FrameLoop {
  start(): void
  stop(): void
  pause(): void
  resume(): void
  isRunning(): boolean
  isPaused(): boolean
  /** 下一次 rAF 立即刷新一次（不受 fps 节流限制）。 */
  requestImmediate(): void
  /** 当前帧间隔（毫秒）。 */
  frameInterval(): number
}

const DEFAULT_FPS = 30

/** 取工具设置中的仪表盘刷新率。 */
export function dashboardFps(): number {
  const fps = serialSettings.dashboardFps
  return fps === 15 || fps === 30 || fps === 60 ? fps : DEFAULT_FPS
}

function createEnvironment(
  environment: FrameLoopEnvironment | undefined,
): Required<FrameLoopEnvironment> {
  const raf =
    environment?.requestAnimationFrame ??
    (typeof requestAnimationFrame === 'function'
      ? requestAnimationFrame.bind(globalThis)
      : (callback: (timestamp: number) => void) =>
          setTimeout(() => callback(Date.now()), 16) as unknown as number)
  const cancel =
    environment?.cancelAnimationFrame ??
    (typeof cancelAnimationFrame === 'function'
      ? cancelAnimationFrame.bind(globalThis)
      : (handle: number) => clearTimeout(handle))
  return {
    now:
      environment?.now ??
      (typeof performance !== 'undefined' && typeof performance.now === 'function'
        ? () => performance.now()
        : () => Date.now()),
    requestAnimationFrame: raf,
    cancelAnimationFrame: cancel,
    isDocumentHidden:
      environment?.isDocumentHidden ??
      (() => typeof document !== 'undefined' && document.visibilityState === 'hidden'),
    addVisibilityListener:
      environment?.addVisibilityListener ??
      ((listener) => {
        if (typeof document === 'undefined') return () => {}
        document.addEventListener('visibilitychange', listener)
        return () => document.removeEventListener('visibilitychange', listener)
      }),
  }
}

/** 创建刷新调度器。 */
export function createFrameLoop(options: FrameLoopOptions): FrameLoop {
  const env = createEnvironment(options.environment)
  const reportError =
    options.onError ??
    ((error: unknown) => {
      console.error('[dashboard] frame loop error', error)
    })

  let running = false
  let paused = false
  let needsImmediate = false
  let handle: number | null = null
  let lastFrameAt = Number.NEGATIVE_INFINITY
  let removeVisibilityListener: (() => void) | null = null

  function fps(): number {
    const value = options.fps?.() ?? dashboardFps()
    return Number.isFinite(value) && value > 0 ? value : DEFAULT_FPS
  }

  function schedule(): void {
    if (!running || handle !== null) return
    if (env.isDocumentHidden()) return
    handle = env.requestAnimationFrame(onAnimationFrame)
  }

  function stopHandle(): void {
    if (handle === null) return
    env.cancelAnimationFrame(handle)
    handle = null
  }

  function invoke(now: number): void {
    lastFrameAt = now
    if (paused) return
    try {
      options.onFrame(now)
    } catch (error) {
      reportError(error)
    }
  }

  function onAnimationFrame(): void {
    handle = null
    if (!running) return
    const now = env.now()
    const interval = 1000 / fps()
    if (needsImmediate || now - lastFrameAt >= interval) {
      needsImmediate = false
      invoke(now)
    }
    schedule()
  }

  function onVisibilityChange(): void {
    if (!running) return
    if (env.isDocumentHidden()) {
      stopHandle()
      return
    }
    // 恢复可见时立即刷新一次（plan §8.10）。
    needsImmediate = true
    schedule()
  }

  return {
    start(): void {
      if (running) return
      running = true
      lastFrameAt = Number.NEGATIVE_INFINITY
      needsImmediate = true
      removeVisibilityListener = env.addVisibilityListener(onVisibilityChange)
      schedule()
    },
    stop(): void {
      if (!running) return
      running = false
      stopHandle()
      removeVisibilityListener?.()
      removeVisibilityListener = null
    },
    pause(): void {
      paused = true
    },
    resume(): void {
      if (!paused) return
      paused = false
      needsImmediate = true
      schedule()
    },
    isRunning(): boolean {
      return running
    },
    isPaused(): boolean {
      return paused
    },
    requestImmediate(): void {
      needsImmediate = true
      schedule()
    },
    frameInterval(): number {
      return 1000 / fps()
    },
  }
}
