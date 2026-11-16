// @vitest-environment happy-dom
import { mount } from '@vue/test-utils'
import { nextTick } from 'vue'
import { describe, expect, it } from 'vitest'

import {
  createEmptyDashboard,
  type Dashboard,
  type WidgetDefinition,
  type WidgetInstance,
  type WidgetPropField,
} from '@/domains/dashboard/public'

import PropertyPanel from '@/tools/serial/dashboard/PropertyPanel.vue'
import type { DashboardRuntime } from '@/tools/serial/dashboard/runtime/context'

/** 覆盖 14 种属性编辑器的组件定义（测试专用）。 */
const ALL_FIELDS: WidgetPropField[] = [
  { key: 'gain', label: '增益', type: 'number', tab: 'data', default: 1, min: 0, max: 10 },
  { key: 'label', label: '文本', type: 'text', tab: 'data', default: '' },
  { key: 'note', label: '多行', type: 'textarea', tab: 'data', default: '' },
  {
    key: 'mode',
    label: '模式',
    type: 'select',
    tab: 'data',
    options: [
      { label: '线', value: 'line' },
      { label: '点', value: 'dot' },
    ],
  },
  { key: 'enabled', label: '启用', type: 'checkbox', tab: 'data', default: false },
  { key: 'color', label: '颜色', type: 'color', tab: 'data', default: 'auto' },
  { key: 'range', label: '范围', type: 'range', tab: 'data', default: { min: null, max: null } },
  { key: 'variable', label: '变量', type: 'variable', tab: 'data' },
  { key: 'variables', label: '变量列表', type: 'variables', tab: 'data', min: 0, max: 4 },
  { key: 'thresholds', label: '阈值', type: 'thresholds', tab: 'data' },
  { key: 'zones', label: '区间', type: 'zones', tab: 'data' },
  { key: 'options', label: '选项', type: 'options', tab: 'data' },
  { key: 'command', label: '命令', type: 'command', tab: 'data' },
  { key: 'expression', label: '表达式', type: 'expression', tab: 'data', default: '' },
  { key: 'showDetail', label: '显示详情', type: 'checkbox', tab: 'data', default: false },
  {
    key: 'detail',
    label: '详情',
    type: 'text',
    tab: 'data',
    default: '',
    visibleWhen: { key: 'showDetail', equals: true },
  },
]

const TEST_DEFINITION: WidgetDefinition = {
  type: 'test.all',
  version: 1,
  title: '测试组件',
  description: '覆盖全部属性编辑器',
  group: 'value',
  icon: { render: () => null },
  defaultSize: { w: 4, h: 3 },
  minSize: { w: 2, h: 2 },
  props: ALL_FIELDS,
  component: () => Promise.resolve({ default: { render: () => null } }),
}

function createDashboard(): Dashboard {
  return createEmptyDashboard({ id: 'd1', name: '测试仪表盘', alias: 'main', now: 1 })
}

function createWidget(id: string, props: Record<string, unknown> = {}): WidgetInstance {
  return {
    id,
    type: 'test.all',
    version: 1,
    x: 0,
    y: 0,
    w: 4,
    h: 3,
    common: {
      title: '组件',
      showTitle: true,
      titleAlign: 'left',
      background: 'default',
      border: true,
      padding: 8,
      fontScale: 1,
    },
    props,
  }
}

/** 最小运行时替身：属性编辑器只用到 variables / meta / displayValue / session。 */
function createRuntime(): DashboardRuntime {
  return {
    paneIndex: 0,
    mode: 'edit',
    dashboard: () => null,
    defaultAlias: () => 'main',
    sourceState: () => 'unbound',
    isSourceOpen: () => false,
    isSourceBound: () => false,
    session: () => undefined,
    series: () => undefined,
    variables: () => [],
    meta: (ref) => ({
      source: ref.source,
      key: ref.key,
      label: ref.key,
      unit: '',
      color: 'var(--series-1)',
      decimals: 2,
      scale: 1,
      offset: 0,
      computed: false,
    }),
    rawLatest: () => undefined,
    displayValue: () => undefined,
    read: () => ({ idx: new Float64Array(0), t: new Float64Array(0), v: new Float64Array(0) }),
    theme: () => '',
    onThemeChange: () => () => {},
    send: () => Promise.resolve('sent'),
    sendBytes: () => Promise.resolve('sent'),
    sendQuickItem: () => Promise.resolve('sent'),
    subscribeFrame: () => () => {},
    requestUpdate: () => {},
    tick: () => 0,
    syncComputed: () => {},
    boundAliases: () => [],
  }
}

