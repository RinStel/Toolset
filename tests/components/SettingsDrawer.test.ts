// @vitest-environment happy-dom
import { flushPromises, mount } from '@vue/test-utils'
import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/app/registry', () => {
  const FakeSettingsPanel = {
    name: 'FakeSettingsPanel',
    template: '<div data-testid="fake-tool-settings">工具设置面板已加载</div>',
  }
  const icon = { name: 'FakeIcon', render: () => null }
  const tools = [
    {
      id: 'fake',
      title: '假工具',
      summary: '带设置面板的测试工具',
      category: 'other',
      icon,
      layout: 'page',
      settings: () => Promise.resolve(FakeSettingsPanel),
    },
    {
      id: 'plain',
      title: '无设置工具',
      summary: '没有设置面板的测试工具',
      category: 'other',
      icon,
      layout: 'page',
    },
  ]
  return {
    tools,
    getTool: (id: string) => tools.find((tool) => tool.id === id),
  }
})

import SettingsDrawer from '@/app/layout/SettingsDrawer.vue'

afterEach(() => {
  document.body.innerHTML = ''
})

describe('SettingsDrawer', () => {
  it('打开时自动挂载提供了 settings 的工具分组', async () => {
    const wrapper = mount(SettingsDrawer, {
      props: { modelValue: true },
      attachTo: document.body,
    })
    await flushPromises()

    expect(document.querySelector('[data-testid="appearance-settings"]')).not.toBeNull()

    const group = document.querySelector('[data-testid="tool-settings-fake"]')
    expect(group).not.toBeNull()
    expect(group?.textContent).toContain('假工具')
    expect(document.querySelector('[data-testid="fake-tool-settings"]')).not.toBeNull()

    // 没有 settings 的工具不渲染分组。
    expect(document.querySelector('[data-testid="tool-settings-plain"]')).toBeNull()

    wrapper.unmount()
  })

  it('关闭时不挂载工具设置组件', async () => {
    const wrapper = mount(SettingsDrawer, {
      props: { modelValue: false },
      attachTo: document.body,
    })
    await flushPromises()

    expect(document.querySelector('[data-testid="appearance-settings"]')).toBeNull()
    expect(document.querySelector('[data-testid="tool-settings-fake"]')).toBeNull()

    wrapper.unmount()
  })
})
