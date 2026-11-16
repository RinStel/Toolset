/**
 * 串口助手工具设置（plan §8.8）。
 *
 * 持久化到 `toolset/tool/serial/settings.v1`。模块持有一份响应式镜像，设置面板
 * （由应用外壳的抽屉渲染）和工具视图因此能即时同步。
 *
 * 颜色项为 `null` 时表示「使用主题变量」；非空时由工具根元素上的 CSS 变量覆盖
 * `--log-rx` 等令牌（见 {@link applyColorVariables}）。
 */

import { reactive, readonly } from 'vue'

import type { TextEncodingName } from '@/domains/bytes/public'
import type { ComposeOptions, DisplayMode } from '@/domains/link/public'
import { getSeriesHub } from '@/domains/series/public'
import type { SettingField } from '@/shared/contracts/settings'
import { createToolStorage } from '@/shared/lib/storage/namespace'

/** 日志条数上限的约束（plan §8.8）。 */
export const LOG_ENTRIES_MIN = 1000
export const LOG_ENTRIES_MAX = 50_000
export const LOG_ENTRIES_DEFAULT = 5000

/** 日志字节预算的约束，界面以 MB 为单位。 */
export const LOG_BYTES_MIN_MB = 8
export const LOG_BYTES_MAX_MB = 256
export const LOG_BYTES_DEFAULT_MB = 32

/** 每个变量保留的样本数范围（plan §8.8）。 */
export const SERIES_CAPACITY_MIN = 10_000
export const SERIES_CAPACITY_MAX = 1_000_000
export const SERIES_CAPACITY_DEFAULT = 100_000

/** 每个数据源的变量上限范围（plan §8.8）。 */
export const MAX_VARIABLES_MIN = 8
export const MAX_VARIABLES_MAX = 128
export const MAX_VARIABLES_DEFAULT = 64

/** 仪表盘刷新率（plan §8.8 / §8.10）。 */
export const DASHBOARD_FPS_OPTIONS = [15, 30, 60] as const
export type DashboardFps = (typeof DASHBOARD_FPS_OPTIONS)[number]
export const DASHBOARD_FPS_DEFAULT: DashboardFps = 30

/** 每个样本的内存占用（idx/t/v 三个 Float64），plan §8.8 的内存估算。 */
export const SERIES_BYTES_PER_SAMPLE = 24

/** 内存估算：`样本数 × 变量数 × 24 字节`，单位 MB（四舍五入）。 */
export function estimateSeriesMemoryMb(capacity: number, maxVariables: number): number {
  const samples = Number.isFinite(capacity) ? Math.max(0, capacity) : 0
  const variables = Number.isFinite(maxVariables) ? Math.max(0, maxVariables) : 0
  return Math.round((samples * variables * SERIES_BYTES_PER_SAMPLE) / (1024 * 1024))
}

/** 颜色设置键；`null` 表示回落到主题变量。 */
export type SerialColorKey =
  'colorRx' | 'colorTx' | 'colorSystem' | 'colorError' | 'colorTimestamp' | 'colorDecoded'

/** 一种可覆盖的日志颜色。 */
export interface LogColorField {
  key: SerialColorKey
  label: string
  cssVar: string
}

/** 设置面板中的颜色行，顺序与 plan §8.8 一致。 */
export const LOG_COLOR_FIELDS: readonly LogColorField[] = [
  { key: 'colorRx', label: '接收（RX）', cssVar: '--log-rx' },
  { key: 'colorTx', label: '发送（TX）', cssVar: '--log-tx' },
  { key: 'colorSystem', label: '系统（SYS）', cssVar: '--log-sys' },
  { key: 'colorError', label: '错误', cssVar: '--log-err' },
  { key: 'colorTimestamp', label: '时间戳', cssVar: '--log-ts' },
  { key: 'colorDecoded', label: '解析结果', cssVar: '--log-decoded' },
]

