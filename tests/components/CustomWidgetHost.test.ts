// @vitest-environment happy-dom
/**
 * 自定义控件宿主：mount / 数据帧 / 属性变化 / 调用保护 / 安全模式 / 卸载。
 */

import { flushPromises, mount } from '@vue/test-utils'
import { nextTick } from 'vue'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { safeMode, SAFE_MODE_PENDING_KEY } from '@/domains/dashboard/public'
import type { WidgetInstance } from '@/domains/dashboard/public'
import type { SeriesSlice, VariableInfo } from '@/domains/series/public'

import CustomWidgetHost from '@/tools/serial/dashboard/custom/CustomWidgetHost.vue'
import { resetCustomWidgetSafeModeForTests } from '@/tools/serial/dashboard/custom/safe-mode-state'
import type {
  DashboardRuntime,
  DashboardSourceState,
  WidgetFrameUpdate,
} from '@/tools/serial/dashboard/runtime/context'

interface FakeRuntime {
  runtime: DashboardRuntime
  emit(values: Array<number | undefined>): Promise<void>
}

function emptySlice(): SeriesSlice {
  return { idx: new Float64Array(0), t: new Float64Array(0), v: new Float64Array(0) }
}

function createFakeRuntime(): FakeRuntime {
  const values = new Map<string, number | undefined>()
  const listeners = new Set<(update: WidgetFrameUpdate) => void>()
  const variables = (): VariableInfo[] => [
    {
      key: 'ch0',
      label: '通道 0',
      unit: '',
      computed: false,
      count: 0,
      last: 0,
      lastAt: 0,
      min: 0,
      max: 0,
      mean: 0,
      rate: 0,
    },
  ]

  const runtime: DashboardRuntime = {
    paneIndex: 0,
    mode: 'run',
    dashboard: () => null,
    defaultAlias: () => 'main',
    sourceState: (): DashboardSourceState => 'open',
    isSourceOpen: () => true,
    isSourceBound: () => true,
    session: () => undefined,
    series: () => undefined,
    variables,
    meta: (ref) => ({
      source: ref.source,
      key: ref.key,
      label: '通道 0',
      unit: '',
      color: 'var(--series-1)',
      decimals: 2,
      scale: 1,
      offset: 0,
      computed: false,
    }),
    rawLatest: (ref) => values.get(ref.key),
    displayValue: (ref) => values.get(ref.key),
    read: () => emptySlice(),
    theme: () => '#22b8cf',
    onThemeChange: () => () => undefined,
    send: async () => 'sent',
    sendBytes: async () => 'sent',
    sendQuickItem: async () => 'sent',
    subscribeFrame: (_refs, callback) => {
      listeners.add(callback)
      return () => listeners.delete(callback)
    },
    requestUpdate: () => {
      for (const listener of listeners) {
        listener({
          now: 0,
          refs: [{ source: 'main', key: 'ch0' }],
          latest: [values.get('ch0')],
          changedAliases: ['main'],
        })
      }
    },
    tick: () => 0,
    syncComputed: () => undefined,
    boundAliases: () => ['main'],
  }

  return {
    runtime,
    async emit(nextValues) {
      for (let index = 0; index < nextValues.length; index += 1) {
        values.set('ch0', nextValues[index])
      }
      for (const listener of listeners) {
        listener({
          now: 0,
          refs: [{ source: 'main', key: 'ch0' }],
          latest: [values.get('ch0')],
          changedAliases: ['main'],
        })
      }
      await nextTick()
      await flushPromises()
    },
  }
}

function createInstance(id = 'host-test', patch: Record<string, unknown> = {}): WidgetInstance {
  return {
    id,
    type: 'custom:test-widget',
    version: 1,
    x: 0,
    y: 0,
    w: 6,
    h: 6,
    common: {
      title: '测试控件',
      showTitle: true,
      titleAlign: 'left',
      background: 'default',
      border: true,
      padding: 8,
      fontScale: 1,
    },
    props: {
      variables: [{ source: 'main', key: 'ch0' }],
      ...patch,
    },
  }
}

