// @vitest-environment happy-dom
import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'

import type { CommonProps, VarRef, WidgetInstance } from '@/domains/dashboard/public'

import ValueLed from '@/tools/serial/dashboard/widgets/value.led/Widget.vue'
import type { WidgetContext } from '@/tools/serial/dashboard/widgets/shared/types'
import { DASHBOARD_RUNTIME_KEY } from '@/tools/serial/dashboard/runtime/injection-keys'
import type {
  DashboardRuntime,
  DashboardSourceState,
  DashboardVariableMeta,
  WidgetFrameUpdate,
} from '@/tools/serial/dashboard/runtime/context'

interface FakeValue {
  value?: number
  meta?: Partial<DashboardVariableMeta>
}

const EMPTY_SLICE = (): { idx: Float64Array; t: Float64Array; v: Float64Array } => ({
  idx: new Float64Array(0),
  t: new Float64Array(0),
  v: new Float64Array(0),
})

function createRuntime(
  options: { values?: Record<string, FakeValue>; state?: DashboardSourceState } = {},
): DashboardRuntime {
  const values = options.values ?? {}
  const state = options.state ?? 'open'
  const meta = (ref: VarRef): DashboardVariableMeta => {
    const entry = values[ref.key]
    return {
      source: ref.source,
      key: ref.key,
      label: entry?.meta?.label ?? ref.key,
      unit: entry?.meta?.unit ?? '',
      color: entry?.meta?.color ?? 'var(--series-1)',
      decimals: entry?.meta?.decimals ?? 2,
      scale: 1,
      offset: 0,
      computed: false,
    }
  }
  const displayValue = (ref: VarRef): number | undefined => values[ref.key]?.value
  const subscriptions = new Set<(update: WidgetFrameUpdate) => void>()

  return {
    paneIndex: 0,
    mode: 'run',
    dashboard: () => null,
    defaultAlias: () => 'main',
    sourceState: () => state,
    isSourceOpen: () => state === 'open',
    isSourceBound: () => state !== 'unbound',
    session: () => undefined,
    series: () => undefined,
    variables: () => [],
    meta,
    rawLatest: (ref) => values[ref.key]?.value,
    displayValue,
    read: () => EMPTY_SLICE(),
    theme: () => '',
    onThemeChange: () => () => {},
    send: async () => 'sent',
    sendBytes: async () => 'sent',
    sendQuickItem: async () => 'sent',
    subscribeFrame: (refs, callback) => {
      const subscription = (): void => {
        callback({
          now: 1,
          refs: refs(),
          latest: refs().map((ref) => displayValue(ref)),
          changedAliases: ['main'],
        })
      }
      subscriptions.add(subscription)
      return () => {
        subscriptions.delete(subscription)
      }
    },
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

function widget(props: Record<string, unknown>): WidgetInstance {
  return {
    id: 'w1',
    type: 'value.led',
    version: 1,
    x: 0,
    y: 0,
    w: 3,
    h: 3,
    common: COMMON,
    props,
  }
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

function mountLed(runtime: DashboardRuntime, props: Record<string, unknown>) {
  return mount(ValueLed, {
    props: {
      instance: widget(props),
      props,
      size: { width: 120, height: 120 },
      mode: 'run',
      ctx: contextOf(runtime),
    },
    global: { provide: { [DASHBOARD_RUNTIME_KEY]: runtime } },
  })
}

const CONDITIONS = [
  { op: '>', value: 10, color: '#ff0000', label: '过高' },
  { op: '>', value: 0, color: '#00ff00', label: '正常' },
]

function propsFor(blink = false): Record<string, unknown> {
  return { variable: { source: 'main', key: 'temp' }, conditions: CONDITIONS, blink }
}

describe('value.led', () => {
  it('按条件顺序取第一个匹配项', () => {
    const runtime = createRuntime({ values: { temp: { value: 12 } } })
    const wrapper = mountLed(runtime, propsFor())
    const lamp = wrapper.find('[data-testid="value-led-lamp"]')

    expect(lamp.attributes('data-color')).toBe('#ff0000')
    expect(lamp.classes()).toContain('is-lit')
    // 条件 label 显示在灯下。
    expect(wrapper.text()).toContain('过高')
  })

  it('第一个条件不匹配时使用下一个匹配项', () => {
    const runtime = createRuntime({ values: { temp: { value: 5 } } })
    const wrapper = mountLed(runtime, propsFor())

    expect(wrapper.find('[data-testid="value-led-lamp"]').attributes('data-color')).toBe('#00ff00')
    expect(wrapper.text()).toContain('正常')
  })

  it('没有条件匹配时熄灭并使用 offColor', () => {
    const runtime = createRuntime({ values: { temp: { value: -1 } } })
    const wrapper = mountLed(runtime, propsFor())
    const lamp = wrapper.find('[data-testid="value-led-lamp"]')

    expect(lamp.attributes('data-color')).toBe('var(--border)')
    expect(lamp.classes()).not.toContain('is-lit')
  })

  it('blink 打开且匹配时带闪烁类名', () => {
    const runtime = createRuntime({ values: { temp: { value: 12 } } })
    const blinking = mountLed(runtime, propsFor(true))
    expect(blinking.find('[data-testid="value-led-lamp"]').classes()).toContain('is-blink')

    const steady = mountLed(runtime, propsFor(false))
    expect(steady.find('[data-testid="value-led-lamp"]').classes()).not.toContain('is-blink')

    const unmatched = createRuntime({ values: { temp: { value: -5 } } })
    expect(
      mountLed(unmatched, propsFor(true)).find('[data-testid="value-led-lamp"]').classes(),
    ).not.toContain('is-blink')
  })

  it('未绑定变量时显示空状态', () => {
    const wrapper = mountLed(createRuntime(), { variable: null, conditions: CONDITIONS })
    expect(wrapper.find('[data-empty-state]').text()).toBe('未绑定变量')
  })
})
