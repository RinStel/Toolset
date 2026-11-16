/**
 * 主线程协议运行时（plan §6.5）：Worker 生命周期、批量发送、输入溢出处理与看门狗。
 */

import { createEmitter, type EventHandler, type Unsubscribe } from '../../../shared/lib/events'
import type {
  ProtocolDiscardEvent,
  ProtocolFrame,
  ProtocolLogLevel,
  ProtocolRuntimeInfo,
  ProtocolWorkerInMessage,
  ProtocolWorkerOutMessage,
  SendValue,
} from '../types'

/** 初始化超时（plan §6.5：2000ms）。 */
export const INIT_TIMEOUT_MS = 2000
/** 单请求超时（plan §6.5：500ms）。 */
export const REQUEST_TIMEOUT_MS = 500
/** feed 批量发送间隔。 */
export const FEED_BATCH_INTERVAL_MS = 16
/** feed 批量发送累计上限。 */
export const FEED_BATCH_BYTES = 16 * 1024
/** 已发未完成 + 待发送数据的上限。 */
export const INPUT_QUEUE_LIMIT_BYTES = 2 * 1024 * 1024
/** 看门狗触发时对外报告的固定原因（plan §9）。 */
export const REQUEST_TIMEOUT_REASON = '协议执行超时（可能存在死循环）'

/** `createProtocolRuntime` 注入假 Worker 所需的最小接口。 */
export interface ProtocolWorkerLike {
  postMessage(message: unknown): void
  terminate(): void
  onmessage: ((event: MessageEvent) => void) | null
  onerror?: ((event: ErrorEvent) => void) | null
}

export interface ProtocolLogEvent {
  level: ProtocolLogLevel
  text: string
}

export interface ProtocolFatalEvent {
  reason: string
}

/** `ProtocolRuntime.on` 的事件表。 */
export interface ProtocolRuntimeEvents {
  frames: ProtocolFrame[]
  discard: ProtocolDiscardEvent
  log: ProtocolLogEvent
  fatal: ProtocolFatalEvent
  /** 满足 `EventMap` 的索引签名约束。 */
  [event: string]: unknown
}

export interface ProtocolRuntime {
  readonly info: ProtocolRuntimeInfo
  feed(chunk: Uint8Array, at: number): void
  decodeTx(bytes: Uint8Array, at: number): void
  encode(values: Record<string, SendValue>): Promise<Uint8Array>
  on<K extends keyof ProtocolRuntimeEvents & string>(
    event: K,
    handler: EventHandler<ProtocolRuntimeEvents[K]>,
  ): Unsubscribe
  dispose(): void
}

export interface ProtocolRuntimeOptions {
  /** 覆盖协议定义中的 `maxFrameLength`。 */
  maxFrameLength?: number
  /**
   * Worker 工厂。plan §6.5 未列出，但看门狗测试需要注入一个永不回复的假 Worker，
   * 因此作为测试可用的扩展项提供（默认使用 `new Worker(...)`）。
   */
  workerFactory?: () => ProtocolWorkerLike
  /** 时间源，默认 `Date.now`；测试可注入。 */
  now?: () => number
}

interface QueuedChunk {
  bytes: Uint8Array
  at: number
}

interface InflightRequest {
  timer: ReturnType<typeof setTimeout>
  /** 该请求计入输入队列的字节数（feed / decodeTx），其他请求为 0。 */
  bytes: number
  /** 已经收到 encoded / encodeError（看门狗可停止计时，但仍等 done 释放额度）。 */
  responded: boolean
}

interface PendingEncode {
  resolve: (bytes: Uint8Array) => void
  reject: (error: Error) => void
}