function mountPanel(selected: WidgetInstance[], definition: WidgetDefinition = TEST_DEFINITION) {
  return mount(PropertyPanel, {
    props: {
      dashboard: createDashboard(),
      selected,
      mode: 'edit',
      runtime: createRuntime(),
      definition,
    },
  })
}

async function openDataTab(wrapper: ReturnType<typeof mountPanel>): Promise<void> {
  const tab = wrapper.find('[data-tab-key="data"]')
  expect(tab.exists()).toBe(true)
  await tab.trigger('click')
  await nextTick()
}

describe('PropertyPanel', () => {
  it('按 WidgetPropField 生成全部 14 种编辑器', async () => {
    const wrapper = mountPanel([createWidget('w1')])
    await openDataTab(wrapper)

    const types = new Set(
      wrapper
        .findAll('[data-editor-type]')
        .map((node) => node.attributes('data-editor-type'))
        .filter((value): value is string => Boolean(value)),
    )
    // 公共外观字段也会带 data-editor-type，这里只断言 14 种属性类型全部出现。
    for (const type of [
      'number',
      'text',
      'textarea',
      'select',
      'checkbox',
      'color',
      'range',
      'variable',
      'variables',
      'thresholds',
      'zones',
      'options',
      'command',
      'expression',
    ]) {
      expect(types.has(type)).toBe(true)
    }
  })

  it('按 visibleWhen 条件显示字段', async () => {
    const hidden = mountPanel([createWidget('w1', { showDetail: false })])
    await openDataTab(hidden)
    expect(hidden.find('[data-testid="prop-detail"]').exists()).toBe(false)
    expect(hidden.find('[data-testid="prop-showDetail"]').exists()).toBe(true)

    const visible = mountPanel([createWidget('w1', { showDetail: true })])
    await openDataTab(visible)
    expect(visible.find('[data-testid="prop-detail"]').exists()).toBe(true)
  })

  it('修改字段时发出 update-props 并带合并键', async () => {
    const wrapper = mountPanel([createWidget('w1', { gain: 1 })])
    await openDataTab(wrapper)

    const input = wrapper.find('[data-testid="prop-input-gain"] input')
    expect(input.exists()).toBe(true)
    await input.setValue('3')
    await input.trigger('blur')

    const events = wrapper.emitted('update-props')
    expect(events).toBeTruthy()
    const payload = events?.at(-1)?.[0] as {
      ids: string[]
      patch: Record<string, unknown>
      mergeKey: string
    }
    expect(payload.ids).toEqual(['w1'])
    expect(payload.patch).toEqual({ gain: 3 })
    expect(payload.mergeKey).toBe('prop:gain')
  })

  it('多选组件时只显示外观公共字段', async () => {
    const wrapper = mountPanel([createWidget('w1'), createWidget('w2')])
    expect(wrapper.attributes('data-multi')).toBe('true')

    // 没有「数据 / 行为」标签页。
    expect(wrapper.find('[data-tab-key="data"]').exists()).toBe(false)
    expect(wrapper.find('[data-tab-key="behavior"]').exists()).toBe(false)
    expect(wrapper.find('[data-tab-key="style"]').exists()).toBe(true)

    // 公共外观字段存在，标题（多选时因值可能不同）隐藏。
    expect(wrapper.find('[data-testid="prop-background"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="prop-fontScale"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="prop-title"]').exists()).toBe(false)
    // 定义中的业务字段不出现。
    expect(wrapper.find('[data-testid="prop-gain"]').exists()).toBe(false)
  })

  it('未选中时显示仪表盘设置', async () => {
    const wrapper = mountPanel([])
    expect(wrapper.find('[data-testid="dashboard-settings-fields"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="dashboard-setting-name"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="dashboard-source-row-main"]').exists()).toBe(true)
  })
})
