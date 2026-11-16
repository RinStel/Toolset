/**
 * `SeriesSource`：单个会话的变量集合（plan §6.8）。
 *
 * 负责把 `frames` 批次里的解码结果写成时间序列：帧内所有变量共享同一个 `idx`，
 * 时间戳按批内相同 `at` 的帧插值；变量上限、环形缓冲、统计与计算变量都在这里。
 */

import type { DecodedFrame } from '../link/public'
import { createEmitter, type Unsubscribe } from '../../shared/lib/events'
import { compileComputedVariables, type CompiledComputedVariable } from './computed'
import { extractVariables, type ExtractedVariable } from './extract'
import { SeriesRing } from './ring'
import { interpolateTimestamps } from './timestamps'
import {
  MAX_IGNORED_VARIABLES,
  MAX_TOTAL_VARIABLES,
  type ComputedVariable,
  type SeriesReadQuery,
  type SeriesSlice,
  type SeriesSource,
  type VariableInfo,
} from './types'

/** `createSeriesSource()` 的依赖；由 `SeriesHub` 注入，便于单元测试。 */
export interface SeriesSourceOptions {
  sessionId: string
  /** 当前配置的样本容量；创建新变量时读取（`configure()` 只影响之后新建的变量）。 */
  capacity: () => number
  /** 本源的变量上限；在数据源创建时快照。 */
  maxVariablesPerSource: number
  /** 所有数据源的变量总数，用于 256 上限检查。 */
  totalVariableCount: () => number
  /** 总数上限，默认 256（plan §6.8）。 */
  totalLimit?: number
}

interface VariableEntry {
  key: string
  label?: string
  unit?: string
  computed: boolean
  error?: string
  ring: SeriesRing
  /** 最新一次写入的值 / 时间；尚无样本时为 NaN / 0。 */
  last: number
  lastAt: number
  statCount: number
  statSum: number
  statMin: number
  statMax: number
  rateSecond: number
  rateCount: number
  rate: number
}

interface ComputedState {
  compiled: CompiledComputedVariable
  entry: VariableEntry
  prev: number
  prevT: number | undefined
  disabled: boolean
}

interface PreparedFrame {
  at: number
  variables: ExtractedVariable[]
  invalid: number
}

interface SeriesSourceEventMap {
  variables: undefined
  data: { frameIdx: number }
  [event: string]: unknown
}

function errorText(error: unknown): string {
  if (error instanceof Error) return error.message
  return String(error)
}

function emptySlice(): SeriesSlice {
  return { idx: new Float64Array(0), t: new Float64Array(0), v: new Float64Array(0) }
}

/** 创建单个会话的变量集合；通常由 `SeriesHub` 调用。 */
export function createSeriesSource(options: SeriesSourceOptions): SeriesSourceImpl {
  return new SeriesSourceImpl(options)
}

export class SeriesSourceImpl implements SeriesSource {
  private readonly options: SeriesSourceOptions
  private readonly totalLimit: number
  private readonly emitter = createEmitter<SeriesSourceEventMap>()
  private readonly entries = new Map<string, VariableEntry>()
  private computedStates: ComputedState[] = []
  private ignoredList: string[] = []

  private frameIdxValue = 0
  private invalidSamplesValue = 0
  private lastTValue: number | undefined
  private pendingVariablesEvent = false
  private disposed = false

  constructor(options: SeriesSourceOptions) {
    this.options = options
    this.totalLimit = Math.max(1, Math.floor(options.totalLimit ?? MAX_TOTAL_VARIABLES))
  }

  get sessionId(): string {
    return this.options.sessionId
  }

  get frameIdx(): number {
    return this.frameIdxValue
  }

  get invalidSamples(): number {
    return this.invalidSamplesValue
  }

  get ignoredVariables(): string[] {
    return this.ignoredList.slice()
  }

  /** 变量总数（含计算变量）；供 `SeriesHub` 统计全源上限。 */
  get variableCount(): number {
    return this.entries.size
  }

  variables(): VariableInfo[] {
    const list: VariableInfo[] = []
    for (const entry of this.entries.values()) list.push(this.toInfo(entry))
    return list
  }

  latest(key: string): number | undefined {
    const entry = this.entries.get(key)
    if (entry === undefined || !Number.isFinite(entry.last)) return undefined
    return entry.last
  }

  read(key: string, query: SeriesReadQuery = {}): SeriesSlice {
    const entry = this.entries.get(key)
    if (entry === undefined) return emptySlice()
    return entry.ring.read(query)
  }