function createDefaultWorker(): ProtocolWorkerLike {
  const worker = new Worker(new URL('./protocol.worker.ts', import.meta.url), {
    type: 'module',
  })
  return worker as unknown as ProtocolWorkerLike
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/**
 * 创建协议运行时。初始化失败（编译错误 / 2000ms 超时）时 reject。
 */
export function createProtocolRuntime(
  code: string,
  options: ProtocolRuntimeOptions = {},
): Promise<ProtocolRuntime> {
  const worker = options.workerFactory ? options.workerFactory() : createDefaultWorker()
  const emitter = createEmitter<ProtocolRuntimeEvents>()
  const now = options.now ?? (() => Date.now())

  let disposed = false
  let failed = false
  let ready = false
  let terminated = false
  let info: ProtocolRuntimeInfo | undefined

  let nextRequestId = 1
  let lastSentAt = now()

  const inflight = new Map<number, InflightRequest>()
  const pendingEncodes = new Map<number, PendingEncode>()
  let queue: QueuedChunk[] = []
  let queuedBytes = 0
  let inflightBytes = 0

  let batchTimer: ReturnType<typeof setTimeout> | null = null
  let idleTimer: ReturnType<typeof setTimeout> | null = null
  let initTimer: ReturnType<typeof setTimeout> | null = null

  let resolveInit: (runtime: ProtocolRuntime) => void = () => {}
  let rejectInit: (error: Error) => void = () => {}

  function clearInitTimer(): void {
    if (initTimer === null) return
    clearTimeout(initTimer)
    initTimer = null
  }

  function clearBatchTimer(): void {
    if (batchTimer === null) return
    clearTimeout(batchTimer)
    batchTimer = null
  }

  function clearIdleTimer(): void {
    if (idleTimer === null) return
    clearTimeout(idleTimer)
    idleTimer = null
  }

  function terminateWorker(): void {
    if (terminated) return
    terminated = true
    try {
      worker.terminate()
    } catch {
      // terminate 的异常没有可恢复动作。
    }
  }

  function clearAllTimers(): void {
    clearInitTimer()
    clearBatchTimer()
    clearIdleTimer()
    for (const request of inflight.values()) clearTimeout(request.timer)
    inflight.clear()
    inflightBytes = 0
  }

  /** 终止运行时、释放资源并把待定 encode 全部 reject。 */
  function stopAll(reason: string): void {
    clearAllTimers()
    terminateWorker()
    queue = []
    queuedBytes = 0
    for (const pending of [...pendingEncodes.values()]) pending.reject(new Error(reason))
    pendingEncodes.clear()
  }

  function failRuntime(reason: string): void {
    if (failed || disposed) return
    failed = true
    stopAll(reason)
    emitter.emit('fatal', { reason })
  }

  function allocateId(): number {
    const id = nextRequestId
    nextRequestId += 1
    return id
  }

  function onRequestTimeout(id: number): void {
    if (disposed || failed) return
    const request = inflight.get(id)
    if (!request || request.responded) return
    failRuntime(REQUEST_TIMEOUT_REASON)
  }

  function completeRequest(id: number): void {
    const request = inflight.get(id)
    if (!request) return
    clearTimeout(request.timer)
    inflight.delete(id)
    inflightBytes -= request.bytes
    if (inflightBytes < 0) inflightBytes = 0
  }

  function markResponded(id: number): void {
    const request = inflight.get(id)
    if (!request || request.responded) return
    request.responded = true
    clearTimeout(request.timer)
  }

  function sendTracked(message: ProtocolWorkerInMessage, id: number, bytes: number): boolean {
    const timer = setTimeout(() => {
      onRequestTimeout(id)
    }, REQUEST_TIMEOUT_MS)
    inflight.set(id, { timer, bytes, responded: false })
    inflightBytes += bytes
    try {
      worker.postMessage(message)
      return true
    } catch (error) {
      completeRequest(id)
      failRuntime(`协议 Worker 通信失败：${errorText(error)}`)
      return false
    }
  }

  function handleMessage(event: MessageEvent): void {
    const message = event.data as ProtocolWorkerOutMessage
    switch (message.t) {
      case 'ready': {
        if (ready || disposed) return
        clearInitTimer()
        ready = true
        const runtimeInfo: ProtocolRuntimeInfo = {
          meta: message.meta,
          framing: message.framing,
        }
        if (message.sendForm !== undefined) runtimeInfo.sendForm = message.sendForm
        info = runtimeInfo
        resolveInit(createRuntimeApi())
        return
      }
      case 'initError': {
        clearInitTimer()
        terminateWorker()
        rejectInit(new Error(`协议初始化失败：${message.error}`))
        return
      }
      case 'frames': {
        emitter.emit('frames', message.frames)
        return
      }
      case 'discard': {
        emitter.emit('discard', {
          bytes: message.bytes,
          at: message.at,
          reason: message.reason,
        })
        return
      }
      case 'log': {
        emitter.emit('log', { level: message.level, text: message.text })
        return
      }
      case 'encoded': {
        const pending = pendingEncodes.get(message.id)
        if (pending) {
          pendingEncodes.delete(message.id)
          pending.resolve(message.bytes)
        }
        markResponded(message.id)
        return
      }
      case 'encodeError': {
        const pending = pendingEncodes.get(message.id)
        if (pending) {
          pendingEncodes.delete(message.id)
          pending.reject(new Error(message.error))
        }
        markResponded(message.id)
        return
      }
      case 'done': {
        completeRequest(message.id)
        return
      }
      default:
        return
    }
  }

  function handleWorkerError(text: string): void {
    if (disposed) return
    if (!ready) {
      clearInitTimer()
      terminateWorker()
      rejectInit(new Error(`协议初始化失败：${text}`))
      return
    }
    failRuntime(`协议 Worker 异常：${text}`)
  }

  function trimInputQueue(): void {
    while (inflightBytes + queuedBytes > INPUT_QUEUE_LIMIT_BYTES && queue.length > 0) {
      const dropped = queue.shift()
      if (dropped === undefined) break
      queuedBytes -= dropped.bytes.length
      emitter.emit('discard', {
        bytes: dropped.bytes,
        at: dropped.at,
        reason: 'overflow',
      })
    }
  }

  function sendQueuedFeed(): void {
    clearBatchTimer()
    if (queue.length === 0) return
    const chunks = queue
    const bytes = queuedBytes
    queue = []
    queuedBytes = 0
    const id = allocateId()
    lastSentAt = now()
    sendTracked({ t: 'feed', id, chunks }, id, bytes)
  }

  function scheduleBatchTimer(): void {
    if (batchTimer !== null) return
    const delay = Math.max(0, FEED_BATCH_INTERVAL_MS - (now() - lastSentAt))
    batchTimer = setTimeout(() => {
      batchTimer = null
      if (queue.length > 0) sendQueuedFeed()
    }, delay)
  }

  function trySendQueued(): void {
    if (queue.length === 0 || !ready || disposed || failed) return
    if (now() - lastSentAt >= FEED_BATCH_INTERVAL_MS || queuedBytes >= FEED_BATCH_BYTES) {
      sendQueuedFeed()
      return
    }
    scheduleBatchTimer()
  }

  function resetIdleTimer(): void {
    if (info?.framing.type !== 'idle' || disposed || failed) return
    clearIdleTimer()
    const gapMs = info.framing.gapMs
    idleTimer = setTimeout(() => {
      idleTimer = null
      onIdleExpired()
    }, gapMs)
  }

  function onIdleExpired(): void {
    if (!ready || disposed || failed) return
    if (queue.length > 0) sendQueuedFeed()
    const id = allocateId()
    sendTracked({ t: 'flush', id }, id, 0)
  }

  function encodeRequest(values: Record<string, SendValue>): Promise<Uint8Array> {
    if (disposed) return Promise.reject(new Error('协议运行时已释放'))
    if (!ready || failed) return Promise.reject(new Error('协议运行时不可用'))
    const id = allocateId()
    return new Promise<Uint8Array>((resolve, reject) => {
      pendingEncodes.set(id, { resolve, reject })
      const sent = sendTracked({ t: 'encode', id, values }, id, 0)
      if (!sent) {
        pendingEncodes.delete(id)
        reject(new Error('协议 Worker 通信失败'))
      }
    })
  }

  function disposeRuntime(): void {
    if (disposed) return
    disposed = true
    stopAll('协议运行时已释放')
    emitter.clear()
  }

  function createRuntimeApi(): ProtocolRuntime {
    return {
      get info(): ProtocolRuntimeInfo {
        if (info === undefined) throw new Error('协议运行时尚未初始化')
        return info
      },
      feed(chunk: Uint8Array, at: number): void {
        if (!ready || disposed || failed || chunk.length === 0) return
        queue.push({ bytes: Uint8Array.from(chunk), at })
        queuedBytes += chunk.length
        resetIdleTimer()
        trimInputQueue()
        trySendQueued()
      },
      decodeTx(bytes: Uint8Array, at: number): void {
        if (!ready || disposed || failed) return
        const id = allocateId()
        sendTracked({ t: 'decodeTx', id, bytes: Uint8Array.from(bytes), at }, id, bytes.length)
      },
      encode(values: Record<string, SendValue>): Promise<Uint8Array> {
        return encodeRequest(values)
      },
      on<K extends keyof ProtocolRuntimeEvents & string>(
        event: K,
        handler: EventHandler<ProtocolRuntimeEvents[K]>,
      ): Unsubscribe {
        return emitter.on(event, handler)
      },
      dispose(): void {
        disposeRuntime()
      },
    }
  }

  worker.onmessage = handleMessage
  worker.onerror = (event: ErrorEvent): void => {
    handleWorkerError(event.message || '协议 Worker 发生未知错误')
  }

  const initPromise = new Promise<ProtocolRuntime>((resolve, reject) => {
    resolveInit = resolve
    rejectInit = reject
  })

  initTimer = setTimeout(() => {
    initTimer = null
    if (disposed || ready) return
    terminateWorker()
    rejectInit(new Error(`协议初始化超时（${INIT_TIMEOUT_MS}ms）`))
  }, INIT_TIMEOUT_MS)

  try {
    const initMessage: ProtocolWorkerInMessage =
      options.maxFrameLength === undefined
        ? { t: 'init', code }
        : { t: 'init', code, maxFrameLength: options.maxFrameLength }
    worker.postMessage(initMessage)
  } catch (error) {
    clearInitTimer()
    terminateWorker()
    rejectInit(new Error(`协议初始化失败：${errorText(error)}`))
  }

  return initPromise
}
