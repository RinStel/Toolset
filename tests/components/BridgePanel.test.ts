// @vitest-environment happy-dom
import { flushPromises, mount } from '@vue/test-utils'
import { describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => {
  const listeners: Array<(rules: unknown[]) => void> = []
  return {
    listeners,
    add: vi.fn(() => ({ ok: false, error: '该规则会形成转发环路' })),
    emitRules: (rules: unknown[]) => {
      for (const listener of listeners) listener(rules)
    },
  }
})

vi.mock('@/domains/link/public', () => ({
  getBridgeService: () => ({
    list: () => [],
    add: mocks.add,
    setPaused: () => {},
    remove: () => {},
    on: (_event: string, handler: (rules: unknown[]) => void) => {
      mocks.listeners.push(handler)
      return () => {}
    },
    dispose: () => {},
  }),
}))

vi.mock('@/tools/serial/stores/sessions', () => ({
  serialSessions: {
    views: [
      { id: 's1', name: '会话 A', state: 'open' },
      { id: 's2', name: '会话 B', state: 'open' },
    ],
  },
}))

import BridgePanel from '@/tools/serial/components/BridgePanel.vue'

describe('BridgePanel', () => {
  it('提交被拒绝时显示原因', async () => {
    const wrapper = mount(BridgePanel, { props: { sessionId: 's1' } })

    await wrapper.get('[data-testid="bridge-source"]').setValue('s1')
    await wrapper.get('[data-testid="bridge-target"]').setValue('s2')
    await wrapper.get('[data-testid="bridge-add"]').trigger('click')
    await flushPromises()

    expect(mocks.add).toHaveBeenCalledWith('s1', 's2', 'oneway')
    expect(wrapper.get('[data-testid="bridge-error"]').text()).toContain('该规则会形成转发环路')
    expect(wrapper.text()).toContain('该规则会形成转发环路')
  })

  it('规则暂停时显示「已暂停」', async () => {
    const wrapper = mount(BridgePanel, { props: { sessionId: 's1' } })
    mocks.emitRules([
      {
        id: 'r1',
        a: 's1',
        b: 's2',
        mode: 'oneway',
        paused: true,
        stats: { aToB: 12, bToA: 0, dropped: 0 },
      },
    ])
    await flushPromises()

    expect(wrapper.find('[data-testid="bridge-rule-r1"]').exists()).toBe(true)
    expect(wrapper.get('[data-testid="bridge-rule-r1"]').text()).toContain('已暂停')
  })
})
