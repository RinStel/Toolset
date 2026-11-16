// @vitest-environment happy-dom
import { flushPromises, mount } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { nextTick } from 'vue'

import type { CommandSpec, CommonProps, VarRef, WidgetInstance } from '@/domains/dashboard/public'

import CtrlSlider from '@/tools/serial/dashboard/widgets/ctrl.slider/Widget.vue'
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

interface FakeRuntime {
  runtime: DashboardRuntime
  setValue(key: string, value: number | undefined): void
  emitFrame(): void
}

function createRuntime(values: Record<string, number | undefined> = {}): FakeRuntime {
  const subscriptions = new Set<{
    refs: () => readonly VarRef[]
    callback: (update: WidgetFrameUpdate) => void
  }>()
  const meta = (ref: VarRef): DashboardVariableMeta => ({
    source: ref.source,
    key: ref.key,
    label: ref.key,
    unit: '',
    color: 'var(--series-1)',
    decimals: 2,
    scale: 1,
    offset: 0,
    computed: false,
  })
  const displayValue = (ref: VarRef): number | undefined => values[ref.key]

  const runtime: DashboardRuntime = {
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
    rawLatest: (ref) => values[ref.key],
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
      values[key] = value
    },
    emitFrame: () => {
      for (const subscription of subscriptions) {
        subscription.callback({
          now: 1,
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

const COMMAND: CommandSpec = {
  kind: 'template',
  source: 'main',
  mode: 'text',
  template: 'PWM={value}',
  options: {
    encoding: 'utf-8',
    eol: 'none',
    checksum: 'none',
    checksumEndian: 'le',
    checksumSkip: 0,
  },
}

function createSend() {
  return vi.fn(async (_cmd: CommandSpec | string, _value?: number | boolean | string) => 'sent')
}

function mountSlider(fake: FakeRuntime, props: Record<string, unknown>, send = createSend()) {
  const widgetProps: Record<string, unknown> = {
    min: 0,
    max: 100,
    step: 1,
    command: COMMAND,
    ...props,
  }
  const instance: WidgetInstance = {
    id: 'w1',
    type: 'ctrl.slider',
    version: 1,
    x: 0,
    y: 0,
    w: 6,
    h: 2,
    common: COMMON,
    props: widgetProps,
  }
  const context: WidgetContext = {
    send,
    sendBytes: async () => 'sent',
    sourceState: () => 'open',
    theme: () => '',
    resolveMeta: (ref) => fake.runtime.meta(ref),
    requestUpdate: () => {},
  }
  const wrapper = mount(CtrlSlider, {
    props: {
      instance,
      props: widgetProps,
      size: { width: 320, height: 60 },
      mode: 'run',
      ctx: context,
    },
    global: { provide: { [DASHBOARD_RUNTIME_KEY]: fake.runtime } },
  })
  return { wrapper, send }
}

const sliderInput = (wrapper: ReturnType<typeof mountSlider>['wrapper']) =>
  wrapper.find('[data-testid="ctrl-slider-input"]')

/** 模拟拖动：只触发 `input`（`setValue` 会同时触发 `change`）。 */
async function dragTo(
  wrapper: ReturnType<typeof mountSlider>['wrapper'],
  value: number,
): Promise<void> {
  const input = sliderInput(wrapper)
  ;(input.element as HTMLInputElement).value = String(value)
  await input.trigger('input')
}

describe('ctrl.slider', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('松开时发送：拖动过程中不发送，change 时发送一次', async () => {
    const fake = createRuntime()
    const { wrapper, send } = mountSlider(fake, { sendMode: 'release' })

    await dragTo(wrapper, 60)
    await flushPromises()
    expect(send).not.toHaveBeenCalled()
    expect(wrapper.attributes('data-value')).toBe('60')

    await sliderInput(wrapper).trigger('change')
    await flushPromises()
    expect(send).toHaveBeenCalledTimes(1)
    expect(send.mock.calls[0]?.[1]).toBe(60)
    expect(wrapper.attributes('data-value')).toBe('60')
    expect(wrapper.attributes('data-sent-count')).toBe('1')
  })

  it('拖动时节流发送：首个事件立即发送，之后的发送按 throttleMs 合并', async () => {
    const fake = createRuntime()
    const { wrapper, send } = mountSlider(fake, { sendMode: 'throttle', throttleMs: 100 })

    await dragTo(wrapper, 10)
    await flushPromises()
    expect(send).toHaveBeenCalledTimes(1)
    expect(send.mock.calls[0]?.[1]).toBe(10)

    await dragTo(wrapper, 20)
    await dragTo(wrapper, 30)
    await flushPromises()
    expect(send).toHaveBeenCalledTimes(1)

    await vi.advanceTimersByTimeAsync(100)
    await flushPromises()
    expect(send).toHaveBeenCalledTimes(2)
    expect(send.mock.calls[1]?.[1]).toBe(30)
  })

  it('feedbackVar 同步数值，用户操作后 2 秒内不被反馈覆盖', async () => {
    const fake = createRuntime({ fb: 42 })
    const { wrapper, send } = mountSlider(fake, {
      sendMode: 'release',
      feedbackVar: { source: 'main', key: 'fb' },
    })
    await nextTick()
    expect(wrapper.attributes('data-value')).toBe('42')

    await dragTo(wrapper, 60)
    await sliderInput(wrapper).trigger('change')
    await flushPromises()
    expect(send).toHaveBeenCalledTimes(1)

    // 保护期内反馈变化不覆盖用户操作。
    fake.setValue('fb', 10)
    fake.emitFrame()
    await nextTick()
    expect(wrapper.attributes('data-value')).toBe('60')

    // 2 秒后反馈重新生效。
    await vi.advanceTimersByTimeAsync(2000)
    await nextTick()
    expect(wrapper.attributes('data-value')).toBe('10')

    fake.setValue('fb', 55)
    fake.emitFrame()
    await nextTick()
    expect(wrapper.attributes('data-value')).toBe('55')
  })

  it('再次拖动时重置保护期', async () => {
    const fake = createRuntime({ fb: 5 })
    const { wrapper } = mountSlider(fake, {
      sendMode: 'release',
      feedbackVar: { source: 'main', key: 'fb' },
    })
    await nextTick()
    expect(wrapper.attributes('data-value')).toBe('5')

    await dragTo(wrapper, 70)
    fake.setValue('fb', 20)
    fake.emitFrame()
    await nextTick()
    expect(wrapper.attributes('data-value')).toBe('70')

    await vi.advanceTimersByTimeAsync(1500)
    await dragTo(wrapper, 80)
    await vi.advanceTimersByTimeAsync(1500)
    await nextTick()
    // 距最后一次操作只过了 1.5 秒，保护期仍有效。
    expect(wrapper.attributes('data-value')).toBe('80')
  })
})
