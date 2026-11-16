/**
 * 仪表盘数据与控件 e2e（plan.md §11.4 用例 17、18、23）。
 *
 * 覆盖控件发送（text / hex 模板、节流、越界）、计算变量与反馈变量，以及终端 +
 * 仪表盘分屏时 1kHz 数据下的日志自动抽样与不丢帧。
 */

import { expect, test, type Locator, type Page } from '@playwright/test'

import {
  KV_TEXT_PROTOCOL_ID,
  JUSTFLOAT_PROTOCOL_ID,
  addComputedVariable,
  addDemoSerialSession,
  addFakePort,
  addFakeSerialSession,
  bindDashboardSource,
  clickDashboardMoreAction,
  connectFocusedSession,
  createBlankDashboard,
  ensureWideViewport,
  dashboardButton,
  dashboardMode,
  focusEmptyPane,
  closeSettingsDrawer,
  fillSettingNumber,
  focusedSessionState,
  forceDashboardRefresh,
  generateDashboard,
  openDashboardPane,
  openPropertyTab,
  openSettingsDrawer,
  openSerialTool,
  pane,
  panes,
  propCommandPreview,
  propVariableBoundKey,
  readDownloadedFile,
  readLogPolicyLabel,
  selectProtocol,
  selectSessionTab,
  selectWidget,
  selectPropOptionContaining,
  setDashboardMode,
  setPropCommandTemplate,
  setPropCheckbox,
  setPropNumber,
  setPropVariable,
  setupDashboardWithVariables,
  systemLogRows,
  variableDisplayValue,
  variableItem,
  waitForChartData,
  waitForProtocolActive,
  waitForToast,
  widgetDataNumber,
  widgetDisplayNumber,
  widgetsByType,
} from './helpers'

/** 从组件库点击添加一个组件（点击会放在第一个空位）。 */
async function addWidgetFromLibrary(page: Page, type: string, paneIndex = 0): Promise<void> {
  const item = pane(page, paneIndex).getByTestId(`library-item-${type}`)
  await expect(item).toBeVisible({ timeout: 15_000 })
  await item.click()
  await expect
    .poll(async () => widgetsByType(page, type, paneIndex).count(), { timeout: 10_000 })
    .toBeGreaterThan(0)
}

/** 读取组件内部的开关状态（兼容 aria-checked / checkbox / class / 文案）。 */
async function readSwitchState(widget: Locator): Promise<boolean> {
  return widget.evaluate((element) => {
    const aria = element.getAttribute('aria-checked')
    if (aria !== null) return aria === 'true'
    const input = element.querySelector<HTMLInputElement>('input[type="checkbox"]')
    if (input !== null) return input.checked
    const toggle = element.querySelector<HTMLElement>('[role="switch"], [aria-checked]')
    if (toggle !== null) {
      const toggleAria = toggle.getAttribute('aria-checked')
      if (toggleAria !== null) return toggleAria === 'true'
      const state = toggle.getAttribute('data-state')
      if (state !== null) return state === 'on' || state === 'checked'
    }
    const onElement = element.querySelector('.is-on, .is-checked, [data-checked="true"]')
    const offElement = element.querySelector('.is-off, [data-checked="false"]')
    if (onElement !== null) return true
    if (offElement !== null) return false
    const text = (element.textContent ?? '').trim()
    return text.includes('开') && !text.includes('关')
  })
}

/** 在运行模式下拖动滑块（优先 input[type=range]，否则按组件坐标拖动）。 */
async function dragControlSlider(
  page: Page,
  widget: Locator,
): Promise<{ elapsedMs: number; steps: number }> {
  const range = widget.locator('input[type="range"]').first()
  const slider = (await range.count()) > 0 ? range : widget
  const box = await slider.boundingBox()
  if (box === null) throw new Error('滑块不可见')
  const y = box.y + box.height / 2
  const startX = box.x + box.width * 0.2
  const endX = box.x + box.width * 0.8
  const startedAt = Date.now()
  await page.mouse.move(startX, y)
  await page.mouse.down()
  const steps = 10
  for (let index = 1; index <= steps; index += 1) {
    await page.mouse.move(startX + ((endX - startX) * index) / steps, y)
    await page.waitForTimeout(20)
  }
  await page.mouse.up()
  return { elapsedMs: Date.now() - startedAt, steps }
}

