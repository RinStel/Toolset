import { describe, expect, it } from 'vitest'

import type { VariableInfo } from '../../../src/domains/series/public'
import { COLS, collides, generateDashboard } from '../../../src/domains/dashboard/public'
import type { Dashboard, WidgetInstance } from '../../../src/domains/dashboard/public'

function makeVariables(count: number): VariableInfo[] {
  return Array.from({ length: count }, (_, index) => ({
    key: `v${index}`,
    label: `变量${index}`,
    unit: 'V',
    computed: false,
    count: 100,
    last: 1,
    lastAt: 0,
    min: 0,
    max: 1,
    mean: 0.5,
    rate: 10,
  }))
}

function widgetsOfType(dashboard: Dashboard, type: string): WidgetInstance[] {
  return dashboard.widgets.filter((widget) => widget.type === type)
}

function sizes(dashboard: Dashboard): Array<Array<string | number>> {
  return dashboard.widgets.map((widget) => [widget.type, widget.x, widget.y, widget.w, widget.h])
}

function expectNoOverlap(dashboard: Dashboard): void {
  const widgets = dashboard.widgets
  for (let i = 0; i < widgets.length; i += 1) {
    const widget = widgets[i]
    if (!widget) continue
    expect(widget.x).toBeGreaterThanOrEqual(0)
    expect(widget.y).toBeGreaterThanOrEqual(0)
    expect(widget.x + widget.w).toBeLessThanOrEqual(COLS)
    expect(widget.w).toBeGreaterThanOrEqual(1)
    expect(widget.w).toBeLessThanOrEqual(24)
    expect(widget.h).toBeGreaterThanOrEqual(1)
    expect(widget.h).toBeLessThanOrEqual(64)
    for (let j = i + 1; j < widgets.length; j += 1) {
      const other = widgets[j]
      if (!other) continue
      expect(collides(widget, other), `${widget.id} 与 ${other.id} 重叠`).toBe(false)
    }
  }
}

describe('generateDashboard', () => {
  it('creates a chart and one value widget for a single variable', () => {
    const dashboard = generateDashboard(makeVariables(1), { alias: 'main', name: '演示' })
    expect(dashboard.schema).toBe(1)
    expect(dashboard.rowHeight).toBe(28)
    expect(dashboard.name).toBe('演示')
    expect(sizes(dashboard)).toEqual([
      ['chart.line', 0, 0, 24, 10],
      ['value.number', 0, 10, 24, 3],
    ])
    expect(dashboard.widgets[0]?.props.variables).toEqual([
      { source: 'main', key: 'v0', color: 'auto' },
    ])
    expect(dashboard.widgets[1]?.props.variable).toEqual({ source: 'main', key: 'v0' })
    expect(dashboard.widgets[1]?.common.title).toBe('变量0')
    expectNoOverlap(dashboard)
  })

  it('lays out eight variables in one chart plus one row of value widgets', () => {
    const dashboard = generateDashboard(makeVariables(8), { alias: 'main', name: '八变量' })
    const charts = widgetsOfType(dashboard, 'chart.line')
    const values = widgetsOfType(dashboard, 'value.number')
    expect(charts).toHaveLength(1)
    expect(values).toHaveLength(8)
    expect(charts[0]).toMatchObject({ x: 0, y: 0, w: 24, h: 10 })
    expect(values.map((widget) => [widget.x, widget.y, widget.w, widget.h])).toEqual([
      [0, 10, 3, 3],
      [3, 10, 3, 3],
      [6, 10, 3, 3],
      [9, 10, 3, 3],
      [12, 10, 3, 3],
      [15, 10, 3, 3],
      [18, 10, 3, 3],
      [21, 10, 3, 3],
    ])
    expect(charts[0]?.props.variables).toHaveLength(8)
    expectNoOverlap(dashboard)
  })

  it('lays out nine variables as two charts plus a table', () => {
    const dashboard = generateDashboard(makeVariables(9), { alias: 'main', name: '九变量' })
    expect(sizes(dashboard)).toEqual([
      ['chart.line', 0, 0, 12, 9],
      ['chart.line', 12, 0, 12, 9],
      ['value.table', 0, 9, 24, 11],
    ])
    expect(dashboard.widgets[0]?.props.variables).toHaveLength(8)
    expect(dashboard.widgets[1]?.props.variables).toHaveLength(1)
    expect(dashboard.widgets[2]?.props.variables).toHaveLength(9)
    expect(dashboard.widgets[2]?.props.source).toBe('main')
    expectNoOverlap(dashboard)
  })

  it('lays out twenty variables as three charts plus a capped table', () => {
    const dashboard = generateDashboard(makeVariables(20), { alias: 'main', name: '二十变量' })
    expect(sizes(dashboard)).toEqual([
      ['chart.line', 0, 0, 12, 9],
      ['chart.line', 12, 0, 12, 9],
      ['chart.line', 0, 9, 12, 9],
      ['value.table', 0, 18, 24, 16],
    ])
    expectNoOverlap(dashboard)
  })

  it('assigns the --series palette cyclically into variableMeta', () => {
    const dashboard = generateDashboard(makeVariables(20), { alias: 'main', name: '颜色' })
    expect(dashboard.variableMeta['main/v0']?.color).toBe('var(--series-1)')
    expect(dashboard.variableMeta['main/v11']?.color).toBe('var(--series-12)')
    expect(dashboard.variableMeta['main/v12']?.color).toBe('var(--series-1)')
    expect(Object.keys(dashboard.variableMeta)).toHaveLength(20)
  })

  it('uses the provided alias and name', () => {
    const dashboard = generateDashboard(makeVariables(2), { alias: 'dev1', name: '电机测试' })
    expect(dashboard.sources).toEqual([{ alias: 'dev1', label: '电机测试' }])
    expect(dashboard.variableMeta['dev1/v0']).toBeDefined()
    expect(dashboard.widgets[0]?.props.variables).toEqual([
      { source: 'dev1', key: 'v0', color: 'auto' },
      { source: 'dev1', key: 'v1', color: 'auto' },
    ])
  })

  it('falls back to main for an invalid alias and an empty name', () => {
    const dashboard = generateDashboard(makeVariables(1), { alias: 'Main', name: '  ' })
    expect(dashboard.sources[0]?.alias).toBe('main')
    expect(dashboard.name).toBe('仪表盘')
  })

  it('creates no widgets for an empty variable list', () => {
    const dashboard = generateDashboard([], { alias: 'main', name: '空' })
    expect(dashboard.widgets).toEqual([])
    expect(dashboard.variableMeta).toEqual({})
  })

  it('generates unique widget ids', () => {
    const dashboard = generateDashboard(makeVariables(20), { alias: 'main', name: 'id' })
    const ids = dashboard.widgets.map((widget) => widget.id)
    expect(new Set(ids).size).toBe(ids.length)
    for (const widget of dashboard.widgets) {
      expect(widget.version).toBe(1)
      expect(widget.common.showTitle).toBe(true)
    }
  })
})
