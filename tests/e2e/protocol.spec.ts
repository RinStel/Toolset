/**
 * 协议 e2e（plan.md §11.4 用例 4、5、11）。
 *
 * 覆盖内置协议分帧与显示模式、协议管理器的校验/预览/保存与自动套用，以及
 * Worker 看门狗超时后主线程仍可交互。
 */

import { expect, test } from '@playwright/test'

import {
  BUILTIN_SENSOR_PROTOCOL_ID,
  DEFAULT_FAKE_PORT_INFO,
  DEFAULT_FAKE_PROTOCOL_INFO,
  addFakePort,
  addFakeSerialSession,
  allLogRows,
  closeProtocolManager,
  decodedLogRows,
  emitRx,
  logRowTexts,
  newProtocolFromTemplate,
  openProtocolManager,
  openSerialTool,
  pane,
  protocolIdByName,
  protocolStatusText,
  rawLogRows,
  runProtocolPreview,
  saveProtocol,
  selectProtocol,
  selectSessionTab,
  sensorReportFrame,
  setDisplayMode,
  setProtocolCode,
  waitForLogText,
  waitForProtocolActive,
  waitForText,
} from './helpers'

/** 一个合法的自定义协议（按行分帧，返回文本摘要）。 */
const VALID_PROTOCOL_CODE = `return {
  apiVersion: 1,
  meta: { name: '测试协议', description: 'e2e 自定义协议', version: '1.0.0' },
  framing: { type: 'line' },
  decode: function (frame) {
    return { summary: '行：' + sdk.text(frame).trim() }
  },
}
`

/** 修改后的合法协议：摘要前缀变化，用于验证会话立即重建 runtime。 */
const UPDATED_PROTOCOL_CODE = `return {
  apiVersion: 1,
  meta: { name: '测试协议', description: 'e2e 自定义协议', version: '1.0.0' },
  framing: { type: 'line' },
  decode: function (frame) {
    return { summary: '新版：' + sdk.text(frame).trim() }
  },
}
`

/** 编译能通过、但 decode 会死循环的协议（用例 11）。 */
const INFINITE_LOOP_PROTOCOL_CODE = `return {
  apiVersion: 1,
  meta: { name: '死循环协议', description: 'e2e 看门狗', version: '1.0.0' },
  framing: { type: 'line' },
  decode: function (frame) {
    while (true) {}
  },
}
`

/** 语法错误的协议：保存时必须被拒绝。 */
const INVALID_PROTOCOL_CODE = `return {
  apiVersion: 1,
  meta: { name: '坏协议' },
  framing: { type: 'line' },
  decode: function (frame) {
`

