import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  createProtocolRuntime,
  REQUEST_TIMEOUT_REASON,
  type ProtocolWorkerLike,
} from '@/domains/protocol/runtime/client'
import type { ProtocolFrame } from '@/domains/protocol/types'

/** 可注入的假 Worker：默认永不回复，只有显式 `receive` 才发出消息。 */
class FakeWorker implements ProtocolWorkerLike {
  readonly posted: unknown[] = []
  terminated = 0
  onmessage: ((event: MessageEvent) => void) | null = null
  onerror: ((event: ErrorEvent) => void) | null = null
  /** 收到消息时同步返回的自动回复；返回 `null` 表示不回复。 */
  autoReply: ((message: Record<string, unknown>) => unknown | null) | null = null

  postMessage(message: unknown): void {
    this.posted.push(message)
    const reply = this.autoReply?.(message as Record<string, unknown>)
    if (reply !== null && reply !== undefined) this.receive(reply)
  }

  terminate(): void {
    this.terminated += 1
  }

  receive(data: unknown): void {
    this.onmessage?.({ data } as unknown as MessageEvent)
  }

  messagesOfType(type: string): Array<Record<string, unknown>> {
    return this.posted.filter(
      (message): message is Record<string, unknown> =>
        typeof message === 'object' && message !== null && (message as { t?: unknown }).t === type,
    )
  }
}

const READY_MESSAGE = {
  t: 'ready',
  meta: { name: '测试协议' },
  framing: { type: 'line' },
}

function replyInitOnly(worker: FakeWorker): void {
  worker.autoReply = (message) => (message.t === 'init' ? READY_MESSAGE : null)
}

afterEach(() => {
  vi.useRealTimers()
})

describe('看门狗', () => {
  it('init 超过 2000ms 没有 ready/initError 时终止 Worker 并 reject', async () => {
    vi.useFakeTimers()
    const worker = new FakeWorker()
    const runtimePromise = createProtocolRuntime('return {}', { workerFactory: () => worker })

    expect(worker.messagesOfType('init')).toHaveLength(1)
    const expectation = expect(runtimePromise).rejects.toThrow('协议初始化超时')
    await vi.advanceTimersByTimeAsync(2000)
    await expectation
    expect(worker.terminated).toBe(1)
  })

  it('请求超过 500ms 没有 done/encoded 时触发 fatal 并终止 Worker', async () => {
    vi.useFakeTimers()
    const worker = new FakeWorker()
    replyInitOnly(worker)
    const runtime = await createProtocolRuntime('return {}', { workerFactory: () => worker })
    const fatal: Array<{ reason: string }> = []
    runtime.on('fatal', (event) => {
      fatal.push(event)
    })

    const encodePromise = runtime.encode({ interval: 1000 })
    const expectation = expect(encodePromise).rejects.toThrow(REQUEST_TIMEOUT_REASON)
    expect(worker.messagesOfType('encode')).toHaveLength(1)

    await vi.advanceTimersByTimeAsync(500)
    await expectation
    expect(fatal).toEqual([{ reason: REQUEST_TIMEOUT_REASON }])
    expect(worker.terminated).toBe(1)
  })

  it('超时后运行时不再发送任何消息', async () => {
    vi.useFakeTimers()
    const worker = new FakeWorker()
    replyInitOnly(worker)
    const runtime = await createProtocolRuntime('return {}', { workerFactory: () => worker })

    runtime.decodeTx(Uint8Array.from([1, 2, 3]), 10)
    await vi.advanceTimersByTimeAsync(500)
    expect(worker.terminated).toBe(1)

    const posted = worker.posted.length
    runtime.feed(Uint8Array.from([1]), 0)
    runtime.decodeTx(Uint8Array.from([2]), 0)
    await expect(runtime.encode({})).rejects.toThrow('协议运行时不可用')
    expect(worker.posted.length).toBe(posted)
  })

  it('initError 会终止 Worker 并 reject', async () => {
    vi.useFakeTimers()
    const worker = new FakeWorker()
    worker.autoReply = (message) =>
      message.t === 'init' ? { t: 'initError', error: '插件代码语法错误：Unexpected token' } : null

    await expect(
      createProtocolRuntime('return {', { workerFactory: () => worker }),
    ).rejects.toThrow('协议初始化失败：插件代码语法错误')
    expect(worker.terminated).toBe(1)
  })
})

