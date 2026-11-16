// @vitest-environment happy-dom
import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'

import type { CommonProps, VarRef, WidgetInstance } from '@/domains/dashboard/public'

import ValueGauge from '@/tools/serial/dashboard/widgets/value.gauge/Widget.vue'
import type { WidgetContext } from '@/tools/serial/dashboard/widgets/shared/types'
import { DASHBOARD_RUNTIME_KEY } from '@/tools/serial/dashboard/runtime/injection-keys'
import type {
  DashboardRuntime,
  DashboardVariableMeta,
  WidgetFrameUpdate,
} from '@/tools/serial/dashboard/runtime/context'

const EMPTY_SLICE = (): { idx: Float64Array; t: Float64Array; v: Float64Array } => ({
  idx: new Float64Array(0),
  t: new Float64Array(0),
  v: new Float64Array(0),
})

function createRuntime(value: number | undefined): DashboardRuntime {
  const meta = (ref: VarRef): DashboardVariableMeta => ({
    source: ref.source,
    key: ref.key,
    label: ref.key,
    unit: '',
    color: 'var(--series-1)',
    decimals: 0,
    scale: 1,
    offset: 0,
    computed: false,
  })
  return {
    paneIndex: 0,
    mode: 'run',
    dashboard: () => null,
    defaultAlias: () => 'main',
    sourceState: () => 'open',
    isSourceOpen: () => true,
    isSourceBound: () => true,
    session: () => undefined,
    series: () => undefined,
    variables: () => [],
    meta,
    rawLatest: () => value,
    displayValue: () => value,
    read: () => EMPTY_SLICE(),
    theme: () => '',
    onThemeChange: () => () => {},
    send: async () => 'sent',
    sendBytes: async () => 'sent',
    sendQuickItem: async () => 'sent',
    subscribeFrame: (_refs, _callback: (update: WidgetFrameUpdate) => void) => () => {},
    requestUpdate: () => {},
    tick: () => 0,
    syncComputed: () => {},
    boundAliases: () => [],
  }
}

const COMMON: CommonProps = {
  title: '',
  showTitle: true,
  titleAlign: 'left',
  background: 'default',
  border: true,
  padding: 8,
  fontScale: 1,
}

function contextOf(runtime: DashboardRuntime): WidgetContext {
  return {
    send: (cmd, value) => runtime.send(cmd, value),
    sendBytes: (bytes, alias) => runtime.sendBytes(bytes, alias),
    sourceState: (source) => runtime.sourceState(source ?? 'main'),
    theme: (cssVar) => runtime.theme(cssVar),
    resolveMeta: (ref) => runtime.meta(ref),
    requestUpdate: () => runtime.requestUpdate(),
  }
}

function mountGauge(value: number | undefined, props: Record<string, unknown> = {}) {
  const runtime = createRuntime(value)
  const widgetProps: Record<string, unknown> = {
    variable: { source: 'main', key: 'temp' },
    min: 0,
    max: 100,
    ...props,
  }
  const instance: WidgetInstance = {
    id: 'w1',
    type: 'value.gauge',
    version: 1,
    x: 0,
    y: 0,
    w: 6,
    h: 6,
    common: COMMON,
    props: widgetProps,
  }
  return mount(ValueGauge, {
    props: {
      instance,
      props: widgetProps,
      size: { width: 240, height: 240 },
      mode: 'run',
      ctx: contextOf(runtime),
    },
    global: { provide: { [DASHBOARD_RUNTIME_KEY]: runtime } },
  })
}

describe('value.gauge', () => {
  it('指针角度随数值变化（270° 圆弧）', () => {
    expect(mountGauge(0).attributes('data-angle')).toBe('135.0')
    expect(mountGauge(50).attributes('data-angle')).toBe('270.0')
    expect(mountGauge(100).attributes('data-angle')).toBe('405.0')
  })

  it('超出范围时钳制到端点', () => {
    expect(mountGauge(150).attributes('data-angle')).toBe('405.0')
    expect(mountGauge(-40).attributes('data-angle')).toBe('135.0')
  })

  it('180° 圆弧使用不同的角度范围', () => {
    expect(mountGauge(0, { arc: '180' }).attributes('data-angle')).toBe('180.0')
    expect(mountGauge(50, { arc: '180' }).attributes('data-angle')).toBe('270.0')
    expect(mountGauge(100, { arc: '180' }).attributes('data-angle')).toBe('360.0')
  })

  it('显示格式化后的数值（decimals 可继承或覆盖）', () => {
    const inherited = createRuntime(42.5)
    const runtimeMeta = inherited.meta({ source: 'main', key: 'temp' })
    expect(runtimeMeta.decimals).toBe(0)

    const wrapper = mountGauge(42.5, { decimals: 1 })
    expect(wrapper.attributes('data-display-value')).toBe('42.5')
  })

  it('未绑定变量时显示空状态', () => {
    const runtime = createRuntime(1)
    const wrapper = mount(ValueGauge, {
      props: {
        instance: {
          id: 'w2',
          type: 'value.gauge',
          version: 1,
          x: 0,
          y: 0,
          w: 6,
          h: 6,
          common: COMMON,
          props: {},
        },
        props: { variable: null },
        size: { width: 240, height: 240 },
        mode: 'run',
        ctx: contextOf(runtime),
      },
      global: { provide: { [DASHBOARD_RUNTIME_KEY]: runtime } },
    })
    expect(wrapper.find('[data-empty-state]').text()).toBe('未绑定变量')
  })
})
