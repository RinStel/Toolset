/**
 * 仪表盘运行时上下文（plan §8.10 / §8.11 / §6.10）。
 *
 * 一个 Pane 一份运行时，负责：
 * - 把数据源 alias 解析为已绑定的 `LinkSession` / `SeriesSource`；
 * - 把变量的显示覆盖（label/unit/color/scale/offset/decimals）解析给组件；
 * - 执行 `CommandSpec`（通过 `renderCommand`）与字节发送；
 * - 给组件分发刷新帧：只有「绑定的数据有更新」的订阅者才会被通知。
 *
 * 内置组件**不得**自行订阅 series 的 `data` 事件，只能通过 `useWidgetData()` 读取数据
 * （plan §8.10「刷新调度」）。
 */

import {
  COLOR_AUTO,
  SERIES_COLORS,
  renderCommand,
  type CommandAction,
  type CommandSpec,
  type Dashboard,
  type VarRef,
  type VariableMetaOverride,
} from '@/domains/dashboard/public'
import type { ComposeOptions, LinkSession } from '@/domains/link/public'
import { compose } from '@/domains/link/public'
import type { SendValue } from '@/domains/protocol/public'
import {
  getSeriesHub,
  type SeriesReadQuery,
  type SeriesSlice,
  type SeriesSource,
  type VariableInfo,
} from '@/domains/series/public'

import { toast } from '@/shared/ui/services/toast'

import { serialQuick } from '../../stores/quick'
import { getSessionInstance } from '../../stores/sessions'

/** 组件可见的变量元信息（已应用 `variableMeta` 覆盖）。 */
export interface DashboardVariableMeta {
  source: string
  key: string
  /** 显示名：variableMeta > DecodeResult.variableMeta > 变量 key。 */
  label: string
  unit: string
  /** 颜色：variableMeta.color 或调色板中的 `--series-n`。 */
  color: string
  decimals: number
  scale: number
  offset: number
  computed: boolean
  error?: string
}

/** 一次刷新帧的组件更新负载。 */
export interface WidgetFrameUpdate {
  now: number
  refs: readonly VarRef[]
  /** 与 `refs` 顺序一致的显示值（已应用 scale/offset）。 */
  latest: Array<number | undefined>
  /** 本帧有更新的数据源 alias。 */
  changedAliases: string[]
  /**
   * 变量元信息 / 数据源状态的版本号；只在变量增减、显示设置、计算变量或会话状态
   * 变化时递增。`useWidgetData` 用它避免每帧重算元信息数组。
   *
   * 可选：测试或第三方运行时未提供时，组件按「运行时元信息视为不变」处理。
   */
  metaVersion?: number
}

/** 一次发送的结果；`undefined` 表示不发送（例如编辑模式）。 */
export type DashboardSendResult = 'sent' | 'skipped'

/** 数据源状态（plan §8.11 组件的状态点）。 */
export type DashboardSourceState = 'open' | 'closed' | 'unbound'

