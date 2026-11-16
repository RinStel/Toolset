/**
 * 变量时间序列的公共类型（plan §6.8）。
 *
 * 本文件只包含类型与常量，不依赖任何运行时模块，避免 `public.ts` 之外出现
 * 循环依赖。
 */

/** `SeriesHub.configure()` 的选项（plan §6.8；默认值见 §8.8）。 */
export interface SeriesHubOptions {
  /** 每个变量保留的样本数，10000–1000000，默认 100000。 */
  capacity: number
  /** 每个数据源的变量上限，8–128，默认 64。 */
  maxVariablesPerSource: number
}

/** 变量的实时信息；`variables()` 返回的顺序为变量首次出现的顺序。 */
export interface VariableInfo {
  key: string
  /** 来自 `DecodeResult.variableMeta`（或自动提取字段的 label），后到的值覆盖先到的。 */
  label?: string
  unit?: string
  computed: boolean
  /** 计算变量求值出错时的错误信息；`setComputed` 成功后清空。 */
  error?: string
  /** 环形缓冲中当前保留的样本数（不超过该变量的容量）。 */
  count: number
  last: number
  lastAt: number
  /** 自上次 `resetStats()` 以来的统计；没有样本时为 0。 */
  min: number
  max: number
  mean: number
  /** 最近 1 秒内写入的样本数。 */
  rate: number
}

/** 一次读取的快照；数组按 idx 升序，且每次调用都返回新数组。 */
export interface SeriesSlice {
  idx: Float64Array
  t: Float64Array
  v: Float64Array
}

/** `SeriesSource.read()` 的过滤条件。 */
export interface SeriesReadQuery {
  /** 只保留最新 N 个点（与 `limit` 取较小值）。 */
  last?: number
  /** 只保留 `idx >= sinceIdx` 的样本。 */
  sinceIdx?: number
  /** 只保留 `t >= fromT` 的样本。 */
  fromT?: number
  /** 只保留 `t <= toT` 的样本。 */
  toT?: number
  /** 最多返回的点数，默认 100000；取满足条件的最新 limit 个点。 */
  limit?: number
}

/** 计算变量定义（plan §6.8）；`key` 中不写 `fx.` 前缀。 */
export interface ComputedVariable {
  key: string
  expr: string
  unit?: string
  label?: string
}

/** 单个会话的变量集合（plan §6.8）。 */
export interface SeriesSource {
  readonly sessionId: string
  /** 已处理的、含变量的帧数（从 1 开始计数）。 */
  readonly frameIdx: number
  /** 非有限数值等无效样本的数量。 */
  readonly invalidSamples: number
  /** 超出上限而被忽略的变量名（最多记录 32 个）。 */
  readonly ignoredVariables: string[]
  /** 按首次出现的顺序返回变量信息。 */
  variables(): VariableInfo[]
  /** 最新值；没有样本或最新样本无效时返回 `undefined`。 */
  latest(key: string): number | undefined
  /** 读取最近 `limit` 个满足条件的样本；`limit` 默认 100000。 */
  read(key: string, query?: SeriesReadQuery): SeriesSlice
  /** 整体替换计算变量定义；返回编译错误（不抛异常）。 */
  setComputed(defs: ComputedVariable[]): Array<{ key: string; error: string }>
  /** 重置 min/max/mean 统计，保留样本。 */
  resetStats(): void
  /** 清空所有样本和统计，保留变量列表和计算变量定义。 */
  clear(): void
  /** 变量增减、元信息变化、计算变量出错。 */
  on(ev: 'variables', cb: () => void): () => void
  /** 每批帧处理完后发出一次。 */
  on(ev: 'data', cb: (event: { frameIdx: number }) => void): () => void
}

/** 自动挂接所有会话的变量时间序列中心（plan §6.8）。 */
export interface SeriesHub {
  /** 修改默认配置；只影响之后新建的变量与数据源（见实现说明）。 */
  configure(opts: SeriesHubOptions): void
  source(sessionId: string): SeriesSource | undefined
  sources(): SeriesSource[]
  on(ev: 'sources', cb: () => void): () => void
}

/** 样本容量默认值与范围（plan §8.8）。 */
export const DEFAULT_SERIES_CAPACITY = 100000
export const MIN_SERIES_CAPACITY = 10000
export const MAX_SERIES_CAPACITY = 1000000

/** 每源变量上限默认值与范围（plan §8.8）。 */
export const DEFAULT_MAX_VARIABLES_PER_SOURCE = 64
export const MIN_MAX_VARIABLES_PER_SOURCE = 8
export const MAX_MAX_VARIABLES_PER_SOURCE = 128

/** 全部数据源的变量总数上限（plan §6.8）。 */
export const MAX_TOTAL_VARIABLES = 256

/** 被忽略变量名的记录上限（plan §6.8）。 */
export const MAX_IGNORED_VARIABLES = 32

/** `read()` 的默认点数上限（plan §6.8）。 */
export const DEFAULT_READ_LIMIT = 100000

/** 环形缓冲的初始容量，写满后翻倍扩容（plan §6.8）。 */
export const INITIAL_RING_CAPACITY = 1024

/** 计算变量存储时自动添加的前缀（plan §6.8）。 */
export const COMPUTED_KEY_PREFIX = 'fx.'

/** 计算变量表达式长度上限（plan §6.8）。 */
export const MAX_COMPUTED_EXPR_LENGTH = 1000

/** `spectrum()` 的 FFT 长度范围（plan §6.8）。 */
export const MIN_SPECTRUM_SIZE = 256
export const MAX_SPECTRUM_SIZE = 16384

/** 窗函数类型（plan §6.8）。 */
export type SpectrumWindow = 'none' | 'hann' | 'hamming' | 'blackman'

/** 幅度谱的纵轴刻度（plan §6.8）。 */
export type SpectrumScale = 'linear' | 'db'

/** `spectrum()` 的选项（plan §6.8）。 */
export interface SpectrumOptions {
  /** FFT 点数，必须是 256–16384 之间的 2 的幂。 */
  size: number
  window: SpectrumWindow
  sampleRate: number
  scale: SpectrumScale
  removeDc: boolean
}

/** 单边幅度谱；`freq.length === mag.length === size / 2 + 1`。 */
export interface Spectrum {
  freq: Float64Array
  mag: Float64Array
}

/** `minMaxDecimate()` 的输出（plan §6.8）。 */
export interface DecimatedSeries {
  x: Float64Array
  y: Float64Array
}

/** `exportSeriesCsv()` 的行范围（plan §6.8）。 */
export interface SeriesExportRange {
  fromIdx?: number
  toIdx?: number
}
