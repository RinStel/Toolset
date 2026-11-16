/**
 * 内置组件的数据读取契约（plan §8.10「刷新调度」/ §8.11）。
 *
 * ```ts
 * const { latest, variables, slices, appended, sourceStates } = useWidgetData(
 *   () => props.variables,           // VarRef[]（数据源 alias + 变量 key）
 *   { history: { last: 2000 } },     // 可选：历史窗口
 * )
 * ```
 *
 * 约定：
 * - **只在刷新调度帧内读取数据**：series 的 `read/latest` 全部在调度器回调中调用，
 *   组件不得自行订阅 `SeriesSource` 的 `data` 事件（否则会绕过 fps 节流）；
 * - `latest` 与 `refs` 顺序一致，已应用 `variableMeta` 的 scale/offset；
 * - `slices` 是每个变量的历史窗口（`idx/t/v`），同样已应用 scale/offset；
 * - `appended` 是「自上次刷新以来的新样本」，每个变量最多 `maxAppended`（默认 10000）
 *   个点，适合增量绘图；
 * - `sourceStates` 与 `refs` 顺序一致：`open` / `closed` / `unbound`；
 * - 主题切换、数据源断开等导致 `variables` 变化时，下一次调度帧会自动触发一次回调。
 *
 * 性能约定（plan §11.5 仪表盘 1kHz @perf）：
 * - `slices` / `appended` 是**惰性计算**：组件不访问时不读取 series，因此只显示最新值的
 *   组件（`value.number` 等）不会每帧复制历史窗口；
 * - `historyRefreshMs` 可把历史窗口读取降到更低频率（例如 FFT 每 250ms 重新读取），
 *   数据仍在 series 中完整记录，只是 UI 侧降低采样；
 * - `history` 可以是函数，用于按当前配置（窗口点数/秒数）动态计算所需的历史长度；
 * - `latest` 每帧更新，只读取元信息缓存与单点值，开销与变量数线性相关且不复制大数组。
 */

import {
  computed,
  inject,
  onScopeDispose,
  ref,
  shallowRef,
  toValue,
  type ComputedRef,
  type MaybeRefOrGetter,
  type Ref,
} from 'vue'

import type { VarRef } from '@/domains/dashboard/public'
import type { SeriesSlice } from '@/domains/series/public'

import type {
  DashboardRuntime,
  DashboardSourceState,
  DashboardVariableMeta,
  WidgetFrameUpdate,
} from './context'
import { DASHBOARD_RUNTIME_KEY } from './injection-keys'

/** 历史窗口：点数或秒数（plan §8.10 `useWidgetData` 的 `history`）。 */
export interface WidgetDataHistoryOptions {
  /** 最近 N 个点，默认 1000。 */
  last?: number
  /** 最近 N 秒（按样本时间戳过滤）。 */
  seconds?: number
}

export interface WidgetDataOptions {
  /** 历史窗口；传函数时在每次读取历史前求值（可按窗口配置动态调整）。 */
  history?: WidgetDataHistoryOptions | (() => WidgetDataHistoryOptions)
  /** `appended` 每个变量的最多点数，默认 10000（plan §6.10）。 */
  maxAppended?: number
  /**
   * 历史窗口 `slices` 的最短刷新间隔（毫秒）。
   *
   * 默认 0（每个调度帧）。1kHz 数据下高频图表可设置 100–250ms，把环形缓冲的
   * 复制与抽取降到 UI 实际需要的频率；`latest` 仍然每帧更新。
   */
  historyRefreshMs?: number
}

