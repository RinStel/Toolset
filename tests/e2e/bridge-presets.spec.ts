/**
 * 转发与预设 e2e（plan.md §11.4 用例 7、8）。
 */

import { expect, test } from '@playwright/test'

import {
  BUILTIN_SENSOR_PROTOCOL_ID,
  DEFAULT_FAKE_PORT_INFO,
  DEFAULT_FAKE_PROTOCOL_INFO,
  addBridgeRule,
  addDemoSession,
  addFakePort,
  addFakeSerialSession,
  bridgeRule,
  bridgeRuleIds,
  emitRx,
  fakeWritten,
  openSerialTool,
  rawLogRows,
  selectProtocol,
  selectSessionTab,
  sendText,
  settingField,
  statusBarText,
  unplugPort,
  waitForProtocolActive,
} from './helpers'

test.describe('转发与预设', () => {
  test('用例 7：演示端口 A 与假端口 B 双向转发、回显与拔线后暂停', async ({ page }) => {
    await openSerialTool(page)
    const demoSessionId = await addDemoSession(page)
    const fakePort = await addFakePort(page, DEFAULT_FAKE_PORT_INFO)
    const fakeSessionId = await addFakeSerialSession(page, { portIndex: fakePort })

    // 把演示端口显示在 Pane 0，用于观察它的 TX 记录。
    await selectSessionTab(page, demoSessionId)
    await addBridgeRule(page, demoSessionId, fakeSessionId, 'duplex')
    const ruleIds = await bridgeRuleIds(page)
    expect(ruleIds).toHaveLength(1)
    const ruleId = ruleIds[0] as string
    await expect(bridgeRule(page, ruleId)).not.toContainText('已暂停')

    // emit 到假端口 B：字节被转发到演示端口 A，A 的日志出现 TX·转发 记录。
    await emitRx(page, fakePort, [0x68, 0x69]) // "hi"
    await expect(rawLogRows(page, 'tx').filter({ hasText: 'TX·转发' }).first()).toBeVisible({
      timeout: 10_000,
    })
    // 演示设备对可打印 ASCII 原样回显，A 收到 RX。回显又被双向转发给 B。
    await expect(rawLogRows(page, 'rx').filter({ hasText: 'hi' }).first()).toBeVisible({
      timeout: 10_000,
    })
    await expect
      .poll(
        async () => {
          const writes = await fakeWritten(page, fakePort)
          return writes.some((chunk) => Buffer.from(chunk).toString('utf8').includes('hi'))
        },
        { timeout: 10_000 },
      )
      .toBe(true)

    // 向演示端口写文本：演示设备回显，回显经转发到达 B。
    await sendText(page, 'PING')
    await expect
      .poll(
        async () => {
          const writes = await fakeWritten(page, fakePort)
          return writes.some((chunk) => Buffer.from(chunk).toString('utf8').includes('PING'))
        },
        { timeout: 10_000 },
      )
      .toBe(true)

    // 拔掉 B：规则暂停并显示「已暂停」。
    await unplugPort(page, fakePort)
    await expect(bridgeRule(page, ruleId)).toContainText('已暂停')
    await expect(page.getByTestId('bridge-panel')).toContainText('已暂停')
  })

  test('用例 8：另存预设（9600 + 内置协议）并套用到另一个端口', async ({ page }) => {
    await openSerialTool(page)
    const firstPort = await addFakePort(page, DEFAULT_FAKE_PORT_INFO)
    await addFakeSerialSession(page, { portIndex: firstPort, connect: false })

    // 连接前修改波特率并选择内置协议。
    await settingField(page, 'baudRate').locator('select').selectOption('9600')
    await expect(settingField(page, 'baudRate').locator('select')).toHaveValue('9600')
    await selectProtocol(page, BUILTIN_SENSOR_PROTOCOL_ID)
    await waitForProtocolActive(page)

    // 另存预设。
    await page.getByTestId('preset-save').click()
    await page.getByTestId('preset-name').fill('e2e 预设')
    await page.getByTestId('preset-save-confirm').click()
    const presetSelect = page.getByTestId('preset-select')
    await expect(presetSelect.locator('option', { hasText: 'e2e 预设' })).toHaveCount(1)

    // 新增第二个端口（不同设备 key，避免设备记忆互相影响），套用预设。
    const secondPort = await addFakePort(page, DEFAULT_FAKE_PROTOCOL_INFO)
    await addFakeSerialSession(page, { portIndex: secondPort, connect: false })
    await presetSelect.selectOption({ label: 'e2e 预设' })
    await page.getByTestId('preset-apply').click()

    // 参数与协议都生效。
    await expect(settingField(page, 'baudRate').locator('select')).toHaveValue('9600')
    await expect(page.getByTestId('protocol-select')).toHaveValue(BUILTIN_SENSOR_PROTOCOL_ID)
    await waitForProtocolActive(page)
    await expect.poll(async () => statusBarText(page), { timeout: 10_000 }).toContain('9600 8N1')
    await expect(page.getByText('已套用预设「e2e 预设」', { exact: false }).first()).toBeVisible({
      timeout: 10_000,
    })
  })
})
