/**
 * 浏览器支持状态与打开失败文案（plan.md §11.4 用例 10、第 9 节）。
 */

import { expect, test } from '@playwright/test'

import {
  addDemoSession,
  addFakePort,
  addFakeSerialSession,
  connectFocusedSession,
  DEFAULT_FAKE_PORT_INFO,
  failNextOpen,
  fillSettingNumber,
  openSerialTool,
  rawLogRows,
  removeFakeSerial,
} from './helpers'

test.describe('支持状态', () => {
  test('用例 10：remove 后刷新显示不支持提示，演示端口仍可连接并收到上报帧', async ({ page }) => {
    await openSerialTool(page)

    // 删除 navigator.serial 并刷新：假串口安装脚本看到 localStorage 标记后跳过注入。
    await removeFakeSerial(page)
    await page.reload()
    await expect(page.getByTestId('serial-tool')).toBeVisible()

    const unsupportedText =
      '当前浏览器不支持 Web Serial。请使用 Chrome、Edge 89+ 或 Firefox 151+ 桌面版。演示端口仍可使用。'
    await expect(page.getByText(unsupportedText, { exact: true }).first()).toBeVisible({
      timeout: 10_000,
    })
    await expect(page.getByTestId('add-provider-web-serial')).toBeDisabled()
    // 不支持串口时仍然没有已授权的假端口。
    expect(await page.locator('[data-testid^="session-tab-"]').count()).toBe(0)

    // 演示端口不受支持状态影响：缩短上报间隔后连接，收到上报帧。
    const sessionId = await addDemoSession(page, { connect: false })
    await expect(page.getByTestId('setting-interval')).toBeVisible()
    await fillSettingNumber(page, 'interval', 100)
    await connectFocusedSession(page)
    await expect(rawLogRows(page, 'rx').first()).toBeVisible({ timeout: 10_000 })
    await expect(page.getByTestId('status-bar').getByText('已连接')).toBeVisible()
    expect(sessionId.length).toBeGreaterThan(0)

    // 断线重连前的失败用例不走这里；以免误用假端口 API，这里不再访问 __fakeSerial。
    await expect(page.getByTestId('session-disconnect')).toBeEnabled()
  })

  test('用例 13：InvalidStateError 打开失败显示规定文案', async ({ page }) => {
    await openSerialTool(page)
    const portIndex = await addFakePort(page, DEFAULT_FAKE_PORT_INFO)
    await addFakeSerialSession(page, { portIndex, connect: false })

    await failNextOpen(page, portIndex, 'InvalidStateError')
    await page.getByTestId('session-connect').click()

    await expect(
      page.getByText('端口已被打开，可能正在其他标签页或程序中使用。请关闭占用后重试。'),
    ).toBeVisible({ timeout: 10_000 })
    await expect(page.getByTestId('session-connect')).toBeEnabled()
    await expect(page.getByText('连接错误', { exact: true }).first()).toBeVisible()
  })
})
