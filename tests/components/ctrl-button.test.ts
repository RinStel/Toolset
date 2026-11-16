// @vitest-environment happy-dom
import { flushPromises, mount } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { CommandSpec, CommonProps, VarRef, WidgetInstance } from '@/domains/dashboard/public'

import CtrlButton from '@/tools/serial/dashboard/widgets/ctrl.button/Widget.vue'
import type { WidgetContext } from '@/tools/serial/dashboard/widgets/shared/types'
import type { DashboardSourceState } from '@/tools/serial/dashboard/runtime/context'

vi.mock('@/shared/ui/services/confirm', () => ({
  confirm: vi.fn(async () => true),
}))

import { confirm } from '@/shared/ui/services/confirm'

const confirmMock = vi.mocked(confirm)

const COMMON: CommonProps = {
  title: '按钮',
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
  template: 'ON',
  options: {
    encoding: 'utf-8',
    eol: 'none',
    checksum: 'none',
    checksumEndian: 'le',
    checksumSkip: 0,
  },
}

const RELEASE_COMMAND: CommandSpec = {
  kind: 'template',
  source: 'main',
  mode: 'text',
  template: 'OFF',
  options: {
    encoding: 'utf-8',
    eol: 'none',
    checksum: 'none',
    checksumEndian: 'le',
    checksumSkip: 0,
  },
}

function createSend() {
  return vi.fn(
    async (_cmd: CommandSpec | string, _value?: number | boolean | string): Promise<unknown> =>
      'sent',
  )
}

function mountButton(
  options: {
    props?: Record<string, unknown>
    mode?: 'edit' | 'run'
    state?: DashboardSourceState
    send?: ReturnType<typeof createSend>
  } = {},
) {
  const send = options.send ?? createSend()
  const state = options.state ?? 'open'
  const mode = options.mode ?? 'run'
  const widgetProps: Record<string, unknown> = {
    label: '发送',
    command: COMMAND,
    value: 1,
    ...options.props,
  }
  const instance: WidgetInstance = {
    id: 'w1',
    type: 'ctrl.button',
    version: 1,
    x: 0,
    y: 0,
    w: 3,
    h: 2,
    common: COMMON,
    props: widgetProps,
  }
  const context: WidgetContext = {
    send,
    sendBytes: async () => 'sent',
    sourceState: () => state,
    theme: () => '',
    resolveMeta: (ref: VarRef) => ({
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
    requestUpdate: () => {},
  }
  const wrapper = mount(CtrlButton, {
    props: {
      instance,
      props: widgetProps,
      size: { width: 120, height: 60 },
      mode,
      ctx: context,
    },
  })
  return { wrapper, send }
}

describe('ctrl.button', () => {
  beforeEach(() => {
    confirmMock.mockClear()
    confirmMock.mockResolvedValue(true)
  })

  it('点击发送一次命令并累加 data-sent-count', async () => {
    const { wrapper, send } = mountButton()
    await wrapper.find('[data-testid="ctrl-button-send"]').trigger('click')
    await flushPromises()

    expect(send).toHaveBeenCalledTimes(1)
    expect(send.mock.calls[0]?.[0]).toEqual(COMMAND)
    expect(send.mock.calls[0]?.[1]).toBe(1)
    expect(wrapper.attributes('data-sent-count')).toBe('1')
  })

  it('momentary：按下发送 command，松开发送 releaseCommand', async () => {
    const { wrapper, send } = mountButton({
      props: { momentary: true, releaseCommand: RELEASE_COMMAND },
    })
    const button = wrapper.find('[data-testid="ctrl-button-send"]')

    await button.trigger('pointerdown')
    await flushPromises()
    expect(send).toHaveBeenCalledTimes(1)
    expect(send.mock.calls[0]?.[0]).toEqual(COMMAND)
    expect(send.mock.calls[0]?.[1]).toBe(1)

    await button.trigger('pointerup')
    await flushPromises()
    expect(send).toHaveBeenCalledTimes(2)
    expect(send.mock.calls[1]?.[0]).toEqual(RELEASE_COMMAND)
    expect(send.mock.calls[1]?.[1]).toBe(0)
    expect(wrapper.attributes('data-sent-count')).toBe('2')
  })

  it('confirm 打开时先确认，取消则不发送', async () => {
    const send = createSend()
    const { wrapper } = mountButton({ props: { confirm: true }, send })
    const button = wrapper.find('[data-testid="ctrl-button-send"]')

    confirmMock.mockResolvedValueOnce(false)
    await button.trigger('click')
    await flushPromises()
    expect(confirmMock).toHaveBeenCalledTimes(1)
    expect(send).not.toHaveBeenCalled()

    confirmMock.mockResolvedValueOnce(true)
    await button.trigger('click')
    await flushPromises()
    expect(confirmMock).toHaveBeenCalledTimes(2)
    expect(send).toHaveBeenCalledTimes(1)
  })

  it('编辑模式不响应发送', async () => {
    const { wrapper, send } = mountButton({ mode: 'edit' })
    const button = wrapper.find('[data-testid="ctrl-button-send"]')
    expect(button.attributes('disabled')).toBeDefined()

    await button.trigger('click')
    await flushPromises()
    expect(send).not.toHaveBeenCalled()
  })

  it('数据源未连接时禁用并给出 Tooltip', () => {
    const { wrapper } = mountButton({ state: 'unbound' })
    const button = wrapper.find('[data-testid="ctrl-button-send"]')

    expect(button.attributes('disabled')).toBeDefined()
    expect(button.attributes('title')).toContain('数据源 main 未连接')
  })

  it('发送失败时闪烁 --danger（Toast 由外框负责）', async () => {
    const send = createSend()
    send.mockRejectedValueOnce(new Error('端口未打开'))
    const { wrapper } = mountButton({ send })

    await wrapper.find('[data-testid="ctrl-button-send"]').trigger('click')
    await flushPromises()

    expect(wrapper.find('[data-testid="ctrl-button-send"]').classes()).toContain('is-flash-danger')
    expect(wrapper.attributes('data-sent-count')).toBe('0')
  })
})
