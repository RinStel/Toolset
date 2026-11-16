/**
 * `SeriesHub`：自动挂接所有会话的变量时间序列中心（plan §6.8）。
 *
 * 首次调用 `getSeriesHub()` 时创建单例，并订阅 `LinkManager` 的 `sessions` 事件：
 * 对每个会话订阅 `frames` 事件，惰性创建 `SeriesSource`（收到第一个带变量的帧时
 * 才创建）；会话 dispose 时删除对应的数据源并发 `sources` 事件。只处理
 * `direction === 'rx'` 的帧。
 *
 * `SeriesHubManager` / `SeriesHubSession` 是 `LinkManager` / `LinkSession` 的结构化
 * 子集，供单元测试注入假实现。
 */

import { getLinkManager } from '../link/public'
import type { DecodedFrame } from '../link/public'
import { createEmitter, type Unsubscribe } from '../../shared/lib/events'
import { frameHasVariables } from './extract'
import { createSeriesSource, type SeriesSourceImpl } from './source'
import {
  DEFAULT_MAX_VARIABLES_PER_SOURCE,
  DEFAULT_SERIES_CAPACITY,
  type SeriesHub,
  type SeriesHubOptions,
  type SeriesSource,
} from './types'

/** `SeriesHub` 需要的会话能力（`LinkSession` 满足该结构）。 */
export interface SeriesHubSession {
  readonly id: string
  on(ev: 'frames', handler: (frames: DecodedFrame[]) => void): Unsubscribe
  onDispose(handler: () => void): Unsubscribe
}

/** `SeriesHub` 需要的管理器能力（`LinkManager` 满足该结构）。 */
export interface SeriesHubManager {
  sessions(): SeriesHubSession[]
  on(ev: 'sessions', handler: (sessions: SeriesHubSession[]) => void): Unsubscribe
}

interface AttachedSession {
  unsubscribeFrames: Unsubscribe
  unsubscribeDispose: Unsubscribe
}

interface SeriesHubEventMap {
  sources: undefined
  [event: string]: unknown
}

function normalizeCapacity(value: number): number {
  if (!Number.isFinite(value)) return DEFAULT_SERIES_CAPACITY
  return Math.max(1, Math.floor(value))
}

function normalizeMaxVariables(value: number): number {
  if (!Number.isFinite(value)) return DEFAULT_MAX_VARIABLES_PER_SOURCE
  return Math.max(1, Math.floor(value))
}

/** 创建独立实例；应用使用单例 `getSeriesHub()`，测试可注入假管理器。 */
export function createSeriesHub(manager: SeriesHubManager): SeriesHubImpl {
  return new SeriesHubImpl(manager)
}

export class SeriesHubImpl implements SeriesHub {
  private readonly emitter = createEmitter<SeriesHubEventMap>()
  private readonly sourcesList: SeriesSourceImpl[] = []
  private readonly sourceMap = new Map<string, SeriesSourceImpl>()
  private readonly attached = new Map<string, AttachedSession>()
  private readonly unsubscribeSessions: Unsubscribe
  private options: SeriesHubOptions = {
    capacity: DEFAULT_SERIES_CAPACITY,
    maxVariablesPerSource: DEFAULT_MAX_VARIABLES_PER_SOURCE,
  }
  private disposed = false

  constructor(manager: SeriesHubManager) {
    this.unsubscribeSessions = manager.on('sessions', (sessions) => {
      this.reconcile(sessions)
    })
    this.reconcile(manager.sessions())
  }

  /**
   * 更新默认配置。只影响之后新建的变量与数据源：
   * - 每个变量创建时读取当时配置的 capacity，已有变量保持原容量；
   * - 每源变量上限在数据源创建时快照，已有数据源保持原上限。
   */
  configure(opts: SeriesHubOptions): void {
    this.options = {
      capacity: normalizeCapacity(opts.capacity),
      maxVariablesPerSource: normalizeMaxVariables(opts.maxVariablesPerSource),
    }
  }