  /**
   * 整体替换计算变量定义（plan §6.8）。编译错误通过返回值报告；旧的错误状态在
   * 成功替换后清空，因此重新调用即可恢复求值。
   */
  setComputed(defs: readonly ComputedVariable[]): Array<{ key: string; error: string }> {
    if (this.disposed) return []
    const reserved = new Set<string>()
    for (const entry of this.entries.values()) {
      if (!entry.computed) reserved.add(entry.key)
    }
    const { compiled, errors } = compileComputedVariables(defs, reserved)

    for (const state of this.computedStates) this.entries.delete(state.entry.key)
    this.computedStates = []
    for (const item of compiled) {
      const entry = this.createEntry(item.key, true, item)
      this.computedStates.push({
        compiled: item,
        entry,
        prev: Number.NaN,
        prevT: undefined,
        disabled: false,
      })
    }
    this.pendingVariablesEvent = false
    this.emitter.emit('variables', undefined)
    return errors.map((error) => ({ key: error.key, error: error.error }))
  }

  resetStats(): void {
    for (const entry of this.entries.values()) this.resetEntryStats(entry)
  }

  /** 清空样本与统计，保留变量列表和计算变量定义（plan §6.8）。 */
  clear(): void {
    for (const entry of this.entries.values()) {
      entry.ring.clear()
      entry.last = Number.NaN
      entry.lastAt = 0
      entry.rate = 0
      entry.rateSecond = -1
      entry.rateCount = 0
      this.resetEntryStats(entry)
    }
    for (const state of this.computedStates) {
      state.prev = Number.NaN
      state.prevT = undefined
    }
    this.frameIdxValue = 0
    this.invalidSamplesValue = 0
    this.lastTValue = undefined
  }

  on(ev: 'variables', cb: () => void): Unsubscribe
  on(ev: 'data', cb: (event: { frameIdx: number }) => void): Unsubscribe
  on(
    ev: 'variables' | 'data',
    cb: (() => void) | ((event: { frameIdx: number }) => void),
  ): Unsubscribe {
    return this.emitter.on(ev, cb as never)
  }

  /** 处理一批解码帧；由 `SeriesHub` 在会话 `frames` 事件中调用。 */
  handleFrames(frames: readonly DecodedFrame[]): void {
    if (this.disposed) return
    const prepared: PreparedFrame[] = []
    for (const frame of frames) {
      if (frame.direction !== 'rx') continue
      let outcome
      try {
        outcome = extractVariables(frame.results)
      } catch {
        continue
      }
      if (outcome.candidates === 0) continue
      prepared.push({ at: frame.at, variables: outcome.variables, invalid: outcome.invalid })
    }
    if (prepared.length === 0) return

    const timestamps = interpolateTimestamps(
      prepared.map((frame) => ({ at: frame.at })),
      this.lastTValue,
    )
    for (let i = 0; i < prepared.length; i += 1) {
      const frame = prepared[i] as PreparedFrame
      const idx = (this.frameIdxValue += 1)
      const t = timestamps[i] ?? frame.at
      this.lastTValue = t
      this.writeFrame(idx, t, frame.variables)
      this.invalidSamplesValue += frame.invalid
      this.evaluateComputed(idx, t)
    }
    if (this.pendingVariablesEvent) {
      this.pendingVariablesEvent = false
      this.emitter.emit('variables', undefined)
    }
    this.emitter.emit('data', { frameIdx: this.frameIdxValue })
  }

  /** 数据源被移除时释放事件订阅（内部接口，不属于 plan §6.8 的公共契约）。 */
  dispose(): void {
    this.disposed = true
    this.entries.clear()
    this.computedStates = []
    this.emitter.clear()
  }

  /* ----------------------------------------------------------------------- */
  /* 写入                                                                    */
  /* ----------------------------------------------------------------------- */

  private writeFrame(idx: number, t: number, variables: readonly ExtractedVariable[]): void {
    for (const sample of variables) {
      let entry = this.entries.get(sample.key)
      if (entry === undefined) {
        if (!this.canAddExtractedVariable()) {
          this.ignoreVariable(sample.key)
          continue
        }
        entry = this.createEntry(sample.key, false)
      }
      this.updateMeta(entry, sample.label, sample.unit)
      this.pushSample(entry, idx, t, sample.value)
    }
  }

  private createEntry(
    key: string,
    computed: boolean,
    definition?: CompiledComputedVariable,
  ): VariableEntry {
    const capacity = Math.max(1, Math.floor(this.options.capacity()))
    const entry: VariableEntry = {
      key,
      computed,
      ring: new SeriesRing(capacity),
      last: Number.NaN,
      lastAt: 0,
      statCount: 0,
      statSum: 0,
      statMin: Number.POSITIVE_INFINITY,
      statMax: Number.NEGATIVE_INFINITY,
      rateSecond: -1,
      rateCount: 0,
      rate: 0,
    }
    if (definition?.label !== undefined) entry.label = definition.label
    if (definition?.unit !== undefined) entry.unit = definition.unit
    this.entries.set(key, entry)
    this.pendingVariablesEvent = true
    return entry
  }

