/**
 * 内置组件的公共格式化与取值工具（plan §8.11「公共约定」/ §6.9 属性描述）。
 *
 * 这里的函数都是纯函数，不依赖 Vue；组件与属性面板的取值口径保持一致：
 * - 显示值由 `useWidgetData` 提供（已经过 `variableMeta` 的 scale/offset）；
 * - 显示的小数位由 `variableMeta.decimals` 或组件自身的 `decimals` 覆盖；
 * - 颜色 `auto` 表示「变量颜色 / `--series-n`」，由调用方解析后传入。
 */

import type { Threshold, VarRef, Zone } from '@/domains/dashboard/public'

/** 未格式化为有限数字时统一显示的文本。 */
export const MISSING_TEXT = '--'

/** 读取字符串值。 */
export function asString(value: unknown, fallback = ''): string {
  if (typeof value === 'string') return value
  if (value === undefined || value === null) return fallback
  return String(value)
}

/** 读取有限数字值。 */
export function asNumber(value: unknown, fallback: number): number {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : fallback
}

/** 读取可空数字（`null` / 空串 / 非数字都视为「自动」）。 */
export function asNumberOrNull(value: unknown): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null
  if (typeof value === 'string' && value.trim().length > 0) {
    const parsed = Number(value)
    return Number.isFinite(parsed) ? parsed : null
  }
  return null
}

/** 读取布尔值。 */
export function asBoolean(value: unknown, fallback = false): boolean {
  return typeof value === 'boolean' ? value : fallback
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

/** 读取 `VarRef`；非法的引用返回 `null`。 */
export function asVarRef(value: unknown): VarRef | null {
  const record = asRecord(value)
  if (typeof record.source !== 'string' || typeof record.key !== 'string') return null
  if (record.key.length === 0) return null
  return { source: record.source, key: record.key }
}

/** 数值钳制。 */
export function clampNumber(value: number, min: number, max: number): number {
  if (max < min) return min
  return Math.min(max, Math.max(min, value))
}

/** 可空数值钳制（用于 uPlot 的自定义 range）。 */
export function clampNullable(value: number, min: number | null, max: number | null): number {
  let result = value
  if (min !== null) result = Math.max(min, result)
  if (max !== null) result = Math.min(max, result)
  return result
}

/** 小数位钳制到 0–10。 */
export function normalizeDecimals(value: unknown, fallback: number): number {
  const parsed = asNumberOrNull(value)
  if (parsed === null) return fallback
  return Math.round(clampNumber(parsed, 0, 10))
}

/** 按小数位格式化显示值；非有限数字返回 `--`。 */
export function formatNumber(value: number | undefined, decimals: number): string {
  if (value === undefined || !Number.isFinite(value)) return MISSING_TEXT
  return value.toFixed(normalizeDecimals(decimals, 2))
}

/** 按小数位格式化同时附加单位。 */
export function formatNumberWithUnit(
  value: number | undefined,
  decimals: number,
  unit: string,
): string {
  const text = formatNumber(value, decimals)
  if (text === MISSING_TEXT || unit.length === 0) return text
  return `${text} ${unit}`
}

/** 读取 `range` 属性值（`null` 表示自动）。 */
export function asRange(value: unknown): { min: number | null; max: number | null } {
  const record = asRecord(value)
  return { min: asNumberOrNull(record.min), max: asNumberOrNull(record.max) }
}

/** 读取 `thresholds` 属性值。 */
export function asThresholds(value: unknown): Threshold[] {
  return asArray(value).map((item) => {
    const record = asRecord(item)
    const op = asString(record.op, '>')
    const normalizedOp: Threshold['op'] =
      op === '>' || op === '>=' || op === '<' || op === '<=' || op === '==' || op === '!='
        ? op
        : '>'
    const threshold: Threshold = {
      op: normalizedOp,
      value: asNumber(record.value, 0),
      color: asString(record.color, 'var(--accent)'),
    }
    if (typeof record.label === 'string') threshold.label = record.label
    return threshold
  })
}

/** 读取 `zones` 属性值。 */
export function asZones(value: unknown): Zone[] {
  return asArray(value).map((item) => {
    const record = asRecord(item)
    return {
      from: asNumber(record.from, 0),
      to: asNumber(record.to, 100),
      color: asString(record.color, 'var(--warn)'),
    }
  })
}

/** 读取 `options` 属性值（`label` / `value`）。 */
export function asOptions(value: unknown): Array<{ label: string; value: string | number }> {
  return asArray(value)
    .map((item) => {
      const record = asRecord(item)
      const raw = record.value
      const optionValue: string | number =
        typeof raw === 'number' ? raw : typeof raw === 'string' ? raw : asString(raw)
      return { label: asString(record.label, String(optionValue)), value: optionValue }
    })
    .filter((option) => String(option.value).length > 0)
}

/** 单个阈值是否匹配。 */
export function matchesThreshold(value: number, threshold: Threshold): boolean {
  switch (threshold.op) {
    case '>':
      return value > threshold.value
    case '>=':
      return value >= threshold.value
    case '<':
      return value < threshold.value
    case '<=':
      return value <= threshold.value
    case '==':
      return value === threshold.value
    case '!=':
      return value !== threshold.value
    default:
      return false
  }
}

/** 按顺序取第一个匹配的阈值（plan §8.11：`value.number` / `value.led` / `value.bar`）。 */
export function firstMatchingThreshold(
  value: number | undefined,
  thresholds: readonly Threshold[],
): Threshold | null {
  if (value === undefined || !Number.isFinite(value)) return null
  for (const threshold of thresholds) {
    if (matchesThreshold(value, threshold)) return threshold
  }
  return null
}

/** 颜色属性：`auto` / 空值回退到变量颜色或主题色。 */
export function resolveColor(value: unknown, fallback: string): string {
  const text = asString(value).trim()
  if (text.length === 0 || text === 'auto') return fallback
  return text
}

/** 取出 CSS 变量名，如 `var(--accent)` → `--accent`。 */
export function cssVarNameOf(color: string): string | null {
  const match = /^var\(\s*(--[A-Za-z0-9_-]+)\s*(?:,.*)?\)$/.exec(color.trim())
  return match?.[1] ?? null
}

/**
 * 解析成 canvas / SVG 可用的颜色。
 *
 * `CSS 变量`在 canvas 中不能直接使用，需要先用 `theme()` 读出实际颜色；
 * 取不到时回退到调色板第一个颜色。
 */
export function resolveCanvasColor(
  color: string,
  theme: (cssVar: string) => string,
  fallback = 'var(--series-1)',
): string {
  const name = cssVarNameOf(color)
  if (name === null) return color
  const resolved = theme(name)
  return resolved.length > 0 ? resolved : cssVarNameOf(fallback) !== null ? '#3b82f6' : fallback
}

/** `auto` 颜色的最终来源：变量颜色或 `--series-n`。 */
export function seriesColorOf(
  itemColor: unknown,
  variableColor: string,
  index: number,
  palette: readonly string[],
): string {
  if (typeof itemColor === 'string' && itemColor.trim().length > 0 && itemColor !== 'auto') {
    return itemColor
  }
  if (variableColor.length > 0) return variableColor
  return palette[index % palette.length] ?? 'var(--series-1)'
}

/* ------------------------------------------------------------------------- */
/* 文本模板（`value.text` 与命令模板的 text 模式同语法）                        */
/* ------------------------------------------------------------------------- */

const PLACEHOLDER_PATTERN = /\{\{|\}\}|\{([^{}]*)\}/g
const VARIABLE_PLACEHOLDER = /^var\.([A-Za-z_][\w.]*)(?::(.*))?$/

/** 按命令模板 text 模式的规则格式化值（plan §6.9）。 */
export function formatBySpec(value: number | boolean | string, spec: string): string {
  if (spec.length === 0) {
    if (typeof value === 'number') return String(value)
    if (typeof value === 'boolean') return value ? '1' : '0'
    return value
  }
  const number = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(number)) return MISSING_TEXT
  const fractionMatch = /^\.(\d+)f$/.exec(spec)
  if (fractionMatch) {
    const digits = clampNumber(Number(fractionMatch[1]), 0, 10)
    return number.toFixed(digits)
  }
  if (spec === 'd') return String(Math.round(number))
  const paddedMatch = /^0(\d+)d$/.exec(spec)
  if (paddedMatch) {
    const width = clampNumber(Number(paddedMatch[1]), 1, 12)
    const rounded = Math.round(number)
    const sign = rounded < 0 ? '-' : ''
    return `${sign}${String(Math.abs(rounded)).padStart(width, '0')}`
  }
  if (spec === 'x') return Math.round(number).toString(16)
  if (spec === 'X') return Math.round(number).toString(16).toUpperCase()
  return String(value)
}

