import { describe, expect, it } from 'vitest'

import {
  BRIDGE_QUEUE_LIMIT_BYTES,
  createBridgeService,
  type BridgeRule,
  type BridgeService,
  type BridgeSession,
} from '../../../src/domains/link/bridge/service'
import type { Origin, SessionState } from '../../../src/domains/link/session/state'

interface Deferred<T> {
  promise: Promise<T>
  resolve: (value: T) => void
}

function deferred<T>(): Deferred<T> {
  let resolve: (value: T) => void = () => {}
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise
  })
  return { promise, resolve }
}

async function flushMicrotasks(times = 16): Promise<void> {
  for (let index = 0; index < times; index += 1) await Promise.resolve()
}

class FakeSession implements BridgeSession {
  state: SessionState = 'open'
  readonly writes: Array<{ bytes: Uint8Array; origin: Origin }> = []
  readonly logs: Array<{ level: 'info' | 'warn' | 'error'; text: string }> = []
  sendGate: Deferred<void> | null = null
  failSend = false

  private readonly rawHandlers = new Set<(bytes: Uint8Array) => void>()
  private readonly stateHandlers = new Set<(state: SessionState) => void>()
  private readonly disposeHandlers = new Set<() => void>()

  constructor(
    readonly id: string,
    readonly name: string,
  ) {}

  send(bytes: Uint8Array, origin: Origin): Promise<void> {
    if (this.sendGate !== null) {
      const gate = this.sendGate
      return gate.promise.then(() => this.finishSend(bytes, origin))
    }
    return this.finishSend(bytes, origin)
  }

  private finishSend(bytes: Uint8Array, origin: Origin): Promise<void> {
    if (this.failSend) return Promise.reject(new Error('发送失败（测试）'))
    this.writes.push({ bytes: Uint8Array.from(bytes), origin })
    return Promise.resolve()
  }

  on(ev: 'state', handler: (state: SessionState) => void): () => void {
    void ev
    this.stateHandlers.add(handler)
    return () => {
      this.stateHandlers.delete(handler)
    }
  }

  onRawRx(handler: (bytes: Uint8Array) => void): () => void {
    this.rawHandlers.add(handler)
    return () => {
      this.rawHandlers.delete(handler)
    }
  }

  onDispose(handler: () => void): () => void {
    this.disposeHandlers.add(handler)
    return () => {
      this.disposeHandlers.delete(handler)
    }
  }

  writeSystemLog(level: 'info' | 'warn' | 'error', text: string): void {
    this.logs.push({ level, text })
  }

  emitRaw(bytes: Uint8Array | number[]): void {
    for (const handler of [...this.rawHandlers]) handler(Uint8Array.from(bytes))
  }

  setState(state: SessionState): void {
    this.state = state
    for (const handler of [...this.stateHandlers]) handler(state)
  }

  dispose(): void {
    for (const handler of [...this.disposeHandlers]) handler()
  }
}

function setup(): {
  service: BridgeService
  a: FakeSession
  b: FakeSession
  c: FakeSession
  rule(): BridgeRule
} {
  const a = new FakeSession('sa', '通道 A')
  const b = new FakeSession('sb', '通道 B')
  const c = new FakeSession('sc', '通道 C')
  const sessions = new Map<string, FakeSession>([
    [a.id, a],
    [b.id, b],
    [c.id, c],
  ])
  const service = createBridgeService({ getSession: (id) => sessions.get(id) })
  return {
    service,
    a,
    b,
    c,
    rule: () => {
      const rules = service.list()
      expect(rules).toHaveLength(1)
      return rules[0] as BridgeRule
    },
  }
}

