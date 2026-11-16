// @vitest-environment happy-dom
import { mount } from '@vue/test-utils'
import { describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  capabilities: { lineSettings: true, signals: false, break: false },
}))

vi.mock('@/tools/serial/stores/sessions', () => ({
  getSessionView: () => ({
    id: 's1',
    name: '测试会话',
    state: 'open',
    signals: { dtr: null, rts: null },
  }),
  getSessionInstance: () => ({
    state: 'open',
    transport: { capabilities: mocks.capabilities },
  }),
}))

import SignalControls from '@/tools/serial/components/SignalControls.vue'

describe('SignalControls', () => {
  it('能力为 false 时 DTR/RTS/Break 按钮全部禁用', () => {
    const wrapper = mount(SignalControls, { props: { sessionId: 's1' } })

    for (const testId of ['signal-dtr', 'signal-rts']) {
      const buttons = wrapper.get(`[data-testid="${testId}"]`).findAll('button')
      expect(buttons.length).toBeGreaterThan(0)
      for (const button of buttons) {
        expect(button.attributes('disabled')).toBeDefined()
      }
    }

    expect(wrapper.get('[data-testid="signal-break"]').attributes('disabled')).toBeDefined()
  })

  it('支持控制线时按钮可用（连接状态）', () => {
    mocks.capabilities = { lineSettings: true, signals: true, break: true }
    try {
      const wrapper = mount(SignalControls, { props: { sessionId: 's1' } })
      const buttons = wrapper.get('[data-testid="signal-rts"]').findAll('button')
      expect(buttons.some((button) => button.attributes('disabled') === undefined)).toBe(true)
      expect(wrapper.get('[data-testid="signal-break"]').attributes('disabled')).toBeUndefined()
    } finally {
      mocks.capabilities = { lineSettings: true, signals: false, break: false }
    }
  })
})
