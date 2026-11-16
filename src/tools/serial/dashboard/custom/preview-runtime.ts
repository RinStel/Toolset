/**
 * 编辑器预览的数据源与发送桥（plan §8.12「预览」）。
 *
 * 预览实例复用 {@link DashboardRuntime} 接口，因此宿主 / `useWidgetData` / 属性编辑器
 * 与仪表盘中的行为完全一致：
 * - 「模拟数据」：页面内按 30fps 生成与演示设备相同风格的 8 个变量；
 * - 任一已打开会话：委托给真正的仪表盘运行时读取 series；
 * - 发送默认是「模拟发送」，只把将要发送的字节写进编辑器的调试输出；勾选「真实发送」
 *   后才写入所选会话。
 */

import type { Ref } from 'vue'

import {
  createEmptyDashboard,
  renderCommand,
  type CommandAction,
  type CommandSpec,
  type Dashboard,
  type VarRef,
} from '@/domains/dashboard/public'
import type { ComposeOptions, LinkSession } from '@/domains/link/public'
import type { SendValue } from '@/domains/protocol/public'
import type { SeriesSlice, VariableInfo } from '@/domains/series/public'

import { getSessionInstance } from '../../stores/sessions'
import {
  createDashboardRuntime,
  readThemeVariable,
  subscribeThemeChange,
  type DashboardRuntime,
  type DashboardSourceState,
  type DashboardVariableMeta,
  type WidgetFrameUpdate,
} from '../runtime/context'

/** 模拟数据的变量数量（与演示设备一致，plan §8.12）。 */
export const PREVIEW_VARIABLE_COUNT = 8

/** 预览帧率（30fps）。 */
export const PREVIEW_FPS = 30

/** 模拟数据每个变量保留的样本数（远小于仪表盘的 100000 上限）。 */
const SIM_CAPACITY = 20_000

const SIM_COLORS = [
  'var(--series-1)',
  'var(--series-2)',
  'var(--series-3)',
  'var(--series-4)',
  'var(--series-5)',
  'var(--series-6)',
  'var(--series-7)',
  'var(--series-8)',
]

/** 模拟变量的显示信息。 */
interface SimVariable {
  key: string
  label: string
  unit: string
  color: string
}

const SIM_VARIABLES: SimVariable[] = Array.from({ length: PREVIEW_VARIABLE_COUNT }, (_, index) => ({
  key: `ch${index}`,
  label: `通道 ${index}`,
  unit: index === 4 ? 'V' : index === 6 ? '°C' : '',
  color: SIM_COLORS[index % SIM_COLORS.length] ?? 'var(--series-1)',
}))

function simulateValue(index: number, sampleIndex: number, random: () => number): number {
  const tau = sampleIndex / 100
  switch (index % PREVIEW_VARIABLE_COUNT) {
    case 1:
      return 10 * Math.cos(Math.PI * 2 * tau)
    case 2:
      return Math.sign(Math.sin(Math.PI * tau)) * 5
    case 3: {
      const cycles = 0.2 * tau
      return 10 * (cycles - Math.floor(cycles))
    }
    case 4:
      return 0.5 + 0.2 * (random() * 2 - 1)
    case 5:
      return 10 * (0.5 * Math.sin(Math.PI * 2 * 5 * tau) + 0.2 * Math.sin(Math.PI * 2 * 12 * tau))
    case 6:
      return 25 + 5 * Math.sin(Math.PI * 2 * 0.05 * tau)
    case 7:
      return sampleIndex % 1000
    case 0:
    default:
      return 10 * Math.sin(Math.PI * 2 * tau)
  }
}

interface SimBuffer {
  idx: number[]
  t: number[]
  v: number[]
}

/** 一秒内的发送限速由调用保护负责；这里只记录模拟发送。 */
export interface PreviewRuntimeOptions {
  /** 预览数据源：`'simulated'` 或会话 id。 */
  source: string
  /** 是否真实发送；默认 `false`（模拟发送）。 */
  realSend: Ref<boolean>
  /** 调试输出回调。 */
  onLog: (line: string) => void
  /** 模拟数据的随机源（测试可注入）。 */
  random?: () => number
}

/** 预览运行时 + 资源清理。 */
export interface PreviewRuntimeHandle {
  runtime: DashboardRuntime
  /** 属性编辑器需要的假仪表盘（单数据源 `main`）。 */
  dashboard: Dashboard
  /** 停止模拟计时器并释放订阅。 */
  dispose(): void
}

