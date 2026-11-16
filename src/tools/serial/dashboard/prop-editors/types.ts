/**
 * 属性编辑器共用的类型与工具（plan §8.10「属性面板」）。
 */

import type { Dashboard, WidgetPropField, VarRef } from '@/domains/dashboard/public'

import type { DashboardRuntime } from '../runtime/context'

/** 编辑器收到的上下文：当前仪表盘、运行时与（多选时的）组件 id。 */
export interface PropEditorContext {
  dashboard: Dashboard
  runtime: DashboardRuntime
  instanceIds: readonly string[]
  /** Current selected widget props (when exactly one widget is selected). */
  props?: Readonly<Record<string, unknown>>
  /** Schema defaults for the selected widget props. */
  defaults?: Readonly<Record<string, unknown>>
}

/** 从 `WidgetPropField` 联合类型中取出某一种编辑器对应的字段类型。 */
export type PropFieldOf<T extends WidgetPropField['type']> = Extract<WidgetPropField, { type: T }>

/** 属性编辑器的通用 emit。 */
export interface PropEditorEmits {
  update: [value: unknown]
}

/** 数据源下拉选项。 */
export function sourceOptions(context: PropEditorContext): Array<{ label: string; value: string }> {
  return context.dashboard.sources.map((source) => ({
    label: `${source.alias} · ${source.label}`,
    value: source.alias,
  }))
}

/** 某数据源当前的变量（用于 variable / variables 编辑器）。 */
export function variablesOf(
  context: PropEditorContext,
  alias: string,
): Array<{ key: string; label: string }> {
  return context.runtime.variables(alias).map((info) => ({
    key: info.key,
    label: info.label !== undefined && info.label !== '' ? info.label : info.key,
  }))
}

/** 显示值（已应用 scale/offset 与小数位）。 */
export function formatDisplayValue(context: PropEditorContext, ref: VarRef | null): string {
  if (!ref) return '--'
  const value = context.runtime.displayValue(ref)
  if (value === undefined || !Number.isFinite(value)) return '--'
  const decimals = context.runtime.meta(ref).decimals
  return value.toFixed(Math.max(0, Math.min(10, Math.round(decimals))))
}

/** 读取对象值。 */
export function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {}
}

/** 读取数组值。 */
export function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : []
}

/** 读取数字；非法时返回 fallback。 */
export function asNumber(value: unknown, fallback = 0): number {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : fallback
}

/** 读取字符串。 */
export function asString(value: unknown, fallback = ''): string {
  return typeof value === 'string'
    ? value
    : value === undefined || value === null
      ? fallback
      : String(value)
}

/** 读取 `VarRef`；非法的引用返回 `null`。 */
export function asVarRef(value: unknown): VarRef | null {
  const record = asRecord(value)
  if (typeof record.source !== 'string' || typeof record.key !== 'string') return null
  return { source: record.source, key: record.key }
}
