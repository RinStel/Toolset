import { afterEach, describe, expect, it, vi } from 'vitest'

import type {
  DecodeResult,
  ProtocolFrame,
  ProtocolRuntime,
  ProtocolRuntimeEvents,
  ProtocolRuntimeInfo,
} from '../../../src/domains/protocol/public'
import { DEFAULT_LOG_POLICY, type LogPolicy } from '../../../src/domains/link/log/policy'
import { createLinkSession, type LinkSession } from '../../../src/domains/link/session/session'
import type {
  ByteTransport,
  TransportCapabilities,
} from '../../../src/domains/link/transport/types'
import { createEmitter, type Unsubscribe } from '../../../src/shared/lib/events'

const CAPABILITIES: TransportCapabilities = {
  lineSettings: false,
  signals: false,
  break: false,
}

class FakeTransport implements ByteTransport {
  readonly kind = 'fake'
  readonly deviceKey = 'fake:log-policy'
  readonly label = '假通道'
  readonly capabilities: TransportCapabilities = CAPABILITIES

  private readableStream: ReadableStream<Uint8Array> | null = null
  private writableStream: WritableStream<Uint8Array> | null = null
  private controller: ReadableStreamDefaultController<Uint8Array> | null = null
  writes: Uint8Array[] = []

  get readable(): ReadableStream<Uint8Array> | null {
    return this.readableStream
  }

  get writable(): WritableStream<Uint8Array> | null {
    return this.writableStream
  }

  async open(): Promise<void> {
    this.readableStream = new ReadableStream<Uint8Array>({
      start: (controller) => {
        this.controller = controller
      },
      cancel: () => {
        this.controller = null
      },
    })
    this.writableStream = new WritableStream<Uint8Array>({
      write: (chunk) => {
        this.writes.push(Uint8Array.from(chunk))
      },
    })
  }

  async close(): Promise<void> {
    const controller = this.controller
    this.controller = null
    if (controller !== null) {
      try {
        controller.close()
      } catch {
        // Already closed.
      }
    }
    this.readableStream = null
    this.writableStream = null
  }

  onDisconnect(): () => void {
    return () => {}
  }

  isSameDevice(other: ByteTransport): boolean {
    return other === this
  }

  push(bytes: Uint8Array | number[]): void {
    if (this.controller === null) throw new Error('没有可读流')
    this.controller.enqueue(Uint8Array.from(bytes))
  }
}

class FakeRuntime implements ProtocolRuntime {
  readonly info: ProtocolRuntimeInfo = {
    meta: { name: '假协议' },
    framing: { type: 'line' },
  }

  private readonly emitter = createEmitter<ProtocolRuntimeEvents>()

  feed(): void {}

  decodeTx(): void {}

  encode(): Promise<Uint8Array> {
    return Promise.resolve(Uint8Array.from([0x99]))
  }

  on<K extends keyof ProtocolRuntimeEvents & string>(
    event: K,
    handler: (payload: ProtocolRuntimeEvents[K]) => void,
  ): Unsubscribe {
    return this.emitter.on(event, handler)
  }

  dispose(): void {
    this.emitter.clear()
  }

  emitFrames(frames: ProtocolFrame[]): void {
    this.emitter.emit('frames', frames)
  }

  emitDiscard(bytes: Uint8Array, at: number, reason: 'sync' | 'overflow' = 'sync'): void {
    this.emitter.emit('discard', { bytes, at, reason })
  }
}

const tracked: LinkSession[] = []

interface Harness {
  session: LinkSession
  runtime: FakeRuntime
  transport: FakeTransport
}

async function setup(): Promise<Harness> {
  const runtime = new FakeRuntime()
  const transport = new FakeTransport()
  const session = createLinkSession({
    id: 's1',
    transport,
    providerKind: 'fake',
    createRuntime: () => Promise.resolve(runtime),
    log: { maxEntries: 1000, maxBytes: 5_000_000 },
  })
  tracked.push(session)
  await session.setProtocol('builtin:sensor-a5')
  await session.open()
  return { session, runtime, transport }
}

function frame(
  results: DecodeResult[] = [{ summary: 'ok' }],
  options: { error?: string; direction?: 'rx' | 'tx'; at?: number } = {},
): ProtocolFrame {
  const next: ProtocolFrame = {
    bytes: new Uint8Array([1]),
    at: options.at ?? 0,
    direction: options.direction ?? 'rx',
    results,
  }
  if (options.error !== undefined) next.error = options.error
  return next
}

