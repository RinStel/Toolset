import { describe, expect, it } from 'vitest'

import {
  COLS,
  collides,
  createEmptyDashboard,
  migrateDashboard,
  normalize,
  validateDashboard,
} from '../../../src/domains/dashboard/public'
import type { CommonProps, Dashboard, WidgetInstance } from '../../../src/domains/dashboard/public'

function validCommon(overrides: Partial<CommonProps> = {}): CommonProps {
  return {
    title: '波形图',
    showTitle: true,
    titleAlign: 'left',
    background: 'default',
    border: true,
    padding: 8,
    fontScale: 1,
    ...overrides,
  }
}

function validWidget(overrides: Partial<WidgetInstance> = {}): WidgetInstance {
  return {
    id: 'w1',
    type: 'chart.line',
    version: 1,
    x: 0,
    y: 0,
    w: 12,
    h: 8,
    common: validCommon(),
    props: { variables: [] },
    ...overrides,
  }
}

function validDashboard(overrides: Partial<Dashboard> = {}): Dashboard {
  return {
    schema: 1,
    id: 'dash-1',
    name: '测试仪表盘',
    createdAt: 1_700_000_000_000,
    updatedAt: 1_700_000_000_000,
    rowHeight: 28,
    sources: [{ alias: 'main', label: '主设备', match: { deviceKey: 'usb-1' } }],
    variableMeta: {
      'main/temp': {
        label: '温度',
        unit: '°C',
        color: 'var(--series-1)',
        scale: 2,
        offset: 1,
        decimals: 1,
      },
    },
    computed: { main: [{ key: 'sum', expr: 'a+b', unit: 'V', label: '合计' }] },
    widgets: [validWidget()],
    ...overrides,
  }
}

/** 深拷贝成可随意改写的原始对象。 */
function rawDashboard(): Record<string, unknown> {
  return JSON.parse(JSON.stringify(validDashboard())) as Record<string, unknown>
}

function firstWidget(input: Record<string, unknown>): Record<string, unknown> {
  const widgets = input.widgets
  if (!Array.isArray(widgets) || widgets.length === 0) throw new Error('widgets 缺失')
  return widgets[0] as Record<string, unknown>
}

function errorText(result: ReturnType<typeof validateDashboard>): string {
  return result.ok ? '' : result.errors.join('\n')
}

function expectError(input: unknown, fragment: string): void {
  const result = validateDashboard(input)
  expect(result.ok, `期望校验失败：${fragment}`).toBe(false)
  expect(errorText(result)).toContain(fragment)
}

function expectGridValid(items: readonly WidgetInstance[]): void {
  for (let i = 0; i < items.length; i += 1) {
    const item = items[i]
    if (!item) continue
    expect(item.x).toBeGreaterThanOrEqual(0)
    expect(item.y).toBeGreaterThanOrEqual(0)
    expect(item.x + item.w).toBeLessThanOrEqual(COLS)
    expect(item.w).toBeLessThanOrEqual(24)
    expect(item.h).toBeLessThanOrEqual(64)
    for (let j = i + 1; j < items.length; j += 1) {
      const other = items[j]
      if (!other) continue
      expect(collides(item, other), `${item.id} 与 ${other.id} 重叠`).toBe(false)
    }
  }
}

