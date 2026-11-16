/**
 * 仪表盘的公共类型与常量（plan §6.9 / §6.10 / §8.11）。
 *
 * 本文件只有类型、接口和常量，不包含任何 Vue 运行时依赖；`WidgetDefinition` 中的
 * `Component` 使用 `import type`（plan §3.2 的 domain-no-ui 规则只约束运行时依赖）。
 */

import type { Component } from 'vue'

import type { ComposeOptions } from '../link/public'
import type { PluginSdk } from '../protocol/public'
import type { ComputedVariable } from '../series/public'

/** 仪表盘文件格式版本；目前只有 1（plan §6.9）。 */
export const DASHBOARD_SCHEMA_VERSION = 1

/** 网格列数（plan §6.9）。 */
export const COLS = 24

/** 行高默认值与范围（plan §6.9 `Dashboard.rowHeight`）。 */
export const DEFAULT_ROW_HEIGHT = 28
export const MIN_ROW_HEIGHT = 16
export const MAX_ROW_HEIGHT = 64

/** 组件尺寸范围（plan §6.9 `WidgetInstance`）。 */
export const MIN_WIDGET_W = 1
export const MAX_WIDGET_W = COLS
export const MIN_WIDGET_H = 1
export const MAX_WIDGET_H = 64

/** 数据源 alias 的合法格式（plan §6.9）。 */
export const SOURCE_ALIAS_PATTERN = /^[a-z][a-z0-9_]{0,15}$/

/** 默认数据源 alias（plan §6.9）。 */
export const DEFAULT_SOURCE_ALIAS = 'main'

/** 新建组件时的默认 props 版本。 */
export const DEFAULT_WIDGET_VERSION = 1

/** 自定义控件状态（`WidgetInstance.state`）的 JSON 上限：64KB（plan §6.9）。 */
export const MAX_WIDGET_STATE_BYTES = 64 * 1024

/** 自定义控件源码上限：256KB（plan §6.10）。 */
export const MAX_CUSTOM_WIDGET_CODE_LENGTH = 256 * 1024

/** 颜色属性 `auto`：按变量颜色或主题色（plan §6.9 / §8.11）。 */
export const COLOR_AUTO = 'auto'

/** 调色板，定义在 `tokens.css`（plan §6.9 / §8.11）。 */
export const SERIES_COLORS = [
  'var(--series-1)',
  'var(--series-2)',
  'var(--series-3)',
  'var(--series-4)',
  'var(--series-5)',
  'var(--series-6)',
  'var(--series-7)',
  'var(--series-8)',
  'var(--series-9)',
  'var(--series-10)',
  'var(--series-11)',
  'var(--series-12)',
] as const

/** 内置组件统一的空状态文案（plan §8.11 公共约定）。 */
export const EMPTY_NO_VARIABLE = '未绑定变量'
export const EMPTY_WAITING_DATA = '等待数据…'
export const EMPTY_SOURCE_DISCONNECTED = '数据源未连接'

/* ------------------------------------------------------------------------- */
/* 仪表盘模型（plan §6.9）                                                     */
/* ------------------------------------------------------------------------- */

export interface Dashboard {
  schema: 1
  id: string
  name: string
  createdAt: number
  updatedAt: number
  /** 网格行高，16–64 px，默认 28。 */
  rowHeight: number
  /** 至少 1 个，第一个为默认数据源。 */
  sources: DashboardSource[]
  /** 键为 `<alias>/<key>`。 */
  variableMeta: Record<string, VariableMetaOverride>
  /** 键为 alias。 */
  computed: Record<string, ComputedVariable[]>
  widgets: WidgetInstance[]
}

export interface DashboardSource {
  /** `/^[a-z][a-z0-9_]{0,15}$/`，在仪表盘内唯一；默认数据源为 `main`。 */
  alias: string
  /** 如「主设备」。 */
  label: string
  /** 自动匹配会话的依据。 */
  match?: { deviceKey?: string; providerKind?: string }
}

/**
 * 单个变量的显示覆盖（plan §6.9）。
 *
 * 显示值 = 原始值 × scale + offset；只影响仪表盘显示与控件反馈值。
 */
