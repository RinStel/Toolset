/**
 * 一键生成仪表盘（plan §6.9「一键生成」）。
 *
 * 布局：
 * - 变量不超过 8 个：第一行是包含全部变量的波形图（24×10），第二行起每个变量一个数值组件；
 * - 变量超过 8 个：每 8 个变量一个波形图（12×9，两两并排），最后是包含全部变量的变量表
 *   （24×min(2 + n, 16)）。
 *
 * 变量颜色按 `--series-1`…`--series-12` 依次分配，写入 `variableMeta`。
 */

import type { VariableInfo } from '../series/public'
import { uuid } from '../../shared/lib/id'
import {
  COLOR_AUTO,
  COLS,
  DASHBOARD_SCHEMA_VERSION,
  DEFAULT_ROW_HEIGHT,
  DEFAULT_SOURCE_ALIAS,
  DEFAULT_WIDGET_VERSION,
  SERIES_COLORS,
  SOURCE_ALIAS_PATTERN,
  type CommonProps,
  type Dashboard,
  type VarRef,
  type VariableMetaOverride,
  type WidgetInstance,
} from './types'

/** 生成的仪表盘内置组件类型（plan §8.11）。 */
export const GENERATED_VALUE_TYPE = 'value.number'
export const GENERATED_CHART_TYPE = 'chart.line'
export const GENERATED_TABLE_TYPE = 'value.table'

/** 生成参数：数据源 alias 与仪表盘名称。 */
export interface GenerateDashboardOptions {
  alias: string
  name: string
}

/** 颜色分配：`var(--series-1)` … `var(--series-12)` 循环。 */
export function seriesColor(index: number): string {
  return SERIES_COLORS[index % SERIES_COLORS.length] ?? 'var(--series-1)'
}

function createCommonProps(title: string): CommonProps {
  return {
    title,
    showTitle: true,
    titleAlign: 'left',
    background: 'default',
    border: true,
    padding: 8,
    fontScale: 1,
  }
}

function variableRef(alias: string, key: string): VarRef & { color: string } {
  return { source: alias, key, color: COLOR_AUTO }
}

function createWidget(
  id: string,
  type: string,
  title: string,
  x: number,
  y: number,
  w: number,
  h: number,
  props: Record<string, unknown>,
): WidgetInstance {
  return {
    id,
    type,
    version: DEFAULT_WIDGET_VERSION,
    x,
    y,
    w,
    h,
    common: createCommonProps(title),
    props,
  }
}

/**
 * 生成仪表盘。
 *
 * @param variables 数据源的变量列表（`SeriesSource.variables()`）
 * @param opts 数据源 alias 与仪表盘名称
 */
export function generateDashboard(
  variables: VariableInfo[],
  opts: GenerateDashboardOptions,
): Dashboard {
  const now = Date.now()
  const alias = SOURCE_ALIAS_PATTERN.test(opts.alias) ? opts.alias : DEFAULT_SOURCE_ALIAS
  const name = opts.name.trim() === '' ? '仪表盘' : opts.name

  const variableMeta: Record<string, VariableMetaOverride> = {}
  variables.forEach((variable, index) => {
    variableMeta[`${alias}/${variable.key}`] = { color: seriesColor(index) }
  })

  const widgets: WidgetInstance[] = []
  let idCounter = 0
  const nextId = (): string => {
    idCounter += 1
    return `w${idCounter}`
  }
  const titleOf = (variable: VariableInfo): string => variable.label ?? variable.key

  if (variables.length > 0 && variables.length <= 8) {
    widgets.push(
      createWidget(nextId(), GENERATED_CHART_TYPE, '波形图', 0, 0, COLS, 10, {
        variables: variables.map((variable) => variableRef(alias, variable.key)),
      }),
    )

    const valueWidth = Math.max(3, Math.floor(COLS / variables.length))
    let x = 0
    let y = 10
    for (const variable of variables) {
      if (x + valueWidth > COLS) {
        x = 0
        y += 3
      }
      widgets.push(
        createWidget(nextId(), GENERATED_VALUE_TYPE, titleOf(variable), x, y, valueWidth, 3, {
          variable: { source: alias, key: variable.key },
        }),
      )
      x += valueWidth
    }
  } else if (variables.length > 8) {
    const groups: VariableInfo[][] = []
    for (let index = 0; index < variables.length; index += 8) {
      groups.push(variables.slice(index, index + 8))
    }
    groups.forEach((group, groupIndex) => {
      widgets.push(
        createWidget(
          nextId(),
          GENERATED_CHART_TYPE,
          '波形图',
          (groupIndex % 2) * 12,
          Math.floor(groupIndex / 2) * 9,
          12,
          9,
          { variables: group.map((variable) => variableRef(alias, variable.key)) },
        ),
      )
    })

    widgets.push(
      createWidget(
        nextId(),
        GENERATED_TABLE_TYPE,
        '变量表',
        0,
        Math.ceil(groups.length / 2) * 9,
        COLS,
        Math.min(2 + variables.length, 16),
        {
          source: alias,
          variables: variables.map((variable) => ({ source: alias, key: variable.key })),
        },
      ),
    )
  }

  return {
    schema: DASHBOARD_SCHEMA_VERSION,
    id: uuid(),
    name,
    createdAt: now,
    updatedAt: now,
    rowHeight: DEFAULT_ROW_HEIGHT,
    sources: [{ alias, label: name }],
    variableMeta,
    computed: {},
    widgets,
  }
}