describe('消息分发与批量发送', () => {
  it('feed 在 16ms 内累积成一条消息，并转发 frames/discard/log 事件', async () => {
    vi.useFakeTimers()
    const worker = new FakeWorker()
    replyInitOnly(worker)
    const runtime = await createProtocolRuntime('return {}', { workerFactory: () => worker })

    const frames: ProtocolFrame[] = []
    const discards: unknown[] = []
    const logs: unknown[] = []
    runtime.on('frames', (event) => {
      frames.push(...event)
    })
    runtime.on('discard', (event) => discards.push(event))
    runtime.on('log', (event) => logs.push(event))

    runtime.feed(Uint8Array.from([1, 2]), 100)
    runtime.feed(Uint8Array.from([3]), 110)
    expect(worker.messagesOfType('feed')).toHaveLength(0)

    await vi.advanceTimersByTimeAsync(16)
    const feedMessages = worker.messagesOfType('feed')
    expect(feedMessages).toHaveLength(1)
    const feedMessage = feedMessages[0]
    expect(feedMessage?.chunks).toHaveLength(2)

    const id = feedMessage?.id as number
    worker.receive({
      t: 'frames',
      id,
      frames: [
        {
          bytes: Uint8Array.from([1, 2, 3]),
          at: 110,
          direction: 'rx',
          results: [
            {
              summary: 'ok',
              fields: [{ label: '温度', value: 25.31, key: 'temp' }],
              variables: { temp: 25.31, nan: Number.NaN },
              variableMeta: { temp: { unit: '°C', label: '温度' } },
              noVariables: false,
            },
          ],
        },
      ],
    })
    worker.receive({
      t: 'discard',
      id,
      bytes: Uint8Array.from([9]),
      at: 110,
      reason: 'sync',
    })
    worker.receive({ t: 'log', level: 'warn', text: '插件警告' })
    worker.receive({ t: 'done', id })

    expect(frames).toHaveLength(1)
    // 主线程 runtime 原样转发 results：variables / variableMeta / 字段 key 都保留。
    expect(frames[0]?.results[0]?.variables?.temp).toBe(25.31)
    expect(Number.isNaN(frames[0]?.results[0]?.variables?.nan)).toBe(true)
    expect(frames[0]?.results[0]?.variableMeta?.temp).toEqual({ unit: '°C', label: '温度' })
    expect(frames[0]?.results[0]?.fields?.[0]?.key).toBe('temp')
    expect(discards).toEqual([{ bytes: Uint8Array.from([9]), at: 110, reason: 'sync' }])
    expect(logs).toEqual([{ level: 'warn', text: '插件警告' }])

    // done 之后不再有看门狗超时。
    await vi.advanceTimersByTimeAsync(500)
    expect(worker.terminated).toBe(0)
  })

  it('dispose 终止 Worker 并拒绝之后的操作', async () => {
    vi.useFakeTimers()
    const worker = new FakeWorker()
    replyInitOnly(worker)
    const runtime = await createProtocolRuntime('return {}', { workerFactory: () => worker })

    runtime.dispose()
    expect(worker.terminated).toBe(1)
    const posted = worker.posted.length
    runtime.feed(Uint8Array.from([1]), 0)
    await expect(runtime.encode({})).rejects.toThrow('协议运行时已释放')
    await vi.advanceTimersByTimeAsync(100)
    expect(worker.posted.length).toBe(posted)
  })

  it('输入队列超过 2MB 时丢弃最旧的待发数据并上报 overflow', async () => {
    vi.useFakeTimers()
    const worker = new FakeWorker()
    replyInitOnly(worker)
    const runtime = await createProtocolRuntime('return {}', { workerFactory: () => worker })

    const discards: Array<{ bytes: Uint8Array; reason: string }> = []
    runtime.on('discard', (event) => {
      discards.push({ bytes: event.bytes, reason: event.reason })
    })

    runtime.feed(new Uint8Array(1.5 * 1024 * 1024), 0)
    const feedMessages = worker.messagesOfType('feed')
    expect(feedMessages).toHaveLength(1)
    const firstId = feedMessages[0]?.id as number

    runtime.feed(new Uint8Array(1024 * 1024), 1)
    expect(discards).toHaveLength(1)
    expect(discards[0]?.reason).toBe('overflow')
    expect(discards[0]?.bytes.length).toBe(1024 * 1024)
    // 被丢弃的数据不会再发送。
    expect(worker.messagesOfType('feed')).toHaveLength(1)

    worker.receive({ t: 'done', id: firstId })
    await vi.advanceTimersByTimeAsync(500)
    expect(worker.terminated).toBe(0)
  })

  it('idle 模式在静默 gapMs 后发送 flush', async () => {
    vi.useFakeTimers()
    const worker = new FakeWorker()
    worker.autoReply = (message) =>
      message.t === 'init'
        ? { t: 'ready', meta: { name: '空闲协议' }, framing: { type: 'idle', gapMs: 5 } }
        : null
    const runtime = await createProtocolRuntime('return {}', { workerFactory: () => worker })

    runtime.feed(Uint8Array.from([1, 2]), 100)
    await vi.advanceTimersByTimeAsync(5)
    const feedMessages = worker.messagesOfType('feed')
    const flushMessages = worker.messagesOfType('flush')
    expect(feedMessages).toHaveLength(1)
    expect(flushMessages).toHaveLength(1)

    worker.receive({ t: 'done', id: feedMessages[0]?.id })
    worker.receive({ t: 'done', id: flushMessages[0]?.id })
    await vi.advanceTimersByTimeAsync(500)
    expect(worker.terminated).toBe(0)
  })
})
