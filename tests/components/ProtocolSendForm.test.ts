// @vitest-environment happy-dom
import { flushPromises, mount } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => {
  const fields = [
    {
      key: 'interval',
      label: '上报间隔',
      type: 'number',
      min: 100,
      max: 10000,
      default: 1000,
      unit: 'ms',
    },
  ]
  return {
    fields,
    encode: vi.fn(),
    sendForm: vi.fn(),
    dispose: vi.fn(),
    runtime: {
      info: {
        meta: { name: '测试协议' },
        sendForm: { fields },
        framing: { type: 'line' },
      },
      encode: (...args: unknown[]) => mocks.encode(...args),
      on: () => () => {},
      dispose: (...args: unknown[]) => mocks.dispose(...args),
    },
  }
})

vi.mock('@/domains/protocol/public', () => ({
  getProtocolRepository: () => ({
    get: async () => ({
      id: 'p1',
      name: '测试协议',
      code: 'return {}',
      createdAt: 0,
      updatedAt: 0,
    }),
  }),
  createProtocolRuntime: async () => mocks.runtime,
}))

vi.mock('@/tools/serial/stores/sessions', () => ({
  getSessionView: () => ({
    id: 's1',
    name: '测试会话',
    state: 'open',
    protocol: {
      id: 'p1',
      name: '测试协议',
      status: 'active',
      sendForm: mocks.fields,
    },
  }),
  getSessionInstance: () => ({
    state: 'open',
    sendForm: mocks.sendForm,
  }),
}))

import ProtocolSendForm from '@/tools/serial/components/ProtocolSendForm.vue'

function mountForm() {
  return mount(ProtocolSendForm, { props: { sessionId: 's1' } })
}

beforeEach(() => {
  mocks.encode.mockReset()
  mocks.sendForm.mockReset()
  mocks.sendForm.mockResolvedValue(undefined)
  mocks.dispose.mockReset()
})

describe('ProtocolSendForm', () => {
  it('按协议 sendForm 字段生成表单并显示编码预览', async () => {
    mocks.encode.mockResolvedValue(Uint8Array.from([0xa5, 0x5a]))
    const wrapper = mountForm()
    await flushPromises()

    expect(wrapper.find('[data-testid="protocol-field-interval"]').exists()).toBe(true)
    expect(wrapper.text()).toContain('上报间隔')
    expect(wrapper.text()).toContain('将发送 2 字节：A5 5A')

    await wrapper.get('[data-testid="protocol-send-button"]').trigger('click')
    await flushPromises()
    expect(mocks.sendForm).toHaveBeenCalledWith({ interval: 1000 })
  })

  it('编码错误时显示错误并禁用发送按钮', async () => {
    mocks.encode.mockRejectedValue(new Error('上报间隔必须是 100–10000 之间的整数'))
    const wrapper = mountForm()
    await flushPromises()

    expect(wrapper.text()).toContain('上报间隔必须是 100–10000 之间的整数')
    expect(wrapper.get('[data-testid="protocol-send-button"]').attributes('disabled')).toBeDefined()
  })
})