const VALUE_CODE = `return {
  apiVersion: 1,
  meta: { name: '测试控件', group: 'value' },
  variables: { min: 1, max: 1 },
  mount(el, ctx) {
    const span = document.createElement('span')
    span.dataset.role = 'value'
    span.textContent = String(ctx.latest(0) === undefined ? 'none' : ctx.latest(0))
    el.append(span)
    return {
      update() {
        span.textContent = String(ctx.latest(0) === undefined ? 'none' : ctx.latest(0))
      },
      propsChanged(props) {
        span.dataset.propsChanged = String(props.label === undefined ? '' : props.label)
      },
      destroy() {
        el.replaceChildren()
        globalThis.__customWidgetDestroyed = true
      },
    }
  },
}`

async function mountHost(
  code: string,
  options: { instance?: WidgetInstance; runtime?: DashboardRuntime; name?: string } = {},
) {
  const fake = createFakeRuntime()
  const runtime = options.runtime ?? fake.runtime
  const wrapper = mount(CustomWidgetHost, {
    props: {
      instance: options.instance ?? createInstance(),
      runtime,
      mode: 'run',
      code,
      name: options.name ?? '测试控件',
    },
  })
  await flushPromises()
  await nextTick()
  await flushPromises()
  return { wrapper, fake }
}