/** 解析文本模板中的变量 key（按出现顺序去重）。 */
export function parseTemplateKeys(template: string): string[] {
  const keys: string[] = []
  for (const match of template.matchAll(/\{([^{}]*)\}/g)) {
    const content = (match[1] ?? '').trim()
    const placeholder = VARIABLE_PLACEHOLDER.exec(content)
    if (!placeholder) continue
    const key = placeholder[1] ?? ''
    if (key.length > 0 && !keys.includes(key)) keys.push(key)
  }
  return keys
}

/**
 * 渲染文本模板。
 *
 * - `{var.<key>}` / `{var.<key>:fmt}`：用 `resolve(key)` 取显示值，缺失时显示 `--`；
 * - `{{` / `}}` 表示字面量花括号；
 * - 其他占位符保留原文。
 */
export function renderTemplate(
  template: string,
  resolve: (key: string) => number | undefined,
): string {
  let result = ''
  let lastIndex = 0
  PLACEHOLDER_PATTERN.lastIndex = 0
  for (const match of template.matchAll(PLACEHOLDER_PATTERN)) {
    const index = match.index ?? 0
    result += template.slice(lastIndex, index)
    const token = match[0]
    lastIndex = index + token.length
    if (token === '{{') {
      result += '{'
      continue
    }
    if (token === '}}') {
      result += '}'
      continue
    }
    const content = (match[1] ?? '').trim()
    const placeholder = VARIABLE_PLACEHOLDER.exec(content)
    if (!placeholder) {
      result += token
      continue
    }
    const key = placeholder[1] ?? ''
    const value = resolve(key)
    if (value === undefined || !Number.isFinite(value)) {
      result += MISSING_TEXT
      continue
    }
    result += formatBySpec(value, placeholder[2] ?? '')
  }
  result += template.slice(lastIndex)
  return result
}
