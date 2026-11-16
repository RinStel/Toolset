// @vitest-environment happy-dom
/**
 * 自定义控件编辑器：模板新建、预览渲染、保存后列表更新。
 *
 * CodeMirror 由 `defineAsyncComponent` 动态加载；这里用轻量替身避免测试依赖编辑器布局。
 */

import 'fake-indexeddb/auto'

import { flushPromises, mount } from '@vue/test-utils'
import { nextTick } from 'vue'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import CustomWidgetEditor from '@/tools/serial/dashboard/custom/CustomWidgetEditor.vue'
import {
  listCustomWidgetIndex,
  refreshCustomWidgets,
  serialCustomWidgets,
} from '@/tools/serial/dashboard/custom/custom-widget-registry'
import {
  closeCustomWidgetEditor,
  customWidgetEditorState,
} from '@/tools/serial/dashboard/custom/editor-state'

beforeEach(async () => {
  closeCustomWidgetEditor()
  localStorage.clear()
  await refreshCustomWidgets()
})

describe('CustomWidgetEditor', () => {
  it('用模板新建控件，预览渲染模拟数据，保存后出现在列表中', async () => {
    customWidgetEditorState.open = true
    const wrapper = mount(CustomWidgetEditor, {
      attachTo: document.body,
      global: { stubs: { teleport: true } },
    })
    await flushPromises()
    await nextTick()

    await wrapper.get('[data-testid="custom-widget-new"]').trigger('click')
    await nextTick()
    expect(wrapper.find('[data-testid="custom-widget-templates"]').exists()).toBe(true)

    await wrapper.get('[data-testid="custom-widget-template-minimal-value"]').trigger('click')
    await flushPromises()
    await nextTick()
    await flushPromises()

    expect(wrapper.find('[data-testid="custom-widget-preview"]').exists()).toBe(true)
    const preview = wrapper.get('[data-testid="custom-widget-preview"]')
    const host = preview.element.querySelector('.custom-widget-host')
    const mountPoint = host?.querySelector('div')
    const text = mountPoint?.shadowRoot?.textContent ?? ''
    expect(text).not.toContain('等待数据')
    expect(text).toMatch(/-?\d+\.\d{2}/)

    const before = listCustomWidgetIndex().length
    await wrapper.get('[data-testid="custom-widget-save"]').trigger('click')
    await flushPromises()
    await nextTick()
    await vi.waitFor(
      () => {
        expect(listCustomWidgetIndex().length).toBe(before + 1)
      },
      { timeout: 2000 },
    )
    expect(serialCustomWidgets.revision).toBeGreaterThan(0)
    const selectedId = listCustomWidgetIndex()[0]?.id ?? null
    expect(selectedId).not.toBeNull()
    expect(wrapper.find(`[data-testid="custom-widget-item-${selectedId}"]`).exists()).toBe(true)

    wrapper.unmount()
  })

  it('打开时显示安全说明，勾选不再提示后隐藏', async () => {
    customWidgetEditorState.open = true
    const wrapper = mount(CustomWidgetEditor, {
      attachTo: document.body,
      global: { stubs: { teleport: true } },
    })
    await flushPromises()
    await new Promise((resolve) => setTimeout(resolve, 0))
    await flushPromises()
    await wrapper.get('[data-testid="custom-widget-new"]').trigger('click')
    await flushPromises()
    const safety = wrapper.find('[data-testid="custom-widget-safety"]')
    expect(safety.exists()).toBe(true)
    await safety.get('[data-testid="custom-widget-safety-do-not-ask"] input').setValue(true)
    // UiButton 的 click 是组件事件；测试里直接调用处理函数，避免依赖 DOM 事件模拟细节。
    ;(wrapper.vm as unknown as { dismissSafetyNotice: () => void }).dismissSafetyNotice()
    await flushPromises()
    await nextTick()
    expect(wrapper.find('[data-testid="custom-widget-safety"]').exists()).toBe(false)
    wrapper.unmount()
  })
})