beforeEach(() => {
  safeMode.clearPending()
  for (const id of safeMode.listBlocked()) safeMode.unblock(id)
  resetCustomWidgetSafeModeForTests()
  delete (globalThis as Record<string, unknown>).__customWidgetDestroyed
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('CustomWidgetHost', () => {
  it('在 shadow DOM 中 mount 并读取最新数据', async () => {
    const { wrapper, fake } = await mountHost(VALUE_CODE)
    await fake.emit([12.5])

    const host = wrapper.get('[data-testid="custom-widget-test-widget"]')
    const mountPoint = host.element.querySelector('div')
    expect(mountPoint?.shadowRoot).not.toBeNull()
    const value = mountPoint?.shadowRoot?.querySelector('[data-role="value"]')
    expect(value?.textContent).toBe('12.5')
    wrapper.unmount()
  })

  it('每次调用自定义代码前写入 pending 标记，返回后清除', async () => {
    const code = `return {
      apiVersion: 1,
      meta: { name: '标记测试' },
      mount(el, ctx) {
        const span = document.createElement('span')
        span.textContent = String(localStorage.getItem('toolset/safe-mode/pending'))
        el.append(span)
        return {}
      },
    }`
    const { wrapper } = await mountHost(code)
    const mountPoint = wrapper
      .get('[data-testid="custom-widget-test-widget"]')
      .element.querySelector('div')
    const text = mountPoint?.shadowRoot?.querySelector('span')?.textContent ?? ''
    expect(text).toContain('test-widget')
    expect(localStorage.getItem(SAFE_MODE_PENDING_KEY)).toBeNull()
    wrapper.unmount()
  })

  it('update 只在收到数据帧时调用', async () => {
    const code = `return {
      apiVersion: 1,
      meta: { name: '计数' },
      mount(el, ctx) {
        const span = document.createElement('span')
        el.append(span)
        return { update() { span.textContent = String(ctx.latest(0)) } }
      },
    }`
    const { wrapper, fake } = await mountHost(code)
    await fake.emit([1])
    await fake.emit([2])
    const mountPoint = wrapper
      .get('[data-testid="custom-widget-test-widget"]')
      .element.querySelector('div')
    expect(mountPoint?.shadowRoot?.querySelector('span')?.textContent).toBe('2')
    wrapper.unmount()
  })

  it('属性变化优先调用 propsChanged', async () => {
    const code = `return {
      apiVersion: 1,
      meta: { name: '属性' },
      props: [{ key: 'label', label: '文本', tab: 'style', type: 'text', default: 'A' }],
      mount(el, ctx) {
        const span = document.createElement('span')
        span.textContent = String(ctx.props.label)
        el.append(span)
        return { propsChanged(props) { span.textContent = String(props.label) } }
      },
    }`
    const { wrapper } = await mountHost(code)
    await wrapper.setProps({ instance: createInstance('host-test', { label: 'B' }) })
    await nextTick()
    await flushPromises()
    const mountPoint = wrapper
      .get('[data-testid="custom-widget-test-widget"]')
      .element.querySelector('div')
    expect(mountPoint?.shadowRoot?.querySelector('span')?.textContent).toBe('B')
    wrapper.unmount()
  })

  it('抛出异常时显示错误浮层，10 秒内 3 次后停用', async () => {
    const code = `return {
      apiVersion: 1,
      meta: { name: '异常' },
      mount(el) {
        el.textContent = 'ok'
        return { update() { throw new Error('boom') } }
      },
    }`
    const { wrapper, fake } = await mountHost(code)
    await fake.emit([1])
    expect(wrapper.get('[data-testid="custom-widget-error"]').text()).toContain('boom')

    await fake.emit([2])
    await fake.emit([3])
    expect(wrapper.find('[data-testid="custom-widget-disabled"]').exists()).toBe(true)
    expect(wrapper.get('[data-testid="custom-widget-disabled"]').text()).toContain(
      '已停用：多次出错',
    )
    wrapper.unmount()
  })

  it('单次调用超过 200ms 时停用', async () => {
    const code = `return {
      apiVersion: 1,
      meta: { name: '慢调用' },
      mount(el) {
        el.textContent = 'ok'
        return { update() { const start = performance.now(); while (performance.now() - start < 260) { /* busy */ } } }
      },
    }`
    const { wrapper, fake } = await mountHost(code)
    await fake.emit([1])
    expect(wrapper.get('[data-testid="custom-widget-disabled"]').text()).toContain('执行时间过长')
    wrapper.unmount()
  })

  it('被安全模式暂停时不执行，重新启用后恢复', async () => {
    safeMode.block('test-widget')
    const { wrapper } = await mountHost(VALUE_CODE)
    expect(wrapper.get('[data-testid="custom-widget-paused"]').text()).toContain(
      '已暂停（安全模式）',
    )
    expect(
      wrapper
        .get('[data-testid="custom-widget-test-widget"]')
        .element.querySelector('div')
        ?.shadowRoot?.querySelector('[data-role="value"]'),
    ).toBeNull()

    await wrapper.get('[data-testid="custom-widget-reenable"]').trigger('click')
    await flushPromises()
    await nextTick()
    const mountPoint = wrapper
      .get('[data-testid="custom-widget-test-widget"]')
      .element.querySelector('div')
    expect(mountPoint?.shadowRoot?.querySelector('[data-role="value"]')).not.toBeNull()
    wrapper.unmount()
  })

  it('ctx.saveState 超过 64KB 时同步抛出错误', async () => {
    const code = `return {
      apiVersion: 1,
      meta: { name: '状态' },
      mount(el, ctx) {
        ctx.state.big = 'x'.repeat(70 * 1024)
        try {
          ctx.saveState()
          el.textContent = 'no-error'
        } catch (error) {
          el.textContent = 'error:' + error.message
        }
        return {}
      },
    }`
    const { wrapper } = await mountHost(code)
    const mountPoint = wrapper
      .get('[data-testid="custom-widget-test-widget"]')
      .element.querySelector('div')
    expect(mountPoint?.shadowRoot?.textContent ?? '').toContain('64KB')
    wrapper.unmount()
  })

  it('找不到控件时显示占位文案', async () => {
    const wrapper = mount(CustomWidgetHost, {
      props: {
        instance: { ...createInstance(), type: 'custom:missing-widget' },
        runtime: createFakeRuntime().runtime,
        mode: 'run',
      },
    })
    await flushPromises()
    await nextTick()
    await flushPromises()
    expect(wrapper.get('[data-testid="custom-widget-missing"]').text()).toContain(
      '找不到自定义控件（missing-widget）',
    )
    wrapper.unmount()
  })

  it('卸载时调用 destroy 并清空 shadow root', async () => {
    const { wrapper } = await mountHost(VALUE_CODE)
    const host = wrapper.get('[data-testid="custom-widget-test-widget"]').element
    const mountPoint = host.querySelector('div')
    expect(mountPoint?.shadowRoot?.querySelector('[data-role="value"]')).not.toBeNull()
    wrapper.unmount()
    expect((globalThis as Record<string, unknown>).__customWidgetDestroyed).toBe(true)
    expect(
      mountPoint?.shadowRoot?.querySelector('[data-custom-widget-container]')?.childNodes.length ??
        -1,
    ).toBe(0)
  })
})
