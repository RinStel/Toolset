import { describe, expect, it } from 'vitest'

import type { DecodedFrame } from '../../../src/domains/link/public'
import {
  createSeriesHub,
  getSeriesHub,
  resetSeriesHubForTests,
  type SeriesHubManager,
  type SeriesHubSession,
} from '../../../src/domains/series/hub'
import type { Unsubscribe } from '../../../src/shared/lib/events'
import { makeFrame, variablesFrame } from './helpers'

class FakeSession implements SeriesHubSession {
  readonly id: string
  private readonly frameHandlers = new Set<(frames: DecodedFrame[]) => void>()
  private readonly disposeHandlers = new Set<() => void>()

  constructor(id: string) {
    this.id = id
  }

  on(ev: 'frames', handler: (frames: DecodedFrame[]) => void): Unsubscribe {
    void ev
    this.frameHandlers.add(handler)
    return () => {
      this.frameHandlers.delete(handler)
    }
  }

  onDispose(handler: () => void): Unsubscribe {
    this.disposeHandlers.add(handler)
    return () => {
      this.disposeHandlers.delete(handler)
    }
  }

  emitFrames(frames: DecodedFrame[]): void {
    for (const handler of [...this.frameHandlers]) handler(frames)
  }

  dispose(): void {
    for (const handler of [...this.disposeHandlers]) handler()
    this.disposeHandlers.clear()
    this.frameHandlers.clear()
  }

  get frameListenerCount(): number {
    return this.frameHandlers.size
  }
}

class FakeManager implements SeriesHubManager {
  private readonly list: FakeSession[] = []
  private readonly handlers = new Set<(sessions: SeriesHubSession[]) => void>()

  sessions(): SeriesHubSession[] {
    return this.list.slice()
  }

  on(ev: 'sessions', handler: (sessions: SeriesHubSession[]) => void): Unsubscribe {
    void ev
    this.handlers.add(handler)
    return () => {
      this.handlers.delete(handler)
    }
  }

  add(session: FakeSession): void {
    this.list.push(session)
    this.emit()
  }

  remove(session: FakeSession): void {
    const index = this.list.indexOf(session)
    if (index >= 0) this.list.splice(index, 1)
    this.emit()
  }

  emit(): void {
    const snapshot = this.sessions()
    for (const handler of [...this.handlers]) handler(snapshot)
  }

  get listenerCount(): number {
    return this.handlers.size
  }
}