/** 运行时接口；`useWidgetData` 与 WidgetFrame 使用同一实例。 */
export interface DashboardRuntime {
  readonly paneIndex: number
  /** 编辑 / 运行模式（组件据此禁用交互）。 */
  readonly mode: 'edit' | 'run'
  /** 当前仪表盘（可能为 `null`：空状态）。 */
  dashboard(): Dashboard | null
  /** 默认数据源 alias。 */
  defaultAlias(): string
  /** 数据源状态（未绑定 / 已断开 / 已连接）。 */
  sourceState(alias: string): DashboardSourceState
  /** 是否已绑定且处于 open 状态。 */
  isSourceOpen(alias: string): boolean
  /** 是否已绑定到会话（含断开状态）。 */
  isSourceBound(alias: string): boolean
  /** 已绑定的会话实例。 */
  session(alias: string): LinkSession | undefined
  /** 数据源的 series 源。 */
  series(alias: string): SeriesSource | undefined
  /** 数据源的变量列表（没有会话时为空）。 */
  variables(alias: string): VariableInfo[]
  /** 变量元信息（已应用覆盖）。 */
  meta(ref: VarRef): DashboardVariableMeta
  /** 原始最新值（未应用 scale/offset）。 */
  rawLatest(ref: VarRef): number | undefined
  /** 显示值（已应用 scale/offset）。 */
  displayValue(ref: VarRef): number | undefined
  /** 读取序列；`last` 默认 1000。 */
  read(ref: VarRef, query?: SeriesReadQuery): SeriesSlice
  /** 主题 CSS 变量值，如 `theme('--accent')`。 */
  theme(cssVar: string): string
  /** 订阅主题切换；返回取消订阅函数。 */
  onThemeChange(callback: () => void): () => void
  /**
   * 发送一条命令。
   *
   * `cmd` 为字符串时按「默认数据源的 text 模板」处理，组包选项取该会话手动发送区的
   * 当前设置（plan §6.10 `ctx.send` 语义）。
   */
  send(cmd: CommandSpec | string, value?: number | boolean | string): Promise<DashboardSendResult>
  /** 直接发送字节；`alias` 省略时发往默认数据源。 */
  sendBytes(bytes: Uint8Array | number[], alias?: string): Promise<DashboardSendResult>
  /** 执行一个快捷发送项。 */
  sendQuickItem(itemId: string, alias?: string): Promise<DashboardSendResult>
  /** 订阅刷新帧；`refs` 用 getter 提供当前绑定，只有相关数据源有更新时才回调。 */
  subscribeFrame(
    refs: () => readonly VarRef[],
    callback: (update: WidgetFrameUpdate) => void,
  ): () => void
  /** 强制让订阅者在下一次刷新时收到回调（例如 `requestUpdate` / 属性变化）。 */
  requestUpdate(refs?: readonly VarRef[]): void
  /** 由 Pane 的刷新调度器调用；返回被通知的订阅数。 */
  tick(now: number, force?: boolean): number
  /** 元信息版本号（变量增减 / 显示设置 / 计算变量 / 会话状态变化时递增）。 */
  metaVersion?(): number
  /** 把仪表盘的 `computed` 定义同步到各数据源的 series source。 */
  syncComputed(): void
  /** 当前绑定的全部 alias。 */
  boundAliases(): string[]
}

export interface DashboardRuntimeOptions {
  paneIndex: number
  dashboard: () => Dashboard | null
  bindings: () => Record<string, string | null>
  mode: () => 'edit' | 'run'
}

/* ------------------------------------------------------------------------- */
/* 主题监听                                                                    */
/* ------------------------------------------------------------------------- */

const themeListeners = new Set<() => void>()
let themeObserver: MutationObserver | null = null

function ensureThemeObserver(): void {
  if (themeObserver !== null || typeof document === 'undefined') return
  if (typeof MutationObserver === 'undefined') return
  themeObserver = new MutationObserver(() => {
    for (const listener of themeListeners) listener()
  })
  themeObserver.observe(document.documentElement, {
    attributes: true,
    attributeFilter: ['data-theme', 'data-density'],
  })
}

/** 订阅主题切换（Plan §7.4；uPlot 等组件在主题变化后重建样式）。 */
export function subscribeThemeChange(callback: () => void): () => void {
  ensureThemeObserver()
  themeListeners.add(callback)
  return () => {
    themeListeners.delete(callback)
  }
}

/** 读取 CSS 变量值（取不到时返回空字符串）。 */
export function readThemeVariable(cssVar: string): string {
  if (typeof document === 'undefined' || typeof getComputedStyle !== 'function') return ''
  return getComputedStyle(document.documentElement).getPropertyValue(cssVar).trim()
}

/* ------------------------------------------------------------------------- */
/* 变量元信息                                                                  */
/* ------------------------------------------------------------------------- */

const DEFAULT_DECIMALS = 2

function overrideFor(
  dashboard: Dashboard | null,
  alias: string,
  key: string,
): VariableMetaOverride | undefined {
  if (!dashboard) return undefined
  return dashboard.variableMeta[`${alias}/${key}`]
}

