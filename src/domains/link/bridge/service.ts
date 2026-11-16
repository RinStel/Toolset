/**
 * Bridge service: forwards raw RX blocks between sessions (plan §6.6).
 *
 * At most 256 KB are queued per direction; the oldest blocks are dropped when a
 * target cannot keep up. Rules are not persisted and are removed when a session
 * is disposed. A rule pauses (and never auto-resumes) when an endpoint leaves
 * the open state.
 */

import { createEmitter, type Unsubscribe } from '../../../shared/lib/events'
import { uuid } from '../../../shared/lib/id'
import { getLinkManager } from '../session/manager'
import type { LinkSession } from '../session/session'
import type { Origin, SessionState } from '../session/state'

export type BridgeMode = 'oneway' | 'duplex'

export interface BridgeRule {
  id: string
  /** Source session of the a→b direction. */
  a: string
  /** Target session of the a→b direction. */
  b: string
  mode: BridgeMode
  paused: boolean
  stats: { aToB: number; bToA: number; dropped: number }
}

export type BridgeAddResult = { ok: true; rule: BridgeRule } | { ok: false; error: string }

/** Maximum bytes queued per forwarding direction. */
export const BRIDGE_QUEUE_LIMIT_BYTES = 256 * 1024

/** Minimal session surface the bridge needs. */
export interface BridgeSession {
  readonly id: string
  readonly name: string
  readonly state: SessionState
  send(bytes: Uint8Array, origin: Origin): Promise<void>
  on(ev: 'state', handler: (state: SessionState) => void): Unsubscribe
  /** Raw RX blocks before framing. */
  onRawRx(handler: (bytes: Uint8Array) => void): () => void
  onDispose(handler: () => void): () => void
  writeSystemLog(level: 'info' | 'warn' | 'error', text: string): void
}

export interface BridgeServiceOptions {
  getSession(id: string): BridgeSession | undefined
}

export interface BridgeService {
  list(): BridgeRule[]
  add(a: string, b: string, mode: BridgeMode): BridgeAddResult
  setPaused(id: string, paused: boolean): void
  remove(id: string): void
  on(ev: 'change', handler: (rules: BridgeRule[]) => void): Unsubscribe
  /** Removes every rule (page unmount). */
  dispose(): void
}

class ForwardQueue {
  private queue: Uint8Array[] = []
  private queuedBytes = 0
  private draining = false

  constructor(
    private readonly rule: BridgeRule,
    private readonly direction: 'aToB' | 'bToA',
    private readonly getTarget: () => BridgeSession | undefined,
    private readonly onForwarded: () => void,
  ) {}

  enqueue(bytes: Uint8Array): void {
    if (this.rule.paused) return
    const chunk = Uint8Array.from(bytes)
    if (chunk.length === 0) return
    if (chunk.length > BRIDGE_QUEUE_LIMIT_BYTES) {
      this.rule.stats.dropped += chunk.length
      return
    }
    while (this.queuedBytes + chunk.length > BRIDGE_QUEUE_LIMIT_BYTES && this.queue.length > 0) {
      const dropped = this.queue.shift()
      if (dropped === undefined) break
      this.queuedBytes -= dropped.length
      this.rule.stats.dropped += dropped.length
    }
    this.queue.push(chunk)
    this.queuedBytes += chunk.length
    void this.drain()
  }

  private record(bytes: number): void {
    if (this.direction === 'aToB') this.rule.stats.aToB += bytes
    else this.rule.stats.bToA += bytes
    this.onForwarded()
  }

  private dropQueued(): void {
    if (this.queue.length === 0) return
    let dropped = 0
    for (const chunk of this.queue) dropped += chunk.length
    this.queue = []
    this.queuedBytes = 0
    this.rule.stats.dropped += dropped
    this.onForwarded()
  }

