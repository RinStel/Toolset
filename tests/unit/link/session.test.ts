import { afterEach, describe, expect, it, vi } from 'vitest'

import { checksum, read } from '../../../src/domains/bytes/public'
import type {
  ProtocolDiscardEvent,
  ProtocolFrame,
  ProtocolRuntime,
  ProtocolRuntimeEvents,
  ProtocolRuntimeInfo,
  SendValue,
} from '../../../src/domains/protocol/public'
import { createDeviceMemoryStore } from '../../../src/domains/link/presets/devices'
import { defaultComposeOptions } from '../../../src/domains/link/send/compose'
import { createLinkSession, type LinkSession } from '../../../src/domains/link/session/session'
import type { DecodedFrame } from '../../../src/domains/link/session/frames'
import { createLinkManager } from '../../../src/domains/link/session/manager'
import { IllegalStateError } from '../../../src/domains/link/session/state'
import type {
  ByteTransport,
  TransportCapabilities,
  TransportSignals,
} from '../../../src/domains/link/transport/types'
import {
  DemoDevice,
  VirtualTransport,
  demoHumidity,
  demoTemperature,
  demoVoltage,
  normalizeDemoInterval,
} from '../../../src/domains/link/transports/virtual/device'
import { createVirtualTransport } from '../../../src/domains/link/transports/virtual/provider'
import { createEmitter, type Unsubscribe } from '../../../src/shared/lib/events'

interface Deferred<T> {
  promise: Promise<T>
  resolve: (value: T) => void
  reject: (error: unknown) => void
}

function deferred<T>(): Deferred<T> {
  let resolve: (value: T) => void = () => {}
  let reject: (error: unknown) => void = () => {}
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise
    reject = rejectPromise
  })
  return { promise, resolve, reject }
}

async function flushMicrotasks(times = 12): Promise<void> {
  for (let index = 0; index < times; index += 1) await Promise.resolve()
}

class FakeTransport implements ByteTransport {
  readonly kind = 'fake'
  readonly deviceKey = 'fake:1'
  readonly label = '假通道'
  capabilities: TransportCapabilities = {
    lineSettings: true,
    signals: true,
    break: true,
  }

  openCalls = 0
  closeCalls = 0
  signalCalls: TransportSignals[] = []
  writeStarts: number[] = []
  writes: Uint8Array[] = []
  writeGate: Deferred<void> | null = null
  failWrites = false
  openGate: Deferred<void> | null = null
  openError: unknown = null

  private readableStream: ReadableStream<Uint8Array> | null = null
  private readableController: ReadableStreamDefaultController<Uint8Array> | null = null
  private writableStream: WritableStream<Uint8Array> | null = null
  private readonly disconnectHandlers = new Set<() => void>()

  get readable(): ReadableStream<Uint8Array> | null {
    return this.readableStream
  }

  get writable(): WritableStream<Uint8Array> | null {
    return this.writableStream
  }

  async open(): Promise<void> {
    this.openCalls += 1
    if (this.openGate !== null) await this.openGate.promise
    if (this.openError !== null) throw this.openError
    this.openReadable()
    this.writableStream = new WritableStream<Uint8Array>({
      write: async (chunk) => {
        this.writeStarts.push(chunk[0] ?? -1)
        if (this.writeGate !== null) await this.writeGate.promise
        if (this.failWrites) throw new Error('写入失败（测试）')
        this.writes.push(Uint8Array.from(chunk))
      },
    })
  }

  async close(): Promise<void> {
    this.closeCalls += 1
    if (this.readableController !== null) {
      try {
        this.readableController.close()
      } catch {
        // Already closed/errored.
      }
    }
    this.readableController = null
    this.readableStream = null
    this.writableStream = null
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

  push(bytes: Uint8Array | number[]): void {
    if (this.readableController === null) throw new Error('没有可读流')
    this.readableController.enqueue(Uint8Array.from(bytes))
  }

  raiseReadError(name: string): void {
    const controller = this.readableController
    if (controller === null) throw new Error('没有可读流')
    this.readableController = null
    controller.error(new DOMException('测试读取错误', name))
    this.openReadable()
  }

  emitDisconnect(): void {
    for (const handler of [...this.disconnectHandlers]) handler()
  }

  private openReadable(): void {
    this.readableStream = new ReadableStream<Uint8Array>({
      start: (controller) => {
        this.readableController = controller
      },
      cancel: () => {
        this.readableController = null
      },
    })
  }
}

function makeSession(
  transport: FakeTransport = new FakeTransport(),
  overrides: Partial<Parameters<typeof createLinkSession>[0]> = {},
): LinkSession {
  return createLinkSession({
    id: 's1',
    transport,
    providerKind: 'fake',
    settings: {},
    log: { maxEntries: 1000, maxBytes: 5_000_000 },
    ...overrides,
  })
}

function logTexts(session: LinkSession, dir: 'rx' | 'tx' | 'system'): string[] {
  return session.log
    .search((entry) => entry.dir === dir, 100)
    .reverse()
    .map((entry) => entry.text)
}

const sessions: LinkSession[] = []

function track(session: LinkSession): LinkSession {
  sessions.push(session)
  return session
}

afterEach(async () => {
  vi.useRealTimers()
  for (const session of sessions.splice(0)) {
    await session.dispose()
  }
})

class FakeRuntime implements ProtocolRuntime {
  readonly info: ProtocolRuntimeInfo
  encodeValues: Record<string, SendValue> | null = null
  encodeError: string | null = null

