/**
 * 仪表盘核心 e2e（plan.md §11.4 用例 14、15、16）。
 *
 * 这些用例需要仪表盘 UI（Pane 视图切换、一键生成、组件库、变量列表、属性面板、
 * GridCanvas 拖拽与撤销/重做），以及 JustFloat 演示端口数据。
 */

import { expect, test, type Page } from '@playwright/test'

import {
  addDemoSerialSession,
  addPropZone,
  bindDashboardSource,
  dashboardMode,
  dashboardRedo,
  dashboardUndo,
  dragLibraryItemToCanvas,
  dragVariableToCanvas,
  dragVariableToWidget,
  expectWidgetBoxClose,
  expectWidgetsDoNotOverlap,
  findWidgetByVariable,
  JUSTFLOAT_PROTOCOL_ID,
  moveWidget,
  openDashboardPane,
  openPropertyTab,
  propField,
  propVariableBoundKey,
  propVariableRowCount,
  resizeWidget,
  selectDashboardByName,
  selectWidget,
  setDashboardMode,
  setPropNumber,
  selectProtocol,
  setPropVariable,
  setupDashboardWithVariables,
  setupGeneratedDashboard,
  waitForChartData,
  variableItem,
  waitForDashboardSaved,
  widgetBox,
  widgetBoxes,
  widgetCards,
  widgetDataNumber,
  widgetDisplayNumber,
  widgetId,
  widgetsByType,
} from './helpers'

/** 用例 14–16 的仪表盘名称。 */
const DASHBOARD_NAME = 'e2e 核心仪表盘'

/** 读取一个 number 属性的输入值。 */
async function propInputValue(page: Page, key: string): Promise<string> {
  const input = propField(page, key).locator('input').first()
  return input.inputValue()
}