  private async drain(): Promise<void> {
    if (this.draining) return
    this.draining = true
    try {
      while (this.queue.length > 0) {
        const target = this.getTarget()
        if (target === undefined || target.state !== 'open' || this.rule.paused) {
          this.dropQueued()
          return
        }
        const chunk = this.queue.shift()
        if (chunk === undefined) return
        this.queuedBytes -= chunk.length
        try {
          await target.send(chunk, 'bridge')
        } catch {
          // The target write failed; drop the remaining blocks (session logs the error).
          this.rule.stats.dropped += chunk.length
          this.dropQueued()
          return
        }
        this.record(chunk.length)
      }
    } finally {
      this.draining = false
    }
  }
}

interface RuleState {
  rule: BridgeRule
  sessionA: BridgeSession
  sessionB: BridgeSession
  aToB: ForwardQueue
  bToA: ForwardQueue | null
  unsubscribers: Unsubscribe[]
}

function cloneRule(rule: BridgeRule): BridgeRule {
  return { ...rule, stats: { ...rule.stats } }
}

function collectEdges(states: Map<string, RuleState>): Map<string, Set<string>> {
  const edges = new Map<string, Set<string>>()
  const addEdge = (from: string, to: string): void => {
    let targets = edges.get(from)
    if (targets === undefined) {
      targets = new Set()
      edges.set(from, targets)
    }
    targets.add(to)
  }
  for (const state of states.values()) {
    addEdge(state.rule.a, state.rule.b)
    if (state.rule.mode === 'duplex') addEdge(state.rule.b, state.rule.a)
  }
  return edges
}

function isReachable(edges: Map<string, Set<string>>, from: string, to: string): boolean {
  if (from === to) return true
  const visited = new Set<string>()
  const stack = [from]
  while (stack.length > 0) {
    const current = stack.pop()
    if (current === undefined) break
    if (visited.has(current)) continue
    visited.add(current)
    const targets = edges.get(current)
    if (targets === undefined) continue
    for (const next of targets) {
      if (next === to) return true
      stack.push(next)
    }
  }
  return false
}

class BridgeServiceImpl implements BridgeService {
  private readonly states = new Map<string, RuleState>()
  private readonly emitter = createEmitter<{ change: BridgeRule[]; [event: string]: unknown }>()

  constructor(private readonly options: BridgeServiceOptions) {}

  list(): BridgeRule[] {
    return [...this.states.values()].map((state) => cloneRule(state.rule))
  }

  add(a: string, b: string, mode: BridgeMode): BridgeAddResult {
    if (a === b) return { ok: false, error: '不能转发到自身' }
    const sessionA = this.options.getSession(a)
    const sessionB = this.options.getSession(b)
    if (sessionA === undefined || sessionB === undefined) {
      return { ok: false, error: '会话不存在' }
    }

    const existing = this.findByPair(a, b)
    if (existing !== undefined) {
      if (existing.rule.mode === 'duplex') {
        return { ok: false, error: '已存在相同的转发规则' }
      }
      if (existing.rule.a === a && existing.rule.b === b) {
        return { ok: false, error: '已存在相同的转发规则' }
      }
      // Reverse one-way rule: merge into one duplex rule (plan §6.6).
      return { ok: true, rule: this.mergeToDuplex(existing) }
    }

    const edges = collectEdges(this.states)
    if (mode === 'duplex') {
      if (isReachable(edges, b, a) || isReachable(edges, a, b)) {
        return { ok: false, error: '该规则会形成转发环路' }
      }
    } else if (isReachable(edges, b, a)) {
      return { ok: false, error: '该规则会形成转发环路' }
    }

    const rule: BridgeRule = {
      id: uuid(),
      a,
      b,
      mode,
      paused: false,
      stats: { aToB: 0, bToA: 0, dropped: 0 },
    }
    const state = this.setupRule(rule, sessionA, sessionB)
    this.states.set(rule.id, state)
    this.checkOpenState(state)
    this.emitChange()
    return { ok: true, rule: cloneRule(rule) }
  }

  setPaused(id: string, paused: boolean): void {
    const state = this.states.get(id)
    if (state === undefined) return
    if (state.rule.paused === paused) return
    state.rule.paused = paused
    this.emitChange()
  }