/** `useWidgetData` 的返回值。 */
export interface WidgetData {
  /** 与 `refs` 顺序一致的显示值（已应用 scale/offset）。 */
  latest: Readonly<Ref<Array<number | undefined>>>
  /** 与 `refs` 顺序一致的变量元信息（显示名、单位、颜色、小数位）。 */
  variables: ComputedRef<DashboardVariableMeta[]>
  /** 与 `refs` 顺序一致的历史窗口（惰性；未访问时不读取）。 */
  slices: Readonly<Ref<SeriesSlice[]>>
  /** 与 `refs` 顺序一致的增量样本（自上次访问以来；惰性）。 */
  appended: Readonly<Ref<SeriesSlice[]>>
  /** 与 `refs` 顺序一致的数据源状态。 */
  sourceStates: ComputedRef<DashboardSourceState[]>
  /** 计算变量的错误信息（与 `refs` 顺序一致）。 */
  errors: ComputedRef<Array<string | undefined>>
  /** 已处理的刷新帧序号（从 0 开始）。 */
  frameIndex: Readonly<Ref<number>>
  /** 最近一帧的时间戳（毫秒）。 */
  now: Readonly<Ref<number>>
  /** 发送命令（`CommandSpec` 或 text 模板字符串）。 */
  send: DashboardRuntime['send']
  /** 直接发送字节。 */
  sendBytes: DashboardRuntime['sendBytes']
  /** 读取主题 CSS 变量。 */
  theme: DashboardRuntime['theme']
  /** 解析一个变量的元信息。 */
  resolveMeta: (ref: VarRef) => DashboardVariableMeta
  /** 强制下一次刷新回调（属性变化 / requestUpdate）。 */
  requestUpdate: () => void
}

const DEFAULT_HISTORY = 1000
const DEFAULT_MAX_APPENDED = 10_000

function emptySlice(): SeriesSlice {
  return { idx: new Float64Array(0), t: new Float64Array(0), v: new Float64Array(0) }
}

function refKey(ref: VarRef): string {
  return `${ref.source}\u0000${ref.key}`
}

function maxIdx(slice: SeriesSlice): number {
  return slice.idx.length === 0 ? -1 : (slice.idx[slice.idx.length - 1] as number)
}

/**
 * 订阅一个 Pane 的刷新调度。
 *
 * @param refs 组件绑定的变量引用（getter / ref / 数组）
 * @param opts 历史窗口与增量上限
 */
