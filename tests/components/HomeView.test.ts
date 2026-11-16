// @vitest-environment happy-dom
import { mount } from '@vue/test-utils'
import { describe, expect, it, vi } from 'vitest'
import { createMemoryHistory, createRouter } from 'vue-router'

vi.mock('@/app/registry', () => {
  const icon = { name: 'FakeIcon', render: () => null }
  const tools = [
    {
      id: 'serial',
      title: '串口助手',
      summary: '串口收发与协议解析',
      category: 'comm',
      icon,
      layout: 'workspace',
      keywords: ['uart', '串口'],
    },
    {
      id: 'convert',
      title: '格式转换',
      summary: '十六进制与文本互转',
      category: 'convert',
      icon,
      layout: 'page',
    },
    {
      id: 'mystery',
      title: '未知工具',
      summary: '分类未知的演示工具',
      category: 'unknown',
      icon,
      layout: 'page',
    },
  ]
  return {
    tools,
    getTool: (id: string) => tools.find((tool) => tool.id === id),
  }
})

import HomeView from '@/app/layout/HomeView.vue'

async function mountHomeView() {
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/', component: { template: '<div />' } },
      { path: '/tools/:id', component: { template: '<div />' } },
    ],
  })
  await router.push('/')
  await router.isReady()

  return mount(HomeView, {
    global: {
      plugins: [router],
    },
  })
}

describe('HomeView', () => {
  it('按分类分组显示工具卡片', async () => {
    const wrapper = await mountHomeView()

    expect(wrapper.find('[data-testid="tool-group-comm"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="tool-group-convert"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="tool-group-other"]').exists()).toBe(true)

    expect(wrapper.get('[data-testid="tool-group-comm"]').text()).toContain('串口助手')
    expect(wrapper.get('[data-testid="tool-group-convert"]').text()).toContain('格式转换')
    // 未知分类回退到 other 分组。
    expect(wrapper.get('[data-testid="tool-group-other"]').text()).toContain('未知工具')
  })

  it('搜索框按标题、摘要和关键词过滤', async () => {
    const wrapper = await mountHomeView()
    const search = wrapper.get('[data-testid="tool-search"]')

    await search.setValue('uart')
    expect(wrapper.find('[data-testid="tool-card-serial"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="tool-card-convert"]').exists()).toBe(false)

    await search.setValue('互转')
    expect(wrapper.find('[data-testid="tool-card-convert"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="tool-card-serial"]').exists()).toBe(false)

    await search.setValue('不存在的关键词')
    expect(wrapper.find('[data-testid="tool-card-serial"]').exists()).toBe(false)
    expect(wrapper.text()).toContain('未找到匹配的工具')
  })

  it('后续规划以纯文本展示且不可点击', async () => {
    const wrapper = await mountHomeView()
    const items = wrapper.findAll('[data-testid="roadmap-item"]')

    expect(items.length).toBeGreaterThan(0)
    for (const item of items) {
      expect(item.element.tagName).toBe('LI')
      expect(item.find('a, button').exists()).toBe(false)
    }
    expect(wrapper.get('[data-testid="roadmap"]').text()).toContain('数据格式转换')
    expect(wrapper.get('[data-testid="roadmap"]').text()).toContain('阻抗计算')
    expect(wrapper.get('[data-testid="roadmap"]').text()).toContain('网络 / BLE 通道')
  })
})