/** 串口助手设置结构（存储版本 1）。 */
export interface SerialToolSettings {
  /** 每个会话的日志条数上限。 */
  maxLogEntries: number
  /** 每个会话的日志字节预算，单位 MB。 */
  maxLogBytesMb: number
  /** 新 Pane 的默认显示模式。 */
  defaultDisplayMode: DisplayMode
  defaultShowTimestamp: boolean
  defaultShowTx: boolean
  defaultShowSystem: boolean
  defaultShowBridge: boolean
  colorRx: string | null
  colorTx: string | null
  colorSystem: string | null
  colorError: string | null
  colorTimestamp: string | null
  colorDecoded: string | null
  /** 手动发送的默认文本编码。 */
  defaultEncoding: TextEncodingName
  /** 手动发送的默认行尾。 */
  defaultEol: ComposeOptions['eol']
  /** 开启后 Enter 发送，Shift+Enter 换行。 */
  enterToSend: boolean
  /** 是否在侧栏显示演示端口入口。 */
  showDemoProvider: boolean
  /** 每个变量保留的样本数（plan §8.8）。 */
  seriesCapacity: number
  /** 每个数据源的变量上限（plan §8.8）。 */
  maxVariablesPerSource: number
  /** 仪表盘刷新率（plan §8.8）。 */
  dashboardFps: DashboardFps
  /** 新会话的日志策略是否默认开启自动抽样（写入 `LogPolicy.auto`）。 */
  logAutoSample: boolean
}

/** 默认值（plan §8.8）。 */
export const DEFAULT_SERIAL_SETTINGS: Readonly<SerialToolSettings> = Object.freeze({
  maxLogEntries: LOG_ENTRIES_DEFAULT,
  maxLogBytesMb: LOG_BYTES_DEFAULT_MB,
  defaultDisplayMode: 'both',
  defaultShowTimestamp: true,
  defaultShowTx: true,
  defaultShowSystem: true,
  defaultShowBridge: true,
  colorRx: null,
  colorTx: null,
  colorSystem: null,
  colorError: null,
  colorTimestamp: null,
  colorDecoded: null,
  defaultEncoding: 'utf-8',
  defaultEol: 'none',
  enterToSend: false,
  showDemoProvider: true,
  seriesCapacity: SERIES_CAPACITY_DEFAULT,
  maxVariablesPerSource: MAX_VARIABLES_DEFAULT,
  dashboardFps: DASHBOARD_FPS_DEFAULT,
  logAutoSample: true,
})

const DISPLAY_MODES: readonly DisplayMode[] = ['raw', 'decoded', 'both']
const ENCODINGS: readonly TextEncodingName[] = ['utf-8', 'ascii', 'latin1', 'gbk']
const EOLS: readonly ComposeOptions['eol'][] = ['none', 'cr', 'lf', 'crlf']
const HEX_COLOR = /^#[0-9a-f]{6}$/

/** 深色主题的令牌值，用于在取不到计算样式时（测试 / SSR）展示颜色选择器。 */
const FALLBACK_THEME_COLORS: Readonly<Record<string, string>> = Object.freeze({
  '--log-rx': '#8fb8c9',
  '--log-tx': '#d7a64a',
  '--log-sys': '#8b9691',
  '--log-err': '#e07a72',
  '--log-ts': '#68736c',
  '--log-decoded': '#8fbf9a',
})

function clampInteger(value: unknown, min: number, max: number, fallback: number): number {
  const parsed = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(parsed)) return fallback
  return Math.min(max, Math.max(min, Math.round(parsed)))
}

function isDisplayMode(value: unknown): value is DisplayMode {
  return typeof value === 'string' && (DISPLAY_MODES as readonly string[]).includes(value)
}

function isEncoding(value: unknown): value is TextEncodingName {
  return typeof value === 'string' && (ENCODINGS as readonly string[]).includes(value)
}

function isEol(value: unknown): value is ComposeOptions['eol'] {
  return typeof value === 'string' && (EOLS as readonly string[]).includes(value)
}

function normalizeColor(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const normalized = value.trim().toLowerCase()
  return HEX_COLOR.test(normalized) ? normalized : null
}