describe('validateDashboard', () => {
  it('accepts a valid dashboard', () => {
    const result = validateDashboard(validDashboard())
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.dashboard.id).toBe('dash-1')
    expect(result.dashboard.widgets).toHaveLength(1)
    expect(result.dashboard.variableMeta['main/temp']?.scale).toBe(2)
    expect(result.dashboard.computed.main?.[0]?.expr).toBe('a+b')
  })

  it('fills optional fields with defaults', () => {
    const result = validateDashboard({
      schema: 1,
      id: 'dash-2',
      name: '空仪表盘',
      sources: [{ alias: 'main', label: '主设备' }],
    })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.dashboard.rowHeight).toBe(28)
    expect(result.dashboard.variableMeta).toEqual({})
    expect(result.dashboard.computed).toEqual({})
    expect(result.dashboard.widgets).toEqual([])
    expect(result.dashboard.createdAt).toBeGreaterThan(0)
  })

  it('rejects a non-object input', () => {
    expectError(null, '必须是一个对象')
    expectError('dashboard', '必须是一个对象')
    expectError([], '必须是一个对象')
  })

  it('rejects every invalid root field', () => {
    const cases: Array<[string, (input: Record<string, unknown>) => void, string]> = [
      ['schema', (input) => (input.schema = 2), 'schema 必须为 1'],
      ['id 缺失', (input) => delete input.id, 'id 必须是非空字符串'],
      ['id 为空', (input) => (input.id = '  '), 'id 不能为空字符串'],
      ['name 非字符串', (input) => (input.name = 5), 'name 必须是字符串'],
      ['createdAt 非数字', (input) => (input.createdAt = 'x'), 'createdAt 必须是有限数'],
      ['updatedAt 为负', (input) => (input.updatedAt = -1), 'updatedAt 必须是大于等于 0 的有限数'],
      ['rowHeight 过小', (input) => (input.rowHeight = 15), 'rowHeight 必须是 16–64'],
      ['rowHeight 过大', (input) => (input.rowHeight = 65), 'rowHeight 必须是 16–64'],
      ['rowHeight 非整数', (input) => (input.rowHeight = 28.5), 'rowHeight 必须是 16–64'],
      ['sources 缺失', (input) => delete input.sources, 'sources 至少需要 1 个数据源'],
      ['sources 为空', (input) => (input.sources = []), 'sources 至少需要 1 个数据源'],
      ['sources 非数组', (input) => (input.sources = {}), 'sources 至少需要 1 个数据源'],
      [
        'alias 格式',
        (input) => {
          const sources = input.sources as Array<Record<string, unknown>>
          if (sources[0]) sources[0].alias = 'Main'
        },
        '必须匹配',
      ],
      [
        'alias 重复',
        (input) => {
          input.sources = [
            { alias: 'main', label: 'A' },
            { alias: 'main', label: 'B' },
          ]
        },
        '数据源 alias「main」重复',
      ],
      [
        'label 缺失',
        (input) => {
          const sources = input.sources as Array<Record<string, unknown>>
          if (sources[0]) delete sources[0].label
        },
        'label 必须是非空字符串',
      ],
      [
        'match 非法',
        (input) => {
          const sources = input.sources as Array<Record<string, unknown>>
          if (sources[0]) sources[0].match = 'usb'
        },
        'match 必须是对象',
      ],
    ]
    for (const [name, mutate, fragment] of cases) {
      const input = rawDashboard()
      mutate(input)
      expectError(input, fragment)
      expect(name.length).toBeGreaterThan(0)
    }
  })

  it('rejects invalid variableMeta entries', () => {
    expectError(
      { ...rawDashboard(), variableMeta: { temp: { label: '温度' } } },
      '必须为「<alias>/<key>」格式',
    )
    expectError({ ...rawDashboard(), variableMeta: { 'main/1a': { label: 'x' } } }, '变量名不合法')
    expectError(
      { ...rawDashboard(), variableMeta: { 'Main/temp': { label: 'x' } } },
      '数据源 alias 不合法',
    )
    expectError(
      { ...rawDashboard(), variableMeta: { 'main/temp': { scale: 'x' } } },
      'scale 必须是有限数',
    )
    expectError(
      { ...rawDashboard(), variableMeta: { 'main/temp': { decimals: -1 } } },
      'decimals 必须是大于等于 0 的整数',
    )
    expectError({ ...rawDashboard(), variableMeta: [] }, 'variableMeta 必须是对象')
  })

  it('rejects invalid computed entries', () => {
    expectError({ ...rawDashboard(), computed: [] }, 'computed 必须是对象')
    expectError({ ...rawDashboard(), computed: { main: {} } }, 'computed["main"] 必须是数组')
    expectError(
      { ...rawDashboard(), computed: { main: [{ key: '', expr: 'a' }] } },
      'computed["main"][0].key 不能为空字符串',
    )
    expectError(
      { ...rawDashboard(), computed: { main: [{ key: 'sum', expr: 5 }] } },
      'computed["main"][0].expr 必须是字符串',
    )
  })

  it('rejects invalid widget fields', () => {
    const cases: Array<[string, (widget: Record<string, unknown>) => void, string]> = [
      ['id 缺失', (widget) => delete widget.id, 'id 必须是非空字符串'],
      ['type 缺失', (widget) => delete widget.type, 'type 必须是非空字符串'],
      ['version 为负', (widget) => (widget.version = -1), 'version 必须是大于等于 0 的整数'],
      ['x 非整数', (widget) => (widget.x = 0.5), 'x 必须是整数'],
      ['y 缺失', (widget) => delete widget.y, 'y 必须是整数'],
      ['w 为 0', (widget) => (widget.w = 0), 'w 必须大于等于 1'],
      ['h 非数字', (widget) => (widget.h = 'x'), 'h 必须是整数'],
      ['props 非对象', (widget) => (widget.props = []), 'props 必须是对象'],
      ['state 非对象', (widget) => (widget.state = 'x'), 'state 必须是对象'],
      [
        'common.titleAlign',
        (widget) => {
          const common = widget.common as Record<string, unknown>
          common.titleAlign = 'right'
        },
        "titleAlign 必须是 'left' 或 'center'",
      ],
      [
        'common.padding',
        (widget) => {
          const common = widget.common as Record<string, unknown>
          common.padding = 3
        },
        'padding 必须是 0、4、8 或 12',
      ],
      [
        'common.fontScale',
        (widget) => {
          const common = widget.common as Record<string, unknown>
          common.fontScale = 3
        },
        'fontScale 必须是 0.75–2',
      ],
      [
        'common.border',
        (widget) => {
          const common = widget.common as Record<string, unknown>
          common.border = 'yes'
        },
        'border 必须是布尔值',
      ],
      [
        'common 非对象',
        (widget) => {
          widget.common = 'x'
        },
        'common 必须是对象',
      ],
      [
        'state 超过 64KB',
        (widget) => {
          widget.state = { big: 'a'.repeat(70 * 1024) }
        },
        'state 超过 64KB 上限',
      ],
    ]
    for (const [name, mutate, fragment] of cases) {
      const input = rawDashboard()
      mutate(firstWidget(input))
      expectError(input, fragment)
      expect(name.length).toBeGreaterThan(0)
    }
  })

  it('rejects duplicate widget ids', () => {
    const input = rawDashboard()
    const first = firstWidget(input)
    input.widgets = [first, { ...first }]
    expectError(input, '组件 id「w1」重复')
  })

  it('does not treat out-of-bounds layout as a validation error and lets normalize fix it', () => {
    const input = rawDashboard()
    const first = firstWidget(input)
    first.x = -3
    first.y = -2
    first.w = 30
    first.h = 100
    input.widgets = [first, { ...first, id: 'w2', x: 0, y: 0, w: 12, h: 8 }]

    const result = validateDashboard(input)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    // 校验不修改布局；加载时由 normalize 修正。
    expect(result.dashboard.widgets[0]?.x).toBe(-3)

    const fixed = normalize(
      result.dashboard.widgets.map((widget) => ({
        id: widget.id,
        x: widget.x,
        y: widget.y,
        w: widget.w,
        h: widget.h,
      })),
    )
    expectGridValid(
      fixed.map((rect, index) => ({
        ...(result.dashboard.widgets[index] as WidgetInstance),
        x: rect.x,
        y: rect.y,
        w: rect.w,
        h: rect.h,
      })),
    )
  })

  it('rejects a state that is not JSON serializable', () => {
    const input = rawDashboard()
    const state: Record<string, unknown> = {}
    state.self = state
    firstWidget(input).state = state
    expectError(input, 'state 必须是可 JSON 序列化的对象')
  })

  it('rejects a widgets value that is not an array', () => {
    expectError({ ...rawDashboard(), widgets: {} }, 'widgets 必须是数组')
  })
})