  /** 自动提取变量的上限检查；超限时记录到 `ignoredVariables` 并通知界面。 */
  private canAddExtractedVariable(): boolean {
    let extracted = 0
    for (const entry of this.entries.values()) {
      if (!entry.computed) extracted += 1
    }
    if (extracted >= Math.max(0, Math.floor(this.options.maxVariablesPerSource))) return false
    if (this.options.totalVariableCount() >= this.totalLimit) return false
    return true
  }

  private ignoreVariable(key: string): void {
    const previousLength = this.ignoredList.length
    if (previousLength < MAX_IGNORED_VARIABLES && !this.ignoredList.includes(key)) {
      this.ignoredList.push(key)
    }
    // 只有真正记录了新的被忽略变量时才通知，避免每帧重复发事件。
    if (this.ignoredList.length > previousLength) this.pendingVariablesEvent = true
  }

  private updateMeta(entry: VariableEntry, label?: string, unit?: string): void {
    let changed = false
    if (label !== undefined && entry.label !== label) {
      entry.label = label
      changed = true
    }
    if (unit !== undefined && entry.unit !== unit) {
      entry.unit = unit
      changed = true
    }
    if (changed) this.pendingVariablesEvent = true
  }

  private pushSample(entry: VariableEntry, idx: number, t: number, value: number): void {
    entry.ring.push(idx, t, value)
    entry.last = value
    entry.lastAt = t
    entry.statCount += 1
    entry.statSum += value
    if (value < entry.statMin) entry.statMin = value
    if (value > entry.statMax) entry.statMax = value
    this.trackRate(entry, t)
  }

  /** 用每自然秒的样本数统计 rate（plan §6.8：最近 1 秒的样本数）。 */
  private trackRate(entry: VariableEntry, t: number): void {
    const second = Math.floor(t / 1000)
    if (second !== entry.rateSecond) {
      if (entry.rateSecond >= 0) {
        entry.rate = second === entry.rateSecond + 1 ? entry.rateCount : 0
      }
      entry.rateSecond = second
      entry.rateCount = 0
    }
    entry.rateCount += 1
  }

  private resetEntryStats(entry: VariableEntry): void {
    entry.statCount = 0
    entry.statSum = 0
    entry.statMin = Number.POSITIVE_INFINITY
    entry.statMax = Number.NEGATIVE_INFINITY
  }

  /* ----------------------------------------------------------------------- */
  /* 计算变量                                                                */
  /* ----------------------------------------------------------------------- */

  private evaluateComputed(idx: number, t: number): void {
    if (this.computedStates.length === 0) return
    if (this.computedStates.every((state) => state.disabled)) return

    const environment = Object.create(null) as Record<string, number>
    for (const entry of this.entries.values()) {
      if (Number.isFinite(entry.last)) environment[entry.key] = entry.last
    }

    for (const state of this.computedStates) {
      if (state.disabled) continue
      const dt = state.prevT === undefined ? 0 : (t - state.prevT) / 1000
      let result: unknown
      try {
        result = state.compiled.evaluate(environment, t, dt, state.prev)
      } catch (error) {
        state.disabled = true
        state.entry.error = `表达式执行出错：${errorText(error)}`
        this.pendingVariablesEvent = true
        continue
      }
      state.prevT = t
      const value = typeof result === 'number' ? result : Number.NaN
      state.prev = value
      if (Number.isFinite(value)) {
        this.pushSample(state.entry, idx, t, value)
        environment[state.compiled.key] = value
      } else {
        this.invalidSamplesValue += 1
      }
    }
  }

  /* ----------------------------------------------------------------------- */
  /* 展示                                                                    */
  /* ----------------------------------------------------------------------- */

  private toInfo(entry: VariableEntry): VariableInfo {
    const info: VariableInfo = {
      key: entry.key,
      computed: entry.computed,
      count: entry.ring.count,
      last: entry.last,
      lastAt: entry.lastAt,
      min: entry.statCount > 0 ? entry.statMin : 0,
      max: entry.statCount > 0 ? entry.statMax : 0,
      mean: entry.statCount > 0 ? entry.statSum / entry.statCount : 0,
      rate: entry.rate,
    }
    if (entry.label !== undefined) info.label = entry.label
    if (entry.unit !== undefined) info.unit = entry.unit
    if (entry.error !== undefined) info.error = entry.error
    return info
  }
}