function normalizeBoolean(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback
}

function normalizeDashboardFps(value: unknown): DashboardFps {
  const parsed = typeof value === 'number' ? value : Number(value)
  return (DASHBOARD_FPS_OPTIONS as readonly number[]).includes(parsed)
    ? (parsed as DashboardFps)
    : DASHBOARD_FPS_DEFAULT
}

/** 把任意来源的数据收敛为一份合法设置（缺失 / 非法字段回落到默认值）。 */
export function normalizeSerialSettings(raw: unknown): SerialToolSettings {
  const source = (typeof raw === 'object' && raw !== null ? raw : {}) as Record<string, unknown>
  const defaults = DEFAULT_SERIAL_SETTINGS
  return {
    maxLogEntries: clampInteger(
      source.maxLogEntries,
      LOG_ENTRIES_MIN,
      LOG_ENTRIES_MAX,
      defaults.maxLogEntries,
    ),
    maxLogBytesMb: clampInteger(
      source.maxLogBytesMb,
      LOG_BYTES_MIN_MB,
      LOG_BYTES_MAX_MB,
      defaults.maxLogBytesMb,
    ),
    defaultDisplayMode: isDisplayMode(source.defaultDisplayMode)
      ? source.defaultDisplayMode
      : defaults.defaultDisplayMode,
    defaultShowTimestamp: normalizeBoolean(
      source.defaultShowTimestamp,
      defaults.defaultShowTimestamp,
    ),
    defaultShowTx: normalizeBoolean(source.defaultShowTx, defaults.defaultShowTx),
    defaultShowSystem: normalizeBoolean(source.defaultShowSystem, defaults.defaultShowSystem),
    defaultShowBridge: normalizeBoolean(source.defaultShowBridge, defaults.defaultShowBridge),
    colorRx: normalizeColor(source.colorRx),
    colorTx: normalizeColor(source.colorTx),
    colorSystem: normalizeColor(source.colorSystem),
    colorError: normalizeColor(source.colorError),
    colorTimestamp: normalizeColor(source.colorTimestamp),
    colorDecoded: normalizeColor(source.colorDecoded),
    defaultEncoding: isEncoding(source.defaultEncoding)
      ? source.defaultEncoding
      : defaults.defaultEncoding,
    defaultEol: isEol(source.defaultEol) ? source.defaultEol : defaults.defaultEol,
    enterToSend: normalizeBoolean(source.enterToSend, defaults.enterToSend),
    showDemoProvider: normalizeBoolean(source.showDemoProvider, defaults.showDemoProvider),
    seriesCapacity: clampInteger(
      source.seriesCapacity,
      SERIES_CAPACITY_MIN,
      SERIES_CAPACITY_MAX,
      defaults.seriesCapacity,
    ),
    maxVariablesPerSource: clampInteger(
      source.maxVariablesPerSource,
      MAX_VARIABLES_MIN,
      MAX_VARIABLES_MAX,
      defaults.maxVariablesPerSource,
    ),
    dashboardFps: normalizeDashboardFps(source.dashboardFps),
    logAutoSample: normalizeBoolean(source.logAutoSample, defaults.logAutoSample),
  }
}

const store = createToolStorage('serial').local<SerialToolSettings>('settings', {
  version: 1,
  defaults: () => ({ ...DEFAULT_SERIAL_SETTINGS }),
  migrate: (raw) => normalizeSerialSettings(raw),
})

const state = reactive<SerialToolSettings>(normalizeSerialSettings(store.get()))

store.subscribe((value) => {
  Object.assign(state, normalizeSerialSettings(value))
})

/** 当前设置（只读快照，组件直接读取即可获得响应式更新）。 */
export const serialSettings = readonly(state)