describe('series/hub', () => {
  it('收到第一个带变量的 RX 帧时才创建数据源', () => {
    const manager = new FakeManager()
    const hub = createSeriesHub(manager)
    const session = new FakeSession('s1')
    manager.add(session)
    expect(hub.sources()).toEqual([])
    expect(hub.source('s1')).toBeUndefined()

    session.emitFrames([makeFrame({ seq: 1, at: 0, results: [{ summary: '' }] })])
    expect(hub.sources()).toEqual([])

    session.emitFrames([variablesFrame(1, 0, { a: 1 }, { direction: 'tx' })])
    expect(hub.sources()).toEqual([])

    session.emitFrames([variablesFrame(2, 0, { a: 1 })])
    expect(hub.sources()).toHaveLength(1)
    expect(hub.source('s1')?.sessionId).toBe('s1')
    expect(hub.source('s1')?.frameIdx).toBe(1)

    hub.dispose()
  })

  it('为已存在的会话自动挂接', () => {
    const manager = new FakeManager()
    const session = new FakeSession('s1')
    manager.add(session)
    const hub = createSeriesHub(manager)
    session.emitFrames([variablesFrame(1, 100, { temp: 1 })])
    expect(hub.source('s1')?.latest('temp')).toBe(1)
    expect(session.frameListenerCount).toBe(1)
    hub.dispose()
  })

  it('会话 dispose 后删除数据源并发出 sources 事件', () => {
    const manager = new FakeManager()
    const hub = createSeriesHub(manager)
    const session = new FakeSession('s1')
    manager.add(session)
    let events = 0
    hub.on('sources', () => {
      events += 1
    })
    session.emitFrames([variablesFrame(1, 0, { a: 1 })])
    expect(events).toBe(1)

    session.dispose()
    expect(hub.source('s1')).toBeUndefined()
    expect(hub.sources()).toEqual([])
    expect(events).toBe(2)
    expect(session.frameListenerCount).toBe(0)
    hub.dispose()
  })

  it('管理器移除会话时也会删除数据源', () => {
    const manager = new FakeManager()
    const hub = createSeriesHub(manager)
    const session = new FakeSession('s1')
    manager.add(session)
    session.emitFrames([variablesFrame(1, 0, { a: 1 })])
    expect(hub.sources()).toHaveLength(1)

    manager.remove(session)
    expect(hub.sources()).toEqual([])
    expect(session.frameListenerCount).toBe(0)
    hub.dispose()
  })

  it('多会话的数据源互相隔离', () => {
    const manager = new FakeManager()
    const hub = createSeriesHub(manager)
    const first = new FakeSession('s1')
    const second = new FakeSession('s2')
    manager.add(first)
    manager.add(second)
    first.emitFrames([variablesFrame(1, 0, { a: 1 })])
    second.emitFrames([variablesFrame(1, 0, { b: 2 })])
    expect(hub.sources().map((source) => source.sessionId)).toEqual(['s1', 's2'])
    expect(
      hub
        .source('s1')
        ?.variables()
        .map((info) => info.key),
    ).toEqual(['a'])
    expect(
      hub
        .source('s2')
        ?.variables()
        .map((info) => info.key),
    ).toEqual(['b'])
    hub.dispose()
  })

  it('configure 的容量只影响之后新建的变量', () => {
    const manager = new FakeManager()
    const hub = createSeriesHub(manager)
    hub.configure({ capacity: 5, maxVariablesPerSource: 64 })
    const session = new FakeSession('s1')
    manager.add(session)
    for (let i = 1; i <= 6; i += 1) {
      session.emitFrames([variablesFrame(i, i, { a: i })])
    }
    expect(hub.source('s1')?.variables()[0]?.count).toBe(5)

    hub.configure({ capacity: 2, maxVariablesPerSource: 64 })
    session.emitFrames([variablesFrame(7, 7, { b: 1 })])
    expect(
      hub
        .source('s1')
        ?.variables()
        .find((info) => info.key === 'b')?.count,
    ).toBe(1)
    session.emitFrames([variablesFrame(8, 8, { b: 2 })])
    session.emitFrames([variablesFrame(9, 9, { b: 3 })])
    const variables = hub.source('s1')?.variables() ?? []
    expect(variables.find((info) => info.key === 'a')?.count).toBe(5)
    expect(variables.find((info) => info.key === 'b')?.count).toBe(2)
    hub.dispose()
  })

  it('每源变量上限在数据源创建时快照，之后 configure 不影响已有数据源', () => {
    const manager = new FakeManager()
    const hub = createSeriesHub(manager)
    hub.configure({ capacity: 100, maxVariablesPerSource: 2 })
    const first = new FakeSession('s1')
    manager.add(first)
    first.emitFrames([variablesFrame(1, 0, { a: 1, b: 2, c: 3 })])
    expect(hub.source('s1')?.ignoredVariables).toEqual(['c'])

    hub.configure({ capacity: 100, maxVariablesPerSource: 8 })
    const second = new FakeSession('s2')
    manager.add(second)
    second.emitFrames([variablesFrame(1, 0, { a: 1, b: 2, c: 3, d: 4, e: 5 })])
    expect(hub.source('s2')?.variables()).toHaveLength(5)
    hub.dispose()
  })

  it('全部数据源的变量总数上限为 256', () => {
    const manager = new FakeManager()
    const hub = createSeriesHub(manager)
    hub.configure({ capacity: 10, maxVariablesPerSource: 64 })
    for (let i = 0; i < 4; i += 1) {
      const session = new FakeSession(`s${i}`)
      manager.add(session)
      const variables: Record<string, number> = {}
      for (let k = 0; k < 64; k += 1) variables[`v${k}`] = k
      session.emitFrames([variablesFrame(1, 0, variables)])
      expect(hub.source(`s${i}`)?.variables()).toHaveLength(64)
    }

    const extra = new FakeSession('extra')
    manager.add(extra)
    extra.emitFrames([variablesFrame(1, 0, { beyond: 1 })])
    expect(hub.source('extra')?.variables()).toEqual([])
    expect(hub.source('extra')?.ignoredVariables).toEqual(['beyond'])
    hub.dispose()
  })

  it('dispose 后取消管理器与会话订阅', () => {
    const manager = new FakeManager()
    const hub = createSeriesHub(manager)
    const session = new FakeSession('s1')
    manager.add(session)
    session.emitFrames([variablesFrame(1, 0, { a: 1 })])
    hub.dispose()
    expect(manager.listenerCount).toBe(0)
    expect(session.frameListenerCount).toBe(0)

    const later = new FakeSession('s2')
    manager.add(later)
    later.emitFrames([variablesFrame(1, 0, { b: 1 })])
    expect(hub.sources()).toEqual([])
  })

  it('getSeriesHub 返回惰性单例，reset 后可重新创建', () => {
    const first = getSeriesHub()
    expect(getSeriesHub()).toBe(first)
    resetSeriesHubForTests()
    const second = getSeriesHub()
    expect(second).not.toBe(first)
    resetSeriesHubForTests()
  })
})