function decodedRxFrames(session: LinkSession): number {
  return session.log.search((entry) => entry.dir === 'rx' && entry.decoded !== undefined, 1000)
    .length
}

function systemTexts(session: LinkSession): string[] {
  return session.log
    .search((entry) => entry.dir === 'system', 1000)
    .reverse()
    .map((entry) => entry.text)
}

afterEach(async () => {
  vi.useRealTimers()
  for (const session of tracked.splice(0)) {
    await session.dispose()
  }
})

describe('LogPolicy defaults', () => {
  it('uses all / 20 / auto from plan §6.6', async () => {
    const { session } = await setup()
    expect(DEFAULT_LOG_POLICY).toEqual({ mode: 'all', maxPerSecond: 20, auto: true })
    expect(session.logPolicy).toEqual({ mode: 'all', maxPerSecond: 20, auto: true })
  })

  it('writes every decoded rx frame in all mode', async () => {
    const { session, runtime } = await setup()
    runtime.emitFrames([frame(), frame(), frame()])
    expect(decodedRxFrames(session)).toBe(3)
    expect(session.stats.rxFrames).toBe(3)
  })
})

describe('LogPolicy sampled', () => {
  it('keeps at most maxPerSecond entries per second and logs the omitted count', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(1000)
    const { session, runtime } = await setup()
    session.logPolicy = { mode: 'sampled', maxPerSecond: 2, auto: true }
    expect(session.logPolicy.auto).toBe(false)

    runtime.emitFrames([frame(), frame(), frame(), frame(), frame()])
    // All five frames arrive inside the first 500ms slice: only one is logged.
    expect(decodedRxFrames(session)).toBe(1)
    expect(session.stats.rxFrames).toBe(5)

    await vi.advanceTimersByTimeAsync(1000)
    expect(systemTexts(session)).toContain('已省略 4 帧')
  })

  it('takes the first frame of each time slice', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(0)
    const { session, runtime } = await setup()
    session.logPolicy = { mode: 'sampled', maxPerSecond: 4, auto: true }

    runtime.emitFrames([frame()])
    await vi.advanceTimersByTimeAsync(300)
    runtime.emitFrames([frame()])
    await vi.advanceTimersByTimeAsync(200)
    runtime.emitFrames([frame()])
    await vi.advanceTimersByTimeAsync(400)
    runtime.emitFrames([frame(), frame()]) // second frame of slice 3 → omitted

    expect(decodedRxFrames(session)).toBe(4)
    await vi.advanceTimersByTimeAsync(100)
    expect(systemTexts(session)).toContain('已省略 1 帧')
    expect(systemTexts(session).some((text) => text.includes('已省略 0 帧'))).toBe(false)
  })

  it('does not write an omitted log when nothing was omitted', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(0)
    const { session, runtime } = await setup()
    session.logPolicy = { mode: 'sampled', maxPerSecond: 2, auto: true }

    runtime.emitFrames([frame()])
    await vi.advanceTimersByTimeAsync(1000)
    expect(systemTexts(session)).toEqual([])
  })
})

describe('LogPolicy none', () => {
  it('drops decoded rx entries but keeps unframed data, error frames and TX', async () => {
    vi.useFakeTimers()
    const { session, runtime } = await setup()
    session.logPolicy = { mode: 'none', maxPerSecond: 20, auto: true }

    runtime.emitFrames([frame(), frame()])
    expect(decodedRxFrames(session)).toBe(0)
    expect(session.stats.rxFrames).toBe(2)

    runtime.emitFrames([frame([], { error: '坏帧' })])
    const errorEntry = session.log.search((entry) => entry.dir === 'rx', 10)[0]
    expect(errorEntry?.level).toBe('error')
    expect(errorEntry?.decoded?.error).toBe('坏帧')

    runtime.emitDiscard(Uint8Array.from([1, 2]), 1)
    await vi.advanceTimersByTimeAsync(120)
    expect(session.log.search((entry) => entry.decoded?.unframed === true, 10)).toHaveLength(1)

    await session.send(Uint8Array.from([9]), 'manual')
    expect(session.log.search((entry) => entry.dir === 'tx', 10)).toHaveLength(1)
  })

  it('keeps error-level results in the log', async () => {
    const { session, runtime } = await setup()
    session.logPolicy = { mode: 'none', maxPerSecond: 20, auto: true }
    runtime.emitFrames([frame([{ summary: 'CRC 错误', level: 'error' }])])
    const entry = session.log.search((item) => item.dir === 'rx', 10)[0]
    expect(entry?.level).toBe('error')
    expect(entry?.decoded?.results[0]?.summary).toBe('CRC 错误')
  })
})