  remove(id: string): void {
    const state = this.states.get(id)
    if (state === undefined) return
    this.unsubscribeRule(state)
    this.states.delete(id)
    this.emitChange()
  }

  on(ev: 'change', handler: (rules: BridgeRule[]) => void): Unsubscribe {
    void ev
    return this.emitter.on('change', handler)
  }

  dispose(): void {
    for (const state of this.states.values()) this.unsubscribeRule(state)
    this.states.clear()
    this.emitter.clear()
  }

  private setupRule(rule: BridgeRule, sessionA: BridgeSession, sessionB: BridgeSession): RuleState {
    const state: RuleState = {
      rule,
      sessionA,
      sessionB,
      aToB: new ForwardQueue(
        rule,
        'aToB',
        () => sessionB,
        () => this.emitChange(),
      ),
      bToA: null,
      unsubscribers: [],
    }
    state.unsubscribers.push(
      sessionA.onRawRx((bytes) => {
        state.aToB.enqueue(bytes)
      }),
    )
    if (rule.mode === 'duplex') {
      state.bToA = new ForwardQueue(
        rule,
        'bToA',
        () => sessionA,
        () => this.emitChange(),
      )
      const bToA = state.bToA
      state.unsubscribers.push(
        sessionB.onRawRx((bytes) => {
          bToA.enqueue(bytes)
        }),
      )
    }
    state.unsubscribers.push(
      sessionA.on('state', () => {
        if (sessionA.state !== 'open') this.pause(state, sessionA)
      }),
    )
    state.unsubscribers.push(
      sessionB.on('state', () => {
        if (sessionB.state !== 'open') this.pause(state, sessionB)
      }),
    )
    state.unsubscribers.push(
      sessionA.onDispose(() => {
        this.remove(rule.id)
      }),
    )
    state.unsubscribers.push(
      sessionB.onDispose(() => {
        this.remove(rule.id)
      }),
    )
    return state
  }

  private mergeToDuplex(state: RuleState): BridgeRule {
    const { rule, sessionB } = state
    rule.mode = 'duplex'
    if (state.bToA === null) {
      state.bToA = new ForwardQueue(
        rule,
        'bToA',
        () => state.sessionA,
        () => this.emitChange(),
      )
      const bToA = state.bToA
      state.unsubscribers.push(
        sessionB.onRawRx((bytes) => {
          bToA.enqueue(bytes)
        }),
      )
    }
    this.emitChange()
    return cloneRule(rule)
  }

  private pause(state: RuleState, session: BridgeSession): void {
    if (state.rule.paused) return
    state.rule.paused = true
    const message = `转发已暂停：${session.name} 已断开`
    state.sessionA.writeSystemLog('error', message)
    state.sessionB.writeSystemLog('error', message)
    this.emitChange()
  }

  private checkOpenState(state: RuleState): void {
    if (state.sessionA.state !== 'open') this.pause(state, state.sessionA)
    if (state.sessionB.state !== 'open') this.pause(state, state.sessionB)
  }

  private findByPair(a: string, b: string): RuleState | undefined {
    for (const state of this.states.values()) {
      const rule = state.rule
      if ((rule.a === a && rule.b === b) || (rule.a === b && rule.b === a)) return state
    }
    return undefined
  }

  private unsubscribeRule(state: RuleState): void {
    for (const unsubscribe of state.unsubscribers) {
      try {
        unsubscribe()
      } catch {
        // Ignore broken listeners.
      }
    }
    state.unsubscribers.length = 0
  }

  private emitChange(): void {
    this.emitter.emit('change', this.list())
  }
}

/** Creates an isolated bridge service (tests). */
export function createBridgeService(options: BridgeServiceOptions): BridgeService {
  return new BridgeServiceImpl(options)
}

let singleton: BridgeService | undefined

/** Application-wide bridge service. */
export function getBridgeService(): BridgeService {
  singleton ??= createBridgeService({
    getSession: (id: string): BridgeSession | undefined => getLinkManager().get(id),
  })
  return singleton
}