describe('bridge service', () => {
  it('forwards a → b for oneway rules with origin bridge', async () => {
    const { service, a, b, rule } = setup()
    const added = service.add(a.id, b.id, 'oneway')
    expect(added.ok).toBe(true)

    a.emitRaw([1, 2, 3])
    await flushMicrotasks()

    expect(b.writes).toHaveLength(1)
    expect([...(b.writes[0]?.bytes ?? [])]).toEqual([1, 2, 3])
    expect(b.writes[0]?.origin).toBe('bridge')
    expect(rule().stats.aToB).toBe(3)

    b.emitRaw([9])
    await flushMicrotasks()
    expect(a.writes).toHaveLength(0)
  })

  it('forwards both directions for duplex rules', async () => {
    const { service, a, b } = setup()
    expect(service.add(a.id, b.id, 'duplex').ok).toBe(true)

    a.emitRaw([1])
    b.emitRaw([2, 3])
    await flushMicrotasks()

    expect(a.writes.map((write) => [...write.bytes])).toEqual([[2, 3]])
    expect(b.writes.map((write) => [...write.bytes])).toEqual([[1]])
    const rules = service.list()
    expect(rules[0]?.stats).toEqual({ aToB: 1, bToA: 2, dropped: 0 })
  })

  it('rejects forwarding to itself', () => {
    const { service, a } = setup()
    expect(service.add(a.id, a.id, 'oneway')).toEqual({
      ok: false,
      error: '不能转发到自身',
    })
  })

  it('rejects duplicate rules and duplicates after a duplex rule', () => {
    const { service, a, b } = setup()
    expect(service.add(a.id, b.id, 'oneway').ok).toBe(true)
    expect(service.add(a.id, b.id, 'oneway')).toEqual({
      ok: false,
      error: '已存在相同的转发规则',
    })
    expect(service.add(a.id, b.id, 'duplex')).toEqual({
      ok: false,
      error: '已存在相同的转发规则',
    })
  })

  it('merges a reverse oneway rule into one duplex rule', async () => {
    const { service, a, b } = setup()
    expect(service.add(a.id, b.id, 'oneway').ok).toBe(true)
    a.emitRaw([1])
    await flushMicrotasks()

    const merged = service.add(b.id, a.id, 'oneway')
    expect(merged.ok).toBe(true)
    if (!merged.ok) return
    expect(merged.rule.mode).toBe('duplex')
    expect(service.list()).toHaveLength(1)
    expect(service.list()[0]?.stats.aToB).toBe(1)

    b.emitRaw([2])
    await flushMicrotasks()
    expect(a.writes.map((write) => [...write.bytes])).toEqual([[2]])
  })

  it('rejects rules that would create a 3-node directed cycle', () => {
    const { service, a, b, c } = setup()
    expect(service.add(a.id, b.id, 'oneway').ok).toBe(true)
    expect(service.add(b.id, c.id, 'oneway').ok).toBe(true)
    expect(service.add(c.id, a.id, 'oneway')).toEqual({
      ok: false,
      error: '该规则会形成转发环路',
    })
  })

  it('drops the oldest queued blocks when a direction exceeds 256KB', async () => {
    const { service, a, b, rule } = setup()
    const gate = deferred<void>()
    b.sendGate = gate
    expect(service.add(a.id, b.id, 'oneway').ok).toBe(true)

    const chunk = new Uint8Array(64 * 1024).fill(0x55)
    for (let index = 0; index < 6; index += 1) a.emitRaw(chunk)
    await flushMicrotasks()
    expect(rule().stats.dropped).toBe(64 * 1024)
    expect(BRIDGE_QUEUE_LIMIT_BYTES).toBe(256 * 1024)

    gate.resolve()
    await flushMicrotasks(40)
    expect(rule().stats.aToB).toBe(5 * 64 * 1024)
    expect(b.writes).toHaveLength(5)
  })

  it('pauses a rule when an endpoint leaves the open state and never auto-resumes', async () => {
    const { service, a, b, rule } = setup()
    service.add(a.id, b.id, 'oneway')

    b.setState('error')
    expect(rule().paused).toBe(true)
    expect(a.logs.some((log) => log.text === '转发已暂停：通道 B 已断开')).toBe(true)
    expect(b.logs.some((log) => log.text === '转发已暂停：通道 B 已断开')).toBe(true)

    b.setState('open')
    expect(rule().paused).toBe(true)

    a.emitRaw([1])
    await flushMicrotasks()
    expect(b.writes).toHaveLength(0)

    service.setPaused(rule().id, false)
    expect(rule().paused).toBe(false)
  })

  it('removes rules when a session is disposed', async () => {
    const { service, a, b } = setup()
    service.add(a.id, b.id, 'duplex')
    expect(service.list()).toHaveLength(1)

    b.dispose()
    expect(service.list()).toHaveLength(0)

    a.emitRaw([1])
    await flushMicrotasks()
    expect(b.writes).toHaveLength(0)
  })

  it('removes rules explicitly and reports change events', async () => {
    const { service, a, b, rule } = setup()
    const changes: number[] = []
    service.on('change', (rules) => changes.push(rules.length))

    service.add(a.id, b.id, 'oneway')
    expect(changes).toEqual([1])

    service.remove(rule().id)
    expect(changes).toEqual([1, 0])
    expect(service.list()).toHaveLength(0)
  })

  it('rejects unknown sessions', () => {
    const { service } = setup()
    expect(service.add('nope', 'sb', 'oneway')).toEqual({ ok: false, error: '会话不存在' })
  })

  it('stops forwarding when the target write fails', async () => {
    const { service, a, b, rule } = setup()
    b.failSend = true
    service.add(a.id, b.id, 'oneway')

    a.emitRaw([1, 2])
    await flushMicrotasks()
    expect(rule().stats.dropped).toBe(2)
    expect(b.writes).toHaveLength(0)
  })
})
