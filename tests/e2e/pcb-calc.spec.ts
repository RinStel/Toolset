/**
 * PCB 走线计算工具端到端验证。
 */

import { expect, test } from '@playwright/test'

test.describe('PCB 走线计算工具', () => {
  test('首页可发现入口并完整操作阻抗串扰、载流压降与过孔计算', async ({ page }) => {
    const pageErrors: string[] = []
    page.on('pageerror', (error) => {
      pageErrors.push(error.message)
    })

    await page.goto('/')
    const card = page.getByTestId('tool-card-pcb-calc')
    await expect(card).toBeVisible()
    await card.click()

    await expect(page).toHaveURL(/#\/tools\/pcb-calc/)
    await expect(page.getByTestId('pcb-calc-tool')).toBeVisible()

    // 打开工具时弹出嘉立创偏差参考警告弹窗并确认关闭
    await expect(
      page.getByText('该工具计算的结果可能与嘉立创官方有所偏差，一切以官方为准。'),
    ).toBeVisible()
    await page.getByRole('button', { name: '我知道了' }).click()

    await expect(page.getByTestId('pcb-z-result')).toContainText('90.0')
    await expect(page.getByTestId('pcb-cross-section-svg')).toBeVisible()

    // 一键调出千兆网口 MDI 并切换嘉立创 7628 层叠
    await page.getByTestId('pcb-hs-preset-eth-mdi').click()
    await expect(page.getByTestId('pcb-z-result')).toContainText('100.0')

    await page.getByTestId('pcb-stackup-jlc-4l-16-7628').click()
    await expect(page.getByTestId('pcb-z-result')).toContainText('100.0')

    // 切换单位为 mm
    await page
      .getByTestId('pcb-unit-toggle')
      .getByRole('radio', { name: 'mm', exact: true })
      .click()
    await expect(page.getByTestId('pcb-recommendations')).toContainText('mm')

    // 切换到载流与压降
    await page
      .getByTestId('pcb-mode-tabs')
      .getByRole('radio', { name: '载流与压降', exact: true })
      .click()
    await expect(page.getByTestId('pcb-current-result')).toBeVisible()
    await page.getByTestId('pcb-rail-rail-24v-5a').click()
    await expect(page.getByTestId('pcb-current-main-val')).toContainText('mm')

    // 切换到过孔参数
    await page
      .getByTestId('pcb-mode-tabs')
      .getByRole('radio', { name: '过孔参数', exact: true })
      .click()
    await expect(page.getByTestId('pcb-via-result')).toBeVisible()
    await expect(page.getByTestId('pcb-via-count')).toContainText('颗')

    expect(pageErrors).toEqual([])
  })

  test('移动端窄屏视口下交互按钮清晰、无横向溢出且支持自定义层叠', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 })
    await page.goto('/#/tools/pcb-calc')
    await expect(page.getByTestId('pcb-calc-tool')).toBeVisible()
    await page.getByRole('button', { name: '我知道了' }).click()

    // 验证大尺寸模式按钮（≥ 36px）与无横向溢出
    const btnBox = await page
      .getByTestId('pcb-line-mode')
      .getByRole('radio', { name: '差分包地', exact: true })
      .boundingBox()
    expect(btnBox?.height).toBeGreaterThanOrEqual(36)

    const hasOverflow = await page.evaluate(
      () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
    )
    expect(hasOverflow).toBe(false)

    // 点击「差分包地」和「自定义层叠」
    await page
      .getByTestId('pcb-line-mode')
      .getByRole('radio', { name: '差分包地', exact: true })
      .click()
    await expect(page.getByTestId('pcb-z-result')).toContainText('90.0')

    await page.getByTestId('pcb-stackup-custom').click()
    await expect(page.getByTestId('pcb-input-mintrack')).toBeVisible()
  })
})