test.describe('仪表盘数据与控件', () => {
  test('用例 17：滑块 text 模板节流发送与按钮 hex 模板、越界提示', async ({ page }) => {
    await ensureWideViewport(page)
    await openSerialTool(page)
    const portIndex = await addFakePort(page)
    const sessionId = await addFakeSerialSession(page, { portIndex })
    await selectProtocol(page, KV_TEXT_PROTOCOL_ID)
    await waitForProtocolActive(page)

    await openDashboardPane(page)
    const dashboardName = await createBlankDashboard(page, 'e2e 控件仪表盘')
    expect(dashboardName).toBeTruthy()
    await bindDashboardSource(page, 'main', sessionId)

    /* -------- 滑块：text 模板 amp={value:.1f}，LF，节流 100ms -------- */
    await addWidgetFromLibrary(page, 'ctrl.slider')
    const sliderWidget = widgetsByType(page, 'ctrl.slider').first()
    await selectWidget(page, sliderWidget)
    await openPropertyTab(page, 'behavior')
    await setPropCommandTemplate(page, 'command', {
      mode: 'text',
      template: 'amp={value:.1f}',
      eol: 'lf',
      source: 'main',
    })
    await selectPropOptionContaining(page, 'sendMode', '节流')
    await setPropNumber(page, 'throttleMs', 100)

    await setDashboardMode(page, 'run')
    expect(await dashboardMode(page)).toBe('run')
    const drag = await dragControlSlider(page, sliderWidget)

    await expect
      .poll(
        async () =>
          (await page.evaluate((index) => window.__fakeSerial.written(index), portIndex)).length,
        {
          timeout: 10_000,
        },
      )
      .toBeGreaterThan(0)
    const sliderWrites = await page.evaluate(
      (index) => window.__fakeSerial.written(index),
      portIndex,
    )
    const sliderTexts = sliderWrites.map((chunk) => Buffer.from(chunk).toString('utf8'))
    // 每次写入都以 amp= 开头并以 LF 结尾，且拖动期间被 100ms 节流限制次数。
    for (const text of sliderTexts) expect(text).toMatch(/^amp=-?\d+(\.\d+)?\n$/)
    expect(sliderTexts.length).toBeGreaterThanOrEqual(1)
    // 节流 100ms：写入次数不超过「拖动时长 / 100ms + 松开时的一次」。
    expect(sliderTexts.length).toBeLessThanOrEqual(Math.ceil(drag.elapsedMs / 100) + 2)
    expect(sliderTexts.length).toBeLessThan(drag.steps + 1)

    /* -------- 按钮：hex 模板 AA {value:u16le} 55，value 300 -------- */
    await setDashboardMode(page, 'edit')
    await addWidgetFromLibrary(page, 'ctrl.button')
    const buttonWidget = widgetsByType(page, 'ctrl.button').first()
    await selectWidget(page, buttonWidget)
    await openPropertyTab(page, 'behavior')
    await setPropCommandTemplate(page, 'command', {
      mode: 'hex',
      template: 'AA {value:u16le} 55',
      eol: 'none',
      source: 'main',
    })
    await setPropNumber(page, 'value', 300)
    expect(await propCommandPreview(page, 'command')).toContain('AA')

    const beforeButtonWrites = (
      await page.evaluate((index) => window.__fakeSerial.written(index), portIndex)
    ).length
    const beforeButtonSent = await widgetDataNumber(buttonWidget, 'data-sent-count')
    await setDashboardMode(page, 'run')
    await buttonWidget.locator('button').first().click()
    await expect
      .poll(async () => widgetDataNumber(buttonWidget, 'data-sent-count'), { timeout: 10_000 })
      .toBe(beforeButtonSent + 1)
    const afterButton = await page.evaluate(
      (index) => window.__fakeSerial.written(index),
      portIndex,
    )
    const expectedHex = Buffer.from([0xaa, 0x2c, 0x01, 0x55])
    expect(
      afterButton.slice(beforeButtonWrites).some((chunk) => Buffer.from(chunk).equals(expectedHex)),
    ).toBe(true)

    /* -------- value 改为 70000：越界提示且没有写入 -------- */
    await setDashboardMode(page, 'edit')
    await selectWidget(page, buttonWidget)
    await openPropertyTab(page, 'behavior')
    await setPropNumber(page, 'value', 70000)
    await setDashboardMode(page, 'run')
    const beforeInvalidSent = await widgetDataNumber(buttonWidget, 'data-sent-count')
    const beforeInvalid = (
      await page.evaluate((index) => window.__fakeSerial.written(index), portIndex)
    ).length
    await buttonWidget.locator('button').first().click()
    await waitForToast(page, /超出 u16le 范围/)
    expect(await widgetDataNumber(buttonWidget, 'data-sent-count')).toBe(beforeInvalidSent)
    const afterInvalid = await page.evaluate(
      (index) => window.__fakeSerial.written(index),
      portIndex,
    )
    expect(afterInvalid.length).toBe(beforeInvalid)
  })

  test('用例 18：计算变量 ch0_sq 与开关 feedbackVar 随方波翻转', async ({ page }) => {
    await setupDashboardWithVariables(page, {
      format: 'kv-text',
      interval: 10,
      protocolId: KV_TEXT_PROTOCOL_ID,
      generate: false,
      dashboardName: 'e2e 计算变量仪表盘',
    })

    // 计算变量 ch0_sq = ch0²，值应落在 0–1 之间。
    await addComputedVariable(page, { key: 'ch0_sq', expr: 'v.ch0 * v.ch0' })
    await expect(variableItem(page, 'fx.ch0_sq')).toBeVisible({ timeout: 15_000 })
    await expect
      .poll(
        async () => {
          const value = Number(await variableDisplayValue(page, 'fx.ch0_sq'))
          return Number.isFinite(value) && value >= 0 && value <= 1 + 1e-6
        },
        { timeout: 15_000 },
      )
      .toBe(true)

    // 开关反馈变量绑定 ch2（方波），状态应随数据翻转。
    await addWidgetFromLibrary(page, 'ctrl.switch')
    const switchWidget = widgetsByType(page, 'ctrl.switch').first()
    await selectWidget(page, switchWidget)
    await openPropertyTab(page, 'behavior')
    await setPropVariable(page, 'feedbackVar', 'ch2')
    await expect.poll(async () => propVariableBoundKey(page, 'feedbackVar')).toBe('ch2')
    await setDashboardMode(page, 'run')

    const seen = new Set<boolean>()
    await expect
      .poll(
        async () => {
          seen.add(await readSwitchState(switchWidget))
          return seen.size
        },
        { timeout: 20_000, intervals: [50, 100, 200] },
      )
      .toBe(2)
  })

  test('用例 23：终端与仪表盘分屏共用会话，日志自动抽样且 ch7 无丢帧', async ({ page }) => {
    // 分屏后每个 Pane 约半宽；放大视口避免仪表盘进入「窄窗格只读布局」。
    await page.setViewportSize({ width: 1920, height: 1080 })
    await openSerialTool(page)
    // 高吞吐下限制日志条数，避免日志列表渲染拖慢解码速率统计。
    await openSettingsDrawer(page)
    await fillSettingNumber(page, 'maxLogEntries', 1000)
    await closeSettingsDrawer(page)
    const sessionId = await addDemoSerialSession(page, {
      format: 'justfloat',
      interval: 3,
      channels: 8,
      connect: false,
    })

    // 先把分屏与仪表盘准备好，再连接设备，确保 series 从第一帧开始记录。
    await page.getByTestId('split-toggle').click()
    await expect(panes(page)).toHaveCount(2)
    await focusEmptyPane(page, 1)
    await selectSessionTab(page, sessionId)
    await openDashboardPane(page, 1)
    await createBlankDashboard(page, 'e2e 分屏仪表盘', 1)
    await bindDashboardSource(page, 'main', sessionId, 1)

    // 先在未连接状态装载协议运行时，再连接设备，确保第一帧起就能被解码进 series。
    // 暂停日志显示，让自动抽样不被日志列表渲染阻塞；抽样完成后再恢复。
    await page.evaluate(() => {
      document.querySelector<HTMLElement>('.session-pane [data-testid="log-pause"]')?.click()
    })
    await selectProtocol(page, JUSTFLOAT_PROTOCOL_ID)
    await connectFocusedSession(page)
    await waitForProtocolActive(page)
    await expect
      .poll(async () => readLogPolicyLabel(page, 0), { timeout: 30_000 })
      .toContain('抽样')
    await page.evaluate(() => {
      document.querySelector<HTMLElement>('.session-pane [data-testid="log-pause"]')?.click()
    })

    // 抽样切换的系统日志：用搜索从日志缓冲区定位（不受日志尾部渲染数量影响）。
    const search = pane(page, 0).getByTestId('log-search')
    await search.fill('日志已切换为抽样记录')
    const sampledRow = pane(page, 0)
      .locator('[data-testid="log-row"], [data-testid="log-row-decoded"]')
      .filter({ hasText: '日志已切换为抽样记录' })
      .first()
    await expect(sampledRow).toBeVisible({ timeout: 15_000 })
    await search.fill('')

    // 右 Pane 的一键仪表盘（数据源已在连接前绑定）。
    await expect(variableItem(page, 'ch0', 1)).toBeVisible({ timeout: 20_000 })
    await generateDashboard(page, 1)
    await waitForChartData(page, 1)

    // 变量表打开「样本数」列，用于直接核对 ch7 的 count。
    await addWidgetFromLibrary(page, 'value.table', 1)
    const table = widgetsByType(page, 'value.table', 1).first()
    await selectWidget(page, table, 1)
    await openPropertyTab(page, 'style', 1)
    await setPropCheckbox(page, 'colCount', true, 1)

    // 再观察一段时间，让 series 记录足够多的帧。
    const ch7Row = table
      .locator('[data-testid="value-table-row"]')
      .filter({ hasText: 'ch7' })
      .first()
    await expect(ch7Row).toBeVisible({ timeout: 10_000 })
    const ch7CountCell = ch7Row.locator('td').last()
    const countBefore = Number(await ch7CountCell.innerText())
    await expect
      .poll(async () => Number(await ch7CountCell.innerText()), { timeout: 15_000 })
      .toBeGreaterThan(countBefore + 100)

    // 断开以冻结数据，然后断言 ch7 的样本数与最新值一致（无丢帧）。
    await page.getByTestId('session-disconnect').click()
    await expect(focusedSessionState(page)).not.toHaveText('已连接', { timeout: 15_000 })
    // 断开是异步的：先等 series 的样本数稳定，再强制刷新读取最终值。
    let previousCount = -1
    await expect
      .poll(
        async () => {
          const current = Number(await ch7CountCell.innerText())
          const stable = current === previousCount
          previousCount = current
          return stable
        },
        { timeout: 10_000, intervals: [300] },
      )
      .toBe(true)
    await forceDashboardRefresh(page, 1)
    // 强制刷新后等 Vue 把组件与变量表渲染到同一帧，再读取最终值。
    await page.waitForTimeout(250)
    const ch7 = widgetsByType(page, 'value.number', 1).filter({ hasText: 'ch7' }).first()
    await expect(ch7).toBeVisible({ timeout: 10_000 })
    const sampleCount = Number(await ch7CountCell.innerText())
    // 仪表盘「导出数据 CSV」直接读取 series，作为无丢帧的权威数据源。
    const downloadPromise = page.waitForEvent('download')
    await clickDashboardMoreAction(page, 'export-csv', 1)
    await expect(page.getByTestId('dashboard-data-export-dialog')).toBeVisible()
    await page.getByTestId('dashboard-data-export-confirm').click()
    const csvFile = await readDownloadedFile(await downloadPromise)
    const lines = csvFile.text
      .replace(/^\uFEFF/, '')
      .split(/\r?\n/)
      .filter((line) => line.trim() !== '')
    const header = (lines[0] ?? '').split(',')
    const ch7Column = header.indexOf('ch7')
    expect(ch7Column).toBeGreaterThanOrEqual(0)
    const values = lines.slice(1).map((line) => Number(line.split(',')[ch7Column]))
    expect(values.every((value) => Number.isFinite(value))).toBe(true)
    const sampleRows = lines.length - 1
    const lastValue = Math.max(...values)
    // 无丢帧：CSV 行数 = ch7（演示设备样本序号）的最新值 + 1；变量表的 count 也应一致。
    expect(sampleRows).toBe(lastValue + 1)
    expect(sampleCount).toBe(sampleRows)
  })
})
