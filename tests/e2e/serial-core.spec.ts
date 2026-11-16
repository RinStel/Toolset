/**
 * 串口助手核心 e2e（plan.md §11.4 用例 1、2、3、12、13）。
 *
 * 这些用例只依赖阶段 2 已完成的界面：通道侧栏、会话标签、日志、手动发送、
 * 设置抽屉与外壳路由。
 */

import { expect, test } from '@playwright/test'

import {
  DEFAULT_FAKE_PORT_INFO,
  DEFAULT_FAKE_PROTOCOL_INFO,
  addDemoSession,
  addFakePort,
  addFakeSerialSession,
  appearanceFontSizeInput,
  computedStyleProperty,
  emitRx,
  fakeWritten,
  fillSendInput,
  fillSettingColor,
  fillSettingNumber,
  focusEmptyPane,
  gotoSerialDirect,
  logRowTexts,
  openSerialTool,
  openSettingsDrawer,
  pane,
  panes,
  rawLogRows,
  readSerialColorVariable,
  selectSessionTab,
  sendHex,
  sendText,
  sessionTab,
  settingField,
  waitForLogText,
  waitForWriteCount,
} from './helpers'

test.describe('串口助手核心流程', () => {
  test('用例 1：新增串口、发送文本/HEX、接收数据与日志开关', async ({ page }) => {
    // 首页 → 串口助手。
    await openSerialTool(page)
    await expect(page).toHaveTitle('串口上位机 · Toolset')

    const portIndex = await addFakePort(page, DEFAULT_FAKE_PORT_INFO)
    const sessionId = await addFakeSerialSession(page, { portIndex })
    await expect(sessionTab(page, sessionId)).toBeVisible()

    // 发送文本：写到假串口的字节与 UTF-8 编码一致。
    await sendText(page, 'hello')
    const afterText = await waitForWriteCount(page, portIndex, 1)
    expect(afterText[0]).toEqual([104, 101, 108, 108, 111])

    // 发送 HEX：切换模式后输入 `A1 02 FF`。
    await sendHex(page, 'A1 02 FF')
    const afterHex = await waitForWriteCount(page, portIndex, 2)
    expect(afterHex[1]).toEqual([0xa1, 0x02, 0xff])

    // TX 记录出现（文本 + HEX 各一条）。
    await expect(rawLogRows(page, 'tx')).toHaveCount(2)
    await expect(rawLogRows(page, 'tx').filter({ hasText: 'hello' })).toHaveCount(1)

    // 注入 RX 数据（line 分帧在 20ms 空闲后成帧）。
    await emitRx(page, portIndex, [0x48, 0x69]) // "Hi"
    await waitForLogText(page, 'Hi')
    await expect(rawLogRows(page, 'rx').filter({ hasText: 'Hi' })).toHaveCount(1)

    // 时间戳开关：关闭后日志行不再渲染时间戳。
    await expect(pane(page).locator('.log-list__timestamp').first()).toBeVisible()
    await pane(page).getByTestId('toggle-timestamp').getByRole('switch').click()
    await expect(pane(page).locator('.log-list__timestamp')).toHaveCount(0)

    // TX 开关：关闭后 TX 行消失，RX 行保留。
    await expect(rawLogRows(page, 'tx')).toHaveCount(2)
    await pane(page).getByTestId('toggle-tx').getByRole('switch').click()
    await expect(rawLogRows(page, 'tx')).toHaveCount(0)
    await expect(rawLogRows(page, 'rx')).toHaveCount(1)
    expect(await logRowTexts(page)).toHaveLength(1)
  })

  test('用例 2：外观字号、日志颜色、日志上限刷新后保留', async ({ page }) => {
    await openSerialTool(page)
    await openSettingsDrawer(page)

    // 外观字号（外壳设置）。
    await appearanceFontSizeInput(page).fill('16')
    await appearanceFontSizeInput(page).press('Enter')

    // 日志颜色（串口工具设置，落在工具根元素的 CSS 变量上）。
    await fillSettingColor(page, 'colorRx', '#ff0000')
    await fillSettingNumber(page, 'maxLogEntries', 2000)

    await expect
      .poll(async () => readSerialColorVariable(page, '--log-rx'), { timeout: 5000 })
      .toBe('#ff0000')
    await expect
      .poll(async () => computedStyleProperty(page, 'html', '--font-size'), { timeout: 5000 })
      .toBe('16px')

    // 刷新页面后设置仍在（外观 + 工具设置都由 localStorage 持久化）。
    await page.reload()
    await expect(page.getByTestId('serial-tool')).toBeVisible()
    await openSettingsDrawer(page)

    await expect(appearanceFontSizeInput(page)).toHaveValue('16')
    await expect(settingField(page, 'colorRx').locator('input.ui-color-input__text')).toHaveValue(
      '#ff0000',
    )
    await expect(settingField(page, 'maxLogEntries').locator('input').first()).toHaveValue('2000')
    await expect
      .poll(async () => computedStyleProperty(page, 'html', '--font-size'), { timeout: 5000 })
      .toBe('16px')

    // 关闭抽屉后工具根元素仍应用了自定义颜色。
    await page.keyboard.press('Escape')
    await expect(page.getByTestId('settings-drawer')).toHaveCount(0)
    await expect
      .poll(async () => readSerialColorVariable(page, '--log-rx'), { timeout: 5000 })
      .toBe('#ff0000')
  })

  test('用例 3：两个会话未读数与分屏独立发送', async ({ page }) => {
    await openSerialTool(page)

    const portA = await addFakePort(page, DEFAULT_FAKE_PORT_INFO)
    const sessionA = await addFakeSerialSession(page, { portIndex: portA })
    const portB = await addFakePort(page, DEFAULT_FAKE_PROTOCOL_INFO)
    const sessionB = await addFakeSerialSession(page, { portIndex: portB })
    expect(sessionA).not.toBe(sessionB)

    // 当前 Pane 显示 B（新会话绑定到焦点 Pane），A 在后台：注入数据后未读数增加。
    await emitRx(page, portA, [0x41])
    const unreadBadge = sessionTab(page, sessionA).locator('.serial-tabs__unread')
    await expect(unreadBadge).toBeVisible({ timeout: 10_000 })
    expect(Number((await unreadBadge.innerText()).trim())).toBeGreaterThan(0)

    // 开启分屏：两个 Pane 各自绑定一个会话。
    await page.getByTestId('split-toggle').click()
    await expect(panes(page)).toHaveCount(2)

    // Pane 0 → A，Pane 1 → B。
    await selectSessionTab(page, sessionA)
    await focusEmptyPane(page, 1)
    await selectSessionTab(page, sessionB)
    await expect(pane(page, 0).getByTestId('send-input')).toBeVisible()
    await expect(pane(page, 1).getByTestId('send-input')).toBeVisible()

    // 两个窗格分别发送，写入各自端口。
    await sendText(page, 'to-a', 0)
    await waitForWriteCount(page, portA, 1)
    await sendText(page, 'to-b', 1)
    await waitForWriteCount(page, portB, 1)

    expect((await fakeWritten(page, portA))[0]).toEqual([116, 111, 45, 97])
    expect((await fakeWritten(page, portB))[0]).toEqual([116, 111, 45, 98])
    // A 的未读在显示后清零。
    await expect(sessionTab(page, sessionA).locator('.serial-tabs__unread')).toHaveCount(0)
  })

  test('用例 12：会话/草稿/分屏在返回首页后保留，直接路由与 404 可用', async ({ page }) => {
    await openSerialTool(page)
    const sessionId = await addDemoSession(page, { connect: true })

    await fillSendInput(page, '草稿内容')
    await page.getByTestId('split-toggle').click()
    await expect(panes(page)).toHaveCount(2)
    await expect(page.getByTestId('split-toggle')).toHaveClass(/is-active/)

    // 返回首页再回来：keepAlive 保留组件，会话 store 保留会话。
    await page.locator('.app-header__brand').click()
    await expect(page.getByTestId('tool-card-serial')).toBeVisible()
    await page.getByTestId('tool-card-serial').click()
    await expect(page.getByTestId('serial-tool')).toBeVisible()

    await expect(sessionTab(page, sessionId)).toBeVisible()
    await expect(page.getByTestId('send-input').first()).toHaveValue('草稿内容')
    await expect(panes(page)).toHaveCount(2)
    await expect(page.getByTestId('split-toggle')).toHaveClass(/is-active/)

    // 直接访问 #/tools/serial 可用（整页加载，会话不跨页面保留）。
    await gotoSerialDirect(page)
    await expect(page.getByText('还没有打开的通道').first()).toBeVisible()
    await expect(page).toHaveTitle('串口上位机 · Toolset')

    // 未知路由显示 404。
    await page.goto('/#/nope')
    await expect(page.getByTestId('not-found')).toBeVisible()
    await expect(page.getByRole('heading', { name: '页面不存在' })).toBeVisible()
  })
})