  private readonly emitter = createEmitter<ProtocolRuntimeEvents>()

  constructor(info?: Partial<ProtocolRuntimeInfo>) {
    this.info = {
      meta: { name: '假协议' },
      framing: { type: 'line' },
      sendForm: {
        fields: [{ key: 'v', label: '数值', type: 'number', default: 1 }],
      },
      ...info,
    }
  }

  feed(): void {}

  decodeTx(): void {}

  encode(values: Record<string, SendValue>): Promise<Uint8Array> {
    this.encodeValues = values
    if (this.encodeError !== null) return Promise.reject(new Error(this.encodeError))
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

  emitDiscard(event: ProtocolDiscardEvent): void {
    this.emitter.emit('discard', event)
  }

  emitFatal(reason: string): void {
    this.emitter.emit('fatal', { reason })
  }
}

describe('LinkSession state machine', () => {
  it('opens, closes and reopens; illegal transitions throw IllegalStateError', async () => {
    const transport = new FakeTransport()
    const session = track(makeSession(transport))
    expect(session.state).toBe('idle')
    expect(session.lastError).toBeNull()

    await expect(session.close()).rejects.toMatchObject({ name: 'IllegalStateError' })

    await session.open()
    expect(session.state).toBe('open')
    expect(session.stats).toEqual({
      rxBytes: 0,
      txBytes: 0,
      rxFrames: 0,
      droppedBytes: 0,
      decodeErrors: 0,
    })
    await expect(session.open()).rejects.toMatchObject({ name: 'IllegalStateError' })

    await session.close()
    expect(session.state).toBe('closed')
    await expect(session.close()).rejects.toMatchObject({ name: 'IllegalStateError' })

    await session.open()
    expect(session.state).toBe('open')
    expect(transport.openCalls).toBe(2)
  })

  it('exposes the opening state while transport.open() is pending', async () => {
    const transport = new FakeTransport()
    const gate = deferred<void>()
    transport.openGate = gate
    const session = track(makeSession(transport))

    const opening = session.open()
    expect(session.state).toBe('opening')
    gate.resolve()
    await opening
    expect(session.state).toBe('open')
  })

  it('waits for a pending open before closing (opening + close -> closed)', async () => {
    const transport = new FakeTransport()
    const gate = deferred<void>()
    transport.openGate = gate
    const session = track(makeSession(transport))

    const opening = session.open()
    const closing = session.close()
    expect(session.state).toBe('closing')
    gate.resolve()
    await opening
    await closing
    expect(session.state).toBe('closed')
    expect(transport.closeCalls).toBe(1)
  })

  it('maps open failures to the localized texts from plan §9', async () => {
    const transport = new FakeTransport()
    const session = track(makeSession(transport))

    transport.openError = new DOMException('busy', 'InvalidStateError')
    await expect(session.open()).rejects.toThrow('端口已被打开')
    expect(session.state).toBe('error')
    expect(session.lastError).toBe(
      '端口已被打开，可能正在其他标签页或程序中使用。请关闭占用后重试。',
    )

    transport.openError = new DOMException('gone', 'NetworkError')
    await expect(session.open()).rejects.toThrow('无法打开端口')
    expect(session.lastError).toBe(
      '无法打开端口，可能被其他程序占用或设备已断开。请检查连接后重试。',
    )

    transport.openError = new Error('boom')
    await expect(session.open()).rejects.toThrow('打开端口失败：boom')
    expect(session.lastError).toBe('打开端口失败：boom')

    transport.openError = null
    await session.open()
    expect(session.state).toBe('open')
  })

  it('allows updateSettings only in idle/closed/error and stages settings otherwise', async () => {
    const transport = new FakeTransport()
    const session = track(makeSession(transport))

    session.updateSettings({ baudRate: 9600 })
    expect(session.settings.baudRate).toBe(9600)

    await session.open()
    expect(() => session.updateSettings({ baudRate: 115200 })).toThrow(IllegalStateError)
    session.stageSettings({ baudRate: 115200 })
    expect(session.settings.baudRate).toBe(115200)
    await session.close()
    session.updateSettings({ baudRate: 57600 })
    expect(session.settings.baudRate).toBe(57600)
  })
})

describe('LinkSession read loop', () => {
  it('frames RX bytes and counts frames', async () => {
    const transport = new FakeTransport()
    const session = track(makeSession(transport))
    await session.open()

    transport.push([0x61, 0x0a, 0x62, 0x0a])
    await flushMicrotasks()

    expect(session.stats.rxBytes).toBe(4)
    expect(session.stats.rxFrames).toBe(2)
    expect(logTexts(session, 'rx')).toEqual(['a', 'b'])
  })

  it('keeps reading after a recoverable read error and logs a warning', async () => {
    const transport = new FakeTransport()
    const session = track(makeSession(transport))
    await session.open()

    transport.push([0x61, 0x0a])
    await flushMicrotasks()
    transport.raiseReadError('BreakError')
    await flushMicrotasks(20)

    expect(session.state).toBe('open')
    expect(session.log.search((entry) => entry.text.includes('BreakError'), 5)).toHaveLength(1)

    transport.push([0x62, 0x0a])
    await flushMicrotasks(20)
    expect(logTexts(session, 'rx')).toEqual(['a', 'b'])
  })

  it('enters error state on a fatal read error', async () => {
    const transport = new FakeTransport()
    const session = track(makeSession(transport))
    await session.open()

    transport.raiseReadError('NetworkError')
    await flushMicrotasks(25)

    expect(session.state).toBe('error')
    expect(session.lastError).toContain('读取失败')
  })

  it('flushes a partial line after the idle timeout', async () => {
    vi.useFakeTimers()
    const transport = new FakeTransport()
    const session = track(
      makeSession(transport, { rxOptions: { framing: 'line', idleMs: 20, encoding: 'utf-8' } }),
    )
    await session.open()

    transport.push([0x61, 0x62, 0x63])
    await flushMicrotasks()
    expect(logTexts(session, 'rx')).toEqual([])

    await vi.advanceTimersByTimeAsync(30)
    expect(logTexts(session, 'rx')).toEqual(['abc'])
  })

  it('batches entries events every 50ms', async () => {
    vi.useFakeTimers()
    const transport = new FakeTransport()
    const session = track(makeSession(transport))
    await session.open()
    const events: string[][] = []
    session.on('entries', (payload) => {
      events.push(payload.added.map((entry) => entry.text))
    })

    transport.push([0x61, 0x0a])
    await flushMicrotasks()
    expect(events).toEqual([])

    await vi.advanceTimersByTimeAsync(60)
    expect(events).toEqual([['a']])
  })
})

describe('LinkSession write queue', () => {
  it('serializes sends and appends TX log entries', async () => {
    const transport = new FakeTransport()
    const session = track(makeSession(transport))
    await session.open()

    const gate = deferred<void>()
    transport.writeGate = gate
    const first = session.send(Uint8Array.from([1]), 'manual')
    const second = session.send(Uint8Array.from([2]), 'quick')
    await flushMicrotasks()
    expect(transport.writeStarts).toEqual([1])

    gate.resolve()
    await first
    await second
    await flushMicrotasks()

    expect(transport.writeStarts).toEqual([1, 2])
    expect(session.stats.txBytes).toBe(2)
    const txEntries = session.log.search((entry) => entry.dir === 'tx', 10).reverse()
    expect(txEntries.map((entry) => entry.origin)).toEqual(['manual', 'quick'])
  })

  it('logs write failures, stops tasks, rejects the caller and stays open', async () => {
    const transport = new FakeTransport()
    const session = track(makeSession(transport))
    await session.open()
    transport.failWrites = true

    await expect(session.send(Uint8Array.from([1]), 'manual')).rejects.toThrow(
      '发送失败：写入失败（测试）。已停止自动发送任务。',
    )
    expect(session.state).toBe('open')
    expect(
      session.log.search((entry) => entry.text.includes('已停止自动发送任务'), 5),
    ).toHaveLength(1)
  })

  it('stops repeat and macro tasks when a write fails', async () => {
    const transport = new FakeTransport()
    const session = track(makeSession(transport))
    await session.open()

    session.startMacro({
      id: 'm1',
      name: '测试宏',
      loop: true,
      steps: [
        { type: 'delay', ms: 60_000 },
        { type: 'send', input: 'AT', options: defaultComposeOptions() },
      ],
    })
    expect(session.tasks.macro).not.toBeNull()

    transport.failWrites = true
    session.startRepeat({ bytes: Uint8Array.from([7]), intervalMs: 10, count: null })
    await flushMicrotasks(20)

    expect(session.tasks.repeat).toBeNull()
    expect(session.tasks.macro).toBeNull()
  })

  it('rejects sending while not open', async () => {
    const session = track(makeSession())
    await expect(session.send(Uint8Array.from([1]), 'manual')).rejects.toBeInstanceOf(
      IllegalStateError,
    )
    await expect(session.sendForm({})).rejects.toBeInstanceOf(IllegalStateError)
  })
})

describe('LinkSession disconnect handling', () => {
  it('switches to error, logs 设备已断开 and can reconnect', async () => {
    const transport = new FakeTransport()
    const session = track(makeSession(transport))
    await session.open()

    transport.emitDisconnect()
    await flushMicrotasks(25)

    expect(session.state).toBe('error')
    expect(session.lastError).toBe('设备已断开')
    expect(logTexts(session, 'system')).toContain('设备已断开')
    expect(session.tasks.repeat).toBeNull()

    await session.open()
    expect(session.state).toBe('open')
    transport.push([0x6f, 0x6b, 0x0a])
    await flushMicrotasks()
    expect(logTexts(session, 'rx')).toContain('ok')
  })
})

describe('LinkSession signals', () => {
  it('forwards DTR/RTS to the transport and exposes the tri-state', async () => {
    const transport = new FakeTransport()
    const session = track(makeSession(transport))
    await session.open()

    await session.setSignals({ dtr: true, rts: false })
    expect(transport.signalCalls).toEqual([{ dtr: true, rts: false }])
    expect(session.signals).toEqual({ dtr: true, rts: false })

    const events: unknown[] = []
    session.on('signals', (payload) => events.push(payload))
    await session.setSignals({ dtr: false })
    expect(events).toEqual([{ dtr: false, rts: false }])
  })

  it('rejects break when the transport does not support it', async () => {
    const transport = new FakeTransport()
    transport.capabilities = { lineSettings: true, signals: true, break: false }
    const session = track(makeSession(transport))
    await session.open()
    await expect(session.setSignals({ brk: true })).rejects.toThrow('该通道不支持 Break 控制')
  })

  it('rejects signal changes when the transport has no such capability', async () => {
    const transport = new FakeTransport()
    transport.capabilities = {
      lineSettings: true,
      signals: false,
      break: false,
    }
    const session = track(makeSession(transport))
    await session.open()
    await expect(session.setSignals({ dtr: true })).rejects.toThrow('该通道不支持控制线')
  })
})

describe('LinkSession device memory', () => {
  it('saves settings and display mode on open and display changes', async () => {
    const memory = createDeviceMemoryStore()
    const transport = new FakeTransport()
    const session = track(makeSession(transport, { memory, settings: { baudRate: 9600 } }))
    await session.open()

    const opened = memory.get('fake:1')
    expect(opened?.settings).toEqual({ baudRate: 9600 })
    expect(opened?.displayMode).toBe('both')

    session.displayMode = 'raw'
    expect(memory.get('fake:1')?.displayMode).toBe('raw')
  })
})

describe('LinkManager', () => {
  it('dedupes transports by isSameDevice and allocates sequential ids', async () => {
    const manager = createLinkManager()
    const counts: number[] = []
    const unsubscribe = manager.on('sessions', (list) => counts.push(list.length))

    const transport = new FakeTransport()
    const first = manager.createFrom(transport)
    expect(first.id).toBe('s1')
    expect(manager.createFrom(transport)).toBe(first)
    expect(manager.sessions()).toHaveLength(1)

    const second = manager.createFrom(new FakeTransport())
    expect(second.id).toBe('s2')
    expect(manager.sessions()).toHaveLength(2)
    expect(counts).toEqual([1, 2])

    expect(manager.get(first.id)).toBe(first)
    await first.dispose()
    expect(manager.sessions()).toHaveLength(1)
    expect(counts).toEqual([1, 2, 1])
    unsubscribe()
    await manager.disposeAll()
  })

  it('lists providers and authorized ports', async () => {
    const manager = createLinkManager()
    expect(manager.listProviders().map((provider) => provider.kind)).toEqual([
      'web-serial',
      'virtual',
    ])
    await expect(manager.listAuthorized()).resolves.toEqual([])
    await manager.disposeAll()
  })

  it('creates demo sessions through request()', async () => {
    const manager = createLinkManager()
    const session = await manager.request('virtual')
    expect(session?.providerKind).toBe('virtual')
    expect(session?.state).toBe('idle')
    expect(session?.settings).toMatchObject({ format: 'sensor-a5', interval: 1000, channels: 8 })
    expect(session?.logPolicy).toEqual({ mode: 'all', maxPerSecond: 20, auto: true })
    expect(session?.transport.deviceKey).toBe('virtual')
    await expect(manager.request('unknown-kind')).rejects.toThrow('未知的通道类型')
    await session?.dispose()
    await manager.disposeAll()
  })

  it('prefills new sessions from device memory without opening them', async () => {
    const memory = createDeviceMemoryStore()
    memory.save({
      deviceKey: 'fake:1',
      settings: { baudRate: 9600 },
      protocolId: null,
      rxOptions: { framing: 'idle', idleMs: 40, encoding: 'gbk' },
      displayMode: 'raw',
      updatedAt: 1,
    })
    const manager = createLinkManager({ memory })
    const session = manager.createFrom(new FakeTransport())
    expect(session.settings).toEqual({ baudRate: 9600 })
    expect(session.rxOptions).toEqual({ framing: 'idle', idleMs: 40, encoding: 'gbk' })
    expect(session.displayMode).toBe('raw')
    expect(session.state).toBe('idle')
    await manager.disposeAll()
  })
})

describe('LinkSession protocol integration (injected runtime)', () => {
  function protocolSession(
    transport = new FakeTransport(),
    runtime = new FakeRuntime(),
    extra: Partial<Parameters<typeof createLinkSession>[0]> = {},
  ): { session: LinkSession; runtime: FakeRuntime } {
    return {
      runtime,
      session: track(
        makeSession(transport, {
          createRuntime: () => Promise.resolve(runtime),
          ...extra,
        }),
      ),
    }
  }

  it('loads the protocol, logs rx frames with decoded results and exposes sendForm', async () => {
    const { session, runtime } = protocolSession()
    await session.setProtocol('builtin:sensor-a5')
    expect(session.protocol).toMatchObject({
      id: 'builtin:sensor-a5',
      name: '假协议',
      status: 'active',
    })
    expect(session.protocol?.sendForm?.[0]?.label).toBe('数值')

    await session.open()
    runtime.emitFrames([
      {
        bytes: new Uint8Array([1, 2]),
        at: 5,
        direction: 'rx',
        results: [{ summary: '温度 25.00°C' }],
      },
    ])
    await flushMicrotasks()

    expect(session.stats.rxFrames).toBe(1)
    const entry = session.log.search((item) => item.dir === 'rx', 1)[0]
    expect(entry?.decoded?.protocolId).toBe('builtin:sensor-a5')
    expect(entry?.decoded?.results[0]?.summary).toBe('温度 25.00°C')
  })

  it('backfills TX decoded data and emits entries with updated seqs', async () => {
    vi.useFakeTimers()
    const { session, runtime } = protocolSession()
    await session.setProtocol('builtin:sensor-a5')
    await session.open()

    const events: Array<{ added: number; updated?: number[] }> = []
    session.on('entries', (payload) => {
      events.push({ added: payload.added.length, updated: payload.updated })
    })

    await session.send(Uint8Array.from([7]), 'manual')
    const txSeq = session.log.lastSeq
    runtime.emitFrames([
      { bytes: new Uint8Array([7]), at: 9, direction: 'tx', results: [{ summary: '写入成功' }] },
    ])
    await flushMicrotasks()
    const txEntry = session.log.search((item) => item.dir === 'tx', 1)[0]
    expect(txEntry?.decoded?.results[0]?.summary).toBe('写入成功')

    await vi.advanceTimersByTimeAsync(60)
    expect(events.some((event) => event.updated?.includes(txSeq))).toBe(true)
  })

  it('sends encoded values with origin protocol and reports encode errors', async () => {
    const transport = new FakeTransport()
    const { session, runtime } = protocolSession(transport)
    await session.setProtocol('builtin:sensor-a5')
    await session.open()

    await session.sendForm({ v: 2 })
    expect(runtime.encodeValues).toEqual({ v: 2 })
    expect([...(transport.writes[0] as Uint8Array)]).toEqual([0x99])
    expect(session.log.search((item) => item.dir === 'tx', 1)[0]?.origin).toBe('protocol')

    runtime.encodeError = '坏值'
    await expect(session.sendForm({ v: 3 })).rejects.toThrow('协议编码失败：坏值')
    expect(session.log.search((item) => item.text.includes('协议编码失败'), 1)).toHaveLength(1)
  })

  it('falls back to no-protocol mode when the protocol cannot be loaded', async () => {
    const { session } = protocolSession()
    await session.setProtocol('missing:protocol')
    expect(session.protocol).toBeNull()
    expect(session.log.search((item) => item.text.includes('协议加载失败'), 1)).toHaveLength(1)
  })

  it('disables the protocol on a fatal runtime error and falls back to framing', async () => {
    const transport = new FakeTransport()
    const { session, runtime } = protocolSession(transport)
    await session.setProtocol('builtin:sensor-a5')
    await session.open()

    runtime.emitFatal('看门狗超时')
    await flushMicrotasks()
    expect(session.protocol?.status).toBe('disabled')
    expect(session.log.search((item) => item.text.includes('协议执行超时'), 1)).toHaveLength(1)

    transport.push([0x6f, 0x6b, 0x0a])
    await flushMicrotasks()
    expect(logTexts(session, 'rx')).toContain('ok')
  })

  it('merges discarded bytes into one unframed log entry', async () => {
    vi.useFakeTimers()
    const { session, runtime } = protocolSession()
    await session.setProtocol('builtin:sensor-a5')
    await session.open()

    runtime.emitDiscard({ bytes: Uint8Array.from([1, 2]), at: 1, reason: 'sync' })
    runtime.emitDiscard({ bytes: Uint8Array.from([3]), at: 2, reason: 'resync' })
    await vi.advanceTimersByTimeAsync(120)

    const entries = session.log.search((item) => item.decoded?.unframed === true, 5)
    expect(entries).toHaveLength(1)
    expect(entries[0]?.decoded?.error).toBe('未成帧数据')
    expect([...(entries[0]?.bytes ?? [])]).toEqual([1, 2, 3])
    expect(session.stats.droppedBytes).toBe(3)
    expect(session.protocolOverflowBytes).toBe(0)
  })

  it('rate limits decode error logs to one per second and appends suppressed counts', async () => {
    let now = 10_000
    const { session, runtime } = protocolSession(new FakeTransport(), new FakeRuntime(), {
      now: () => now,
    })
    await session.setProtocol('builtin:sensor-a5')
    await session.open()

    const frame = (error: string): ProtocolFrame => ({
      bytes: new Uint8Array([1]),
      at: now,
      direction: 'rx',
      results: [],
      error,
    })
    runtime.emitFrames([frame('坏帧')])
    runtime.emitFrames([frame('坏帧')])
    await flushMicrotasks()
    expect(session.stats.decodeErrors).toBe(2)
    expect(session.log.search((item) => item.text.includes('协议解码出错'), 10)).toHaveLength(1)

    now += 1000
    runtime.emitFrames([frame('坏帧')])
    await flushMicrotasks()
    const logs = session.log.search((item) => item.text.includes('协议解码出错'), 10)
    expect(logs).toHaveLength(2)
    expect(logs[0]?.text).toContain('（另有 1 条同类错误）')
  })

  it('counts protocol input overflow bytes', async () => {
    const { session, runtime } = protocolSession()
    await session.setProtocol('builtin:sensor-a5')
    await session.open()

    runtime.emitDiscard({ bytes: new Uint8Array(10), at: 1, reason: 'overflow' })
    await flushMicrotasks()
    expect(session.protocolOverflowBytes).toBe(10)
    expect(session.stats.droppedBytes).toBe(10)
  })
})

describe('LinkSession frames event', () => {
  function framesSession(): { session: LinkSession; runtime: FakeRuntime } {
    const runtime = new FakeRuntime()
    const session = track(
      makeSession(new FakeTransport(), { createRuntime: () => Promise.resolve(runtime) }),
    )
    return { session, runtime }
  }

  it('emits every decoded batch synchronously with a session-local seq', async () => {
    const { session, runtime } = framesSession()
    await session.setProtocol('builtin:sensor-a5')
    await session.open()
    const batches: DecodedFrame[][] = []
    session.on('frames', (frames) => batches.push(frames))

    runtime.emitFrames([
      { bytes: new Uint8Array([1]), at: 10, direction: 'rx', results: [{ summary: 'a' }] },
      { bytes: new Uint8Array([2]), at: 11, direction: 'rx', results: [] },
    ])
    // Synchronous: no timer or microtask is needed before the event arrives.
    expect(batches).toHaveLength(1)
    const first = batches[0]
    expect(first?.map((frame) => frame.seq)).toEqual([1, 2])
    expect(first?.map((frame) => frame.direction)).toEqual(['rx', 'rx'])
    expect(first?.[0]?.bytes).toEqual(new Uint8Array([1]))
    expect(first?.[0]?.at).toBe(10)
    expect(first?.[0]?.results[0]?.summary).toBe('a')
    expect(first?.[0]?.error).toBeUndefined()

    runtime.emitFrames([
      { bytes: new Uint8Array([3]), at: 12, direction: 'rx', results: [], error: '坏帧' },
    ])
    expect(batches).toHaveLength(2)
    expect(batches[1]?.map((frame) => frame.seq)).toEqual([3])
    expect(batches[1]?.[0]?.results).toEqual([])
    expect(batches[1]?.[0]?.error).toBe('坏帧')

    runtime.emitFrames([
      { bytes: new Uint8Array([4]), at: 13, direction: 'rx', results: [] },
      { bytes: new Uint8Array([5]), at: 14, direction: 'rx', results: [] },
    ])
    expect(batches[2]?.map((frame) => frame.seq)).toEqual([4, 5])
  })

  it('includes TX frames and is not sampled by the log policy', async () => {
    const { session, runtime } = framesSession()
    await session.setProtocol('builtin:sensor-a5')
    await session.open()
    session.logPolicy = { mode: 'none', maxPerSecond: 20, auto: true }
    const batches: DecodedFrame[][] = []
    session.on('frames', (frames) => batches.push(frames))

    runtime.emitFrames([
      { bytes: new Uint8Array([1]), at: 1, direction: 'rx', results: [{ summary: 'rx' }] },
      { bytes: new Uint8Array([2]), at: 2, direction: 'tx', results: [{ summary: 'tx' }] },
    ])
    expect(batches).toHaveLength(1)
    expect(batches[0]?.map((frame) => frame.direction)).toEqual(['rx', 'tx'])
    expect(batches[0]?.map((frame) => frame.seq)).toEqual([1, 2])
    // `none` suppresses the decoded RX log entry but not the frames event.
    expect(session.log.search((entry) => entry.dir === 'rx', 10)).toHaveLength(0)
  })

  it('does not emit a frames event without a protocol', async () => {
    const transport = new FakeTransport()
    const session = track(makeSession(transport))
    await session.open()
    const batches: DecodedFrame[][] = []
    session.on('frames', (frames) => batches.push(frames))

    transport.push([0x6f, 0x6b, 0x0a])
    await flushMicrotasks()
    expect(batches).toEqual([])
  })
})

describe('VirtualTransport demo device', () => {
  function sensorFrame(cmd: number, data: number[]): Uint8Array {
    const body: number[] = [0xa5, 0x5a, data.length + 1, cmd, ...data]
    const crc = checksum('crc16-modbus', Uint8Array.from(body))
    body.push(crc & 0xff, (crc >> 8) & 0xff)
    return Uint8Array.from(body)
  }

  it('reports a valid sensor frame every interval', async () => {
    vi.useFakeTimers()
    const transport = new VirtualTransport('演示端口 测试')
    await transport.open({ interval: 100 })
    expect(transport.deviceKey).toBe('virtual')
    expect(transport.capabilities).toEqual({
      lineSettings: false,
      signals: true,
      break: false,
    })

    const reader = transport.readable?.getReader()
    expect(reader).toBeDefined()
    if (reader === undefined) return

    const pending = reader.read()
    await vi.advanceTimersByTimeAsync(100)
    const result = await pending
    const frame = result.value as Uint8Array

    expect([...frame.subarray(0, 4)]).toEqual([0xa5, 0x5a, 11, 0x01])
    const expected = checksum('crc16-modbus', frame.subarray(0, frame.length - 2))
    expect(read.u16le(frame, frame.length - 2)).toBe(expected)
    const temperature = read.i16le(frame, 4) / 100
    const humidity = read.u16le(frame, 6) / 100
    const voltage = read.u16le(frame, 8)
    expect(temperature).toBeGreaterThanOrEqual(20)
    expect(temperature).toBeLessThanOrEqual(30)
    expect(humidity).toBeGreaterThanOrEqual(40)
    expect(humidity).toBeLessThanOrEqual(60)
    expect(voltage).toBeGreaterThanOrEqual(3250)
    expect(voltage).toBeLessThanOrEqual(3350)
    expect(read.u32le(frame, 10)).toBe(0)

    await transport.close()
  })

  it('acknowledges a valid interval and rejects an out-of-range one', async () => {
    vi.useFakeTimers()
    const transport = new VirtualTransport('演示端口 测试')
    await transport.open({ interval: 1000 })
    const reader = transport.readable?.getReader()
    const writer = transport.writable?.getWriter()
    expect(reader).toBeDefined()
    expect(writer).toBeDefined()
    if (reader === undefined || writer === undefined) return

    await writer.write(sensorFrame(0x10, [0xc8, 0x00]))
    const ack = (await reader.read()).value as Uint8Array
    expect([...ack.subarray(0, 4)]).toEqual([0xa5, 0x5a, 4, 0x90])
    expect(read.u8(ack, 4)).toBe(0)
    expect(read.u16le(ack, 5)).toBe(200)

    await writer.write(sensorFrame(0x10, [0x05, 0x00]))
    const rejected = (await reader.read()).value as Uint8Array
    expect(read.u8(rejected, 4)).toBe(1)
    expect(read.u16le(rejected, 5)).toBe(200)

    await transport.close()
  })

  it('echoes printable ASCII / CRLF data', async () => {
    vi.useFakeTimers()
    const transport = new VirtualTransport('演示端口 测试')
    await transport.open({ interval: 1000 })
    const reader = transport.readable?.getReader()
    const writer = transport.writable?.getWriter()
    if (reader === undefined || writer === undefined) return

    const text = new TextEncoder().encode('AT\r\n')
    await writer.write(text)
    const echo = (await reader.read()).value as Uint8Array
    expect([...echo]).toEqual([...text])

    await transport.close()
  })

  it('resets the counter when DTR falls', async () => {
    vi.useFakeTimers()
    const transport = new VirtualTransport('演示端口 测试')
    await transport.open({ interval: 100 })
    const reader = transport.readable?.getReader()
    if (reader === undefined) return

    let pending = reader.read()
    await vi.advanceTimersByTimeAsync(100)
    expect(read.u32le((await pending).value as Uint8Array, 10)).toBe(0)

    pending = reader.read()
    await vi.advanceTimersByTimeAsync(100)
    expect(read.u32le((await pending).value as Uint8Array, 10)).toBe(1)

    await transport.setSignals({ dtr: true })
    await transport.setSignals({ dtr: false })
    const reset = (await reader.read()).value as Uint8Array
    expect(new TextDecoder().decode(reset)).toBe('[demo] reset\r\n')

    pending = reader.read()
    await vi.advanceTimersByTimeAsync(100)
    expect(read.u32le((await pending).value as Uint8Array, 10)).toBe(0)

    await transport.close()
  })

  it('stops its timer on close and exposes demo value helpers', async () => {
    vi.useFakeTimers()
    const device = new DemoDevice({ intervalMs: 100 })
    const frames: Uint8Array[] = []
    device.start((bytes) => frames.push(bytes))
    await vi.advanceTimersByTimeAsync(100)
    expect(frames).toHaveLength(1)
    device.stop()
    await vi.advanceTimersByTimeAsync(500)
    expect(frames).toHaveLength(1)

    expect(demoTemperature(0)).toBe(25)
    expect(demoHumidity(0)).toBeCloseTo(50 + 10 * Math.sin(1))
    expect(demoVoltage(0)).toBeCloseTo(3300 + 50 * Math.sin(2))
    expect(normalizeDemoInterval(5, 'sensor-a5')).toBe(100)
    expect(normalizeDemoInterval(undefined, 'firewater')).toBe(10)

    const transport = new VirtualTransport('演示端口 测试')
    await transport.open({ interval: 100 })
    const reader = transport.readable?.getReader()
    if (reader === undefined) return
    await transport.close()
    const done = await reader.read()
    expect(done.done).toBe(true)
  })

  it('creates providers with incrementing labels and the virtual device key', async () => {
    const first = createVirtualTransport()
    const second = createVirtualTransport()
    expect(first.deviceKey).toBe('virtual')
    expect(first.label).not.toBe(second.label)
    expect(first.label.startsWith('演示端口 ')).toBe(true)
    expect(second.label.startsWith('演示端口 ')).toBe(true)
  })
})