describe('migrateDashboard', () => {
  it('accepts schema 1', () => {
    const result = migrateDashboard(validDashboard())
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.dashboard.schema).toBe(1)
  })

  it('rejects newer schemas', () => {
    const result = migrateDashboard({ ...rawDashboard(), schema: 2 })
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error).toContain('仪表盘版本过新')
  })

  it('rejects missing or invalid schema', () => {
    const missing = migrateDashboard({ id: 'x' })
    expect(missing.ok).toBe(false)
    if (!missing.ok) expect(missing.error).toContain('缺少 schema 版本号')
    const notObject = migrateDashboard('dashboard')
    expect(notObject.ok).toBe(false)
  })
})

describe('createEmptyDashboard', () => {
  it('creates a default empty dashboard', () => {
    const dashboard = createEmptyDashboard({ name: '新仪表盘', id: 'dash-new', now: 1234 })
    expect(dashboard).toMatchObject({
      schema: 1,
      id: 'dash-new',
      name: '新仪表盘',
      createdAt: 1234,
      updatedAt: 1234,
      rowHeight: 28,
      sources: [{ alias: 'main', label: 'main' }],
      variableMeta: {},
      computed: {},
      widgets: [],
    })
    expect(validateDashboard(dashboard).ok).toBe(true)
  })

  it('honours alias, label, rowHeight and falls back to defaults', () => {
    const custom = createEmptyDashboard({
      name: '设备',
      alias: 'dev_1',
      label: '主设备',
      rowHeight: 40,
      now: 1,
    })
    expect(custom.sources[0]).toEqual({ alias: 'dev_1', label: '主设备' })
    expect(custom.rowHeight).toBe(40)

    const fallback = createEmptyDashboard({ alias: 'Main', rowHeight: 999, name: '  ' })
    expect(fallback.sources[0]?.alias).toBe('main')
    expect(fallback.rowHeight).toBe(28)
    expect(fallback.name).toBe('未命名仪表盘')
  })
})
