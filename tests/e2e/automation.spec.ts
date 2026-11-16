/**
 * 发送与导出 e2e（plan.md §11.4 用例 6、9）。
 */

import { expect, test } from '@playwright/test'

import {
  DEFAULT_FAKE_PORT_INFO,
  addFakePort,
  addFakeSerialSession,
  emitRx,
  exportLogFile,
  fakeSignals,
  fakeWritten,
  fillSendInput,
  logRowTexts,
  openSerialTool,
  rawLogRows,
  readDownloadedFile,
  sendHex,
  sendText,
  unplugPort,
  waitForLogText,
  waitForWriteCount,
} from './helpers'

test.describe('发送与导出', () => {
  test('用例 6：快捷发送、重复发送 3 次自动停止、宏运行中拔线停止', async ({ page }) => {
    await openSerialTool(page)
    const portIndex = await addFakePort(page, DEFAULT_FAKE_PORT_INFO)
    await addFakeSerialSession(page, { portIndex })

    /* -------- 快捷发送：数据项 -------- */
    await page.getByRole('tab', { name: '快捷', exact: true }).click()
    await expect(page.getByTestId('quick-item-sample-at')).toBeVisible()

    await page.getByTestId('quick-item-sample-at').click()
    const firstWrites = await waitForWriteCount(page, portIndex, 1)
    expect(firstWrites[0]).toEqual([65, 84, 13, 10]) // "AT\r\n"

    await page.getByTestId('quick-item-sample-hex').click()
    const secondWrites = await waitForWriteCount(page, portIndex, 2)
    expect(secondWrites[1]?.slice(0, 6)).toEqual([0x01, 0x03, 0x00, 0x00, 0x00, 0x01])
    expect(secondWrites[1]).toHaveLength(8) // 6 字节数据 + CRC16-MODBUS

    /* -------- 快捷发送：控制线项 -------- */
    await page.getByTestId('quick-item-sample-esp32').click()
    await expect
      .poll(async () => (await fakeSignals(page, portIndex)).length, { timeout: 10_000 })
      .toBe(3)
    const signals = await fakeSignals(page, portIndex)
    expect(signals[0]).toEqual({ dataTerminalReady: false, requestToSend: true })
    expect(signals[1]).toEqual({ dataTerminalReady: true, requestToSend: false })
    expect(signals[2]).toEqual({ dataTerminalReady: false })

    /* -------- 重复发送：3 次后自动停止 -------- */
    await page.getByRole('tab', { name: '手动', exact: true }).click()
    const writesBeforeRepeat = (await fakeWritten(page, portIndex)).length
    await fillSendInput(page, 'PING')
    await page.getByTestId('repeat-enable').click()
    const intervalInput = page.getByTestId('repeat-interval')
    await intervalInput.fill('200')
    const countInput = page.getByTestId('repeat-count')
    await countInput.fill('3')
    await page.getByTestId('repeat-start').click()

    await expect(page.getByTestId('repeat-status')).toBeVisible()
    await waitForWriteCount(page, portIndex, writesBeforeRepeat + 3, 15_000)
    const repeatWrites = (await fakeWritten(page, portIndex)).slice(writesBeforeRepeat)
    expect(repeatWrites).toHaveLength(3)
    for (const chunk of repeatWrites) expect(chunk).toEqual([80, 73, 78, 71]) // "PING"
    // 达到次数后自动停止：停止按钮消失、开始按钮恢复可用。
    await expect(page.getByTestId('repeat-status')).toHaveCount(0)
    await expect(page.getByTestId('repeat-stop')).toHaveCount(0)
    await expect(page.getByTestId('repeat-start')).toBeEnabled()

    /* -------- 宏：运行中拔线应停止并写系统日志 -------- */
    await page.getByRole('tab', { name: '宏', exact: true }).click()
    await page.getByTestId('macro-run-sample-macro').click()
    await expect(page.getByTestId('macro-status')).toBeVisible()
    await expect(page.getByTestId('macro-status')).toContainText('示例宏')

    await unplugPort(page, portIndex)
    await expect(page.getByTestId('macro-status')).toHaveCount(0, { timeout: 10_000 })
    await expect(page.getByTestId('macro-stop-sample-macro')).toHaveCount(0)
    await waitForLogText(page, '宏「示例宏」已停止：通道已断开', 0, 10_000)
    // 拔线本身也应写系统日志「设备已断开」。
    await waitForLogText(page, '设备已断开', 0, 10_000)
  })

  test('用例 9：导出 TXT、CSV、BIN 并断言文件内容', async ({ page }) => {
    await openSerialTool(page)
    const portIndex = await addFakePort(page, DEFAULT_FAKE_PORT_INFO)
    await addFakeSerialSession(page, { portIndex })

    // 制造 TX 与 RX 记录。
    await sendText(page, 'hello')
    await waitForWriteCount(page, portIndex, 1)
    await sendHex(page, '01 02 03')
    await waitForWriteCount(page, portIndex, 2)
    await emitRx(page, portIndex, [0x41, 0x42, 0x43]) // "ABC"
    await waitForLogText(page, 'ABC')

    await expect(rawLogRows(page, 'tx')).toHaveCount(2)
    await expect(rawLogRows(page, 'rx')).toHaveCount(1)
    expect((await logRowTexts(page)).join('\n')).toContain('ABC')

    // TXT：形如 `YYYY-MM-DD HH:mm:ss.SSS DIR 内容`。
    const txt = await readDownloadedFile(await exportLogFile(page, '导出 TXT'))
    expect(txt.fileName).toMatch(/^USB 串口 \(1A86_7523\)_\d{8}-\d{6}\.txt$/)
    expect(txt.text).toMatch(/\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}\.\d{3} RX ABC/)
    expect(txt.text).toMatch(/\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}\.\d{3} TX hello/)
    expect(txt.text).toContain('TX \\x01\\x02\\x03')

    // CSV：UTF-8 BOM + 固定列头。
    const csv = await readDownloadedFile(await exportLogFile(page, '导出 CSV'))
    expect(csv.fileName).toMatch(/\.csv$/)
    expect(csv.bytes[0]).toBe(0xef)
    expect(csv.bytes[1]).toBe(0xbb)
    expect(csv.bytes[2]).toBe(0xbf)
    const csvLines = csv.text.trim().split('\r\n')
    expect(csvLines[0]).toBe('time,dir,origin,level,hex,text,summary,fields')
    expect(csvLines.some((line) => line.includes(',rx,') && line.includes('41 42 43'))).toBe(true)
    expect(csvLines.some((line) => line.includes(',tx,') && line.includes('hello'))).toBe(true)

    // BIN：所有 RX 条目的原始字节按顺序拼接。
    const bin = await readDownloadedFile(await exportLogFile(page, '导出 BIN'))
    expect(bin.fileName).toMatch(/\.bin$/)
    expect([...bin.bytes]).toEqual([0x41, 0x42, 0x43])
  })
})