  source(sessionId: string): SeriesSource | undefined {
    return this.sourceMap.get(sessionId)
  }

  sources(): SeriesSource[] {
    return this.sourcesList.slice()
  }

  on(ev: 'sources', cb: () => void): Unsubscribe {
    return this.emitter.on(ev, cb as never)
  }

  /** 取消所有订阅并释放数据源（测试或多工具页面卸载时使用）。 */
  dispose(): void {
    if (this.disposed) return
    this.disposed = true
    this.unsubscribeSessions()
    for (const id of [...this.attached.keys()]) this.detachSession(id)
    for (const source of this.sourcesList) source.dispose()
    this.sourcesList.length = 0
    this.sourceMap.clear()
    this.emitter.clear()
  }

  /* ----------------------------------------------------------------------- */
  /* 挂接                                                                    */
  /* ----------------------------------------------------------------------- */

  private reconcile(sessions: readonly SeriesHubSession[]): void {
    if (this.disposed) return
    const present = new Set<string>()
    for (const session of sessions) present.add(session.id)

    for (const id of [...this.attached.keys()]) {
      if (!present.has(id)) this.detachSession(id)
    }
    for (const session of sessions) {
      if (!this.attached.has(session.id)) this.attachSession(session)
    }

    let changed = false
    for (const id of [...this.sourceMap.keys()]) {
      if (present.has(id)) continue
      if (this.removeSource(id)) changed = true
    }
    if (changed) this.emitSources()
  }

  private attachSession(session: SeriesHubSession): void {
    const unsubscribeFrames = session.on('frames', (frames) => {
      this.handleFrames(session.id, frames)
    })
    const unsubscribeDispose = session.onDispose(() => {
      this.releaseSession(session.id)
    })
    this.attached.set(session.id, { unsubscribeFrames, unsubscribeDispose })
  }

  private detachSession(sessionId: string): void {
    const attached = this.attached.get(sessionId)
    if (attached === undefined) return
    this.attached.delete(sessionId)
    attached.unsubscribeFrames()
    attached.unsubscribeDispose()
  }

  /** 会话被释放（dispose）时同步删除数据源，不发多余的会话事件。 */
  private releaseSession(sessionId: string): void {
    this.detachSession(sessionId)
    if (this.removeSource(sessionId)) this.emitSources()
  }

  private handleFrames(sessionId: string, frames: DecodedFrame[]): void {
    if (this.disposed || frames.length === 0) return
    let source = this.sourceMap.get(sessionId)
    if (source === undefined) {
      // 惰性创建：本批帧里没有任何候选变量时不创建数据源（plan §6.8）。
      if (!frames.some((frame) => frameHasVariables(frame))) return
      source = createSeriesSource({
        sessionId,
        capacity: () => this.options.capacity,
        maxVariablesPerSource: this.options.maxVariablesPerSource,
        totalVariableCount: () => this.totalVariableCount(),
      })
      this.sourceMap.set(sessionId, source)
      this.sourcesList.push(source)
      this.emitSources()
    }
    source.handleFrames(frames)
  }

  private removeSource(sessionId: string): boolean {
    const source = this.sourceMap.get(sessionId)
    if (source === undefined) return false
    this.sourceMap.delete(sessionId)
    const index = this.sourcesList.indexOf(source)
    if (index >= 0) this.sourcesList.splice(index, 1)
    source.dispose()
    return true
  }

  private totalVariableCount(): number {
    let total = 0
    for (const source of this.sourcesList) total += source.variableCount
    return total
  }

  private emitSources(): void {
    this.emitter.emit('sources', undefined)
  }
}

let singleton: SeriesHubImpl | undefined

/** 应用级单例，首次调用时创建（plan §6.8）。 */
export function getSeriesHub(): SeriesHub {
  singleton ??= createSeriesHub(getLinkManager())
  return singleton
}

/** 重置单例（仅测试使用）：释放订阅并清空数据源。 */
export function resetSeriesHubForTests(): void {
  singleton?.dispose()
  singleton = undefined
}
