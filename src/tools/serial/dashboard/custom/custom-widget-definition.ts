/**
 * 自定义控件定义 → `WidgetDefinition` 适配（plan §6.10「属性面板」）。
 *
 * 仪表盘的属性面板只认识 `WidgetDefinition`；自定义控件的 `definition.props` 与
 * `variables` 声明转成同一结构后即可复用现有属性编辑器，无需在面板里加分支。
 */

import { markRaw, type Component } from 'vue'

import type {
  CustomWidgetDefinition,
  WidgetDefinition,
  WidgetPropField,
} from '@/domains/dashboard/public'

const PLACEHOLDER_ICON = markRaw({
  name: 'CustomWidgetPlaceholderIcon',
  render: () => null,
}) as Component

/** 声明 `variables` 时属性面板自动加入的变量选择（值保存在 `props.variables`）。 */
export function customWidgetVariablesField(
  definition: CustomWidgetDefinition,
): WidgetPropField | null {
  if (definition.variables === undefined) return null
  return {
    key: 'variables',
    label: '变量',
    tab: 'data',
    type: 'variables',
    min: definition.variables.min,
    max: definition.variables.max,
    help: `绑定 ${definition.variables.min}–${definition.variables.max} 个变量`,
  }
}

/** 把自定义控件定义包装为组件库 / 属性面板使用的 `WidgetDefinition`。 */
export function toWidgetDefinition(
  definition: CustomWidgetDefinition,
  type: string,
): WidgetDefinition {
  const props: WidgetPropField[] = [...(definition.props ?? [])]
  const variablesField = customWidgetVariablesField(definition)
  if (variablesField !== null) props.push(variablesField)
  return {
    type,
    version: 1,
    title: definition.meta.name,
    description: definition.meta.description ?? '',
    group: definition.meta.group ?? 'value',
    icon: PLACEHOLDER_ICON,
    defaultSize: { ...(definition.size?.default ?? { w: 6, h: 6 }) },
    minSize: { ...(definition.size?.min ?? { w: 2, h: 2 }) },
    props,
    component: async () => ({ default: { render: () => null } }),
  }
}
