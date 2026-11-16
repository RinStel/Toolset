import { afterEach, describe, expect, it, vi } from 'vitest'

import { defaultComposeOptions, type ComposeOptions } from '../../../src/domains/link/send/compose'
import { createLinkSession, type LinkSession } from '../../../src/domains/link/session/session'
import type {
  ByteTransport,
  TransportCapabilities,
  TransportSignals,
} from '../../../src/domains/link/transport/types'

async function flushMicrotasks(times = 12): Promise<void> {
  for (let index = 0; index < times; index += 1) await Promise.resolve()
}

class FakeTransport implements ByteTransport {
  readonly kind = 'fake'
  readonly deviceKey = 'fake:repeat'
  readonly label = '假通道'
  capabilities: TransportCapabilities = {
    lineSettings: true,
    signals: true,
    break: true,
  }

  writes: Uint8Array[] = []
  failWrites = false
  signalCalls: TransportSignals[] = []
  closeCalls = 0

  private privateController: ReadableStreamDefaultController<Uint8Array> | null = null
  private privateReadable: ReadableStream<Uint8Array> | null = null
  private privateWritable: WritableStream<Uint8Array> | null = null
  private readonly disconnectHandlers = new Set<() => void>()

  get readable(): ReadableStream<Uint8Array> | null {
    return this.privateReadable
  }

  get writable(): WritableStream<Uint8Array> | null {
    return this.privateWritable
  }

  async open(): Promise<void> {
    this.privateReadable = new ReadableStream<Uint8Array>({
      start: (controller) => {
        this.privateController = controller
      },
    })
    this.privateWritable = new WritableStream<Uint8Array>({
      write: (chunk) => {
        if (this.failWrites) throw new Error('写入失败（测试）')
        this.writes.push(Uint8Array.from(chunk))
      },
    })
  }

  async close(): Promise<void> {
    this.closeCalls += 1
    if (this.privateController !== null) {
      try {
        this.privateController.close()
      } catch {
        // Already closed.
      }
    }
    this.privateController = null
    this.privateReadable = null
    this.privateWritable = null
  }

  async setSignals(signals: TransportSignals): Promise<void> {
    this.signalCalls.push(signals)
  }

  onDisconnect(callback: () => void): () => void {
    this.disconnectHandlers.add(callback)
    return () => {
      this.disconnectHandlers.delete(callback)
    }
  }

  isSameDevice(other: ByteTransport): boolean {
    return other === this
  }

  emitDisconnect(): void {
    for (const handler of [...this.disconnectHandlers]) handler()
  }
}

const sessions: LinkSession[] = []

async function openSession(transport = new FakeTransport()): Promise<LinkSession> {
  const session = createLinkSession({
    id: 's1',
    transport,
    providerKind: 'fake',
    settings: {},
    log: { maxEntries: 5000, maxBytes: 5_000_000 },
  })
  sessions.push(session)
  await session.open()
  return session
}

function systemTexts(session: LinkSession): string[] {
  return session.log
    .search((entry) => entry.dir === 'system', 200)
    .reverse()
    .map((entry) => entry.text)
}

afterEach(async () => {
  vi.useRealTimers()
  for (const session of sessions.splice(0)) await session.dispose()
})

function sendOptions(overrides: Partial<ComposeOptions> = {}): ComposeOptions {
  return { ...defaultComposeOptions(), eol: 'crlf', ...overrides }
}

describe('session repeat task (fake timers)', () => {
  it('sends the requested number of frames and stops at the count', async () => {
    vi.useFakeTimers()
    const transport = new FakeTransport()
    const session = await openSession(transport)

    session.startRepeat({ bytes: Uint8Array.from([1]), intervalMs: 10, count: 3 })
    await vi.advanceTimersByTimeAsync(0)
    expect(transport.writes).toHaveLength(1)
    expect(session.tasks.repeat).toEqual({ sent: 1, count: 3, intervalMs: 10 })

    await vi.advanceTimersByTimeAsync(10)
    expect(transport.writes).toHaveLength(2)
    await vi.advanceTimersByTimeAsync(10)
    expect(transport.writes).toHaveLength(3)
    expect(session.tasks.repeat).toBeNull()
  })

  it('stops on user request', async () => {
    vi.useFakeTimers()
    const transport = new FakeTransport()
    const session = await openSession(transport)

    session.startRepeat({ bytes: Uint8Array.from([2]), intervalMs: 10, count: null })
    await vi.advanceTimersByTimeAsync(0)
    await vi.advanceTimersByTimeAsync(10)
    expect(transport.writes).toHaveLength(2)

    session.stopRepeat()
    expect(session.tasks.repeat).toBeNull()
    await vi.advanceTimersByTimeAsync(100)
    expect(transport.writes).toHaveLength(2)
  })

  it('snapshots the bytes at start time', async () => {
    vi.useFakeTimers()
    const transport = new FakeTransport()
    const session = await openSession(transport)

    const bytes = Uint8Array.from([7])
    session.startRepeat({ bytes, intervalMs: 10, count: 1 })
    bytes[0] = 9
    await vi.advanceTimersByTimeAsync(0)
    expect([...(transport.writes[0] as Uint8Array)]).toEqual([7])
  })

  it('stops when a write fails', async () => {
    vi.useFakeTimers()
    const transport = new FakeTransport()
    const session = await openSession(transport)
    transport.failWrites = true

    session.startRepeat({ bytes: Uint8Array.from([1]), intervalMs: 10, count: 5 })
    await vi.advanceTimersByTimeAsync(0)
    expect(session.tasks.repeat).toBeNull()
    await vi.advanceTimersByTimeAsync(100)
    expect(transport.writes).toHaveLength(0)
  })

  it('validates interval/count and keeps no task on invalid input', async () => {
    vi.useFakeTimers()
    const session = await openSession()
    expect(() =>
      session.startRepeat({ bytes: Uint8Array.from([1]), intervalMs: 5, count: 1 }),
    ).toThrow(RangeError)
    expect(session.tasks.repeat).toBeNull()
    expect(() =>
      session.startRepeat({ bytes: Uint8Array.from([1]), intervalMs: 10, count: 0 }),
    ).toThrow(RangeError)
  })

  it('aborts when the session leaves the open state', async () => {
    vi.useFakeTimers()
    const transport = new FakeTransport()
    const session = await openSession(transport)

    session.startRepeat({ bytes: Uint8Array.from([1]), intervalMs: 10, count: null })
    await vi.advanceTimersByTimeAsync(10)
    const writtenBefore = transport.writes.length

    transport.emitDisconnect()
    await flushMicrotasks(25)
    expect(session.tasks.repeat).toBeNull()
    await vi.advanceTimersByTimeAsync(200)
    expect(transport.writes.length).toBe(writtenBefore)
  })
})

