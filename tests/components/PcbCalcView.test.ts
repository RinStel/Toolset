// @vitest-environment happy-dom
import { flushPromises, mount } from '@vue/test-utils'
import { afterEach, describe, expect, it } from 'vitest'

import { userStackupPresets, userTracePresets } from '@/tools/pcb-calc/stores/settings'
import PcbCalcView from '@/tools/pcb-calc/views/PcbCalcView.vue'

afterEach(() => {
  document.body.innerHTML = ''
})

describe('PcbCalcView PCB 走线计算工具', () => {
  it('默认进入阻抗与串扰模式并自动匹配 USB 2.0 HS 90Ω 差分方案', async () => {
    const wrapper = mount(PcbCalcView, { attachTo: document.body })
    await flushPromises()

    expect(wrapper.find('[data-testid="pcb-calc-tool"]').exists()).toBe(true)
    const zText = wrapper.get('[data-testid="pcb-z-result"]').text()
    expect(zText).toContain('90.0')
    expect(wrapper.find('[data-testid="pcb-cross-section-svg"]').exists()).toBe(true)
    expect(wrapper.get('[data-testid="pcb-crosstalk-panel"]').text()).toContain('3W 净间距')
    expect(wrapper.text()).not.toContain('D+/D- 差分 · 对内 ≤50mil')
    expect(wrapper.text()).not.toContain('推荐高速 · 细线宽')
    expect(wrapper.get('[data-testid="pcb-impedance-result"]').text()).not.toContain('±10% 达标')

    // 点击千兆网口 MDI (100Ω 差分) 与 嘉立创 7628 层叠
    await wrapper.get('[data-testid="pcb-hs-preset-eth-mdi"]').trigger('click')
    await flushPromises()
    expect(wrapper.get('[data-testid="pcb-z-result"]').text()).toContain('100.0')

    await wrapper.get('[data-testid="pcb-stackup-jlc-4l-16-7628"]').trigger('click')
    await flushPromises()
    // 切换 7628 后仍然自动反算出接近 100Ω 的线宽
    expect(wrapper.get('[data-testid="pcb-z-result"]').text()).toContain('100.0')
    expect(wrapper.get('[data-testid="pcb-recommendations"]').text()).toContain('常规平衡档')

    // 点击紧凑扇出档推荐卡片
    await wrapper.get('[data-testid="pcb-rec-compact"]').trigger('click')
    await flushPromises()
    expect(wrapper.get('[data-testid="pcb-z-result"]').text()).toContain('100.')

    // 切回 USB 2.0 HS 并切换到「差分包地 (diff-cpwg)」共面波导，仍保持 90Ω 目标且同时控制 S 与 S_gnd
    await wrapper.get('[data-testid="pcb-hs-preset-usb2-hs"]').trigger('click')
    await flushPromises()
    const lineModeButtons = wrapper
      .get('[data-testid="pcb-line-mode"]')
      .findAll('button[role="radio"]')
    const diffCpwgBtn = lineModeButtons.find((btn) => btn.text().includes('差分包地'))
    expect(diffCpwgBtn).toBeTruthy()
    await diffCpwgBtn!.trigger('click')
    await flushPromises()

    expect(wrapper.get('[data-testid="pcb-z-result"]').text()).toContain('90.0')
    expect(wrapper.find('[data-testid="pcb-input-s"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="pcb-input-sgnd"]').exists()).toBe(true)
    expect(wrapper.get('[data-testid="pcb-recommendations"]').text()).toContain('包地')
    expect(wrapper.get('[data-testid="pcb-hs-preset-usb2-hs"]').classes()).toContain('is-active')

    // 切换参考平面为 L3 (In2)：介质厚度 H 自动增大，截面图同步显示 L3 参考平面
    const refBelowSelect = wrapper.get('[data-testid="pcb-ref-below"] select')
    await refBelowSelect.setValue('2')
    await flushPromises()
    expect(wrapper.get('[data-testid="pcb-cross-section-svg"]').text()).toContain(
      'L3 (In2) 参考平面',
    )

    wrapper.unmount()
  })

  it('支持切换 mil / mm 主单位以及保存与删除个人预设', async () => {
    const wrapper = mount(PcbCalcView, { attachTo: document.body })
    await flushPromises()

    const unitButtons = wrapper
      .get('[data-testid="pcb-unit-toggle"]')
      .findAll('button[role="radio"]')
    await unitButtons[1]!.trigger('click')
    await flushPromises()
    expect(wrapper.get('[data-testid="pcb-recommendations"]').text()).toContain('mm')

    // 打开保存预设弹窗并保存
    const initialCount = userTracePresets.list.length
    await wrapper.get('[data-testid="pcb-save-preset-btn"]').trigger('click')
    await flushPromises()

    const nameInput = document.body.querySelector(
      '[data-testid="pcb-preset-name-input"]',
    ) as HTMLInputElement
    expect(nameInput).toBeTruthy()
    nameInput.value = '测试项目USB线'
    nameInput.dispatchEvent(new Event('input'))
    await flushPromises()

    const buttons = Array.from(document.body.querySelectorAll('button'))
    const saveConfirmBtn = buttons.find((btn) => btn.textContent?.includes('保存预设'))
    expect(saveConfirmBtn).toBeTruthy()
    saveConfirmBtn!.click()
    await flushPromises()

    expect(userTracePresets.list.length).toBe(initialCount + 1)
    const createdId = userTracePresets.list[0]!.id
    expect(wrapper.find(`[data-testid="pcb-user-preset-${createdId}"]`).exists()).toBe(true)

    // 删除该预设
    await wrapper.get(`button[aria-label="删除预设"]`).trigger('click')
    await flushPromises()
    expect(userTracePresets.list.length).toBe(initialCount)

    // 测试自定义接口与自定义层叠（含保存与删除个人层叠预设）
    await wrapper.get('[data-testid="pcb-hs-preset-custom"]').trigger('click')
    await flushPromises()
    expect(wrapper.get('[data-testid="pcb-hs-preset-custom"]').classes()).toContain('is-active')

    await wrapper.get('[data-testid="pcb-stackup-custom"]').trigger('click')
    await flushPromises()
    expect(wrapper.get('[data-testid="pcb-stackup-custom"]').classes()).toContain('is-active')
    expect(wrapper.find('[data-testid="pcb-input-mintrack"]').exists()).toBe(true)

    const initialStackupCount = userStackupPresets.list.length
    await wrapper.get('[data-testid="pcb-save-stackup-btn"]').trigger('click')
    await flushPromises()

    const stackupInput = document.body.querySelector(
      '[data-testid="pcb-stackup-name-input"]',
    ) as HTMLInputElement
    expect(stackupInput).toBeTruthy()
    stackupInput.value = '我的定制6层板'
    stackupInput.dispatchEvent(new Event('input'))
    await flushPromises()

    const saveStackupBtn = Array.from(document.body.querySelectorAll('button')).find((btn) =>
      btn.textContent?.includes('保存层叠'),
    )
    expect(saveStackupBtn).toBeTruthy()
    saveStackupBtn!.click()
    await flushPromises()

    expect(userStackupPresets.list.length).toBe(initialStackupCount + 1)
    const createdStackupId = userStackupPresets.list[0]!.id
    expect(wrapper.find(`[data-testid="pcb-user-stackup-${createdStackupId}"]`).exists()).toBe(true)

    await wrapper.get(`button[aria-label="删除层叠预设"]`).trigger('click')
    await flushPromises()
    expect(userStackupPresets.list.length).toBe(initialStackupCount)

    wrapper.unmount()
  })

  it('支持切换载流与压降模式和过孔参数模式', async () => {
    const wrapper = mount(PcbCalcView, { attachTo: document.body })
    await flushPromises()

    const modeRadios = wrapper.get('[data-testid="pcb-mode-tabs"]').findAll('button[role="radio"]')
    // 切到载流与压降
    await modeRadios[1]!.trigger('click')
    await flushPromises()
    expect(wrapper.find('[data-testid="pcb-current-result"]').exists()).toBe(true)
    await wrapper.get('[data-testid="pcb-rail-rail-24v-5a"]').trigger('click')
    await flushPromises()
    expect(wrapper.get('[data-testid="pcb-current-main-val"]').text()).toContain('mil')

    // 切到过孔参数
    await modeRadios[2]!.trigger('click')
    await flushPromises()
    expect(wrapper.find('[data-testid="pcb-via-result"]').exists()).toBe(true)
    expect(wrapper.get('[data-testid="pcb-via-count"]').text()).toContain('颗')
    await wrapper.get('[data-testid="pcb-via-preset-jlc-02-045"]').trigger('click')
    await flushPromises()
    const holeInput = wrapper.get('[data-testid="pcb-via-hole"] input').element as HTMLInputElement
    expect(holeInput.value).toBe('0.2')

    wrapper.unmount()
  })
})