test.describe('协议', () => {
  test('用例 4：内置协议解析完整帧、半帧、坏 CRC、垃圾数据与三种显示模式', async ({ page }) => {
    await openSerialTool(page)
    const portIndex = await addFakePort(page, DEFAULT_FAKE_PORT_INFO)
    await addFakeSerialSession(page, { portIndex })

    // 选择内置协议「传感器帧（A5 5A）」，等待 Worker 就绪（显示模式控件解除禁用）。
    await selectProtocol(page, BUILTIN_SENSOR_PROTOCOL_ID)
    await waitForProtocolActive(page)
    expect(await protocolStatusText(page)).toContain('传感器帧（A5 5A）')

    // 完整帧：CMD 0x01 上报，计数 42。
    await emitRx(page, portIndex, sensorReportFrame(42))
    await waitForLogText(page, '上报 #42')
    await waitForLogText(page, '温度 25.31°C')

    // 半帧：先发前 5 字节，再发剩余字节，最终应解析出一帧（计数 43）。
    const half = sensorReportFrame(43)
    await emitRx(page, portIndex, half.slice(0, 5))
    await expect(decodedLogRows(page).filter({ hasText: '上报 #43' })).toHaveCount(0)
    await emitRx(page, portIndex, half.slice(5))
    await waitForLogText(page, '上报 #43')

    // 坏 CRC：解析结果标记为错误行。
    await emitRx(page, portIndex, sensorReportFrame(44, { corruptCrc: true }))
    await waitForLogText(page, 'CRC 错误')

    // 垃圾数据：分帧重同步丢弃，显示「未成帧数据」。
    await emitRx(page, portIndex, [0x00, 0x11, 0x22, 0x33])
    await waitForLogText(page, '未成帧数据')

    // 默认「原始+解析」：4 条 RX 原始行 + 4 条解析行（2 正常、1 CRC、1 未成帧）。
    await expect(rawLogRows(page, 'rx')).toHaveCount(4)
    await expect(decodedLogRows(page)).toHaveCount(4)

    // 原始模式：只显示原始行；切到 HEX 视图后能断言二进制帧内容。
    await setDisplayMode(page, 'raw')
    await expect(decodedLogRows(page)).toHaveCount(0)
    await expect(rawLogRows(page, 'rx')).toHaveCount(4)
    const rawTexts = await logRowTexts(page)
    expect(rawTexts).toHaveLength(4)
    await pane(page).getByTestId('view-hex').getByRole('switch').click()
    await expect(rawLogRows(page, 'rx').filter({ hasText: 'A5 5A 0B 01' }).first()).toBeVisible()
    // 垃圾数据 [00 11 22 33] 也以原始行显示。
    await expect(rawLogRows(page, 'rx').filter({ hasText: '00 11 22 33' }).first()).toBeVisible()
    await pane(page).getByTestId('view-hex').getByRole('switch').click()

    // 解析模式：正常帧与坏 CRC 只显示解析行；未成帧数据保留一条警告行。
    await setDisplayMode(page, 'decoded')
    await expect(decodedLogRows(page)).toHaveCount(4)
    expect(await rawLogRows(page, 'rx').count()).toBeLessThanOrEqual(1)
    const decodedTexts = await logRowTexts(page)
    expect(decodedTexts.some((text) => text.includes('上报 #42'))).toBe(true)
    expect(decodedTexts.some((text) => text.includes('CRC 错误'))).toBe(true)
    expect(decodedTexts.some((text) => text.includes('未成帧数据'))).toBe(true)
    expect(decodedTexts.some((text) => text.includes('计数=42'))).toBe(true)

    // 回到原始+解析：两种行同时出现。
    await setDisplayMode(page, 'both')
    await expect(rawLogRows(page, 'rx')).toHaveCount(4)
    await expect(decodedLogRows(page)).toHaveCount(4)
    await expect(
      pane(page).getByTestId('display-mode').getByRole('radio', { name: '原始+解析', exact: true }),
    ).toHaveAttribute('aria-checked', 'true')
  })

  test('用例 5：语法错误不能保存、预览得到解析结果、保存后会话立即生效', async ({ page }) => {
    await openSerialTool(page)
    const portIndex = await addFakePort(page, DEFAULT_FAKE_PORT_INFO)
    await addFakeSerialSession(page, { portIndex })

    await openProtocolManager(page)
    await newProtocolFromTemplate(page, '最小示例')

    // 含语法错误的协议不能保存。
    await setProtocolCode(page, INVALID_PROTOCOL_CODE, '坏协议')
    await saveProtocol(page)
    await expect(page.getByTestId('protocol-error')).toBeVisible({ timeout: 10_000 })
    await expect(page.getByTestId('protocol-error')).toContainText('语法错误')
    await expect(page.getByTestId('protocol-manager')).toBeVisible()
    await expect(page.getByText('还没有自定义协议', { exact: false })).toBeVisible()

    // 修正后用「预览」得到解析结果。
    await setProtocolCode(page, VALID_PROTOCOL_CODE, '测试协议')
    const previewOutput = await runProtocolPreview(page, '68 65 6C 6C 6F 0A')
    expect(previewOutput).toContain('行：hello')

    // 保存成功后可拿到自定义协议 id；首次保存的新协议会自动套用到打开管理器时的会话。
    await saveProtocol(page)
    await expect(page.getByTestId('protocol-name')).toContainText('测试协议')
    const protocolId = await protocolIdByName(page, '测试协议')
    await closeProtocolManager(page)

    await expect(page.getByTestId('protocol-select')).toHaveValue(protocolId)
    await waitForProtocolActive(page)
    expect(await protocolStatusText(page)).toContain('测试协议')
    await waitForLogText(page, '协议已更新：测试协议')
    await emitRx(page, portIndex, [0x68, 0x65, 0x6c, 0x6c, 0x6f, 0x0a])
    await waitForLogText(page, '行：hello')

    // 再次修改同一个协议并保存：使用它的会话自动重建 runtime 并再次写系统日志。
    await openProtocolManager(page)
    await page.getByTestId(`protocol-item-${protocolId}`).click()
    await setProtocolCode(page, UPDATED_PROTOCOL_CODE, '新版：')
    await saveProtocol(page)
    await expect(page.getByTestId('protocol-name')).toContainText('测试协议')
    await expect(allLogRows(page).filter({ hasText: '协议已更新：测试协议' })).toHaveCount(2, {
      timeout: 10_000,
    })
    await closeProtocolManager(page)
    await emitRx(page, portIndex, [0x62, 0x79, 0x65, 0x0a]) // "bye\n"
    await waitForLogText(page, '新版：bye')
  })

  test('用例 11：死循环插件 3 秒内超时、页面可点击、另一会话继续接收', async ({ page }) => {
    await openSerialTool(page)
    const port1 = await addFakePort(page, DEFAULT_FAKE_PORT_INFO)
    const session1 = await addFakeSerialSession(page, { portIndex: port1 })
    const port2 = await addFakePort(page, DEFAULT_FAKE_PROTOCOL_INFO)
    const session2 = await addFakeSerialSession(page, { portIndex: port2 })

    // 先让会话 1 成为焦点：管理器会把首次保存的新协议套用到打开它时的会话。
    await selectSessionTab(page, session1)
    await openProtocolManager(page)
    await newProtocolFromTemplate(page, '最小示例')
    await setProtocolCode(page, INFINITE_LOOP_PROTOCOL_CODE, '死循环协议')
    await saveProtocol(page)
    await expect(page.getByTestId('protocol-name')).toContainText('死循环协议')
    const protocolId = await protocolIdByName(page, '死循环协议')
    await closeProtocolManager(page)

    // 死循环协议已自动套用到会话 1。
    await expect(page.getByTestId('protocol-select')).toHaveValue(protocolId)
    await waitForProtocolActive(page)
    expect(await protocolStatusText(page)).toContain('死循环协议')

    // 注入一行数据：Worker 死循环 → 看门狗触发，3 秒内出现超时提示。
    await emitRx(page, port1, [0x41, 0x0a])
    await waitForText(page, '协议执行超时（可能存在死循环），已禁用该会话的协议。', 3_000)
    await expect(page.getByTestId('status-bar').getByText('死循环协议（已禁用）')).toBeVisible()

    // 页面仍然可交互：点击主题按钮、打开设置抽屉都能完成。
    const clickStartedAt = Date.now()
    await page.getByTestId('theme-toggle').click()
    expect(Date.now() - clickStartedAt).toBeLessThan(2_000)
    await page.getByTestId('settings-open').click()
    await expect(page.getByTestId('settings-drawer')).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(page.getByTestId('settings-drawer')).toHaveCount(0)

    // 会话 2 继续正常接收数据。
    await selectSessionTab(page, session2)
    await emitRx(page, port2, [0x42, 0x0a])
    await waitForLogText(page, 'B')
    await expect(rawLogRows(page, 'rx').filter({ hasText: 'B' }).first()).toBeVisible()
    await expect(page.getByTestId('status-bar').getByText('已连接')).toBeVisible()
  })
})