describe('LogPolicy sampled with error frames', () => {
  it('always writes error frames, even beyond maxPerSecond', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(0)
    const { session, runtime } = await setup()
    session.logPolicy = { mode: 'sampled', maxPerSecond: 1, auto: true }

    runtime.emitFrames([frame(), frame([], { error: '坏帧 1' }), frame([], { error: '坏帧 2' })])
    expect(decodedRxFrames(session)).toBe(3)
    expect(session.stats.decodeErrors).toBe(2)
    expect(session.stats.rxFrames).toBe(3)
  })
})

describe('LogPolicy auto', () => {
  it('switches to sampled after two consecutive seconds above 200 frames/s', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(0)
    const { session, runtime } = await setup()
    const policies: LogPolicy[] = []
    session.on('logPolicy', (policy) => policies.push(policy))

    const burst = (): void => {
      runtime.emitFrames(Array.from({ length: 250 }, () => frame()))
    }

    burst()
    await vi.advanceTimersByTimeAsync(1000)
    burst()
    expect(session.logPolicy.mode).toBe('all')

    await vi.advanceTimersByTimeAsync(1000)
    burst()
    expect(session.logPolicy.mode).toBe('sampled')
    expect(session.logPolicy.auto).toBe(true)
    expect(policies.at(-1)).toEqual({ mode: 'sampled', maxPerSecond: 20, auto: true })
    expect(systemTexts(session)).toContain(
      '数据帧速率过高（约 250 帧/秒），日志已切换为抽样记录，可在日志工具栏中修改',
    )
  })

  it('does not switch when the high-rate seconds are not consecutive', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(0)
    const { session, runtime } = await setup()
    runtime.emitFrames(Array.from({ length: 250 }, () => frame()))
    await vi.advanceTimersByTimeAsync(1000)
    runtime.emitFrames(Array.from({ length: 10 }, () => frame()))
    await vi.advanceTimersByTimeAsync(1000)
    runtime.emitFrames(Array.from({ length: 250 }, () => frame()))
    expect(session.logPolicy.mode).toBe('all')
    expect(systemTexts(session)).toEqual([])
  })
})

describe('LogPolicy manual changes', () => {
  it('turns auto off when the user changes the mode and emits an event', async () => {
    const { session } = await setup()
    const policies: LogPolicy[] = []
    session.on('logPolicy', (policy) => policies.push(policy))

    session.logPolicy = { mode: 'sampled', maxPerSecond: 10, auto: true }
    expect(session.logPolicy).toEqual({ mode: 'sampled', maxPerSecond: 10, auto: false })
    expect(policies.at(-1)).toEqual({ mode: 'sampled', maxPerSecond: 10, auto: false })

    session.logPolicy = { mode: 'none', maxPerSecond: 10, auto: true }
    expect(session.logPolicy).toEqual({ mode: 'none', maxPerSecond: 10, auto: false })
  })

  it('keeps maxPerSecond normalized and auto when the mode does not change', async () => {
    const { session } = await setup()
    session.logPolicy = { mode: 'all', maxPerSecond: 0, auto: true }
    expect(session.logPolicy).toEqual({ mode: 'all', maxPerSecond: 1, auto: true })
  })

  it('applies a preset policy verbatim through applyLogPolicy', async () => {
    const { session } = await setup()
    session.applyLogPolicy({ mode: 'none', maxPerSecond: 8, auto: true })
    expect(session.logPolicy).toEqual({ mode: 'none', maxPerSecond: 8, auto: true })
  })
})

describe('LogPolicy without a protocol', () => {
  it('does not change the no-protocol log entries', async () => {
    vi.useFakeTimers()
    const runtime = new FakeRuntime()
    const transport = new FakeTransport()
    const session = createLinkSession({
      id: 's1',
      transport,
      providerKind: 'fake',
      createRuntime: () => Promise.resolve(runtime),
      log: { maxEntries: 1000, maxBytes: 5_000_000 },
    })
    tracked.push(session)
    await session.open()
    session.logPolicy = { mode: 'none', maxPerSecond: 20, auto: true }

    transport.push([0x61, 0x0a, 0x62, 0x0a])
    await vi.advanceTimersByTimeAsync(0)
    const texts = session.log
      .search((entry) => entry.dir === 'rx', 10)
      .reverse()
      .map((entry) => entry.text)
    expect(texts).toEqual(['a', 'b'])
  })
})