describe('session macro task (fake timers)', () => {
  it('runs send, delay and signal steps and logs start/end once', async () => {
    vi.useFakeTimers()
    const transport = new FakeTransport()
    const session = await openSession(transport)

    session.startMacro({
      id: 'm1',
      name: '基础宏',
      loop: false,
      steps: [
        { type: 'send', input: 'AT', options: sendOptions() },
        { type: 'delay', ms: 10 },
        { type: 'signal', dtr: true, rts: false },
      ],
    })
    await vi.advanceTimersByTimeAsync(0)
    expect(transport.writes).toHaveLength(1)
    expect([...(transport.writes[0] as Uint8Array)]).toEqual([0x41, 0x54, 0x0d, 0x0a])

    await vi.advanceTimersByTimeAsync(10)
    expect(transport.signalCalls).toEqual([{ dtr: true, rts: false }])
    expect(session.tasks.macro).toBeNull()

    const texts = systemTexts(session)
    expect(texts.filter((text) => text.includes('开始运行'))).toHaveLength(1)
    expect(texts.filter((text) => text.includes('运行结束'))).toHaveLength(1)
  })

  it('loops without repeating the start log', async () => {
    vi.useFakeTimers()
    const session = await openSession()

    session.startMacro({
      id: 'm2',
      name: '循环宏',
      loop: true,
      steps: [{ type: 'delay', ms: 10 }],
    })
    await vi.advanceTimersByTimeAsync(30)
    expect(session.tasks.macro?.loopCount).toBeGreaterThanOrEqual(2)

    session.stopMacro()
    expect(session.tasks.macro).toBeNull()
    const texts = systemTexts(session)
    expect(texts.filter((text) => text.includes('开始运行'))).toHaveLength(1)
    expect(texts.filter((text) => text.includes('已停止'))).toHaveLength(1)
  })

  it('stops before sending when a signal step is unsupported', async () => {
    vi.useFakeTimers()
    const transport = new FakeTransport()
    transport.capabilities = { lineSettings: true, signals: false, break: false }
    const session = await openSession(transport)

    session.startMacro({
      id: 'm3',
      name: '控制线宏',
      loop: false,
      steps: [{ type: 'signal', dtr: true }],
    })
    await vi.advanceTimersByTimeAsync(0)
    expect(session.tasks.macro).toBeNull()
    expect(systemTexts(session).some((text) => text.includes('该通道不支持控制线'))).toBe(true)
  })

  it('rejects the start when a send step cannot be composed', async () => {
    vi.useFakeTimers()
    const session = await openSession()

    expect(() =>
      session.startMacro({
        id: 'm4',
        name: '坏宏',
        loop: false,
        steps: [
          { type: 'delay', ms: 10 },
          { type: 'send', input: 'zz', options: sendOptions({ mode: 'hex' }) },
        ],
      }),
    ).toThrow('第 2 步组包失败')
    expect(session.tasks.macro).toBeNull()
    expect(systemTexts(session).some((text) => text.includes('启动失败'))).toBe(true)
  })

  it('rejects more than 100 steps', async () => {
    vi.useFakeTimers()
    const session = await openSession()
    const steps = Array.from({ length: 101 }, () => ({ type: 'delay' as const, ms: 10 }))
    expect(() => session.startMacro({ id: 'm5', name: '超长宏', loop: false, steps })).toThrow(
      '不能超过 100 个',
    )
  })

  it('aborts mid-delay when the session disconnects', async () => {
    vi.useFakeTimers()
    const transport = new FakeTransport()
    const session = await openSession(transport)

    session.startMacro({
      id: 'm6',
      name: '断开宏',
      loop: false,
      steps: [
        { type: 'delay', ms: 100 },
        { type: 'send', input: 'AT', options: sendOptions() },
      ],
    })
    await vi.advanceTimersByTimeAsync(10)
    expect(session.tasks.macro).not.toBeNull()

    transport.emitDisconnect()
    await flushMicrotasks(25)
    expect(session.tasks.macro).toBeNull()
    await vi.advanceTimersByTimeAsync(500)
    expect(transport.writes).toHaveLength(0)
    expect(systemTexts(session).some((text) => text.includes('通道已断开'))).toBe(true)
  })
})