/** 合并并持久化一份设置。 */
export function updateSerialSettings(patch: Partial<SerialToolSettings>): void {
  const merged = { ...state, ...patch }
  const next = normalizeSerialSettings(merged)
  // 数字输入框在编辑过程中会逐字符触发 change；这里保留原始数值，避免被立刻钳制后
  // 回写导致无法继续输入。真正使用时（logLimitsFromSettings）与下次读取时都会钳制。
  for (const key of [
    'maxLogEntries',
    'maxLogBytesMb',
    'seriesCapacity',
    'maxVariablesPerSource',
  ] as const) {
    const raw = (patch as Record<string, unknown>)[key]
    if (typeof raw === 'number' && Number.isFinite(raw)) next[key] = raw
  }
  Object.assign(state, next)
  store.set(next)
  if (patch.seriesCapacity !== undefined || patch.maxVariablesPerSource !== undefined) {
    applySeriesSettings()
  }
}

/** 把样本数与变量上限写入 series hub（只影响之后新建的变量，plan §8.8）。 */
export function applySeriesSettings(): void {
  getSeriesHub().configure({
    capacity: clampInteger(
      state.seriesCapacity,
      SERIES_CAPACITY_MIN,
      SERIES_CAPACITY_MAX,
      SERIES_CAPACITY_DEFAULT,
    ),
    maxVariablesPerSource: clampInteger(
      state.maxVariablesPerSource,
      MAX_VARIABLES_MIN,
      MAX_VARIABLES_MAX,
      MAX_VARIABLES_DEFAULT,
    ),
  })
}

/** 恢复全部默认值。 */
export function resetSerialSettings(): void {
  const next = normalizeSerialSettings(DEFAULT_SERIAL_SETTINGS)
  Object.assign(state, next)
  store.set(next)
  applySeriesSettings()
}

/** 单个颜色项恢复为主题变量（`null`）。 */
export function resetSerialColor(key: SerialColorKey): void {
  updateSerialSettings({ [key]: null } as unknown as Partial<SerialToolSettings>)
}

/** 当前生效的日志上限；新建会话时套用。 */
export function logLimitsFromSettings(): { maxEntries: number; maxBytes: number } {
  return {
    maxEntries: clampInteger(
      state.maxLogEntries,
      LOG_ENTRIES_MIN,
      LOG_ENTRIES_MAX,
      LOG_ENTRIES_DEFAULT,
    ),
    maxBytes:
      clampInteger(state.maxLogBytesMb, LOG_BYTES_MIN_MB, LOG_BYTES_MAX_MB, LOG_BYTES_DEFAULT_MB) *
      1024 *
      1024,
  }
}

/**
 * 把非空的颜色设置写到串口工具根元素。
 *
 * 值为 `null` 时移除对应自定义属性，回落到 `tokens.css` 中的主题变量。
 */
export function applyColorVariables(root: HTMLElement | null | undefined): void {
  if (!root) return
  for (const field of LOG_COLOR_FIELDS) {
    const value = state[field.key]
    if (value === null) root.style.removeProperty(field.cssVar)
    else root.style.setProperty(field.cssVar, value)
  }
}

/** 读取当前主题下的日志颜色，颜色选择器用它作为「未覆盖」时的展示值。 */
export function resolveThemeLogColors(): Record<string, string> {
  const result: Record<string, string> = { ...FALLBACK_THEME_COLORS }
  if (typeof document === 'undefined' || typeof getComputedStyle !== 'function') return result
  const style = getComputedStyle(document.documentElement)
  for (const field of LOG_COLOR_FIELDS) {
    const value = style.getPropertyValue(field.cssVar).trim()
    if (value.length > 0) result[field.cssVar] = value
  }
  return result
}

const ENCODING_OPTIONS = [
  { label: 'UTF-8', value: 'utf-8' },
  { label: 'ASCII', value: 'ascii' },
  { label: 'Latin-1', value: 'latin1' },
  { label: 'GBK', value: 'gbk' },
]

const EOL_OPTIONS = [
  { label: '无', value: 'none' },
  { label: 'CR（\\r）', value: 'cr' },
  { label: 'LF（\\n）', value: 'lf' },
  { label: 'CRLF（\\r\\n）', value: 'crlf' },
]