test.describe('仪表盘核心', () => {
  test('用例 14：一键仪表盘生成 1 个波形图与 8 个数值组件并持续刷新', async ({ page }) => {
    await setupGeneratedDashboard(page, {
      format: 'justfloat',
      interval: 10,
      channels: 8,
      dashboardName: DASHBOARD_NAME,
    })

    // 生成 1 个波形图和 8 个数值组件。
    await expect(widgetsByType(page, 'chart.line')).toHaveCount(1)
    await expect(widgetsByType(page, 'value.number')).toHaveCount(8)

    // 1 秒后波形图已经拿到数据点。
    await waitForChartData(page)
    const chartRoot = widgetsByType(page, 'chart.line').first()
    expect(Number.isFinite(await widgetDataNumber(chartRoot, 'data-point-count'))).toBe(true)

    // ch7 是演示设备递增的样本序号：数值组件的显示值应持续增加。
    const ch7 = await findWidgetByVariable(page, 'value.number', 'variable', 'ch7')
    const first = await widgetDisplayNumber(ch7)
    expect(Number.isFinite(first)).toBe(true)
    await expect
      .poll(async () => widgetDisplayNumber(ch7), { timeout: 15_000 })
      .toBeGreaterThan(first)
  })

  test('用例 15：编辑模式拖入仪表、绑定属性、拖动缩放、撤销重做与刷新持久化', async ({ page }) => {
    const setup = await setupGeneratedDashboard(page, {
      format: 'justfloat',
      interval: 10,
      channels: 8,
      dashboardName: DASHBOARD_NAME,
    })
    await setDashboardMode(page, 'edit')
    expect(await dashboardMode(page)).toBe('edit')

    // 从组件库拖入「仪表」。
    await dragLibraryItemToCanvas(page, 'value.gauge', { xRatio: 0.62, yRatio: 0.55 })
    const gauge = widgetsByType(page, 'value.gauge').first()
    await expect(gauge).toBeVisible({ timeout: 10_000 })

    // 属性面板：绑定 ch6，min 20、max 30，再加一个区间颜色。
    await selectWidget(page, gauge)
    await openPropertyTab(page, 'data')
    await setPropVariable(page, 'variable', 'ch6')
    await setPropNumber(page, 'min', 20)
    await setPropNumber(page, 'max', 30)
    await expect.poll(async () => propInputValue(page, 'min')).toBe('20')
    await expect.poll(async () => propInputValue(page, 'max')).toBe('30')

    await openPropertyTab(page, 'style')
    await addPropZone(page, 'zones', { from: 20, to: 30, color: '#ff7a00' })
    const zoneColor = propField(page, 'zones')
      .getByTestId('prop-zones-color-zones-0')
      .locator('input.ui-color-input__text')
    await expect.poll(async () => zoneColor.inputValue()).toBe('#ff7a00')

    const gaugeId = await widgetId(gauge)
    const originalBox = await widgetBox(gauge)
    const beforeMove = await widgetBoxes(page)

    // 拖动组件到另一个组件上：其他组件被推开，且没有任何重叠。
    const otherWidget = widgetsByType(page, 'value.number').first()
    const otherBox = await widgetBox(otherWidget)
    await moveWidget(page, gauge, {
      dx: otherBox.x + otherBox.width / 2 - (originalBox.x + originalBox.width / 2),
      dy: otherBox.y + otherBox.height / 2 - (originalBox.y + originalBox.height / 2),
    })
    await expectWidgetsDoNotOverlap(page)
    const afterMove = await widgetBoxes(page)
    const pushed = Object.keys(beforeMove).filter((id) => {
      if (id === gaugeId) return false
      const before = beforeMove[id]
      const after = afterMove[id]
      return before !== undefined && after !== undefined && after.y > before.y + 1
    })
    expect(pushed.length).toBeGreaterThan(0)

    // 缩放后仍然没有重叠。
    await resizeWidget(page, gaugeId, { dx: 70, dy: 50 })
    await expectWidgetsDoNotOverlap(page)
    const afterResizeBox = await widgetBox(gauge)

    // 撤销 2 次（缩放 + 拖动）恢复原位置，再重做 2 次回到缩放后的位置。
    await dashboardUndo(page, 2)
    await expectWidgetBoxClose(page, gauge, originalBox)
    await dashboardRedo(page, 2)
    await expectWidgetBoxClose(page, gauge, afterResizeBox)

    // 刷新后仪表盘与组件属性都被保留（先等防抖保存完成）。
    await waitForDashboardSaved(page)
    await page.reload()
    await expect(page.getByTestId('serial-tool')).toBeVisible({ timeout: 15_000 })
    await openDashboardPane(page)
    await selectDashboardByName(page, setup.dashboardName)
    await setDashboardMode(page, 'edit')
    // 刷新后会话不保留，重新建一个演示端口让数据源自动匹配，变量下拉才能显示 ch6。
    const restoredSession = await addDemoSerialSession(page, {
      format: 'justfloat',
      interval: 10,
      channels: 8,
    })
    await selectProtocol(page, JUSTFLOAT_PROTOCOL_ID)
    await bindDashboardSource(page, 'main', restoredSession)
    await expect(variableItem(page, 'ch6')).toBeVisible({ timeout: 20_000 })
    const restoredGauge = widgetsByType(page, 'value.gauge').first()
    await expect(restoredGauge).toBeVisible({ timeout: 15_000 })
    await selectWidget(page, restoredGauge)
    await openPropertyTab(page, 'data')
    await expect.poll(async () => propInputValue(page, 'min')).toBe('20')
    await expect.poll(async () => propInputValue(page, 'max')).toBe('30')
    await expect.poll(async () => propVariableBoundKey(page, 'variable')).toBe('ch6')
    await openPropertyTab(page, 'style')
    await expect
      .poll(async () =>
        propField(page, 'zones')
          .getByTestId('prop-zones-color-zones-0')
          .locator('input.ui-color-input__text')
          .inputValue(),
      )
      .toBe('#ff7a00')
  })

  test('用例 16：变量拖放到空白处新建波形图，再把第二个变量拖到波形图上', async ({ page }) => {
    await setupDashboardWithVariables(page, {
      format: 'justfloat',
      interval: 10,
      channels: 8,
      dashboardName: DASHBOARD_NAME,
      generate: false,
    })
    await setDashboardMode(page, 'edit')
    await expect(widgetCards(page)).toHaveCount(0)

    // 从变量列表把 ch0 拖到空白处：新建波形图并绑定该变量。
    await dragVariableToCanvas(page, 'ch0', { xRatio: 0.55, yRatio: 0.3 })
    const chart = widgetsByType(page, 'chart.line').first()
    await expect(chart).toBeVisible({ timeout: 10_000 })
    await selectWidget(page, chart)
    await openPropertyTab(page, 'data')
    await expect.poll(async () => propVariableRowCount(page, 'variables')).toBe(1)

    // 再把 ch1 拖到这个波形图上：它绑定 2 个变量。
    await dragVariableToWidget(page, 'ch1', chart)
    await selectWidget(page, chart)
    await openPropertyTab(page, 'data')
    await expect.poll(async () => propVariableRowCount(page, 'variables')).toBe(2)

    // 波形图拿到数据（顺带验证拖放后的绑定确实生效）。
    await waitForChartData(page)
  })
})