export interface VariableMetaOverride {
  label?: string
  unit?: string
  color?: string
  scale?: number
  offset?: number
  decimals?: number
}

/** 变量引用；`source` 为数据源 alias。 */
export interface VarRef {
  source: string
  key: string
}

export interface WidgetInstance {
  id: string
  /** 内置类型（如 `chart.line`）或 `custom:<customWidgetId>`。 */
  type: string
  /** 组件定义的 props 版本，用于迁移。 */
  version: number
  /** 网格单位：0 ≤ x，x + w ≤ 24，1 ≤ w ≤ 24，1 ≤ h ≤ 64，y ≥ 0。 */
  x: number
  y: number
  w: number
  h: number
  common: CommonProps
  props: Record<string, unknown>
  /** 只供自定义控件使用；JSON 可序列化，不超过 64KB。 */
  state?: Record<string, unknown>
}

export interface CommonProps {
  /** 默认为组件类型名。 */
  title: string
  /** 默认 true。 */
  showTitle: boolean
  /** 默认 'left'。 */
  titleAlign: 'left' | 'center'
  /** 默认 'default'（--bg-elev）；`string` 为颜色值。 */
  background: 'default' | 'transparent' | string
  /** 默认 true。 */
  border: boolean
  /** 默认 8。 */
  padding: 0 | 4 | 8 | 12
  /** 0.75–2，默认 1。 */
  fontScale: number
}

/** 属性面板标签页（plan §6.9）。 */
export type WidgetPropTab = 'data' | 'style' | 'behavior'

/** 属性描述公共字段（plan §6.9）。 */
export interface PropBase {
  key: string
  label: string
  /** 属性面板标签页：数据 / 外观 / 行为。 */
  tab: WidgetPropTab
  help?: string
  /** 条件显示，用来保持面板简洁。 */
  visibleWhen?: { key: string; equals: unknown | unknown[] }
}

/** 属性描述，内置组件与自定义控件共用（plan §6.9）。 */
export type WidgetPropField = PropBase &
  (
    | { type: 'number'; min?: number; max?: number; step?: number; unit?: string; default?: number }
    | { type: 'text'; maxLength?: number; placeholder?: string; default?: string }
    | { type: 'textarea'; rows?: number; default?: string }
    | {
        type: 'select'
        options: Array<{ label: string; value: string | number }>
        default?: string | number
      }
    | { type: 'checkbox'; default?: boolean }
    | { type: 'color'; default?: string }
    | { type: 'range'; default?: { min: number | null; max: number | null } }
    | { type: 'variable'; default?: VarRef | null }
    | { type: 'variables'; min?: number; max?: number; itemFields?: WidgetPropField[] }
    | { type: 'thresholds'; default?: Threshold[] }
    | { type: 'zones'; default?: Zone[] }
    | { type: 'options'; default?: Array<{ label: string; value: string | number }> }
    | { type: 'command'; default?: CommandSpec | null }
    | { type: 'expression'; default?: string }
  )

/** 阈值；满足条件时改变显示（plan §6.9）。 */
export interface Threshold {
  op: '>' | '>=' | '<' | '<=' | '==' | '!='
  value: number
  color: string
  label?: string
}

/** 仪表分区（plan §6.9）。 */
export interface Zone {
  from: number
  to: number
  color: string
}

/** 命令规格（plan §6.9）。 */
export type CommandSpec =
  | {
      kind: 'template'
      source: string
      mode: 'text' | 'hex'
      template: string
      options: Omit<ComposeOptions, 'mode'>
    }
  | { kind: 'protocol'; source: string; values: Record<string, string | number | boolean> }
  | { kind: 'signal'; source: string; dtr?: boolean; rts?: boolean; brk?: boolean }
  /** 执行一个快捷发送项。 */
  | { kind: 'quick'; source: string; quickItemId: string }

/* ------------------------------------------------------------------------- */
/* 内置组件定义（plan §8.11）                                                  */
/* ------------------------------------------------------------------------- */

export type WidgetGroup = 'chart' | 'value' | 'control'