const DISPLAY_MODE_OPTIONS = [
  { label: '原始', value: 'raw' },
  { label: '解析', value: 'decoded' },
  { label: '原始+解析', value: 'both' },
]

/** 工具设置面板使用的基础字段（颜色项由面板单独渲染）。 */
export const SETTINGS_FIELDS: SettingField[] = [
  {
    key: 'maxLogEntries',
    label: '日志条数上限',
    type: 'number',
    min: LOG_ENTRIES_MIN,
    max: LOG_ENTRIES_MAX,
    step: 100,
    default: LOG_ENTRIES_DEFAULT,
    unit: '条',
    hint: '修改后只对新建会话生效；当前会话在下次清空日志时套用',
  },
  {
    key: 'maxLogBytesMb',
    label: '日志字节预算',
    type: 'number',
    min: LOG_BYTES_MIN_MB,
    max: LOG_BYTES_MAX_MB,
    step: 1,
    default: LOG_BYTES_DEFAULT_MB,
    unit: 'MB',
    hint: '按估算字节数淘汰最旧的日志，修改后同样只对新建会话生效',
  },
  {
    key: 'defaultDisplayMode',
    label: '默认显示模式',
    type: 'select',
    options: DISPLAY_MODE_OPTIONS,
    default: 'both',
  },
  {
    key: 'defaultShowTimestamp',
    label: '默认显示时间戳',
    type: 'checkbox',
    default: true,
  },
  {
    key: 'defaultShowTx',
    label: '默认显示发送记录',
    type: 'checkbox',
    default: true,
  },
  {
    key: 'defaultShowSystem',
    label: '默认显示系统记录',
    type: 'checkbox',
    default: true,
  },
  {
    key: 'defaultShowBridge',
    label: '默认显示转发记录',
    type: 'checkbox',
    default: true,
  },
  {
    key: 'defaultEncoding',
    label: '默认文本编码',
    type: 'select',
    options: ENCODING_OPTIONS,
    default: 'utf-8',
  },
  {
    key: 'defaultEol',
    label: '默认行尾',
    type: 'select',
    options: EOL_OPTIONS,
    default: 'none',
  },
  {
    key: 'enterToSend',
    label: 'Enter 发送',
    type: 'checkbox',
    default: false,
    hint: '开启后按 Enter 发送，Shift+Enter 换行',
  },
  {
    key: 'showDemoProvider',
    label: '显示演示端口入口',
    type: 'checkbox',
    default: true,
  },
  {
    key: 'seriesCapacity',
    label: '每个变量保留的样本数',
    type: 'number',
    min: SERIES_CAPACITY_MIN,
    max: SERIES_CAPACITY_MAX,
    step: 10_000,
    default: SERIES_CAPACITY_DEFAULT,
    unit: '个',
    hint: '修改后只对之后新建的变量生效',
  },
  {
    key: 'maxVariablesPerSource',
    label: '每个数据源的变量上限',
    type: 'number',
    min: MAX_VARIABLES_MIN,
    max: MAX_VARIABLES_MAX,
    step: 1,
    default: MAX_VARIABLES_DEFAULT,
    unit: '个',
    hint: '修改后只对之后新建的变量生效',
  },
  {
    key: 'dashboardFps',
    label: '仪表盘刷新率',
    type: 'select',
    options: DASHBOARD_FPS_OPTIONS.map((fps) => ({ label: `${fps} fps`, value: fps })),
    default: DASHBOARD_FPS_DEFAULT,
    hint: '页面隐藏时自动停止刷新',
  },
  {
    key: 'logAutoSample',
    label: '日志自动抽样',
    type: 'checkbox',
    default: true,
    hint: '数据帧速率过高时自动切换为抽样记录；只影响新建会话的默认值',
  },
]

/** 把样本数 / 变量上限写入 series hub；设置面板与工具视图加载时调用。 */
export function syncSeriesConfiguration(): void {
  applySeriesSettings()
}

syncSeriesConfiguration()