function paletteColor(index: number): string {
  return SERIES_COLORS[index % SERIES_COLORS.length] ?? 'var(--series-1)'
}

function buildMeta(
  dashboard: Dashboard | null,
  alias: string,
  key: string,
  info: VariableInfo | undefined,
  index: number,
): DashboardVariableMeta {
  const override = overrideFor(dashboard, alias, key)
  const color = override?.color ?? paletteColor(index)
  return {
    source: alias,
    key,
    label: override?.label ?? (info?.label !== undefined && info.label !== '' ? info.label : key),
    unit: override?.unit ?? info?.unit ?? '',
    color: color === COLOR_AUTO ? paletteColor(index) : color,
    decimals: override?.decimals ?? DEFAULT_DECIMALS,
    scale: override?.scale ?? 1,
    offset: override?.offset ?? 0,
    computed: info?.computed ?? key.startsWith('fx.'),
    ...(info?.error !== undefined ? { error: info.error } : {}),
  }
}

/* ------------------------------------------------------------------------- */
/* 运行时                                                                      */
/* ------------------------------------------------------------------------- */

interface FrameSubscription {
  refs: () => readonly VarRef[]
  callback: (update: WidgetFrameUpdate) => void
  dirty: boolean
}

/** 创建一份 Pane 运行时。 */
export function createDashboardRuntime(options: DashboardRuntimeOptions): DashboardRuntime {
  const paneIndex = options.paneIndex
  const subscriptions = new Set<FrameSubscription>()
  const lastFrameIdx = new Map<string, number>()
  /** alias → 已应用 computed 定义的 source 与签名。 */
  const computedApplied = new Map<string, { source: SeriesSource; signature: string }>()
  const sourceSubscriptions = new Map<
    string,
    { source: SeriesSource; unsubscribers: Array<() => void> }
  >()

  /**
   * 元信息版本号与缓存（plan §11.5 1kHz @perf）。
   *
   * 每帧为每个引用重新构造 `VariableInfo` / `DashboardVariableMeta` 会产生大量短命对象，
   * 触发 GC 长任务。这里缓存「显示元信息」（label/unit/color/decimals/scale/offset），
   * 只有变量增减、显示设置、计算变量、会话状态或仪表盘切换时才失效；
   * 统计值（count/min/max/mean/rate）仍由 `variables()` 每次实时读取。
   */
  let metaVersionValue = 0
  let metaCacheVersion = -1
  let metaDashboard: Dashboard | null = null
  const metaCache = new Map<string, DashboardVariableMeta>()
  const aliasInfoCache = new Map<
    string,
    { infoByKey: Map<string, VariableInfo>; indexByKey: Map<string, number> }
  >()

  function bumpMetaVersion(): void {
    metaVersionValue += 1
  }

  function syncMetaDashboard(): void {
    const dashboard = currentDashboard()
    if (dashboard === metaDashboard) return
    metaDashboard = dashboard
    bumpMetaVersion()
  }

  function ensureMetaCache(): void {
    if (metaCacheVersion === metaVersionValue) return
    metaCacheVersion = metaVersionValue
    metaCache.clear()
    aliasInfoCache.clear()
  }

  function currentDashboard(): Dashboard | null {
    return options.dashboard()
  }

  function bindings(): Record<string, string | null> {
    return options.bindings()
  }

  function defaultAlias(): string {
    const dashboard = currentDashboard()
    return dashboard?.sources[0]?.alias ?? 'main'
  }

  function session(alias: string): LinkSession | undefined {
    const sessionId = bindings()[alias]
    if (!sessionId) return undefined
    return getSessionInstance(sessionId)
  }

  function sourceState(alias: string): DashboardSourceState {
    const bound = session(alias)
    if (!bound) return 'unbound'
    return bound.state === 'open' ? 'open' : 'closed'
  }

  function series(alias: string): SeriesSource | undefined {
    const bound = session(alias)
    if (!bound) return undefined
    const source = getSeriesHub().source(bound.id)
    if (!source) return undefined
    if (computedApplied.get(alias)?.source !== source) attachSource(alias, source)
    return source
  }

  function variables(alias: string): VariableInfo[] {
    return series(alias)?.variables() ?? []
  }

  function meta(ref: VarRef): DashboardVariableMeta {
    syncMetaDashboard()
    ensureMetaCache()
    const cacheKey = `${ref.source}\u0000${ref.key}`
    const cached = metaCache.get(cacheKey)
    if (cached !== undefined) return cached
    let aliasInfo = aliasInfoCache.get(ref.source)
    if (aliasInfo === undefined) {
      const list = variables(ref.source)
      const infoByKey = new Map<string, VariableInfo>()
      const indexByKey = new Map<string, number>()
      for (let index = 0; index < list.length; index += 1) {
        const item = list[index]
        if (item === undefined) continue
        infoByKey.set(item.key, item)
        indexByKey.set(item.key, index)
      }
      aliasInfo = { infoByKey, indexByKey }
      aliasInfoCache.set(ref.source, aliasInfo)
    }
    const index = aliasInfo.indexByKey.get(ref.key)
    const result = buildMeta(
      currentDashboard(),
      ref.source,
      ref.key,
      index === undefined ? undefined : aliasInfo.infoByKey.get(ref.key),
      index ?? 0,
    )
    metaCache.set(cacheKey, result)
    return result
  }

  function rawLatest(ref: VarRef): number | undefined {
    return series(ref.source)?.latest(ref.key)
  }

  function metaFor(ref: VarRef): DashboardVariableMeta {
    return meta(ref)
  }

  function displayValue(ref: VarRef): number | undefined {
    const raw = rawLatest(ref)
    if (raw === undefined) return undefined
    const info = metaFor(ref)
    return raw * info.scale + info.offset
  }

  function read(ref: VarRef, query: SeriesReadQuery = {}): SeriesSlice {
    const source = series(ref.source)
    if (!source) return { idx: new Float64Array(0), t: new Float64Array(0), v: new Float64Array(0) }
    const queryWithDefault: SeriesReadQuery =
      query.last === undefined && query.fromT === undefined && query.sinceIdx === undefined
        ? { ...query, last: 1000 }
        : query
    return source.read(ref.key, queryWithDefault)
  }

  function theme(cssVar: string): string {
    return readThemeVariable(cssVar)
  }

  function boundAliases(): string[] {
    return Object.entries(bindings())
      .filter(([, sessionId]) => sessionId !== null)
      .map(([alias]) => alias)
  }

  function computedSignature(alias: string): string {
    const dashboard = currentDashboard()
    if (!dashboard) return ''
    const defs = dashboard.computed[alias] ?? []
    return defs.map((def) => `${def.key}\u0000${def.expr}\u0000${def.unit ?? ''}`).join('\u0001')
  }

  function applyComputed(alias: string, source: SeriesSource): void {
    const signature = computedSignature(alias)
    const applied = computedApplied.get(alias)
    if (applied?.source === source && applied.signature === signature) return
    const defs = currentDashboard()?.computed[alias] ?? []
    const errors = source.setComputed(defs)
    for (const entry of errors) {
      toast.show({ type: 'error', message: `计算变量 fx.${entry.key} 编译失败：${entry.error}` })
    }
    computedApplied.set(alias, { source, signature })
    markSubscriptionsDirty(alias)
  }

  function attachSource(alias: string, source: SeriesSource): void {
    const existing = sourceSubscriptions.get(alias)
    if (existing?.source === source) return
    if (existing) for (const unsubscribe of existing.unsubscribers) unsubscribe()
    bumpMetaVersion()
    const unsubscribers: Array<() => void> = []
    // 变量增减 / 计算变量出错时强制组件下一次刷新（数据本身可能没变）。
    unsubscribers.push(
      source.on('variables', () => {
        markSubscriptionsDirty(alias)
      }),
    )
    sourceSubscriptions.set(alias, { source, unsubscribers })
    applyComputed(alias, source)
  }

  function markSubscriptionsDirty(alias?: string): void {
    bumpMetaVersion()
    for (const subscription of subscriptions) {
      if (alias === undefined) {
        subscription.dirty = true
        continue
      }
      if (subscription.refs().some((ref) => ref.source === alias)) subscription.dirty = true
    }
  }

  function syncComputed(): void {
    const dashboard = currentDashboard()
    if (!dashboard) return
    for (const alias of Object.keys(bindings())) {
      const source = series(alias)
      if (source) applyComputed(alias, source)
    }
    for (const alias of Object.keys(dashboard.computed)) {
      const source = series(alias)
      if (source) applyComputed(alias, source)
    }
  }

  function subscribeFrame(
    refs: () => readonly VarRef[],
    callback: (update: WidgetFrameUpdate) => void,
  ): () => void {
    const subscription: FrameSubscription = { refs, callback, dirty: true }
    subscriptions.add(subscription)
    return () => {
      subscriptions.delete(subscription)
    }
  }

  function requestUpdate(refs?: readonly VarRef[]): void {
    bumpMetaVersion()
    for (const subscription of subscriptions) {
      if (refs === undefined) {
        subscription.dirty = true
        continue
      }
      const current = subscription.refs()
      const same =
        current.length === refs.length &&
        current.every(
          (ref, index) => ref.source === refs[index]?.source && ref.key === refs[index]?.key,
        )
      if (same) subscription.dirty = true
    }
  }

  function tick(now: number, force = false): number {
    syncMetaDashboard()
    const bindingSnapshot = bindings()
    const aliases = new Set<string>(Object.keys(bindingSnapshot))
    for (const alias of lastFrameIdx.keys()) aliases.add(alias)
    const changed = new Set<string>()
    for (const alias of aliases) {
      const source = series(alias)
      const frameIdx = source?.frameIdx ?? -1
      const previous = lastFrameIdx.get(alias) ?? -1
      if (frameIdx !== previous) {
        lastFrameIdx.set(alias, frameIdx)
        changed.add(alias)
      }
    }

    let notified = 0
    for (const subscription of subscriptions) {
      const refs = subscription.refs()
      let relevant = force || subscription.dirty
      if (!relevant) {
        for (const ref of refs) {
          if (changed.has(ref.source)) {
            relevant = true
            break
          }
          if (bindingSnapshot[ref.source] !== undefined && series(ref.source) === undefined) {
            relevant = true
            break
          }
        }
      }
      if (!relevant) continue
      subscription.dirty = false
      notified += 1
      subscription.callback({
        now,
        refs,
        latest: refs.map((ref) => displayValue(ref)),
        changedAliases: changed.size > 0 ? [...changed] : [],
        metaVersion: metaVersionValue,
      })
    }
    return notified
  }

  async function resolveCommand(
    cmd: CommandSpec | string,
    value: number | boolean | string | undefined,
  ): Promise<{ ok: true; action: CommandAction } | { ok: false; error: string }> {
    const spec: CommandSpec =
      typeof cmd === 'string'
        ? {
            kind: 'template',
            source: defaultAlias(),
            mode: 'text',
            template: cmd,
            options: composeOptionsFor(defaultAlias()),
          }
        : cmd
    const result = renderCommand(
      spec,
      value,
      (ref) => {
        const resolved = displayValue(ref)
        return resolved
      },
      { isSourceBound: (source) => session(source) !== undefined },
    )
    if (!result.ok) return { ok: false, error: result.error }
    return { ok: true, action: result.action }
  }

  function composeOptionsFor(alias: string): Omit<ComposeOptions, 'mode'> {
    const bound = session(alias)
    if (!bound) {
      return {
        encoding: 'utf-8',
        eol: 'none',
        checksum: 'none',
        checksumEndian: 'le',
        checksumSkip: 0,
      }
    }
    const current = bound.compose
    return {
      encoding: current.encoding,
      eol: current.eol,
      checksum: current.checksum,
      checksumEndian: current.checksumEndian,
      checksumSkip: current.checksumSkip,
    }
  }

  async function dispatchAction(action: CommandAction): Promise<DashboardSendResult> {
    switch (action.kind) {
      case 'bytes': {
        const bound = session(action.source)
        if (!bound) throw new Error(`数据源 ${action.source} 未连接`)
        await bound.send(action.bytes, 'widget')
        return 'sent'
      }
      case 'form': {
        const bound = session(action.source)
        if (!bound) throw new Error(`数据源 ${action.source} 未连接`)
        await bound.sendForm(action.values as Record<string, SendValue>)
        return 'sent'
      }
      case 'signal': {
        const bound = session(action.source)
        if (!bound) throw new Error(`数据源 ${action.source} 未连接`)
        await bound.setSignals({ dtr: action.dtr, rts: action.rts, brk: action.brk })
        return 'sent'
      }
      case 'quick':
        return sendQuickItem(action.quickItemId, action.source)
    }
  }

  async function send(
    cmd: CommandSpec | string,
    value?: number | boolean | string,
  ): Promise<DashboardSendResult> {
    const resolved = await resolveCommand(cmd, value)
    if (!resolved.ok) throw new Error(resolved.error)
    return dispatchAction(resolved.action)
  }

  async function sendBytes(
    bytes: Uint8Array | number[],
    alias?: string,
  ): Promise<DashboardSendResult> {
    const sourceAlias = alias ?? defaultAlias()
    const bound = session(sourceAlias)
    if (!bound) throw new Error(`数据源 ${sourceAlias} 未连接`)
    const payload = bytes instanceof Uint8Array ? bytes : Uint8Array.from(bytes)
    await bound.send(payload, 'widget')
    return 'sent'
  }

  interface QuickDataLike {
    kind: 'data'
    input: string
    options: ComposeOptions
  }

  interface QuickSignalLike {
    kind: 'signal'
    steps: ReadonlyArray<{
      dtr?: boolean
      rts?: boolean
      brk?: boolean
      delayMs?: number
    }>
  }

  type QuickLike = QuickDataLike | QuickSignalLike

  function findQuickItem(itemId: string): QuickLike | undefined {
    for (const group of serialQuick.groups) {
      const item = group.items.find((candidate) => candidate.id === itemId)
      if (item) return item as unknown as QuickLike
    }
    return undefined
  }

  function delay(ms: number): Promise<void> {
    return new Promise((resolve) => {
      setTimeout(resolve, Math.max(0, ms))
    })
  }

  async function sendQuickItem(itemId: string, alias?: string): Promise<DashboardSendResult> {
    const sourceAlias = alias ?? defaultAlias()
    const bound = session(sourceAlias)
    if (!bound) throw new Error(`数据源 ${sourceAlias} 未连接`)
    const item = findQuickItem(itemId)
    if (!item) throw new Error(`找不到快捷发送项：${itemId}`)
    if (item.kind === 'data') {
      const composed = compose(item.input, item.options)
      if (!composed.ok) throw new Error(composed.error)
      await bound.send(composed.bytes, 'quick')
      return 'sent'
    }
    for (const step of item.steps) {
      await bound.setSignals({ dtr: step.dtr, rts: step.rts, brk: step.brk })
      if (step.delayMs !== undefined && step.delayMs > 0) await delay(step.delayMs)
    }
    return 'sent'
  }

  return {
    paneIndex,
    get mode() {
      return options.mode()
    },
    dashboard: currentDashboard,
    defaultAlias,
    sourceState,
    isSourceOpen: (alias) => sourceState(alias) === 'open',
    isSourceBound: (alias) => session(alias) !== undefined,
    session,
    series,
    variables,
    meta,
    rawLatest,
    displayValue,
    read,
    theme,
    onThemeChange: subscribeThemeChange,
    send,
    sendBytes,
    sendQuickItem,
    subscribeFrame,
    requestUpdate,
    tick,
    metaVersion: () => metaVersionValue,
    syncComputed,
    boundAliases,
  }
}