function composeOptionsFor(session: LinkSession | undefined): Omit<ComposeOptions, 'mode'> {
  if (session === undefined) {
    return {
      encoding: 'utf-8',
      eol: 'none',
      checksum: 'none',
      checksumEndian: 'le',
      checksumSkip: 0,
    }
  }
  return {
    encoding: session.compose.encoding,
    eol: session.compose.eol,
    checksum: session.compose.checksum,
    checksumEndian: session.compose.checksumEndian,
    checksumSkip: session.compose.checksumSkip,
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function hexPreview(bytes: Uint8Array): string {
  return [...bytes].map((byte) => byte.toString(16).padStart(2, '0').toUpperCase()).join(' ')
}

function createSimulatedStore(random: () => number) {
  const buffers = new Map<string, SimBuffer>()
  for (const variable of SIM_VARIABLES) {
    buffers.set(variable.key, { idx: [], t: [], v: [] })
  }
  let frameIdx = 0
  let sampleIndex = 0
  let lastAt = Date.now()

  function append(t: number): void {
    sampleIndex += 1
    for (let index = 0; index < SIM_VARIABLES.length; index += 1) {
      const variable = SIM_VARIABLES[index]
      if (variable === undefined) continue
      const buffer = buffers.get(variable.key)
      if (buffer === undefined) continue
      buffer.idx.push(sampleIndex)
      buffer.t.push(t)
      buffer.v.push(simulateValue(index, sampleIndex, random))
      if (buffer.idx.length > SIM_CAPACITY) {
        buffer.idx.shift()
        buffer.t.shift()
        buffer.v.shift()
      }
    }
    frameIdx += 1
    lastAt = t
  }

  function variables(): VariableInfo[] {
    return SIM_VARIABLES.map((variable) => {
      const buffer = buffers.get(variable.key)
      const values = buffer?.v ?? []
      const count = values.length
      const latest = count > 0 ? (values[count - 1] as number) : undefined
      let min = 0
      let max = 0
      let sum = 0
      for (const value of values) {
        if (value < min) min = value
        if (value > max) max = value
        sum += value
      }
      return {
        key: variable.key,
        label: variable.label,
        unit: variable.unit,
        computed: false,
        count,
        last: latest ?? 0,
        lastAt,
        min,
        max,
        mean: count > 0 ? sum / count : 0,
        rate: PREVIEW_FPS,
      }
    })
  }

  function latest(key: string): number | undefined {
    const buffer = buffers.get(key)
    if (buffer === undefined || buffer.v.length === 0) return undefined
    return buffer.v[buffer.v.length - 1]
  }

  function read(
    key: string,
    query: { last?: number; sinceIdx?: number; fromT?: number; toT?: number; limit?: number } = {},
  ): SeriesSlice {
    const buffer = buffers.get(key)
    if (buffer === undefined) {
      return { idx: new Float64Array(0), t: new Float64Array(0), v: new Float64Array(0) }
    }
    const limit = Math.max(1, Math.min(100_000, Math.floor(query.limit ?? 100_000)))
    const filtered: Array<{ idx: number; t: number; v: number }> = []
    for (let index = 0; index < buffer.idx.length; index += 1) {
      const idx = buffer.idx[index] as number
      const t = buffer.t[index] as number
      const value = buffer.v[index] as number
      if (query.sinceIdx !== undefined && idx < query.sinceIdx) continue
      if (query.fromT !== undefined && t < query.fromT) continue
      if (query.toT !== undefined && t > query.toT) continue
      filtered.push({ idx, t, v: value })
    }
    const window = query.last !== undefined ? Math.max(0, Math.floor(query.last)) : filtered.length
    const start = Math.max(0, filtered.length - Math.min(window, limit))
    const slice = filtered.slice(start)
    return {
      idx: Float64Array.from(slice.map((item) => item.idx)),
      t: Float64Array.from(slice.map((item) => item.t)),
      v: Float64Array.from(slice.map((item) => item.v)),
    }
  }

  return {
    append,
    variables,
    latest,
    read,
    get frameIdx() {
      return frameIdx
    },
    get sampleIndex() {
      return sampleIndex
    },
  }
}

/**
 * 创建预览运行时。
 *
 * @param options 数据源（`'simulated'` 或会话 id）与发送策略
 */
export function createPreviewRuntime(options: PreviewRuntimeOptions): PreviewRuntimeHandle {
  const session = options.source === 'simulated' ? undefined : getSessionInstance(options.source)
  const simulated = options.source === 'simulated' || session === undefined
  const random = options.random ?? Math.random
  const sim = createSimulatedStore(random)
  const fakeDashboard: Dashboard = createEmptyDashboard({
    id: 'custom-widget-preview',
    name: '自定义控件预览',
    alias: 'main',
    label: simulated ? '模拟数据' : (session?.name ?? '会话'),
    now: Date.now(),
  })

  const delegate: DashboardRuntime | null =
    !simulated && session !== undefined
      ? createDashboardRuntime({
          paneIndex: 0,
          dashboard: () => fakeDashboard,
          bindings: () => ({ main: session.id }),
          mode: () => 'run',
        })
      : null

  interface Subscription {
    refs: () => readonly VarRef[]
    callback: (update: WidgetFrameUpdate) => void
    dirty: boolean
  }

  const subscriptions = new Set<Subscription>()
  let timer: ReturnType<typeof setInterval> | null = null

  function notify(): void {
    if (subscriptions.size === 0) return
    const now = typeof performance !== 'undefined' ? performance.now() : Date.now()
    for (const subscription of subscriptions) {
      subscription.dirty = false
      const refs = subscription.refs()
      subscription.callback({
        now,
        refs,
        latest: refs.map((ref) => {
          if (simulated) return sim.latest(ref.key)
          return delegate?.displayValue(ref)
        }),
        changedAliases: ['main'],
        metaVersion: 0,
      })
    }
  }

  function ensureTimer(): void {
    if (!simulated || timer !== null) return
    timer = setInterval(
      () => {
        sim.append(Date.now())
        notify()
      },
      Math.round(1000 / PREVIEW_FPS),
    )
  }

  function stopTimerIfIdle(): void {
    if (subscriptions.size > 0 || timer === null) return
    clearInterval(timer)
    timer = null
  }

  function subscribeFrame(
    refs: () => readonly VarRef[],
    callback: (update: WidgetFrameUpdate) => void,
  ): () => void {
    if (!simulated) return delegate?.subscribeFrame(refs, callback) ?? (() => undefined)
    const subscription: Subscription = { refs, callback, dirty: true }
    subscriptions.add(subscription)
    ensureTimer()
    // 第一批数据立即生成，避免预览空白。
    if (sim.sampleIndex === 0) sim.append(Date.now())
    const now = typeof performance !== 'undefined' ? performance.now() : Date.now()
    callback({
      now,
      refs: refs(),
      latest: refs().map((ref) => sim.latest(ref.key)),
      changedAliases: ['main'],
      metaVersion: 0,
    })
    return () => {
      subscriptions.delete(subscription)
      stopTimerIfIdle()
    }
  }

  function requestUpdate(refs?: readonly VarRef[]): void {
    if (!simulated) {
      delegate?.requestUpdate(refs)
      return
    }
    for (const subscription of subscriptions) subscription.dirty = true
  }

  function meta(ref: VarRef): DashboardVariableMeta {
    if (!simulated) return delegate?.meta(ref) ?? buildSimMeta(ref)
    return buildSimMeta(ref)
  }

  function buildSimMeta(ref: VarRef): DashboardVariableMeta {
    const variable = SIM_VARIABLES.find((item) => item.key === ref.key)
    return {
      source: ref.source,
      key: ref.key,
      label: variable?.label ?? ref.key,
      unit: variable?.unit ?? '',
      color: variable?.color ?? 'var(--series-1)',
      decimals: 2,
      scale: 1,
      offset: 0,
      computed: false,
    }
  }

  function rawLatest(ref: VarRef): number | undefined {
    if (!simulated) return delegate?.rawLatest(ref)
    return sim.latest(ref.key)
  }

  function displayValue(ref: VarRef): number | undefined {
    if (!simulated) return delegate?.displayValue(ref)
    const value = sim.latest(ref.key)
    if (value === undefined) return undefined
    const info = meta(ref)
    return value * info.scale + info.offset
  }

  function read(ref: VarRef, query?: Parameters<DashboardRuntime['read']>[1]): SeriesSlice {
    if (!simulated) {
      return (
        delegate?.read(ref, query) ?? {
          idx: new Float64Array(0),
          t: new Float64Array(0),
          v: new Float64Array(0),
        }
      )
    }
    const slice = sim.read(ref.key, query)
    const info = meta(ref)
    if (info.scale === 1 && info.offset === 0) return slice
    return {
      idx: slice.idx,
      t: slice.t,
      v: Float64Array.from(slice.v, (value) => value * info.scale + info.offset),
    }
  }

  function targetSession(): LinkSession | undefined {
    return getSessionInstance(options.source === 'simulated' ? null : options.source)
  }

  async function dispatchReal(action: CommandAction, target: LinkSession): Promise<void> {
    switch (action.kind) {
      case 'bytes':
        await target.send(action.bytes, 'widget')
        return
      case 'form':
        await target.sendForm(action.values as Record<string, SendValue>)
        return
      case 'signal':
        await target.setSignals({ dtr: action.dtr, rts: action.rts, brk: action.brk })
        return
      case 'quick':
        throw new Error('预览不支持执行快捷发送项')
    }
  }

  function describeSimulated(action: CommandAction): string {
    switch (action.kind) {
      case 'bytes':
        return `模拟发送（${action.source}）：${hexPreview(action.bytes)}`
      case 'form':
        return `模拟发送（${action.source}，协议表单）：${JSON.stringify(action.values)}`
      case 'signal':
        return `模拟发送（${action.source}，控制线）：DTR=${String(action.dtr)} RTS=${String(action.rts)} BRK=${String(action.brk)}`
      case 'quick':
        return `模拟执行快捷发送项：${action.quickItemId}`
    }
  }

  async function dispatch(action: CommandAction): Promise<void> {
    const target = targetSession()
    if (options.realSend.value && target !== undefined) {
      await dispatchReal(action, target)
      return
    }
    options.onLog(describeSimulated(action))
  }

  async function send(
    cmd: CommandSpec | string,
    value?: number | boolean | string,
  ): Promise<'sent' | 'skipped'> {
    const target = targetSession()
    const spec: CommandSpec =
      typeof cmd === 'string'
        ? {
            kind: 'template',
            source: 'main',
            mode: 'text',
            template: cmd,
            options: composeOptionsFor(target),
          }
        : cmd
    const resolved = renderCommand(spec, value, (ref) => displayValue(ref), {
      isSourceBound: () => target !== undefined || simulated,
    })
    if (!resolved.ok) {
      options.onLog(`发送失败：${resolved.error}`)
      throw new Error(resolved.error)
    }
    await dispatch(resolved.action)
    return 'sent'
  }

  async function sendBytes(
    bytes: Uint8Array | number[],
    source?: string,
  ): Promise<'sent' | 'skipped'> {
    const payload = bytes instanceof Uint8Array ? bytes : Uint8Array.from(bytes)
    const alias = source ?? 'main'
    const target = targetSession()
    if (options.realSend.value && target !== undefined) {
      await target.send(payload, 'widget')
      return 'sent'
    }
    options.onLog(`模拟发送（${alias}）：${hexPreview(payload)}`)
    return 'sent'
  }

  const runtime: DashboardRuntime = {
    paneIndex: 0,
    get mode(): 'run' {
      return 'run'
    },
    dashboard: () => fakeDashboard,
    defaultAlias: () => 'main',
    sourceState: (alias: string): DashboardSourceState => {
      if (!simulated) return delegate?.sourceState(alias) ?? 'unbound'
      return 'open'
    },
    isSourceOpen: (alias: string) => {
      if (!simulated) return delegate?.isSourceOpen(alias) ?? false
      return true
    },
    isSourceBound: (alias: string) => {
      if (!simulated) return delegate?.isSourceBound(alias) ?? false
      return true
    },
    session: (alias: string) => {
      if (!simulated) return delegate?.session(alias)
      return targetSession()
    },
    series: (alias: string) => delegate?.series(alias),
    variables: (alias: string): VariableInfo[] => {
      if (!simulated) return delegate?.variables(alias) ?? []
      return sim.variables()
    },
    meta,
    rawLatest,
    displayValue,
    read,
    theme: (cssVar: string) =>
      delegate !== null ? delegate.theme(cssVar) : readThemeVariable(cssVar),
    onThemeChange: (callback: () => void) =>
      delegate !== null ? delegate.onThemeChange(callback) : subscribeThemeChange(callback),
    send,
    sendBytes,
    sendQuickItem: async (itemId: string) => {
      options.onLog(`模拟执行快捷发送项：${itemId}`)
      return 'sent'
    },
    subscribeFrame,
    requestUpdate,
    tick: (now: number, force = false) => {
      if (!simulated) return delegate?.tick(now, force) ?? 0
      void now
      void force
      sim.append(Date.now())
      notify()
      return subscriptions.size
    },
    syncComputed: () => {
      delegate?.syncComputed()
    },
    metaVersion: () => (simulated ? 0 : (delegate?.metaVersion?.() ?? 0)),
    boundAliases: () => (simulated ? ['main'] : (delegate?.boundAliases() ?? [])),
  }

  return {
    runtime,
    dashboard: fakeDashboard,
    dispose: () => {
      if (timer !== null) {
        clearInterval(timer)
        timer = null
      }
      subscriptions.clear()
    },
  }
}

/** 预览数据源选项。 */
export interface PreviewSourceOption {
  label: string
  value: string
}

/** 构造预览数据源下拉选项：模拟数据 + 已打开的会话。 */
export function previewSourceOptions(
  sessions: ReadonlyArray<{ id: string; name: string }>,
): PreviewSourceOption[] {
  return [
    { label: '模拟数据', value: 'simulated' },
    ...sessions.map((session) => ({ label: `会话：${session.name}`, value: session.id })),
  ]
}

/** 安全地忽略一次模拟错误；编辑器调用方用于保持类型整洁。 */
export function previewErrorMessage(error: unknown): string {
  return errorMessage(error)
}

/** 允许编辑器在调试输出中记录组合预览（与真实发送共用格式）。 */
export function formatPreviewBytes(bytes: Uint8Array | number[]): string {
  return hexPreview(bytes instanceof Uint8Array ? bytes : Uint8Array.from(bytes))
}
