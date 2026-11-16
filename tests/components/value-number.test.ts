// @vitest-environment happy-dom
import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import { nextTick } from 'vue'

import type { CommonProps, VarRef, WidgetInstance } from '@/domains/dashboard/public'

import ValueNumber from '@/tools/serial/dashboard/widgets/value.number/Widget.vue'
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

interface FakeRuntime {
  runtime: DashboardRuntime
  setValue(key: string, value: number | undefined): void
  emitFrame(now?: number): void
}

const EMPTY_SLICE = (): { idx: Float64Array; t: Float64Array; v: Float64Array } => ({
  idx: new Float64Array(0),
  t: new Float64Array(0),
  v: new Float64Array(0),
})

function createRuntime(
  options: { values?: Record<string, FakeValue>; state?: DashboardSourceState } = {},
): FakeRuntime {
  const values = options.values ?? {}
  const state = options.state ?? 'open'
  const subscriptions = new Set<{
    refs: () => readonly VarRef[]
    callback: (update: WidgetFrameUpdate) => void
  }>()

  const meta = (ref: VarRef): DashboardVariableMeta => {
    const entry = values[ref.key]
    return {
      source: ref.source,
      key: ref.key,
      label: entry?.meta?.label ?? ref.key,
      unit: entry?.meta?.unit ?? '',
      color: entry?.meta?.color ?? 'var(--series-1)',
      decimals: entry?.meta?.decimals ?? 2,
      scale: entry?.meta?.scale ?? 1,
      offset: entry?.meta?.offset ?? 0,
      computed: false,
    }
  }

  const displayValue = (ref: VarRef): number | undefined => {
    const entry = values[ref.key]
    if (!entry || entry.value === undefined) return undefined
    return entry.value * meta(ref).scale + meta(ref).offset
  }

  const runtime: DashboardRuntime = {
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
      const subscription = { refs, callback }
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

  return {
    runtime,
    setValue: (key, value) => {
      values[key] = { ...(values[key] ?? {}), value }
    },
    emitFrame: (now = 1) => {
      for (const subscription of subscriptions) {
        subscription.callback({
          now,
          refs: subscription.refs(),
          latest: subscription.refs().map((ref) => displayValue(ref)),
          changedAliases: ['main'],
        })
      }
    },
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
    type: 'value.number',
    version: 1,
    x: 0,
    y: 0,
    w: 4,
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

function mountNumber(fake: FakeRuntime, props: Record<string, unknown>) {
  return mount(ValueNumber, {
    props: {
      instance: widget(props),
      props,
      size: { width: 320, height: 120 },
      mode: 'run',
      ctx: contextOf(fake.runtime),
    },
    global: { provide: { [DASHBOARD_RUNTIME_KEY]: fake.runtime } },
  })
}

const VARIABLE = { variable: { source: 'main', key: 'temp' } }

describe('value.number', () => {
  it('继承变量的 decimals 与单位', () => {
    const fake = createRuntime({
      values: { temp: { value: 12.345, meta: { decimals: 1, unit: 'V', label: '电压' } } },
    })
    const wrapper = mountNumber(fake, VARIABLE)

    expect(wrapper.attributes('data-display-value')).toBe('12.3')
    expect(wrapper.text()).toContain('V')
    expect(wrapper.text()).toContain('电压')
  })

  it('组件 decimals 覆盖变量设置', () => {
    const fake = createRuntime({ values: { temp: { value: 12.345, meta: { decimals: 3 } } } })
    const wrapper = mountNumber(fake, { ...VARIABLE, decimals: 0 })

    expect(wrapper.attributes('data-display-value')).toBe('12')
  })

  it('先应用变量元信息的 scale / offset', () => {
    const fake = createRuntime({
      values: { temp: { value: 3, meta: { scale: 2, offset: 1, decimals: 1 } } },
    })
    const wrapper = mountNumber(fake, VARIABLE)

    expect(wrapper.attributes('data-display-value')).toBe('7.0')
  })

  it('阈值按顺序取第一个匹配项改变颜色', async () => {
    const fake = createRuntime({ values: { temp: { value: 12, meta: { decimals: 0 } } } })
    const wrapper = mountNumber(fake, {
      ...VARIABLE,
      thresholds: [
        { op: '>', value: 10, color: '#ff0000', label: '过高' },
        { op: '>', value: 5, color: '#00ff00', label: '偏高' },
      ],
    })

    expect(wrapper.attributes('data-value-color')).toBe('#ff0000')

    fake.setValue('temp', 6)
    fake.emitFrame()
    await nextTick()
    expect(wrapper.attributes('data-display-value')).toBe('6')
    expect(wrapper.attributes('data-value-color')).toBe('#00ff00')

    fake.setValue('temp', 1)
    fake.emitFrame()
    await nextTick()
    // 没有阈值匹配时使用 auto → 变量颜色。
    expect(wrapper.attributes('data-value-color')).toBe('var(--series-1)')
  })

  it('空状态文案：未绑定变量 / 数据源未连接 / 等待数据…', () => {
    const unbound = mountNumber(createRuntime(), { variable: null })
    expect(unbound.find('[data-empty-state]').text()).toBe('未绑定变量')
    expect(unbound.attributes('data-display-value')).toBe('--')

    const disconnected = createRuntime({ values: { temp: { value: 1 } }, state: 'unbound' })
    expect(mountNumber(disconnected, VARIABLE).find('[data-empty-state]').text()).toBe(
      '数据源未连接',
    )

    const waiting = createRuntime({ values: { temp: {} } })
    expect(mountNumber(waiting, VARIABLE).find('[data-empty-state]').text()).toBe('等待数据…')
  })

  it('关闭 showUnit / showLabel 后不再显示', () => {
    const fake = createRuntime({
      values: { temp: { value: 2, meta: { unit: 'V', label: '电压', decimals: 0 } } },
    })
    const wrapper = mountNumber(fake, { ...VARIABLE, showUnit: false, showLabel: false })

    expect(wrapper.text()).not.toContain('V')
    expect(wrapper.text()).not.toContain('电压')
    expect(wrapper.attributes('data-display-value')).toBe('2')
  })
})
