/**
 * 内置组件注册表（plan §8.11）。
 *
 * 每个 `dashboard/widgets/<目录>/definition.ts` 的默认导出都是一个
 * `WidgetDefinition`；这里用 `import.meta.glob` 自动收集，**新增组件只需新增目录**，
 * 组件库与属性面板会自动出现（需要写入 `docs/dashboard.md`，由文档阶段负责）。
 */

import type { Component } from 'vue'

import type { WidgetDefinition, WidgetGroup, WidgetPropField } from '@/domains/dashboard/public'

/** 组件库分组顺序（plan §8.10：图表 / 数值 / 控件 / 自定义）。 */
export const WIDGET_GROUP_ORDER = ['chart', 'value', 'control'] as const

/** 分组标题。 */
export const WIDGET_GROUP_LABELS: Record<WidgetGroup | 'custom', string> = {
  chart: '图表',
  value: '数值',
  control: '控件',
  custom: '自定义',
}

/** 组件库中的一项。 */
export interface WidgetLibraryGroup {
  group: WidgetGroup | 'custom'
  label: string
  items: WidgetDefinition[]
}

/**
 * `components/` 中的图标组件在 `definition.ts` 里只做类型引用（`type Component`），
 * 不产生静态 Vue 依赖（`widget-definition-light` 架构规则）。
 */
type DefinitionModule = { default: WidgetDefinition }

const definitionModules = import.meta.glob<WidgetDefinition>('./widgets/*/definition.ts', {
  eager: true,
  import: 'default',
}) as Record<string, WidgetDefinition>

function isWidgetDefinition(value: unknown): value is WidgetDefinition {
  if (typeof value !== 'object' || value === null) return false
  const record = value as Record<string, unknown>
  if (typeof record.type !== 'string' || record.type.length === 0) return false
  if (typeof record.title !== 'string') return false
  if (typeof record.component !== 'function') return false
  return WIDGET_GROUP_ORDER.includes(record.group as (typeof WIDGET_GROUP_ORDER)[number])
}

const definitions: WidgetDefinition[] = (() => {
  const byType = new Map<string, WidgetDefinition>()
  for (const [path, definition] of Object.entries(definitionModules)) {
    if (!isWidgetDefinition(definition)) {
      console.warn(`[dashboard] 忽略无效的组件定义：${path}`)
      continue
    }
    if (byType.has(definition.type)) {
      console.warn(`[dashboard] 组件类型重复：${definition.type}（${path}）`)
      continue
    }
    byType.set(definition.type, definition)
  }
  return [...byType.values()].sort((left, right) => {
    const order = WIDGET_GROUP_ORDER.indexOf(left.group) - WIDGET_GROUP_ORDER.indexOf(right.group)
    if (order !== 0) return order
    return left.title.localeCompare(right.title, 'zh-Hans-CN')
  })
})()

/** 全部内置组件定义（按分组与标题排序）。 */
export function listWidgetDefinitions(): WidgetDefinition[] {
  return definitions
}

/** 按类型查找内置组件定义；找不到时返回 `undefined`（例如 D1c 的自定义控件）。 */
export function getWidgetDefinition(type: string): WidgetDefinition | undefined {
  return definitions.find((definition) => definition.type === type)
}

/** 是否内置组件类型。 */
export function isBuiltInWidgetType(type: string): boolean {
  return getWidgetDefinition(type) !== undefined
}

/** 是否自定义控件实例（`custom:<id>`）。 */
export function isCustomWidgetType(type: string): boolean {
  return type.startsWith('custom:')
}

/** 取自定义控件 id；非自定义类型返回 `null`。 */
export function customWidgetIdOf(type: string): string | null {
  return isCustomWidgetType(type) ? type.slice('custom:'.length) : null
}

/** 按「图表 / 数值 / 控件」分组（不含自定义控件仓库，D1c 负责合并）。 */
export function listWidgetLibraryGroups(): WidgetLibraryGroup[] {
  return WIDGET_GROUP_ORDER.map((group) => ({
    group,
    label: WIDGET_GROUP_LABELS[group],
    items: definitions.filter((definition) => definition.group === group),
  }))
}

/** 组件定义中的图标；没有图标时返回 `null`（组件库显示占位方块）。 */
export function iconOf(definition: WidgetDefinition): Component | null {
  return definition.icon ?? null
}

/** 合并默认值：按 `props` 描述生成一个组件的初始 `props`。 */
export function createDefaultWidgetProps(definition: WidgetDefinition): Record<string, unknown> {
  const props: Record<string, unknown> = {}
  for (const field of definition.props) {
    const value = defaultForField(field)
    if (value !== undefined) props[field.key] = value
  }
  return props
}

/** 属性描述的单字段默认值（自定义控件同样复用）。 */
export function defaultForField(field: WidgetPropField): unknown {
  switch (field.type) {
    case 'number':
      return field.default
    case 'text':
    case 'textarea':
    case 'expression':
      return field.default ?? ''
    case 'select':
      return field.default ?? field.options[0]?.value
    case 'checkbox':
      return field.default ?? false
    case 'color':
      return field.default ?? 'auto'
    case 'range':
      return field.default ?? { min: null, max: null }
    case 'variable':
      return field.default ?? null
    case 'variables':
      return []
    case 'thresholds':
    case 'zones':
    case 'options':
      return field.default ?? []
    case 'command':
      return field.default ?? null
    default:
      return undefined
  }
}