/**
 * 内置组件定义；`definition.ts` 的默认导出（plan §8.11）。
 *
 * 图标与组件只做类型引用，不在领域层产生任何 Vue 运行时依赖。
 */
export interface WidgetDefinition {
  type: string
  version: number
  title: string
  description: string
  group: WidgetGroup
  icon: Component
  defaultSize: { w: number; h: number }
  minSize: { w: number; h: number }
  props: WidgetPropField[]
  migrate?(props: Record<string, unknown>, fromVersion: number): Record<string, unknown>
  component: () => Promise<{ default: Component }>
}

/* ------------------------------------------------------------------------- */
/* 自定义控件（plan §6.10）                                                    */
/* ------------------------------------------------------------------------- */

export type CustomWidgetGroup = WidgetGroup

export interface CustomWidgetMeta {
  name: string
  description?: string
  version?: string
  /** group 默认 'value'。 */
  group?: CustomWidgetGroup
}

export interface CustomWidgetSize {
  /** 默认 6×6。 */
  default?: { w: number; h: number }
  /** 最小 2×2。 */
  min?: { w: number; h: number }
}

export interface CustomWidgetDefinition {
  apiVersion: 1
  meta: CustomWidgetMeta
  /** 默认 6×6，最小 2×2。 */
  size?: CustomWidgetSize
  /** 自动生成属性面板，key 不得与 'variables' 冲突。 */
  props?: WidgetPropField[]
  /** 声明后，属性面板「数据」页自动加入变量选择（值保存在 props.variables 中）。 */
  variables?: { min: number; max: number }
  mount(el: HTMLElement, ctx: CustomWidgetContext): CustomWidgetInstance | void
}

export interface CustomWidgetInstance {
  /** 刷新周期内有新数据或 requestUpdate 时调用。 */
  update?(data: WidgetFrameData): void
  /** 未实现时，属性变化会触发 destroy 后重新 mount。 */
  propsChanged?(props: Record<string, unknown>): void
  resize?(size: { width: number; height: number }): void
  destroy?(): void
}

/** 一帧的序列数据；`idx`、`t`、`v` 等长。 */
export interface WidgetSeriesData {
  idx: Float64Array
  t: Float64Array
  v: Float64Array
}

export interface WidgetFrameData {
  now: number
  /** 与 ctx.variables 顺序一致，已应用 scale/offset。 */
  latest: Array<number | undefined>
  /** 自上次 update 以来的新样本，每个变量最多 10000 个，已应用 scale/offset。 */
  appended: WidgetSeriesData[]
}

/** 自定义控件变量元信息（plan §6.10 `ctx.variables` 项）。 */
export interface CustomWidgetVariable {
  source: string
  key: string
  label: string
  unit: string
  color: string
}

export interface CustomWidgetContext {
  /** 已合并默认值。 */
  readonly props: Readonly<Record<string, unknown>>
  readonly variables: ReadonlyArray<CustomWidgetVariable>
  readonly size: { width: number; height: number }
  readonly mode: 'edit' | 'run'
  latest(i: number): number | undefined
  /** 最多 100000 个点。 */
  history(i: number, q?: { last?: number; fromT?: number }): WidgetSeriesData
  send(cmd: CommandSpec | string, value?: number | boolean | string): Promise<void>
  sendBytes(bytes: Uint8Array | number[], source?: string): Promise<void>
  sourceState(source?: string): 'open' | 'closed' | 'unbound'
  /** 实例的持久状态，随仪表盘保存。 */
  readonly state: Record<string, unknown>
  /** 1 秒内把 state 写入仪表盘（JSON 往返检查，超过 64KB 时抛错）。 */
  saveState(): void
  /** 读取 CSS 变量，如 `theme('--accent')`。 */
  theme(cssVar: string): string
  onThemeChange(cb: () => void): () => void
  requestUpdate(): void
  /** 输出到编辑器的调试面板（最近 100 行），同时调用 console.debug。 */
  log(...args: unknown[]): void
  /** 与协议插件相同的 SDK（plan §6.5）。 */
  readonly sdk: PluginSdk
}
