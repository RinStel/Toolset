// @vitest-environment happy-dom
import { flushPromises, mount } from '@vue/test-utils'
import { afterEach, describe, expect, it } from 'vitest'

import { appearance, resetAppearance, setUiStyle } from '@/app/stores/appearance'
import { getPrintFontStylesHtml } from '@/tools/seal-strip/core/fonts'
import SealStripView from '@/tools/seal-strip/views/SealStripView.vue'

afterEach(() => {
  document.body.innerHTML = ''
  resetAppearance()
})

describe('SealStripView 与站点 UI 风格切换', () => {
  it('挂载后默认生成 21 张商品封箱条，且支持固定种子复现 M3YC-QDWE-84H', async () => {
    const wrapper = mount(SealStripView, { attachTo: document.body })
    await flushPromises()

    expect(wrapper.find('[data-testid="seal-strip-tool"]').exists()).toBe(true)
    const rows = wrapper.findAll('[data-testid^="seal-card-row-"]')
    expect(rows).toHaveLength(21)

    // 点击按种子生成（默认种子为 20261115）
    await wrapper.get('[data-testid="seal-apply-seed"]').trigger('click')
    await flushPromises()

    expect(wrapper.get('[data-testid="seal-current-code"]').element).toBeInstanceOf(
      HTMLInputElement,
    )
    expect(
      (wrapper.get('[data-testid="seal-current-code"]').element as HTMLInputElement).value,
    ).toBe('M3YC-QDWE-84H')
    expect(wrapper.get('[data-testid="seal-current-chk"]').text()).toBe('14-58E2-A039')
    expect(wrapper.get('[data-testid="seal-current-sig"]').text()).toBe('04E214')
    expect(wrapper.find('[data-testid="seal-single-preview"] svg').exists()).toBe(true)

    wrapper.unmount()
  })

  it('支持单张/A4 预览切换以及编码核验模式', async () => {
    const wrapper = mount(SealStripView, { attachTo: document.body })
    await flushPromises()

    // 切换到 A4 二十一联预览
    const previewRadios = wrapper
      .get('[data-testid="seal-preview-mode"]')
      .findAll('button[role="radio"]')
    await previewRadios[1]!.trigger('click')
    await flushPromises()
    expect(wrapper.find('[data-testid="seal-sheet-preview"] svg').exists()).toBe(true)

    // 切换到编码核验模式并输入完整二维码载荷
    const modeRadios = wrapper.get('[data-testid="seal-mode-tabs"]').findAll('button[role="radio"]')
    await modeRadios[1]!.trigger('click')
    await flushPromises()

    const verifyInput = wrapper.get('[data-testid="seal-verify-input"]')
    await verifyInput.setValue('RINSTEL-SEAL|M3YC-QDWE-84H|14-58E2-A039')
    await flushPromises()

    const resultText = wrapper.get('[data-testid="seal-verify-result"]').text()
    expect(resultText).toContain('校验码匹配')
    expect(resultText).toContain('1E3E45B7395F0E52')
    expect(resultText).toContain('04E214')

    // 测试篡改的校验码
    await verifyInput.setValue('RINSTEL-SEAL|M3YC-QDWE-84H|AA-BBBB-CCCC')
    await flushPromises()
    expect(wrapper.get('[data-testid="seal-verify-result"]').text()).toContain('校验码不匹配')

    // 切换到专用字体页，验证云端加载入口与去除冗余说明文案
    await modeRadios[2]!.trigger('click')
    await flushPromises()
    expect(wrapper.find('[data-testid="seal-load-cloud-fonts"]').exists()).toBe(true)
    expect(wrapper.text()).not.toContain('原脚本严格指定三款字体')
    expect(getPrintFontStylesHtml()).toContain('lxgw-wenkai-webfont')
    expect(getPrintFontStylesHtml()).toContain('Space+Grotesk')

    wrapper.unmount()
  })

  it('appearance.setUiStyle 能正确切换并持久化 data-style 主题属性', () => {
    setUiStyle('moss')
    expect(appearance.style).toBe('moss')
    expect(document.documentElement.dataset.style).toBe('moss')

    setUiStyle('industrial')
    expect(appearance.style).toBe('industrial')
    expect(document.documentElement.dataset.style).toBe('industrial')
  })
})