export function useWidgetData(
  refs: MaybeRefOrGetter<readonly VarRef[]>,
  opts: WidgetDataOptions = {},
): WidgetData {
  const runtime = inject(DASHBOARD_RUNTIME_KEY, null)

  const latest = shallowRef<Array<number | undefined>>([])
  const frameIndex = ref(0)
  const now = ref(0)
  /** 变量元信息 / 数据源状态的刷新版本（只在上下文元信息变化时递增）。 */
  const metaTick = ref(0)
  /** 历史窗口的刷新版本（按 `historyRefreshMs` 节流）。 */
  const historyTick = ref(0)

  let lastMetaVersion = runtime?.metaVersion?.() ?? 0
  let lastHistoryAt = Number.NEGATIVE_INFINITY
  let historyNow = 0

  const maxAppended = Math.max(1, opts.maxAppended ?? DEFAULT_MAX_APPENDED)
  const historyRefreshMs = Math.max(0, opts.historyRefreshMs ?? 0)
  /** `appended` 的增量游标：只在组件访问 appended 时更新。 */
  const lastSeen = new Map<string, number>()

  function currentRefs(): readonly VarRef[] {
    return toValue(refs)
  }

  function resolveHistory(): WidgetDataHistoryOptions | undefined {
    const value = opts.history
    return typeof value === 'function' ? value() : value
  }

  function refresh(update?: WidgetFrameUpdate): void {
    const current = currentRefs()
    const frameNow = update?.now ?? now.value
    if (update) {
      frameIndex.value += 1
      now.value = update.now
      if (update.metaVersion !== undefined && update.metaVersion !== lastMetaVersion) {
        lastMetaVersion = update.metaVersion
        metaTick.value += 1
      }
    }

    if (!runtime) {
      latest.value = current.map(() => undefined)
      return
    }

    latest.value =
      update !== undefined ? update.latest : current.map((item) => runtime.displayValue(item))

    // 历史窗口按最短间隔读取；未达间隔时保持上一次的 `slices` 缓存。
    if (
      update === undefined ||
      historyRefreshMs === 0 ||
      frameNow - lastHistoryAt >= historyRefreshMs
    ) {
      lastHistoryAt = frameNow
      historyNow = frameNow
      historyTick.value += 1
    }
  }

  refresh()

  let unsubscribe: (() => void) | null = null
  if (runtime) {
    unsubscribe = runtime.subscribeFrame(currentRefs, (update) => {
      try {
        refresh(update)
      } catch (error) {
        console.error('[dashboard] useWidgetData refresh failed', error)
      }
    })
  }

  onScopeDispose(() => {
    unsubscribe?.()
    unsubscribe = null
  })

  const variables = computed<DashboardVariableMeta[]>(() => {
    // 依赖元信息版本，保证数据源断开 / 元信息变化后重新计算；数据帧本身不触发。
    void metaTick.value
    if (!runtime) return []
    return currentRefs().map((item) => runtime.meta(item))
  })

  /**
   * 历史窗口（惰性）。依赖 `historyTick`：在 `historyRefreshMs` 间隔内重复访问返回同一
   * 数组，组件可在每帧渲染路径里安全读取。
   */
  const slices = computed<SeriesSlice[]>(() => {
    void historyTick.value
    const current = currentRefs()
    if (!runtime) return current.map(emptySlice)
    const history = resolveHistory()
    const seconds = history?.seconds
    const query =
      seconds !== undefined && seconds > 0
        ? { fromT: historyNow - seconds * 1000 }
        : { last: Math.max(1, Math.floor(history?.last ?? DEFAULT_HISTORY)) }
    return current.map((item) => runtime.read(item, query))
  })

  /**
   * 增量样本（惰性）。只有组件访问时才调用 `runtime.read(sinceIdx)`；未访问时不产生
   * 环形缓冲扫描，`lastSeen` 游标在下次访问时一次性补齐（上限 `maxAppended`）。
   */
  const appended = computed<SeriesSlice[]>(() => {
    void frameIndex.value
    const current = currentRefs()
    if (!runtime) return current.map(emptySlice)
    const result: SeriesSlice[] = []
    for (const item of current) {
      const key = refKey(item)
      const previous = lastSeen.get(key) ?? -1
      const slice = runtime.read(item, {
        sinceIdx: Math.max(0, previous + 1),
        limit: maxAppended,
      })
      if (slice.idx.length > 0) {
        lastSeen.set(key, maxIdx(slice))
        result.push(slice)
      } else {
        result.push(emptySlice())
      }
    }
    return result
  })

  const sourceStates = computed<DashboardSourceState[]>(() => {
    void metaTick.value
    if (!runtime) return currentRefs().map(() => 'unbound')
    return currentRefs().map((item) => runtime.sourceState(item.source))
  })

  const errors = computed<Array<string | undefined>>(() =>
    variables.value.map((item) => item.error),
  )

  return {
    latest,
    variables,
    slices,
    appended,
    sourceStates,
    errors,
    frameIndex,
    now,
    send: (cmd, value) => {
      if (!runtime) return Promise.reject(new Error('仪表盘运行时不可用'))
      return runtime.send(cmd, value)
    },
    sendBytes: (bytes, alias) => {
      if (!runtime) return Promise.reject(new Error('仪表盘运行时不可用'))
      return runtime.sendBytes(bytes, alias)
    },
    theme: (cssVar) => runtime?.theme(cssVar) ?? '',
    resolveMeta: (item) =>
      runtime?.meta(item) ?? {
        source: item.source,
        key: item.key,
        label: item.key,
        unit: '',
        color: 'var(--series-1)',
        decimals: 2,
        scale: 1,
        offset: 0,
        computed: item.key.startsWith('fx.'),
      },
    requestUpdate: () => {
      runtime?.requestUpdate(currentRefs())
    },
  }
}
