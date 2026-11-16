/**
 * e2e 公共流程封装（plan.md §11.4）。
 *
 * 约定：
 * - 断言优先使用 `data-testid`（见 plan §11.4 的清单）与界面文案；
 * - 假串口只能用 `page.evaluate(() => window.__fakeSerial.…)` 控制；
 * - 不做固定时长等待，全部用 `expect(locator)` / `expect.poll`。
 */

import { readFile } from 'node:fs/promises'
import path from 'node:path'

import { expect, type Download, type Locator, type Page } from '@playwright/test'

import { installFakeSerial, type FakeSerialPortInfo } from './fixtures/fake-serial'

/** 串口助手路由（hash 模式）。 */
export const SERIAL_TOOL_PATH = '/#/tools/serial'

/** 内置传感器协议 id（plan §8.6）。 */
export const BUILTIN_SENSOR_PROTOCOL_ID = 'builtin:sensor-a5'

/** 默认假串口信息（USB 串口芯片 CH340）。 */
export const DEFAULT_FAKE_PORT_INFO: FakeSerialPortInfo = {
  usbVendorId: 0x1a86,
  usbProductId: 0x7523,
}

export const DEFAULT_FAKE_PROTOCOL_INFO: FakeSerialPortInfo = {
  usbVendorId: 0x10c4,
  usbProductId: 0xea60,
}

/* ------------------------------------------------------------------------- */
/* 页面导航与假串口安装                                                        */
/* ------------------------------------------------------------------------- */

/** 在 `page.goto` 之前调用：注入 `navigator.serial` 与 `window.__fakeSerial`。 */
export async function installFakeSerialApi(page: Page): Promise<void> {
  await page.addInitScript(installFakeSerial)
}

/** 打开首页并等待工具卡片渲染。 */
export async function gotoHome(page: Page): Promise<void> {
  await page.goto('/')
  await expect(page.getByTestId('tool-card-serial')).toBeVisible()
}

/**
 * 打开串口助手。`withFakeSerial` 默认为 true；用例 10 需要在刷新后失去假串口时
 * 仍然使用同一个安装脚本（`remove()` 会写 localStorage 标记，刷新后自动跳过注入）。
 */
export async function openSerialTool(
  page: Page,
  options: { fakeSerial?: boolean } = {},
): Promise<void> {
  const { fakeSerial = true } = options
  if (fakeSerial) await installFakeSerialApi(page)
  await gotoHome(page)
  await page.getByTestId('tool-card-serial').click()
  await expect(page.getByTestId('serial-tool')).toBeVisible()
  await expect(page).toHaveURL(/#\/tools\/serial/)
}

/** 直接以 hash URL 进入串口助手（整页加载，用于验证直接访问）。 */
export async function gotoSerialDirect(page: Page): Promise<void> {
  // 先离开当前文档：仅 hash 变化的 page.goto 属于同文档导航，不会真正重新加载页面。
  await page.goto('about:blank')
  await page.goto(SERIAL_TOOL_PATH)
  await expect(page.getByTestId('serial-tool')).toBeVisible()
}

/* ------------------------------------------------------------------------- */
/* 假串口控制                                                                  */
/* ------------------------------------------------------------------------- */

/** 新增一个假串口，返回其索引。 */
export async function addFakePort(
  page: Page,
  info: FakeSerialPortInfo = DEFAULT_FAKE_PORT_INFO,
): Promise<number> {
  return page.evaluate((portInfo) => window.__fakeSerial.addPort(portInfo), info)
}

/** 指定下一次 `requestPort` 选择哪个假串口。 */
export async function setFakePortSelection(page: Page, index: number): Promise<void> {
  await page.evaluate(
    (portIndex) => window.__fakeSerial.setRequestBehavior({ select: portIndex }),
    index,
  )
}

/** 让下一次打开指定端口失败。 */
export async function failNextOpen(
  page: Page,
  index: number,
  name: 'InvalidStateError' | 'NetworkError',
): Promise<void> {
  await page.evaluate(
    ({ portIndex, errorName }) => window.__fakeSerial.failNextOpen(portIndex, errorName),
    { portIndex: index, errorName: name },
  )
}

/** 向指定假串口注入 RX 数据。 */
export async function emitRx(page: Page, index: number, bytes: readonly number[]): Promise<void> {
  await page.evaluate(({ portIndex, value }) => window.__fakeSerial.emit(portIndex, value), {
    portIndex: index,
    value: [...bytes],
  })
}

/** 拔出指定假串口（触发 disconnect）。 */
export async function unplugPort(page: Page, index: number): Promise<void> {
  await page.evaluate((portIndex) => window.__fakeSerial.unplug(portIndex), index)
}

/** 删除 `navigator.serial`（同时写入刷新后仍然生效的标记）。 */
export async function removeFakeSerial(page: Page): Promise<void> {
  await page.evaluate(() => window.__fakeSerial.remove())
}

/** 假串口收到的写入内容（每个元素是一次写入的字节数组）。 */
export async function fakeWritten(page: Page, index: number): Promise<number[][]> {
  return page.evaluate((portIndex) => window.__fakeSerial.written(portIndex), index)
}

/** 假串口收到的控制线设置序列。 */
export async function fakeSignals(
  page: Page,
  index: number,
): Promise<Array<Record<string, boolean>>> {
  return page.evaluate(
    (portIndex) => window.__fakeSerial.signals(portIndex) as Array<Record<string, boolean>>,
    index,
  )
}

/** 关闭写入记录（perf 用例避免测试自身的内存增长影响堆断言）。 */
export async function disableFakeWriteRecording(page: Page): Promise<void> {
  await page.evaluate(() => window.__fakeSerial.setWriteRecording(false))
}

/** 轮询等待假串口累计写入次数达到 `count`，返回全部写入。 */
export async function waitForWriteCount(
  page: Page,
  portIndex: number,
  count: number,
  timeout = 10_000,
): Promise<number[][]> {
  await expect
    .poll(async () => (await fakeWritten(page, portIndex)).length, { timeout })
    .toBe(count)
  return fakeWritten(page, portIndex)
}

/* ------------------------------------------------------------------------- */
/* 会话与窗格                                                                  */
/* ------------------------------------------------------------------------- */

const SESSION_TAB_SELECTOR = '[data-testid^="session-tab-"]'

export function sessionTabs(page: Page): Locator {
  return page.locator(SESSION_TAB_SELECTOR)
}

export function sessionTab(page: Page, sessionId: string): Locator {
  return page.getByTestId(`session-tab-${sessionId}`)
}

/** 当前所有会话 id（按标签顺序）。 */
export async function sessionIds(page: Page): Promise<string[]> {
  const values = await sessionTabs(page).evaluateAll((elements) =>
    elements.map((element) => element.getAttribute('data-testid') ?? ''),
  )
  return values
    .filter((value) => value.startsWith('session-tab-'))
    .map((value) => value.slice('session-tab-'.length))
}

export async function waitForSessionCount(page: Page, count: number): Promise<void> {
  await expect(sessionTabs(page)).toHaveCount(count)
}

/** 侧栏「当前会话」的状态文案。 */
export function focusedSessionState(page: Page): Locator {
  return page.locator('.session-settings__status-text')
}

/** 点击侧栏「连接」并等待状态变为已连接。 */
export async function connectFocusedSession(page: Page): Promise<void> {
  await page.getByTestId('session-connect').click()
  await expect(focusedSessionState(page)).toHaveText('已连接', { timeout: 10_000 })
}

/**
 * 新增一个假串口会话（可顺带连接），返回 session id。
 *
 * 调用方必须先用 {@link addFakePort} 创建假端口：`addFakePort` 的返回值就是这里
 * 的 `portIndex`。
 */
export async function addFakeSerialSession(
  page: Page,
  options: {
    portIndex: number
    connect?: boolean
  },
): Promise<string> {
  const { portIndex, connect = true } = options
  const before = await sessionTabs(page).count()
  await setFakePortSelection(page, portIndex)
  await page.getByTestId('add-provider-web-serial').click()
  await waitForSessionCount(page, before + 1)
  await expect(focusedSessionState(page)).not.toHaveText('正在连接…')
  const ids = await sessionIds(page)
  const sessionId = ids.at(-1)
  if (sessionId === undefined) throw new Error('新增会话后没有找到会话标签')
  if (connect) await connectFocusedSession(page)
  return sessionId
}

/** 新增演示端口并连接，返回 session id。 */
export async function addDemoSession(
  page: Page,
  options: { connect?: boolean } = {},
): Promise<string> {
  const { connect = true } = options
  const before = await sessionTabs(page).count()
  await page.getByTestId('add-provider-virtual').click()
  await waitForSessionCount(page, before + 1)
  const ids = await sessionIds(page)
  const sessionId = ids.at(-1)
  if (sessionId === undefined) throw new Error('新增演示端口后没有找到会话标签')
  if (connect) await connectFocusedSession(page)
  return sessionId
}

/** 点击标签页把会话显示到当前焦点 Pane。 */
export async function selectSessionTab(page: Page, sessionId: string): Promise<void> {
  // 高吞吐（1kHz）下会话标签会随日志统计频繁重渲染，Playwright 的点击行动性/
  // 重试可能永不完成；在页面里直接调用标签按钮的 click()（仍是用户点击语义）。
  await expect
    .poll(
      async () =>
        page.evaluate((targetId) => {
          const host = document.querySelector(`[data-testid="session-tab-${CSS.escape(targetId)}"]`)
          const tab = host?.querySelector<HTMLElement>('[role="tab"]')
          if (!tab) return false
          tab.click()
          return true
        }, sessionId),
      { timeout: 15_000, intervals: [100, 200, 500] },
    )
    .toBe(true)
}

/** 第 `index` 个 Pane（分屏时从 0 开始）。 */
export function pane(page: Page, index = 0): Locator {
  return page.locator('.session-pane').nth(index)
}

export function panes(page: Page): Locator {
  return page.locator('.session-pane')
}

/** 点击空 Pane 让它成为焦点（不点到空状态里的按钮）。 */
export async function focusEmptyPane(page: Page, index: number): Promise<void> {
  // 高负载下 Pane 会随日志统计频繁重渲染，用 pointerdown 事件直接触发焦点逻辑，
  // 避免 Playwright 的点击行动性检查一直等待“稳定”。
  await expect
    .poll(
      async () =>
        page.evaluate((paneIndex) => {
          const target = document.querySelectorAll('.session-pane')[paneIndex]
          if (!(target instanceof HTMLElement)) return false
          target.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }))
          return true
        }, index),
      { timeout: 10_000, intervals: [50, 100, 200] },
    )
    .toBe(true)
}

/** 点击 Pane 内的日志区域，让它成为焦点（无副作用）。 */
export async function focusPane(page: Page, index: number): Promise<void> {
  await focusEmptyPane(page, index)
}

/* ------------------------------------------------------------------------- */
/* 发送                                                                        */
/* ------------------------------------------------------------------------- */

export async function setSendMode(page: Page, mode: 'text' | 'hex', paneIndex = 0): Promise<void> {
  await pane(page, paneIndex)
    .getByTestId('send-mode')
    .getByRole('radio', { name: mode === 'hex' ? 'HEX' : '文本', exact: true })
    .click()
}

export async function fillSendInput(page: Page, value: string, paneIndex = 0): Promise<void> {
  await pane(page, paneIndex).getByTestId('send-input').fill(value)
}

export async function clickSend(page: Page, paneIndex = 0): Promise<void> {
  const button = pane(page, paneIndex).getByTestId('send-button')
  await expect(button).toBeEnabled()
  await button.click()
}

export async function sendText(page: Page, text: string, paneIndex = 0): Promise<void> {
  await setSendMode(page, 'text', paneIndex)
  await fillSendInput(page, text, paneIndex)
  await clickSend(page, paneIndex)
}

export async function sendHex(page: Page, hex: string, paneIndex = 0): Promise<void> {
  await setSendMode(page, 'hex', paneIndex)
  await fillSendInput(page, hex, paneIndex)
  await clickSend(page, paneIndex)
}

/* ------------------------------------------------------------------------- */
/* 日志                                                                        */
/* ------------------------------------------------------------------------- */

const LOG_ROW_SELECTOR = '[data-testid="log-row"], [data-testid="log-row-decoded"]'

export function rawLogRows(page: Page, dir?: 'rx' | 'tx' | 'system', paneIndex = 0): Locator {
  const base = pane(page, paneIndex)
  return dir === undefined
    ? base.locator('[data-testid="log-row"]')
    : base.locator(`[data-testid="log-row"][data-dir="${dir}"]`)
}

export function decodedLogRows(page: Page, paneIndex = 0): Locator {
  return pane(page, paneIndex).locator('[data-testid="log-row-decoded"]')
}

export function allLogRows(page: Page, paneIndex = 0): Locator {
  return pane(page, paneIndex).locator(LOG_ROW_SELECTOR)
}

export async function logRowTexts(page: Page, paneIndex = 0): Promise<string[]> {
  return allLogRows(page, paneIndex).allTextContents()
}

/** 等待某条日志行出现并包含指定文本。 */
export async function waitForLogText(
  page: Page,
  text: string,
  paneIndex = 0,
  timeout = 10_000,
): Promise<void> {
  await expect(allLogRows(page, paneIndex).filter({ hasText: text }).first()).toBeVisible({
    timeout,
  })
}

/** 等待 Pane 内不再包含指定文本的日志行。 */
export async function waitForNoLogText(page: Page, text: string, paneIndex = 0): Promise<void> {
  await expect(allLogRows(page, paneIndex).filter({ hasText: text })).toHaveCount(0)
}

/** 打开设置抽屉（外壳右侧抽屉）。 */
export async function openSettingsDrawer(page: Page): Promise<void> {
  await page.getByTestId('settings-open').click()
  await expect(page.getByTestId('settings-drawer')).toBeVisible()
}

/** 设置抽屉里某个设置字段的容器（`setting-<key>`）。 */
export function settingField(page: Page, key: string): Locator {
  return page.getByTestId(`setting-${key}`)
}

/** 设置抽屉里「外观」字号输入框。 */
export function appearanceFontSizeInput(page: Page): Locator {
  return page.getByTestId('appearance-font-size').locator('input').first()
}

/** 填写工具设置里的数字字段（失焦提交）。 */
export async function fillSettingNumber(page: Page, key: string, value: number): Promise<void> {
  const input = settingField(page, key).locator('input').first()
  await input.fill(String(value))
  await input.press('Enter')
}

/** 填写工具设置里的颜色字段（十六进制文本 + 回车提交）。 */
export async function fillSettingColor(page: Page, key: string, hex: string): Promise<void> {
  const input = settingField(page, key).locator('input.ui-color-input__text')
  await input.fill(hex)
  await input.press('Enter')
}

/** 读取工具根元素上生效的日志颜色 CSS 变量。 */
export async function readSerialColorVariable(page: Page, cssVar: string): Promise<string> {
  return page.evaluate((name) => {
    const root = document.querySelector<HTMLElement>('[data-testid="serial-tool"]')
    return root === null ? '' : root.style.getPropertyValue(name).trim()
  }, cssVar)
}

/* ------------------------------------------------------------------------- */
/* 显示模式与协议                                                              */
/* ------------------------------------------------------------------------- */

export async function setDisplayMode(
  page: Page,
  mode: 'raw' | 'decoded' | 'both',
  paneIndex = 0,
): Promise<void> {
  const label = mode === 'raw' ? '原始' : mode === 'decoded' ? '解析' : '原始+解析'
  await pane(page, paneIndex)
    .getByTestId('display-mode')
    .getByRole('radio', { name: label, exact: true })
    .click()
}

/** 在侧栏协议下拉中选择协议（兼容 UiSelect 包装与原生 select）。 */
export async function selectProtocol(page: Page, protocolId: string): Promise<void> {
  const root = page.getByTestId('protocol-select')
  const native = root.locator('select')
  const select = (await native.count()) > 0 ? native.first() : root
  // 协议列表由仓库异步加载，先等 option 出现再选择。
  await expect(select.locator(`option[value="${protocolId}"]`)).toHaveCount(1, {
    timeout: 10_000,
  })
  await select.selectOption(protocolId)
}

/** 等待当前会话的协议变为可用（日志工具栏显示模式控件解除禁用）。 */
export async function waitForProtocolActive(page: Page, paneIndex = 0): Promise<void> {
  await expect(
    pane(page, paneIndex)
      .getByTestId('display-mode')
      .getByRole('radio', { name: '原始', exact: true }),
  ).toBeEnabled({ timeout: 10_000 })
}

/** 状态栏里的协议文案。 */
export async function protocolStatusText(page: Page): Promise<string> {
  const items = page.getByTestId('status-bar').locator('.status-bar__item')
  const texts = await items.allTextContents()
  return texts.find((text) => text.startsWith('协议：')) ?? ''
}

/* ------------------------------------------------------------------------- */
/* 传感器帧（A5 5A）构造                                                       */
/* ------------------------------------------------------------------------- */

/** CRC16-MODBUS（低字节先写入帧尾）。 */
export function crc16Modbus(bytes: readonly number[]): number {
  let crc = 0xffff
  for (const byte of bytes) {
    crc ^= byte
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc & 1) === 1 ? (crc >>> 1) ^ 0xa001 : crc >>> 1
    }
  }
  return crc & 0xffff
}

/** 构造一帧 `A5 5A | LEN | CMD | DATA | CRC16-MODBUS(LE)`。 */
export function sensorFrame(
  cmd: number,
  data: readonly number[],
  options: { corruptCrc?: boolean } = {},
): number[] {
  const body = [0xa5, 0x5a, data.length + 1, cmd, ...data]
  const crc = crc16Modbus(body)
  const low = options.corruptCrc === true ? (crc & 0xff) ^ 0xff : crc & 0xff
  return [...body, low, (crc >> 8) & 0xff]
}

/** CMD 0x01 上报帧的数据段；`count` 为 32 位计数。 */
export function sensorReportData(count: number): number[] {
  // 温度 2531（25.31°C）、湿度 4820（48.20%）、电压 3301mV，与 §8.6 示例一致。
  return [
    0xe3,
    0x09,
    0xd4,
    0x12,
    0xe5,
    0x0c,
    count & 0xff,
    (count >> 8) & 0xff,
    (count >> 16) & 0xff,
    (count >>> 24) & 0xff,
  ]
}

/** 构造 CMD 0x01 上报帧。 */
export function sensorReportFrame(count = 42, options: { corruptCrc?: boolean } = {}): number[] {
  return sensorFrame(0x01, sensorReportData(count), options)
}

/* ------------------------------------------------------------------------- */
/* 导出                                                                        */
/* ------------------------------------------------------------------------- */

/** 点击日志工具栏的导出菜单并等待下载。 */
export async function exportLogFile(
  page: Page,
  label: '导出 TXT' | '导出 CSV' | '导出 BIN',
  paneIndex = 0,
): Promise<Download> {
  const target = pane(page, paneIndex).getByTestId('export-menu')
  const downloadPromise = page.waitForEvent('download')
  await target.click()
  await page.getByRole('menuitem', { name: label, exact: true }).click()
  return downloadPromise
}

export interface DownloadedFile {
  fileName: string
  bytes: Buffer
  text: string
}

/** 读取下载文件（TXT / CSV 的 UTF-8 文本与 BIN 的原始字节）。 */
export async function readDownloadedFile(download: Download): Promise<DownloadedFile> {
  const fileName = download.suggestedFilename()
  const filePath = await download.path()
  if (filePath === null) throw new Error('下载文件没有落盘路径')
  const bytes = await readFile(filePath)
  return { fileName, bytes, text: bytes.toString('utf8').replace(/^\uFEFF/, '') }
}

/* ------------------------------------------------------------------------- */
/* 主题与截图                                                                  */
/* ------------------------------------------------------------------------- */

/** 写入外观设置并刷新，使主题在首屏渲染前生效。 */
export async function setStoredTheme(page: Page, theme: 'dark' | 'light'): Promise<void> {
  await page.evaluate((value) => {
    localStorage.setItem(
      'toolset/app/settings.v1',
      JSON.stringify({ version: 1, data: { theme: value, fontSize: 13, density: 'compact' } }),
    )
  }, theme)
  await page.reload()
  await expect(page.locator('html')).toHaveAttribute('data-theme', theme)
}

/** 读回当前元素的计算样式，用于断言主题/颜色是否真的生效。 */
export async function computedStyleProperty(
  page: Page,
  selector: string,
  property: string,
): Promise<string> {
  return page.evaluate(
    ({ target, name }) => {
      const element = document.querySelector<HTMLElement>(target)
      return element === null ? '' : getComputedStyle(element).getPropertyValue(name).trim()
    },
    { target: selector, name: property },
  )
}

/* ------------------------------------------------------------------------- */
/* 转发 / 预设 / 协议管理器                                                    */
/* ------------------------------------------------------------------------- */

/** 读取页面里所有会话 id（供建造转发/预设下拉的选项值）。 */
export async function currentSessionIds(page: Page): Promise<string[]> {
  return sessionIds(page)
}

/** 等待局部文案出现（用于系统日志、错误提示等非 testid 断言）。 */
export async function waitForText(page: Page, text: string, timeout = 10_000): Promise<void> {
  await expect(page.getByText(text, { exact: false }).first()).toBeVisible({ timeout })
}

/** 读取当前 Pane 日志缓冲区条数（状态栏「日志 N 条」）。 */
export async function logEntryCount(page: Page, paneIndex = 0): Promise<number> {
  const text = await pane(page, paneIndex).getByTestId('status-bar').innerText()
  const match = /日志 (\d+) 条/.exec(text)
  return match === null ? 0 : Number(match[1])
}

/** 读取当前 Pane 状态栏里的 TX/RX 字节数文案。 */
export async function statusBarText(page: Page, paneIndex = 0): Promise<string> {
  return pane(page, paneIndex).getByTestId('status-bar').innerText()
}

/** 当前 Pane 是否显示转发记录。 */
export async function bridgeRuleText(page: Page): Promise<string> {
  return page.locator('[data-testid^="bridge-rule-"]').first().innerText()
}

/* ------------------------------------------------------------------------- */
/* 协议管理器                                                                  */
/* ------------------------------------------------------------------------- */

/** 打开协议管理器（全屏对话框）。 */
export async function openProtocolManager(page: Page): Promise<void> {
  await page.getByTestId('protocol-manager-open').click()
  await expect(page.getByTestId('protocol-manager')).toBeVisible()
}

/** 从「新建」菜单选择一个模板（模板名为 4 个内置模板之一，如「最小示例」）。 */
export async function newProtocolFromTemplate(page: Page, templateLabel: string): Promise<void> {
  await page.getByTestId('protocol-manager-new').click()
  await page.getByRole('menuitem', { name: templateLabel, exact: true }).click()
  await expect(protocolEditorContent(page)).toBeVisible({ timeout: 10_000 })
}

/** CodeMirror 的可编辑区域。 */
export function protocolEditorContent(page: Page): Locator {
  return page.getByTestId('protocol-editor').locator('.cm-content')
}

/**
 * 整体替换协议代码（CodeMirror 6）。
 *
 * Playwright 对 `[contenteditable]` 的 `fill()` 走 `insertText` 输入事件，CodeMirror
 * 能正常接收；若当前版本不生效则退回 `Ctrl+A` + `insertText`。最后用 `marker`
 * 确认编辑器状态确实更新（否则保存/预览会测到旧代码）。
 */
export async function setProtocolCode(page: Page, code: string, marker: string): Promise<void> {
  const content = protocolEditorContent(page)
  await content.click()
  try {
    await content.fill(code)
  } catch {
    // 某些 Playwright 版本对 contenteditable 的 fill 可能直接拒绝，退回 insertText。
  }
  if (!(await content.innerText()).includes(marker)) {
    await page.keyboard.press('Control+A')
    await page.keyboard.insertText(code)
  }
  await expect(content).toContainText(marker, { timeout: 5_000 })
}

/** 点击管理器里的「保存」。 */
export async function saveProtocol(page: Page): Promise<void> {
  await page.getByTestId('protocol-save').click()
}

/** 在管理器「预览」标签里运行示例 HEX，返回输出文本。 */
export async function runProtocolPreview(page: Page, hex: string): Promise<string> {
  await page.getByTestId('protocol-tab-preview').click()
  await page.getByTestId('protocol-preview-input').fill(hex)
  await page.getByTestId('protocol-preview-run').click()
  const output = page.getByTestId('protocol-preview-output')
  await expect(output).not.toContainText('点击「运行」查看分帧与解析结果', { timeout: 10_000 })
  return output.innerText()
}

/** 通过列表里的协议名取得协议 id（用于侧栏下拉与后续断言）。 */
export async function protocolIdByName(page: Page, name: string): Promise<string> {
  const item = page
    .getByTestId('protocol-manager')
    .locator('[data-testid^="protocol-item-"]')
    .filter({ hasText: name })
    .first()
  await expect(item).toBeVisible({ timeout: 10_000 })
  const testId = await item.getAttribute('data-testid')
  if (testId === null) throw new Error(`没有找到协议「${name}」的 testid`)
  return testId.slice('protocol-item-'.length)
}

/** 关闭协议管理器。 */
export async function closeProtocolManager(page: Page): Promise<void> {
  await page.getByTestId('protocol-close').click()
  await expect(page.getByTestId('protocol-manager')).toHaveCount(0)
}

/* ------------------------------------------------------------------------- */
/* 转发规则                                                                    */
/* ------------------------------------------------------------------------- */

/** 在侧栏转发面板新建一条规则（选择源/目标会话与方向）。 */
export async function addBridgeRule(
  page: Page,
  sourceSessionId: string,
  targetSessionId: string,
  mode: 'oneway' | 'duplex' = 'duplex',
): Promise<void> {
  const toggle = page.getByTestId('bridge-panel-toggle')
  if ((await toggle.count()) > 0 && (await toggle.getAttribute('aria-expanded')) === 'false') {
    await toggle.click()
  }
  const before = await page.locator('[data-testid^="bridge-rule-"]').count()
  await page.getByTestId('bridge-source').selectOption(sourceSessionId)
  await page.getByTestId('bridge-target').selectOption(targetSessionId)
  await page.getByTestId('bridge-mode').selectOption(mode)
  await page.getByTestId('bridge-add').click()
  await expect(page.locator('[data-testid^="bridge-rule-"]')).toHaveCount(before + 1)
}

/** 转发面板里的规则 id。 */
export async function bridgeRuleIds(page: Page): Promise<string[]> {
  const values = await page
    .locator('[data-testid^="bridge-rule-"]')
    .evaluateAll((elements) => elements.map((element) => element.getAttribute('data-testid') ?? ''))
  return values
    .filter((value) => value.startsWith('bridge-rule-'))
    .map((value) => value.slice('bridge-rule-'.length))
}

/** 第 `index` 条规则的面板元素。 */
export function bridgeRule(page: Page, ruleId: string): Locator {
  return page.getByTestId(`bridge-rule-${ruleId}`)
}

/* ------------------------------------------------------------------------- */
/* 演示端口设置（plan §6.6 / §8.7）                                             */
/* ------------------------------------------------------------------------- */

/** 内置数据格式（演示端口）。 */
export type DemoFormat = 'sensor-a5' | 'firewater' | 'justfloat' | 'kv-text'

/** 内置协议 id。 */
export const JUSTFLOAT_PROTOCOL_ID = 'builtin:justfloat'
export const KV_TEXT_PROTOCOL_ID = 'builtin:kv-text'

export interface DemoSerialSessionOptions {
  format?: DemoFormat
  interval?: number
  channels?: number
  connect?: boolean
}

/** 选择 `setting-<key>` 里的原生 select 选项并确认值已生效。 */
export async function selectSettingOption(page: Page, key: string, value: string): Promise<void> {
  const root = settingField(page, key)
  await expect(root.locator('select')).toHaveCount(1)
  const select = root.locator('select').first()
  await select.selectOption(value)
  await expect(select).toHaveValue(value)
}

/**
 * 新增演示端口，先按 plan §6.6 设置数据格式 / 上报间隔 / 变量数，再连接。
 *
 * 这些字段由提供者的 `settingsSchema` 自动渲染为 `setting-format`、
 * `setting-interval`、`setting-channels`，因此不需要为演示端口写专用表单。
 */
export async function addDemoSerialSession(
  page: Page,
  options: DemoSerialSessionOptions = {},
): Promise<string> {
  const { connect = true } = options
  const before = await sessionTabs(page).count()
  await page.getByTestId('add-provider-virtual').click()
  await waitForSessionCount(page, before + 1)
  const ids = await sessionIds(page)
  const sessionId = ids.at(-1)
  if (sessionId === undefined) throw new Error('新增演示端口后没有找到会话标签')

  if (options.format !== undefined) {
    await selectSettingOption(page, 'format', options.format)
  }
  if (options.interval !== undefined) {
    await fillSettingNumber(page, 'interval', options.interval)
  }
  if (options.channels !== undefined) {
    await fillSettingNumber(page, 'channels', options.channels)
  }
  if (connect) await connectFocusedSession(page)
  return sessionId
}

/* ------------------------------------------------------------------------- */
/* Pane 视图切换（plan §11.4 / D1a 视图栏）                                    */
/* ------------------------------------------------------------------------- */

export type PaneViewKind = 'terminal' | 'dashboard'

export function paneViewButton(page: Page, paneIndex: number, view: PaneViewKind): Locator {
  const testId = view === 'terminal' ? 'pane-view-terminal' : 'pane-view-dashboard'
  if (paneIndex === 0) return page.getByTestId(testId).first()
  return pane(page, paneIndex).getByTestId(testId)
}

/** 切换 Pane 的终端 / 仪表盘视图（兼容 aria-pressed 与 aria-checked）。 */
export async function switchPaneView(
  page: Page,
  paneIndex: number,
  view: PaneViewKind,
): Promise<void> {
  const button = paneViewButton(page, paneIndex, view)
  await expect(button).toBeVisible({ timeout: 15_000 })
  const isActive = async (): Promise<boolean> => {
    const pressed = await button.getAttribute('aria-pressed')
    if (pressed !== null) return pressed === 'true'
    return (await button.getAttribute('aria-checked')) === 'true'
  }
  if (!(await isActive())) await button.click()
  await expect.poll(isActive, { timeout: 15_000 }).toBe(true)
}

export function dashboardPane(page: Page, paneIndex = 0): Locator {
  return pane(page, paneIndex).getByTestId('dashboard-pane')
}

export function dashboardToolbar(page: Page, paneIndex = 0): Locator {
  return pane(page, paneIndex).getByTestId('dashboard-toolbar')
}

export function dashboardButton(page: Page, name: string, paneIndex = 0): Locator {
  return dashboardToolbar(page, paneIndex).getByTestId(`dashboard-${name}`)
}

/** 点击仪表盘工具栏按钮或「更多」溢出菜单中的操作项。 */
export async function clickDashboardMoreAction(
  page: Page,
  name: 'duplicate' | 'rename' | 'delete' | 'import' | 'export' | 'pause' | 'export-csv',
  paneIndex = 0,
): Promise<void> {
  const direct = dashboardButton(page, name, paneIndex)
  if ((await direct.count()) > 0 && (await direct.isVisible())) {
    await direct.click()
    return
  }
  await dashboardButton(page, 'more', paneIndex).click()
  const item = page.getByTestId(`dashboard-${name}`)
  await expect(item).toBeVisible({ timeout: 10_000 })
  await item.click()
}

/** 打开仪表盘视图并等待工具栏出现。 */
export async function openDashboardPane(page: Page, paneIndex = 0): Promise<void> {
  const dashboardButtonLocator = paneViewButton(page, paneIndex, 'dashboard')
  if ((await dashboardButtonLocator.count()) === 0) {
    // 没有会话时 SerialToolView 显示空状态，只能从「打开仪表盘」入口进入。
    const open = page.getByTestId('empty-open-dashboard')
    await expect(open).toBeVisible({ timeout: 15_000 })
    await open.click()
  } else {
    await switchPaneView(page, paneIndex, 'dashboard')
  }
  await expect(dashboardToolbar(page, paneIndex)).toBeVisible({ timeout: 15_000 })
}

/** 切回终端视图并等待日志区出现。 */
export async function openTerminalPane(page: Page, paneIndex = 0): Promise<void> {
  await switchPaneView(page, paneIndex, 'terminal')
  await expect(pane(page, paneIndex).getByTestId('log-list')).toBeVisible({ timeout: 15_000 })
}

/* ------------------------------------------------------------------------- */
/* 仪表盘 CRUD 与工具栏（plan §8.10 / §11.4 / D1a）                             */
/* ------------------------------------------------------------------------- */

function dashboardSelect(page: Page, paneIndex = 0): Locator {
  return dashboardToolbar(page, paneIndex).getByTestId('dashboard-select')
}

/** 仪表盘下拉里的全部选项文本（首项是「新建空白仪表盘…」占位）。 */
export async function dashboardOptions(page: Page, paneIndex = 0): Promise<string[]> {
  const select = dashboardSelect(page, paneIndex)
  await expect(select).toBeVisible({ timeout: 15_000 })
  return select.evaluate((element) =>
    Array.from((element as HTMLSelectElement).options).map((option) =>
      (option.textContent ?? '').trim(),
    ),
  )
}

/** 当前选中的仪表盘名称（占位项返回空字符串）。 */
export async function selectedDashboardName(page: Page, paneIndex = 0): Promise<string> {
  const select = dashboardSelect(page, paneIndex)
  return select.evaluate((element) => {
    const selected = (element as HTMLSelectElement).selectedOptions[0]
    return selected === undefined ? '' : (selected.textContent ?? '').trim()
  })
}

/** 通过下拉选项文本选择仪表盘。 */
export async function selectDashboardByName(
  page: Page,
  name: string,
  paneIndex = 0,
): Promise<void> {
  const select = dashboardSelect(page, paneIndex)
  await expect
    .poll(async () => (await dashboardOptions(page, paneIndex)).includes(name), { timeout: 15_000 })
    .toBe(true)
  await select.selectOption({ label: name })
  await expect.poll(async () => selectedDashboardName(page, paneIndex)).toBe(name)
}

/**
 * 新建空白仪表盘（D1a：`dashboard-new` 弹出命名对话框）。
 *
 * 返回创建后的名称（未指定时使用默认名称）。
 */
export async function createBlankDashboard(
  page: Page,
  name = 'e2e 仪表盘',
  paneIndex = 0,
): Promise<string> {
  let button = dashboardButton(page, 'new', paneIndex)
  if ((await button.count()) === 0) {
    button = pane(page, paneIndex).getByTestId('dashboard-empty-new')
  }
  await expect(button).toBeVisible({ timeout: 15_000 })
  await button.click()

  const dialog = page.getByTestId('dashboard-name-dialog')
  if ((await dialog.count()) > 0) {
    await expect(dialog).toBeVisible()
    await page.getByTestId('dashboard-name-input').fill(name)
    await page.getByTestId('dashboard-name-confirm').click()
    await expect(dialog).toHaveCount(0)
  }
  await expect(dashboardButton(page, 'mode', paneIndex)).toHaveAttribute('data-mode', 'edit', {
    timeout: 15_000,
  })
  return name
}

/** 点击「一键生成」，并等待生成结果出现。 */
export async function generateDashboard(page: Page, paneIndex = 0): Promise<void> {
  let button = dashboardButton(page, 'generate', paneIndex)
  if ((await button.count()) === 0) {
    button = pane(page, paneIndex).getByTestId('dashboard-empty-generate')
  }
  await expect(button).toBeVisible({ timeout: 15_000 })
  await expect(button).toBeEnabled({ timeout: 15_000 })
  await button.click()
  await expect
    .poll(async () => (await widgetIds(page, paneIndex)).length, { timeout: 20_000 })
    .toBeGreaterThan(0)
}

/** 读取 `dashboard-mode` 的 `data-mode`。 */
export async function dashboardMode(page: Page, paneIndex = 0): Promise<string> {
  const mode = dashboardButton(page, 'mode', paneIndex)
  await expect(mode).toBeVisible({ timeout: 15_000 })
  return (await mode.getAttribute('data-mode')) ?? ''
}

/** 切换编辑 / 运行模式并等待 `data-mode` 生效。 */
export async function setDashboardMode(
  page: Page,
  mode: 'edit' | 'run',
  paneIndex = 0,
): Promise<void> {
  const button = dashboardButton(page, 'mode', paneIndex)
  await expect(button).toBeVisible({ timeout: 15_000 })
  if ((await button.getAttribute('data-mode')) !== mode) await button.click()
  await expect(button).toHaveAttribute('data-mode', mode, { timeout: 15_000 })
}

/** 点击撤销；`times` 次。 */
export async function dashboardUndo(page: Page, times = 1, paneIndex = 0): Promise<void> {
  for (let index = 0; index < times; index += 1) {
    await dashboardButton(page, 'undo', paneIndex).click()
  }
}

/** 点击重做；`times` 次。 */
export async function dashboardRedo(page: Page, times = 1, paneIndex = 0): Promise<void> {
  for (let index = 0; index < times; index += 1) {
    await dashboardButton(page, 'redo', paneIndex).click()
  }
}

/** 通过隐藏 file input 导入仪表盘 JSON。 */
export async function importDashboardFile(
  page: Page,
  fileName: string,
  text: string,
): Promise<void> {
  const input = page.getByTestId('dashboard-import-file')
  await expect(input).toHaveCount(1, { timeout: 15_000 })
  await input.setInputFiles({
    name: fileName,
    mimeType: 'application/json',
    buffer: Buffer.from(text, 'utf8'),
  })
}

/** 使用 `dashboard-export` 下载仪表盘 JSON。 */
export async function exportDashboardFile(page: Page, paneIndex = 0): Promise<DownloadedFile> {
  const downloadPromise = page.waitForEvent('download')
  await clickDashboardMoreAction(page, 'export', paneIndex)
  return readDownloadedFile(await downloadPromise)
}

/**
 * 把默认数据源绑定到指定会话。
 *
 * 工具栏的数据源下拉 testid 为 `dashboard-source-<alias>`；未选中组件时右侧的
 * 仪表盘设置里也有同样的行（`dashboard-source-row-<alias>`），两处都兼容。
 */
export async function bindDashboardSource(
  page: Page,
  alias: string,
  sessionId: string,
  paneIndex = 0,
): Promise<void> {
  const candidates = [
    pane(page, paneIndex).getByTestId(`dashboard-source-${alias}`),
    pane(page, paneIndex).getByTestId(`dashboard-source-row-${alias}`),
  ]
  let root: Locator | null = null
  for (const candidate of candidates) {
    if ((await candidate.count()) > 0) {
      root = candidate.first()
      break
    }
  }
  if (root === null)
    throw new Error(`没有找到数据源「${alias}」的下拉（dashboard-source-${alias}）`)
  const selects = root.locator('select')
  const select = (await selects.count()) > 0 ? selects.first() : root
  await expect
    .poll(async () => select.locator(`option[value="${sessionId}"]`).count(), { timeout: 15_000 })
    .toBe(1)
  await select.selectOption(sessionId)
  await expect(select).toHaveValue(sessionId)
}

/* ------------------------------------------------------------------------- */
/* 仪表盘组件定位与几何                                                        */
/* ------------------------------------------------------------------------- */

const WIDGET_CARD_SELECTOR = '[data-testid^="widget-"][data-type]'

export function widgetCards(page: Page, paneIndex = 0): Locator {
  return pane(page, paneIndex).locator(WIDGET_CARD_SELECTOR)
}

export function widgetCard(page: Page, widgetId: string, paneIndex = 0): Locator {
  return pane(page, paneIndex).getByTestId(`widget-${widgetId}`)
}

/** 按组件类型（`widget-<id>` 的 `data-type`）筛选。 */
export function widgetsByType(page: Page, type: string, paneIndex = 0): Locator {
  return pane(page, paneIndex).locator(`${WIDGET_CARD_SELECTOR}[data-type="${type}"]`)
}

export async function widgetIds(page: Page, paneIndex = 0): Promise<string[]> {
  const values = await widgetCards(page, paneIndex).evaluateAll((elements) =>
    elements.map((element) => element.getAttribute('data-testid') ?? ''),
  )
  return values
    .filter((value) => value.startsWith('widget-'))
    .map((value) => value.slice('widget-'.length))
}

export async function widgetId(widget: Locator): Promise<string> {
  const testId = await widget.getAttribute('data-testid')
  if (testId === null || !testId.startsWith('widget-')) {
    throw new Error(`元素不是仪表盘组件：${String(testId)}`)
  }
  return testId.slice('widget-'.length)
}

/** 读取组件根元素或内部元素上的测试钩子属性（如 data-display-value）。 */
export async function widgetDataAttribute(widget: Locator, name: string): Promise<string | null> {
  const inner = widget.locator(`[${name}]`)
  if ((await inner.count()) > 0) return inner.first().getAttribute(name)
  return widget.getAttribute(name)
}

export interface Box {
  x: number
  y: number
  width: number
  height: number
}

export async function widgetBox(widget: Locator): Promise<Box> {
  const box = await widget.boundingBox()
  if (box === null) throw new Error('组件不可见，无法读取位置')
  return box
}

export async function widgetBoxes(page: Page, paneIndex = 0): Promise<Record<string, Box>> {
  const result: Record<string, Box> = {}
  const ids = await widgetIds(page, paneIndex)
  for (const id of ids) {
    result[id] = await widgetBox(widgetCard(page, id, paneIndex))
  }
  return result
}

function boxesOverlap(a: Box, b: Box, tolerance = 1.5): boolean {
  const overlapX = Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x)
  const overlapY = Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y)
  return overlapX > tolerance && overlapY > tolerance
}

/** 断言所有组件互不重叠（拖动 / 缩放后使用）。 */
export async function expectWidgetsDoNotOverlap(page: Page, paneIndex = 0): Promise<void> {
  await expect
    .poll(
      async () => {
        const boxes = Object.values(await widgetBoxes(page, paneIndex))
        let overlaps = 0
        for (let a = 0; a < boxes.length; a += 1) {
          for (let b = a + 1; b < boxes.length; b += 1) {
            const first = boxes[a]
            const second = boxes[b]
            if (first !== undefined && second !== undefined && boxesOverlap(first, second)) {
              overlaps += 1
            }
          }
        }
        return overlaps
      },
      { timeout: 10_000 },
    )
    .toBe(0)
}

/** 等待组件位置与期望值一致（容差 2px，用于撤销/重做断言）。 */
export async function expectWidgetBoxClose(
  page: Page,
  widget: Locator,
  expected: Box,
  tolerance = 2,
): Promise<void> {
  await expect
    .poll(
      async () => {
        const box = await widgetBox(widget)
        const close =
          Math.abs(box.x - expected.x) <= tolerance &&
          Math.abs(box.y - expected.y) <= tolerance &&
          Math.abs(box.width - expected.width) <= tolerance * 2 &&
          Math.abs(box.height - expected.height) <= tolerance * 2
        return close
      },
      { timeout: 10_000 },
    )
    .toBe(true)
}

/** 选中组件（编辑模式）并等待属性面板出现字段。 */
export async function selectWidget(page: Page, widget: Locator, paneIndex = 0): Promise<void> {
  // 编辑模式下 WidgetFrame 的 pointer-events 为 none，点击命中的是 GridCanvas 的
  // 组件包装层（testid 所在元素），因此直接点击包装层左上角。
  await widget.click({ position: { x: 8, y: 8 } })
  const properties = pane(page, paneIndex).getByTestId('dashboard-properties')
  await expect(properties).toBeVisible()
  await expect(properties.locator('[data-testid^="prop-"]').first()).toBeVisible({
    timeout: 10_000,
  })
}

/* ------------------------------------------------------------------------- */
/* 属性面板（plan §8.10 / D1a testid 约定）                                     */
/* ------------------------------------------------------------------------- */

export function dashboardProperties(page: Page, paneIndex = 0): Locator {
  return pane(page, paneIndex).getByTestId('dashboard-properties')
}

export function propField(page: Page, key: string, paneIndex = 0): Locator {
  return dashboardProperties(page, paneIndex).getByTestId(`prop-${key}`)
}

/** 切换属性面板标签页（data / style / behavior）。 */
export async function openPropertyTab(
  page: Page,
  tab: 'data' | 'style' | 'behavior',
  paneIndex = 0,
): Promise<void> {
  const button = dashboardProperties(page, paneIndex).locator(`[data-tab-key="${tab}"]`)
  if ((await button.count()) > 0) await button.first().click()
}

/**
 * 属性字段内部真正可输入的原生控件。
 *
 * D1a 约定字段编辑器控件上带 `prop-input-<key>`、`prop-color-<key>` 等 testid；
 * 这些 testid 有时放在包装元素上，因此优先取内部的 input / textarea / select。
 */
async function fieldControl(root: Locator, testId: string): Promise<Locator> {
  const holder = root.getByTestId(testId)
  await expect(holder).toHaveCount(1)
  const inner = holder.locator('input, textarea, select')
  if ((await inner.count()) > 0) return inner.first()
  return holder
}

async function expectOptionAvailable(select: Locator, value: string): Promise<void> {
  await expect(select.locator(`option[value="${value}"]`)).toHaveCount(1, { timeout: 15_000 })
}

async function selectOptionByValueOrLabel(
  select: Locator,
  value: string,
  label: string,
): Promise<void> {
  const native = select.locator('select')
  const target = (await native.count()) > 0 ? native.first() : select
  if ((await target.locator(`option[value="${value}"]`).count()) > 0) {
    await target.selectOption(value)
    return
  }
  await target.selectOption({ label })
}

/** 填写 number 属性。 */
export async function setPropNumber(
  page: Page,
  key: string,
  value: number,
  paneIndex = 0,
): Promise<void> {
  const control = await fieldControl(propField(page, key, paneIndex), `prop-input-${key}`)
  await control.fill(String(value))
  await control.press('Enter')
  await control.blur()
}

/** 填写 text / textarea 属性。 */
export async function setPropText(
  page: Page,
  key: string,
  value: string,
  paneIndex = 0,
): Promise<void> {
  const control = await fieldControl(propField(page, key, paneIndex), `prop-input-${key}`)
  await control.fill(value)
  await control.press('Enter')
  await control.blur()
}

/** 勾选 / 取消勾选 checkbox 属性。 */
export async function setPropCheckbox(
  page: Page,
  key: string,
  checked: boolean,
  paneIndex = 0,
): Promise<void> {
  const field = propField(page, key, paneIndex)
  const control = await fieldControl(field, `prop-input-${key}`)
  const role = control.locator('[role="switch"], input[type="checkbox"]')
  const target = (await role.count()) > 0 ? role.first() : control
  const isChecked = await target.evaluate((element) => {
    if (element instanceof HTMLInputElement) return element.checked
    return element.getAttribute('aria-checked') === 'true'
  })
  if (isChecked === checked) return
  if (await target.evaluate((element) => element instanceof HTMLInputElement)) {
    // UiCheckbox 的原生 input 被视觉层覆盖，直接触发它的 click 事件。
    await target.evaluate((element) => (element as HTMLInputElement).click())
    return
  }
  await target.click()
}

/** 选择 select 属性。 */
export async function setPropSelect(
  page: Page,
  key: string,
  value: string,
  paneIndex = 0,
): Promise<void> {
  const control = await fieldControl(propField(page, key, paneIndex), `prop-input-${key}`)
  const select = control.locator('select')
  const target = (await select.count()) > 0 ? select.first() : control
  await target.selectOption(value)
}

/** 选择「选项文本包含给定文字」的某项（用于文案随实现变化的枚举）。 */
export async function selectPropOptionContaining(
  page: Page,
  key: string,
  text: string,
  paneIndex = 0,
): Promise<void> {
  const control = await fieldControl(propField(page, key, paneIndex), `prop-input-${key}`)
  const select = control.locator('select')
  const target = (await select.count()) > 0 ? select.first() : control
  const value = await target.evaluate((element, needle) => {
    const options = Array.from((element as HTMLSelectElement).options)
    return options.find((option) => (option.textContent ?? '').includes(needle))?.value ?? ''
  }, text)
  if (value === '') throw new Error(`属性「${key}」里没有包含「${text}」的选项`)
  await target.selectOption(value)
}

/** 填写颜色属性（十六进制文本 + 回车）。 */
export async function setPropColor(
  page: Page,
  key: string,
  hex: string,
  paneIndex = 0,
): Promise<void> {
  const field = propField(page, key, paneIndex)
  // 颜色属性默认可能是「自动」，此时输入框被禁用，先取消自动。
  const auto = field.getByTestId(`prop-color-auto-${key}`)
  if ((await auto.count()) > 0) {
    const checkbox = auto.locator('input[type="checkbox"]').first()
    const checked =
      (await checkbox.count()) > 0
        ? await checkbox.isChecked()
        : (await auto.getAttribute('aria-checked')) === 'true'
    if (checked) await auto.click()
  }
  const holder = field.getByTestId(`prop-color-${key}`)
  const textInput = holder.locator('input.ui-color-input__text').first()
  const control =
    (await textInput.count()) > 0
      ? textInput
      : holder.locator('input[type="text"], input:not([type])').first()
  await control.fill(hex)
  await control.press('Enter')
  await control.blur()
}

/** 选中单个变量属性（字段类型 `variable`）。 */
export async function setPropVariable(
  page: Page,
  key: string,
  variableKey: string,
  alias = 'main',
  paneIndex = 0,
): Promise<void> {
  const field = propField(page, key, paneIndex)
  const sourceRoot = field.getByTestId(`prop-variable-source-${key}`)
  if ((await sourceRoot.count()) > 0) {
    const select = await fieldControl(field, `prop-variable-source-${key}`)
    const target =
      (await select.locator('select').count()) > 0 ? select.locator('select').first() : select
    await expectOptionAvailable(target, alias)
    await target.selectOption(alias)
  }
  const keyControl = await fieldControl(field, `prop-variable-key-${key}`)
  const target =
    (await keyControl.locator('select').count()) > 0
      ? keyControl.locator('select').first()
      : keyControl
  await expectOptionAvailable(target, variableKey)
  await target.selectOption(variableKey)
}

/** 给 `variables` 类型属性追加一个变量（默认第 0 行）。 */
export async function addPropVariable(
  page: Page,
  key: string,
  variableKey: string,
  alias = 'main',
  index = 0,
  paneIndex = 0,
): Promise<void> {
  const field = propField(page, key, paneIndex)
  const rowTestId = `prop-var-row-${key}-${String(index)}`
  if ((await field.getByTestId(rowTestId).count()) === 0) {
    const addButton = field.getByTestId(`prop-variables-add-${key}`)
    await expect(addButton).toBeVisible({ timeout: 10_000 })
    await addButton.click()
  }
  const source = field.getByTestId(`prop-var-source-${key}-${String(index)}`)
  if ((await source.count()) > 0) {
    const control =
      (await source.locator('select').count()) > 0 ? source.locator('select').first() : source
    await expectOptionAvailable(control, alias)
    await control.selectOption(alias)
  }
  const variable = field.getByTestId(`prop-var-key-${key}-${String(index)}`)
  const control =
    (await variable.locator('select').count()) > 0 ? variable.locator('select').first() : variable
  await expectOptionAvailable(control, variableKey)
  await control.selectOption(variableKey)
}

/** 读取 `variables` 属性当前行数。 */
export async function propVariableRowCount(
  page: Page,
  key: string,
  paneIndex = 0,
): Promise<number> {
  return propField(page, key, paneIndex).locator(`[data-testid^="prop-var-row-${key}-"]`).count()
}

/** 给 `zones` 属性添加一行区间（`from` / `to` / `color`）。 */
export async function addPropZone(
  page: Page,
  key: string,
  zone: { from: number; to: number; color: string },
  index = 0,
  paneIndex = 0,
): Promise<void> {
  const field = propField(page, key, paneIndex)
  const rowTestId = `prop-zone-row-${key}-${String(index)}`
  if ((await field.getByTestId(rowTestId).count()) === 0) {
    const addButton = field.getByTestId(`prop-zones-add-${key}`)
    await expect(addButton).toBeVisible({ timeout: 10_000 })
    await addButton.click()
  }
  for (const [name, value] of [
    ['from', zone.from],
    ['to', zone.to],
  ] as const) {
    const holder = field.getByTestId(`prop-zones-${name}-${key}-${String(index)}`)
    await expect(holder).toHaveCount(1)
    const control =
      (await holder.locator('input').count()) > 0 ? holder.locator('input').first() : holder
    await control.fill(String(value))
    await control.press('Enter')
  }
  const color = field.getByTestId(`prop-zones-color-${key}-${String(index)}`)
  const textInput = color.locator('input.ui-color-input__text').first()
  const control =
    (await textInput.count()) > 0
      ? textInput
      : color.locator('input[type="text"], input:not([type])').first()
  await control.fill(zone.color)
  await control.press('Enter')
}

/** 配置命令属性的模板模式（字段类型 `command`）。 */
export async function setPropCommandTemplate(
  page: Page,
  key: string,
  command: {
    mode: 'text' | 'hex'
    template: string
    eol?: 'none' | 'cr' | 'lf' | 'crlf'
    source?: string
  },
  paneIndex = 0,
): Promise<void> {
  const field = propField(page, key, paneIndex)
  const kind = await fieldControl(field, `prop-command-kind-${key}`)
  await selectOptionByValueOrLabel(kind, 'template', '模板')

  const sourceSelect = field.getByTestId(`prop-command-source-${key}`)
  if ((await sourceSelect.count()) > 0 && command.source !== undefined) {
    const control =
      (await sourceSelect.locator('select').count()) > 0
        ? sourceSelect.locator('select').first()
        : sourceSelect
    if ((await control.locator(`option[value="${command.source}"]`).count()) > 0) {
      await control.selectOption(command.source)
    }
  }

  const mode = await fieldControl(field, `prop-command-mode-${key}`)
  await selectOptionByValueOrLabel(mode, command.mode, command.mode === 'hex' ? 'HEX' : '文本')

  const template = await fieldControl(field, `prop-command-template-${key}`)
  await template.fill(command.template)

  if (command.eol !== undefined) {
    const eol = await fieldControl(field, `prop-command-eol-${key}`)
    await selectOptionByValueOrLabel(eol, command.eol, command.eol.toUpperCase())
  }
}

/** 读取 `variable` 属性当前绑定的变量 key（兼容直接 select 与 UiSelect 包装）。 */
export async function propVariableBoundKey(
  page: Page,
  fieldKey = 'variable',
  paneIndex = 0,
): Promise<string> {
  const root = propField(page, fieldKey, paneIndex).getByTestId(`prop-variable-key-${fieldKey}`)
  const inner = root.locator('select')
  const select = (await inner.count()) > 0 ? inner.first() : root
  return select.inputValue()
}

/** 填写命令属性的实时预览文本（示例或错误）。 */
export async function propCommandPreview(page: Page, key: string, paneIndex = 0): Promise<string> {
  return propField(page, key, paneIndex).getByTestId(`prop-command-preview-${key}`).innerText()
}

/* ------------------------------------------------------------------------- */
/* 鼠标拖拽（库 → 画布、变量 → 画布 / 组件、组件移动与缩放）                    */
/* ------------------------------------------------------------------------- */

async function dragPointToPoint(
  page: Page,
  start: { x: number; y: number },
  end: { x: number; y: number },
): Promise<void> {
  await page.mouse.move(start.x, start.y)
  await page.mouse.down()
  // 先小步移动越过拖拽阈值，再按若干步移动到目标点。
  await page.mouse.move(start.x + 6, start.y + 6)
  await page.mouse.move(end.x, end.y, { steps: 12 })
  await page.mouse.up()
}

/**
 * 用真实 DataTransfer 在页面内派发 HTML5 拖放事件序列（dragstart → dragenter →
 * dragover → drop）。
 *
 * 组件库与变量列表用的是 `draggable` + `dataTransfer`，纯 `page.mouse` 在 Chromium
 * 中不会触发原生 DnD，而 `dragTo` 在自定义的 hover/占位逻辑下坐标不稳定。这里直接
 * 在页面里创建 DataTransfer 并按真实事件的顺序派发，语义仍是用户拖放。
 */
async function html5DropOnCanvas(
  page: Page,
  source: Locator,
  paneIndex: number,
  point: { x: number; y: number },
): Promise<void> {
  const canvas = gridCanvas(page, paneIndex)
  const dataTransfer = await page.evaluateHandle(() => new DataTransfer())
  await source.dispatchEvent('dragstart', { dataTransfer })
  await canvas.dispatchEvent('dragenter', {
    dataTransfer,
    clientX: point.x,
    clientY: point.y,
  })
  await canvas.dispatchEvent('dragover', {
    dataTransfer,
    clientX: point.x,
    clientY: point.y,
  })
  await canvas.dispatchEvent('drop', {
    dataTransfer,
    clientX: point.x,
    clientY: point.y,
  })
  await dataTransfer.dispose()
}

async function centerOf(locator: Locator): Promise<{ x: number; y: number }> {
  const box = await locator.boundingBox()
  if (box === null) throw new Error('拖拽源不可见')
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 }
}

export function gridCanvas(page: Page, paneIndex = 0): Locator {
  return pane(page, paneIndex).getByTestId('grid-canvas')
}

/** 画布内按比例取点（0–1）。 */
export async function canvasPoint(
  page: Page,
  xRatio = 0.6,
  yRatio = 0.5,
  paneIndex = 0,
): Promise<{ x: number; y: number }> {
  const canvas = await gridCanvas(page, paneIndex).boundingBox()
  if (canvas === null) throw new Error('画布不可见')
  return {
    x: canvas.x + canvas.width * xRatio,
    y: canvas.y + canvas.height * yRatio,
  }
}

/** 把组件库条目拖到画布指定比例位置。 */
export async function dragLibraryItemToCanvas(
  page: Page,
  type: string,
  position: { xRatio?: number; yRatio?: number } = {},
  paneIndex = 0,
): Promise<void> {
  const item = pane(page, paneIndex).getByTestId(`library-item-${type}`)
  await expect(item).toBeVisible({ timeout: 15_000 })
  const point = await canvasPoint(page, position.xRatio ?? 0.6, position.yRatio ?? 0.3, paneIndex)
  await html5DropOnCanvas(page, item, paneIndex, point)
}

/** 把变量列表中的变量拖到画布空白处（新建波形图）。 */
export async function dragVariableToCanvas(
  page: Page,
  variableKey: string,
  position: { xRatio?: number; yRatio?: number } = {},
  paneIndex = 0,
): Promise<void> {
  const item = pane(page, paneIndex).getByTestId(`variable-item-${variableKey}`)
  await expect(item).toBeVisible({ timeout: 15_000 })
  const point = await canvasPoint(page, position.xRatio ?? 0.6, position.yRatio ?? 0.3, paneIndex)
  await html5DropOnCanvas(page, item, paneIndex, point)
}

/** 把变量列表中的变量拖到某个组件上（追加 / 替换绑定）。 */
export async function dragVariableToWidget(
  page: Page,
  variableKey: string,
  widget: Locator,
  paneIndex = 0,
): Promise<void> {
  const item = pane(page, paneIndex).getByTestId(`variable-item-${variableKey}`)
  await expect(item).toBeVisible({ timeout: 15_000 })
  await selectWidget(page, widget, paneIndex)
  await openPropertyTab(page, 'data', paneIndex)
  const point = await centerOf(widget)
  await html5DropOnCanvas(page, item, paneIndex, point)
}

/** 拖动组件本身（编辑模式下 GridCanvas 的包装层负责 pointermove）。 */
export async function moveWidget(
  page: Page,
  widget: Locator,
  delta: { dx: number; dy: number },
): Promise<void> {
  const start = await centerOf(widget)
  await dragPointToPoint(page, start, { x: start.x + delta.dx, y: start.y + delta.dy })
}

/** 拖动右下角缩放手柄。 */
export async function resizeWidget(
  page: Page,
  widgetIdValue: string,
  delta: { dx: number; dy: number },
  paneIndex = 0,
): Promise<void> {
  const handle = pane(page, paneIndex).getByTestId(`widget-resize-${widgetIdValue}`)
  await expect(handle).toBeVisible({ timeout: 10_000 })
  const start = await centerOf(handle)
  await dragPointToPoint(page, start, { x: start.x + delta.dx, y: start.y + delta.dy })
}

/* ------------------------------------------------------------------------- */
/* 变量列表 / 计算变量（plan §8.10）                                            */
/* ------------------------------------------------------------------------- */

export function variableItem(page: Page, key: string, paneIndex = 0): Locator {
  return pane(page, paneIndex).getByTestId(`variable-item-${key}`)
}

/** 变量列表里的显示值（`data-value`）。 */
export async function variableDisplayValue(
  page: Page,
  key: string,
  paneIndex = 0,
): Promise<string> {
  const item = variableItem(page, key, paneIndex)
  await expect(item).toBeVisible({ timeout: 15_000 })
  return (await item.getAttribute('data-value')) ?? (await item.innerText())
}

/** 通过变量名在给定类型的组件里找到绑定了该变量的组件。 */
export async function findWidgetByVariable(
  page: Page,
  type: string,
  propKey: string,
  variableKey: string,
  paneIndex = 0,
): Promise<Locator> {
  const widgets = widgetsByType(page, type, paneIndex)
  const total = await widgets.count()
  for (let index = 0; index < total; index += 1) {
    const widget = widgets.nth(index)
    await selectWidget(page, widget, paneIndex)
    await openPropertyTab(page, 'data', paneIndex)
    const field = propField(page, propKey, paneIndex)
    if ((await field.count()) === 0) continue
    const root = field.getByTestId(`prop-variable-key-${propKey}`)
    if ((await root.count()) === 0) continue
    const select =
      (await root.locator('select').count()) > 0 ? root.locator('select').first() : root
    if ((await select.inputValue()) === variableKey) return widget
  }
  throw new Error(`没有找到绑定变量 ${variableKey} 的 ${type} 组件`)
}

/** 通过输入对话框新增计算变量。 */
export async function addComputedVariable(
  page: Page,
  variable: { key: string; expr: string; unit?: string },
  paneIndex = 0,
): Promise<void> {
  const addButton = pane(page, paneIndex).getByTestId('variable-add-computed')
  await expect(addButton).toBeVisible({ timeout: 15_000 })
  await addButton.click()

  // 面板内容有 `variable-computed-dialog` testid，确认按钮在 UiDialog 的 footer 里，
  // 因此以 role=dialog 为操作范围，字段用实际 testid / aria-label 定位。
  const dialog = page.getByRole('dialog', { name: '新增计算变量' }).last()
  await expect(dialog).toBeVisible({ timeout: 15_000 })
  const nameInput = dialog.getByTestId('variable-computed-name')
  const exprInput = dialog.getByTestId('variable-computed-expr')
  if ((await nameInput.count()) > 0) {
    await nameInput.fill(variable.key)
  } else {
    await dialog.getByLabel('变量名', { exact: true }).fill(variable.key)
  }
  if ((await exprInput.count()) > 0) {
    await exprInput.fill(variable.expr)
  } else {
    await dialog.getByLabel('表达式', { exact: true }).fill(variable.expr)
  }
  if (variable.unit !== undefined) {
    const unit = dialog.getByLabel('单位', { exact: true })
    if ((await unit.count()) > 0) await unit.first().fill(variable.unit)
  }

  await dialog.getByRole('button', { name: '添加', exact: true }).click()
  await expect(dialog).toHaveCount(0, { timeout: 10_000 })
  await expect(variableItem(page, `fx.${variable.key}`, paneIndex)).toBeVisible({
    timeout: 15_000,
  })
}

/* ------------------------------------------------------------------------- */
/* 通用对话框 / Toast                                                          */
/* ------------------------------------------------------------------------- */

/** 当前最上层的对话框（UiDialog 的 role=dialog）。 */
export function currentDialog(page: Page): Locator {
  return page.getByRole('dialog').last()
}

/** 在对话框里点击指定文案的按钮。 */
export async function clickDialogButton(
  page: Page,
  name: string | RegExp,
  dialog?: Locator,
): Promise<void> {
  const target = dialog ?? currentDialog(page)
  await expect(target).toBeVisible({ timeout: 15_000 })
  await target.getByRole('button', { name }).first().click()
}

/** 等待 Toast 文案出现。 */
export async function waitForToast(page: Page, text: string | RegExp): Promise<void> {
  const pattern = typeof text === 'string' ? new RegExp(text) : text
  await expect(
    page.locator('.service-toast__message').filter({ hasText: pattern }).first(),
  ).toBeVisible({ timeout: 15_000 })
}

/** 通过设置抽屉显式选择主题（比顶栏循环按钮更确定）。 */
export async function setThemeViaSettings(
  page: Page,
  theme: 'dark' | 'light' | 'system',
): Promise<void> {
  const label = theme === 'dark' ? '深色' : theme === 'light' ? '浅色' : '跟随系统'
  await openSettingsDrawer(page)
  await page
    .getByTestId('appearance-theme')
    .getByRole('radio', { name: label, exact: true })
    .click()
  if (theme !== 'system') await expect(page.locator('html')).toHaveAttribute('data-theme', theme)
  await closeSettingsDrawer(page)
}

/** 关闭设置抽屉（Esc）。 */
export async function closeSettingsDrawer(page: Page): Promise<void> {
  if ((await page.getByTestId('settings-drawer').count()) === 0) return
  await page.keyboard.press('Escape')
  await expect(page.getByTestId('settings-drawer')).toHaveCount(0)
}

/** 轮换主题按钮并返回切换后的主题。 */
export async function cycleTheme(page: Page): Promise<string> {
  const before = await page.locator('html').getAttribute('data-theme')
  await page.getByTestId('theme-toggle').click()
  await expect
    .poll(async () => page.locator('html').getAttribute('data-theme'), { timeout: 5_000 })
    .not.toBe(before)
  return (await page.locator('html').getAttribute('data-theme')) ?? ''
}

/* ------------------------------------------------------------------------- */
/* 自定义控件编辑器（plan §8.12 / §6.10；D1c 实现，部分 testid 为契约约定）        */
/* ------------------------------------------------------------------------- */

/** 自定义控件编辑器根元素（优先 `custom-widget-editor`，兼容全屏 dialog）。 */
export function customWidgetEditor(page: Page): Locator {
  const byTestId = page.getByTestId('custom-widget-editor')
  return byTestId
}

/** 编辑器内的属性字段容器（与仪表盘属性面板分离定位）。 */
function editorPropField(editor: Locator, key: string): Locator {
  return editor.locator(`[data-testid="prop-${key}"]`).first()
}

/** 首次打开 / 新建时可能出现的自定义控件安全说明，点击确认。 */
async function dismissCustomWidgetSafety(page: Page): Promise<void> {
  const editor = page.getByTestId('custom-widget-editor')
  // 等待编辑器出现，避免在异步加载前误判为「没有安全说明」。
  await expect(editor).toBeVisible({ timeout: 8_000 })
  const safety = page.getByTestId('custom-widget-safety')
  if ((await safety.count()) === 0 || !(await safety.first().isVisible())) return
  const dismiss = page.getByTestId('custom-widget-safety-dismiss')
  await expect(dismiss).toBeVisible()
  await dismiss.click()
  await expect(safety).toHaveCount(0, { timeout: 5_000 })
}

/** 打开自定义控件编辑器（需处于仪表盘编辑模式，组件库「自定义」组里有入口）。 */
export async function openCustomWidgetEditor(page: Page): Promise<Locator> {
  await openDashboardPane(page)
  await setDashboardMode(page, 'edit')
  const opener = pane(page).getByTestId('custom-widget-editor-open')
  await expect(opener).toBeVisible({ timeout: 15_000 })
  await opener.click()
  const editor = customWidgetEditor(page)
  await expect(editor).toBeVisible({ timeout: 15_000 })
  await dismissCustomWidgetSafety(page)
  return editor
}

/** 用指定模板新建自定义控件（模板名为 plan §6.10 的 4 个模板之一）。 */
export async function newCustomWidgetFromTemplate(
  page: Page,
  templateLabel: string,
): Promise<void> {
  const editor = customWidgetEditor(page)
  const dialog =
    (await editor.count()) > 0 && (await editor.first().isVisible())
      ? editor.first()
      : page.getByRole('dialog', { name: /自定义控件/ }).last()
  const create = dialog.getByTestId('custom-widget-new')
  await expect(create).toBeVisible({ timeout: 15_000 })
  await create.click()

  const templates = dialog
    .locator('[data-testid^="custom-widget-template-"]')
    .filter({ hasText: templateLabel })
  await expect(templates.first()).toBeVisible({ timeout: 10_000 })
  await templates.first().click()
  // 首次新建会显示安全说明。
  await dismissCustomWidgetSafety(page)
}

/** 整体替换编辑器里的代码（CodeMirror 6）。 */
export async function setCustomWidgetCode(page: Page, code: string, marker: string): Promise<void> {
  const editor = customWidgetEditor(page)
  const root =
    (await editor.count()) > 0 && (await editor.first().isVisible())
      ? editor.first()
      : page.getByRole('dialog', { name: /自定义控件/ }).last()
  const content = root.locator('.cm-content').first()
  await expect(content).toBeVisible({ timeout: 15_000 })
  await content.click()
  try {
    await content.fill(code)
  } catch {
    // contenteditable 的 fill 可能被拒绝，退回全选后 insertText。
  }
  if (!(await content.innerText()).includes(marker)) {
    await page.keyboard.press('Control+A')
    await page.keyboard.insertText(code)
  }
  await expect(content).toContainText(marker, { timeout: 5_000 })
}

/** 绑定自定义控件预览里的第一个变量（有变量声明时）。 */
export async function bindCustomWidgetPreviewVariable(
  page: Page,
  variableKey = 'ch0',
): Promise<boolean> {
  const editor = customWidgetEditor(page)
  const root =
    (await editor.count()) > 0 && (await editor.first().isVisible())
      ? editor.first()
      : page.getByRole('dialog', { name: /自定义控件/ }).last()
  const single = editorPropField(root, 'variable')
  if ((await single.count()) > 0) {
    const keyRoot = single.getByTestId('prop-variable-key-variable')
    const sourceRoot = single.getByTestId('prop-variable-source-variable')
    if ((await sourceRoot.count()) > 0) {
      const control =
        (await sourceRoot.locator('select').count()) > 0
          ? sourceRoot.locator('select').first()
          : sourceRoot
      await control.selectOption('main').catch(() => undefined)
    }
    const control =
      (await keyRoot.locator('select').count()) > 0 ? keyRoot.locator('select').first() : keyRoot
    if ((await control.locator(`option[value="${variableKey}"]`).count()) > 0) {
      await control.selectOption(variableKey)
      return true
    }
    return false
  }
  const rows = root.locator('[data-testid^="prop-var-row-variables-"]')
  if ((await rows.count()) === 0) {
    const add = root.getByTestId('prop-variables-add-variables')
    if ((await add.count()) === 0) return false
    await add.click()
  }
  const keyRoot = root.getByTestId('prop-var-key-variables-0')
  const control =
    (await keyRoot.locator('select').count()) > 0 ? keyRoot.locator('select').first() : keyRoot
  if ((await control.count()) === 0) return false
  if ((await control.locator(`option[value="${variableKey}"]`).count()) === 0) return false
  await control.selectOption(variableKey)
  return true
}

/** 预览框（编辑器右栏），返回编辑器内第一个预览容器。 */
export function customWidgetPreview(page: Page): Locator {
  const byTestId = page.getByTestId('custom-widget-preview')
  return byTestId
}

/** 点击「运行预览」并等待编辑器给出结果。 */
export async function runCustomWidgetPreview(page: Page): Promise<void> {
  const editor = customWidgetEditor(page)
  const root =
    (await editor.count()) > 0 && (await editor.first().isVisible())
      ? editor.first()
      : page.getByRole('dialog', { name: /自定义控件/ }).last()
  await dismissCustomWidgetSafety(page)
  await bindCustomWidgetPreviewVariable(page)
  await root.getByTestId('custom-widget-run').click()
  // 编译错误会显示在编辑器里；给出较短的失败等待，让调用方拿到明确信息。
  const error = root.getByText(/语法错误|代码执行出错|apiVersion 必须|mount 必须是函数/)
  await expect(error).toHaveCount(0, { timeout: 5_000 })
}

/** 保存当前自定义控件（运行预览即「保存并运行」；也兼容独立保存按钮）。 */
export async function saveCustomWidget(page: Page): Promise<void> {
  const editor = customWidgetEditor(page)
  const root =
    (await editor.count()) > 0 && (await editor.first().isVisible())
      ? editor.first()
      : page.getByRole('dialog', { name: /自定义控件/ }).last()
  const save = root.getByTestId('custom-widget-save')
  if ((await save.count()) > 0 && (await save.isVisible())) {
    await save.click()
    await expect(root.getByTestId('custom-widget-editor-name')).not.toContainText('未保存', {
      timeout: 10_000,
    })
    return
  }
  await root.getByTestId('custom-widget-run').click()
}

/** 关闭自定义控件编辑器。 */
export async function closeCustomWidgetEditor(page: Page): Promise<void> {
  const editor = customWidgetEditor(page)
  if ((await editor.count()) === 0 || !(await editor.first().isVisible())) {
    const dialog = page.getByRole('dialog', { name: /自定义控件/ }).last()
    if ((await dialog.count()) === 0) return
    await page.keyboard.press('Escape')
    await expect(dialog).toHaveCount(0, { timeout: 10_000 })
    return
  }
  await page.keyboard.press('Escape')
  if (
    await editor
      .first()
      .isVisible()
      .catch(() => false)
  ) {
    const close = editor.first().getByRole('button', { name: /关闭/ }).first()
    if ((await close.count()) > 0) await close.click()
  }
  await expect(editor).toHaveCount(0, { timeout: 10_000 })
}

/** 组件库「自定义」组里现有自定义控件的 id（`library-item-custom:<id>`）。 */
export async function customWidgetLibraryIds(page: Page, paneIndex = 0): Promise<string[]> {
  const values = await pane(page, paneIndex)
    .locator('[data-testid^="library-item-custom:"]')
    .evaluateAll((elements) => elements.map((element) => element.getAttribute('data-testid') ?? ''))
  return values
    .filter((value) => value.startsWith('library-item-custom:'))
    .map((value) => value.slice('library-item-custom:'.length))
}

/**
 * 通过编辑器新建一个自定义控件，返回自定义控件 id。
 *
 * 流程：打开编辑器 → 按模板新建 → 可选替换代码 → 运行预览 → 保存 → 关闭。
 */
export async function createCustomWidget(
  page: Page,
  options: { templateLabel?: string; code?: string; name?: string } = {},
): Promise<string> {
  await openDashboardPane(page)
  await setDashboardMode(page, 'edit')
  const before = new Set(await customWidgetLibraryIds(page))
  await openCustomWidgetEditor(page)
  await newCustomWidgetFromTemplate(page, options.templateLabel ?? '最小数值显示')
  if (options.code !== undefined) {
    await setCustomWidgetCode(page, options.code, options.name ?? 'e2e')
  }
  await runCustomWidgetPreview(page)
  await saveCustomWidget(page)
  await closeCustomWidgetEditor(page)
  await expect
    .poll(async () => (await customWidgetLibraryIds(page)).length, { timeout: 15_000 })
    .toBeGreaterThan(before.size)
  const after = await customWidgetLibraryIds(page)
  const created = after.find((id) => !before.has(id))
  if (created === undefined) throw new Error('创建自定义控件后没有在组件库中找到它')
  return created
}

/** 把自定义控件放到仪表盘（点击组件库条目会放在第一个空位）。 */
export async function placeCustomWidgetOnDashboard(
  page: Page,
  customId: string,
  paneIndex = 0,
): Promise<Locator> {
  const item = pane(page, paneIndex).getByTestId(`library-item-custom:${customId}`)
  await expect(item).toBeVisible({ timeout: 15_000 })
  await item.click()
  const widget = widgetsByType(page, `custom:${customId}`, paneIndex).first()
  await expect(widget).toBeVisible({ timeout: 10_000 })
  return widget
}

/** 给自定义控件实例绑定第一个变量（属性面板的「数据」页）。 */
export async function bindCustomWidgetVariable(
  page: Page,
  widget: Locator,
  variableKey: string,
  paneIndex = 0,
): Promise<void> {
  await selectWidget(page, widget, paneIndex)
  await openPropertyTab(page, 'data', paneIndex)
  const single = propField(page, 'variable', paneIndex)
  if ((await single.count()) > 0) {
    await setPropVariable(page, 'variable', variableKey, 'main', paneIndex)
    return
  }
  await addPropVariable(page, 'variables', variableKey, 'main', 0, paneIndex)
}

/* ------------------------------------------------------------------------- */
/* 安全模式（plan §6.10 / §11.4 用例 20）                                       */
/* ------------------------------------------------------------------------- */

export const SAFE_MODE_PENDING_KEY = 'toolset/safe-mode/pending'
export const SAFE_MODE_BLOCKED_KEY = 'toolset/safe-mode/blocked'

export function safeModeBanner(page: Page): Locator {
  return page.getByTestId('safe-mode-banner')
}

/** 模拟「上次在执行自定义控件时页面失去响应」。 */
export async function writeSafeModePending(
  page: Page,
  pending: { customId: string; name: string },
): Promise<void> {
  await page.evaluate(
    ({ key, value }) => {
      localStorage.setItem(key, JSON.stringify({ ...value, at: Date.now() }))
    },
    { key: SAFE_MODE_PENDING_KEY, value: pending },
  )
}

/**
 * 在下次页面加载时预置 `toolset/safe-mode/pending`。
 *
 * 真实崩溃不会触发 `pagehide`，而 Playwright 的 `reload()` 会触发 `pagehide` 并清掉
 * pending（这是产品规定的「正常卸载」行为）。因此用 init script 在新文档的应用模块
 * 执行前写入 pending，更贴近崩溃场景。
 */
export async function seedSafeModePendingOnNextLoad(
  page: Page,
  pending: { customId: string; name: string },
): Promise<void> {
  await page.addInitScript(
    ({ pendingKey, seedFlagKey, value }) => {
      try {
        if (localStorage.getItem(seedFlagKey) === '1') return
        localStorage.setItem(seedFlagKey, '1')
        localStorage.setItem(pendingKey, JSON.stringify({ ...value, at: Date.now() }))
      } catch {
        // 存储不可用时跳过
      }
    },
    { pendingKey: SAFE_MODE_PENDING_KEY, seedFlagKey: 'toolset/e2e/safe-seeded', value: pending },
  )
  await page.reload()
}

/** 读取 `toolset/safe-mode/blocked`。 */
export async function readSafeModeBlocked(page: Page): Promise<string[]> {
  return page.evaluate((key) => {
    const raw = localStorage.getItem(key)
    if (raw === null) return []
    try {
      const parsed: unknown = JSON.parse(raw)
      return Array.isArray(parsed)
        ? parsed.filter((item): item is string => typeof item === 'string')
        : []
    } catch {
      return []
    }
  }, SAFE_MODE_BLOCKED_KEY)
}

/** 清空安全模式状态（pending + blocked）。 */
export async function clearSafeModeState(page: Page): Promise<void> {
  await page.evaluate(
    ({ pendingKey, blockedKey }) => {
      localStorage.removeItem(pendingKey)
      localStorage.removeItem(blockedKey)
    },
    { pendingKey: SAFE_MODE_PENDING_KEY, blockedKey: SAFE_MODE_BLOCKED_KEY },
  )
}

/* ------------------------------------------------------------------------- */
/* 本机配置备份界面（plan §7.2「数据」组 / §6.11）                               */
/* ------------------------------------------------------------------------- */

export interface BackupSectionView {
  namespace: string
  local: Record<string, string>
  kv: Record<string, unknown>
}

export interface BackupFileView {
  format: string
  formatVersion: number
  appName: string
  createdAt: string
  userAgent: string
  sections: BackupSectionView[]
}

/** 本地存储信封 / 裸值读取。 */
export async function readLocalStorageValue(page: Page, key: string): Promise<unknown> {
  return page.evaluate((storageKey) => {
    const raw = localStorage.getItem(storageKey)
    if (raw === null) return null
    try {
      return JSON.parse(raw) as unknown
    } catch {
      return raw
    }
  }, key)
}

/** 读取 `toolset/tool/serial/<name>.v1` 的 data。 */
export async function readToolStoreData<T>(page: Page, name: string): Promise<T | null> {
  const value = await readLocalStorageValue(page, `toolset/tool/serial/${name}.v1`)
  if (value === null) return null
  if (typeof value === 'object' && value !== null && 'data' in value) {
    return (value as { data: T }).data
  }
  return value as T
}

/** localStorage 中所有以 `prefix` 开头的键。 */
export async function localStorageKeysWithPrefix(page: Page, prefix: string): Promise<string[]> {
  return page.evaluate((value) => {
    const keys: string[] = []
    for (let index = 0; index < localStorage.length; index += 1) {
      const key = localStorage.key(index)
      if (key !== null && key.startsWith(value)) keys.push(key)
    }
    return keys
  }, prefix)
}

/** 通过设置抽屉导出本机配置并读取下载文件。 */
export async function exportBackupViaUi(page: Page): Promise<DownloadedFile> {
  await openSettingsDrawer(page)
  await page.getByTestId('data-export').click()
  await expect(page.getByTestId('data-export-dialog')).toBeVisible({ timeout: 15_000 })
  await expect(page.getByTestId('data-export-confirm')).toBeEnabled({ timeout: 20_000 })
  const downloadPromise = page.waitForEvent('download')
  await page.getByTestId('data-export-confirm').click()
  const file = await readDownloadedFile(await downloadPromise)
  await closeSettingsDrawer(page)
  return file
}

async function toggleState(root: Locator): Promise<boolean> {
  const input = root.locator('input[type="checkbox"]')
  if ((await input.count()) > 0) return input.first().isChecked()
  const aria = await root.getAttribute('aria-checked')
  if (aria !== null) return aria === 'true'
  return false
}

async function setToggleState(root: Locator, desired: boolean): Promise<void> {
  if ((await toggleState(root)) !== desired) await root.click()
}

export interface ImportBackupUiOptions {
  mode?: 'merge' | 'replace'
  /** 只导入这些命名空间；省略表示全选。 */
  namespaces?: string[]
  /** 是否下载导入前备份，默认保持界面默认值（勾选）。 */
  backupBefore?: boolean
}

/** 通过设置抽屉导入本机配置，并等待导入完成后的自动刷新。 */
export async function importBackupViaUi(
  page: Page,
  text: string,
  options: ImportBackupUiOptions = {},
): Promise<void> {
  await openSettingsDrawer(page)
  const input = page.getByTestId('data-import-input')
  await expect(input).toHaveCount(1, { timeout: 10_000 })
  await input.setInputFiles({
    name: 'toolset-backup-e2e.json',
    mimeType: 'application/json',
    buffer: Buffer.from(text, 'utf8'),
  })
  await expect(page.getByTestId('data-import-dialog')).toBeVisible({ timeout: 15_000 })
  const error = page.getByTestId('data-import-error')
  if ((await error.count()) > 0 && (await error.isVisible())) {
    throw new Error(`导入配置失败：${await error.innerText()}`)
  }

  if (options.backupBefore === false) {
    await setToggleState(page.getByTestId('data-import-backup-before'), false)
  }

  const namespaces = page.getByTestId('data-import-namespace')
  const count = await namespaces.count()
  for (let index = 0; index < count; index += 1) {
    const root = namespaces.nth(index)
    const namespace = (await root.getAttribute('data-namespace')) ?? ''
    const desired = options.namespaces === undefined || options.namespaces.includes(namespace)
    await setToggleState(root, desired)
  }

  if (options.mode !== undefined) {
    const modeRoot = page.getByTestId('data-import-mode')
    if ((await modeRoot.getAttribute('data-mode')) !== options.mode) {
      const label = options.mode === 'replace' ? '替换' : '合并'
      const radio = modeRoot.getByRole('radio', { name: label, exact: true })
      if ((await radio.count()) > 0) await radio.first().click()
      else await modeRoot.getByText(label, { exact: true }).click()
    }
  }

  const reloadPromise = page.waitForEvent('load', { timeout: 30_000 })
  await page.getByTestId('data-import-confirm').click()
  // 已知 UI 缺陷：设置抽屉/导入对话框(z-index 1000) 与全局确认对话框同层，确认按钮被遮挡。
  // 用 click 事件触发确认，流程语义不变；缺陷单独汇报。
  await page.getByRole('button', { name: '导入并刷新' }).click()
  await reloadPromise
  await expect(page.getByTestId('serial-tool')).toBeVisible({ timeout: 30_000 })
}

/** 通过设置抽屉清除全部本地数据，并等待自动刷新。 */
export async function clearAllLocalDataViaUi(page: Page): Promise<void> {
  await openSettingsDrawer(page)
  const reloadPromise = page.waitForEvent('load', { timeout: 30_000 })
  await page.getByTestId('data-clear').click()
  await page.getByRole('button', { name: '清除全部数据' }).click()
  await reloadPromise
  await expect(page.getByTestId('serial-tool')).toBeVisible({ timeout: 30_000 })
  await closeSettingsDrawer(page)
}

/* ------------------------------------------------------------------------- */
/* 日志策略（plan §6.5 LogPolicy / §8.4）                                       */
/* ------------------------------------------------------------------------- */

export function logPolicyControl(page: Page, paneIndex = 0): Locator {
  return pane(page, paneIndex).getByTestId('log-policy')
}

/** 日志策略控件当前选中项的文字（下拉或按钮文案都兼容）。 */
export async function readLogPolicyLabel(page: Page, paneIndex = 0): Promise<string> {
  const control = logPolicyControl(page, paneIndex)
  await expect(control).toBeVisible({ timeout: 15_000 })
  const select = control.locator('select')
  if ((await select.count()) > 0) {
    return select.first().evaluate((element) => {
      const selected = (element as HTMLSelectElement).selectedOptions[0]
      return selected === undefined ? '' : (selected.textContent ?? '').trim()
    })
  }
  return (await control.innerText()).trim()
}

/** 当前 Pane 的系统日志行。 */
export function systemLogRows(page: Page, paneIndex = 0): Locator {
  return pane(page, paneIndex).locator('[data-testid="log-row"][data-dir="system"]')
}

/* ------------------------------------------------------------------------- */
/* 性能与堆统计（plan §11.5）                                                   */
/* ------------------------------------------------------------------------- */

interface E2ePerfWindow extends Window {
  __e2eLongTasks?: Array<{ startTime: number; duration: number }>
  __fakeSerial: Window['__fakeSerial']
}

/** 安装 long task 观察器（>50ms），返回安装是否成功。 */
export async function installLongTaskObserver(page: Page): Promise<void> {
  await page.evaluate(() => {
    const target = window as E2ePerfWindow
    target.__e2eLongTasks = []
    if (typeof PerformanceObserver === 'undefined') return
    try {
      const observer = new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) {
          if (entry.duration > 50) {
            target.__e2eLongTasks?.push({ startTime: entry.startTime, duration: entry.duration })
          }
        }
      })
      observer.observe({ entryTypes: ['longtask'] })
    } catch {
      // 不支持 longtask 的环境保持空数组。
    }
  })
}

/** 读取已记录的 long task（>50ms）数量。 */
export async function readLongTaskCount(page: Page): Promise<number> {
  return page.evaluate(() => (window as E2ePerfWindow).__e2eLongTasks?.length ?? 0)
}

/** Chromium 的 usedJSHeapSize；其他浏览器返回 null。 */
export async function usedHeapSize(page: Page): Promise<number | null> {
  return page.evaluate(() => {
    const memory = (performance as Performance & { memory?: { usedJSHeapSize?: number } }).memory
    return memory?.usedJSHeapSize ?? null
  })
}

/** 用 performance.now() 包住一次点击，测量到下一帧的耗时（毫秒）。 */
export async function measureClickLatency(page: Page): Promise<number> {
  return page.evaluate(
    () =>
      new Promise<number>((resolve) => {
        const button = document.querySelector<HTMLElement>('[data-testid="theme-toggle"]')
        if (button === null) {
          resolve(10_000)
          return
        }
        const startedAt = performance.now()
        button.dispatchEvent(new MouseEvent('click', { bubbles: true }))
        requestAnimationFrame(() => {
          resolve(performance.now() - startedAt)
        })
      }),
  )
}

/** 读取组件内部 `data-*` 钩子的数字值（如 data-point-count / data-last-idx）。 */
export async function widgetDataNumber(widget: Locator, name: string): Promise<number> {
  const value = await widgetDataAttribute(widget, name)
  if (value === null) return Number.NaN
  return Number(value)
}

/** 读取数值组件显示的数值（`data-display-value`）。 */
export async function widgetDisplayNumber(widget: Locator): Promise<number> {
  return widgetDataNumber(widget, 'data-display-value')
}

/**
 * 组件（含 open shadow DOM）内可见文本。
 *
 * 自定义控件宿主位于 shadow root 中，`innerText` / `textContent` 看不到里面的内容，
 * 因此递归遍历 shadow root 收集文本。
 */
export async function widgetShadowText(widget: Locator): Promise<string> {
  return widget.evaluate((element) => {
    const parts: string[] = []
    const visit = (node: Node): void => {
      if (node.nodeType === Node.TEXT_NODE) {
        parts.push(node.textContent ?? '')
        return
      }
      if (node.nodeType !== Node.ELEMENT_NODE && node.nodeType !== Node.DOCUMENT_FRAGMENT_NODE) {
        return
      }
      const shadow = (node as Element).shadowRoot
      if (shadow !== null && shadow !== undefined) visit(shadow)
      for (const child of Array.from(node.childNodes)) visit(child)
    }
    visit(element)
    return parts.join(' ').replace(/\s+/g, ' ').trim()
  })
}

/* ------------------------------------------------------------------------- */
/* 仪表盘测试常用组合流程                                                       */
/* ------------------------------------------------------------------------- */

/**
 * 仪表盘编辑模式在窄窗格下会切换为单列只读布局（左右栏会占用画布宽度）。
 * e2e 需要编辑/拖放时使用足够宽的视口。
 */
export async function ensureWideViewport(page: Page): Promise<void> {
  const size = page.viewportSize()
  if (size === null || size.width < 1600) {
    await page.setViewportSize({ width: 1920, height: 1080 })
  }
}

export interface DashboardSetupOptions extends DemoSerialSessionOptions {
  /** 选择的协议 id；`null` 表示不选择协议。默认 JustFloat。 */
  protocolId?: string | null
  dashboardName?: string
  /** 是否一键生成；false 时只创建空白仪表盘。默认 true。 */
  generate?: boolean
}

export interface DashboardSetup {
  sessionId: string
  dashboardName: string
}

/**
 * 演示端口 → 协议 → 仪表盘视图 → 新建仪表盘 → 绑定默认数据源 → 等待变量。
 *
 * 这是一键仪表盘、编辑、变量拖放、自定义控件等用例的公共前置。
 */
export async function setupDashboardWithVariables(
  page: Page,
  options: DashboardSetupOptions = {},
): Promise<DashboardSetup> {
  await ensureWideViewport(page)
  await openSerialTool(page)
  const sessionId = await addDemoSerialSession(page, {
    format: options.format ?? 'justfloat',
    interval: options.interval ?? 10,
    channels: options.channels ?? 8,
    connect: true,
  })
  const protocolId = options.protocolId === undefined ? JUSTFLOAT_PROTOCOL_ID : options.protocolId
  if (protocolId !== null) {
    await selectProtocol(page, protocolId)
    await waitForProtocolActive(page)
  }

  await openDashboardPane(page, 0)
  const requestedName = await createBlankDashboard(page, options.dashboardName ?? 'e2e 仪表盘')
  await bindDashboardSource(page, 'main', sessionId)
  await expect(variableItem(page, 'ch0')).toBeVisible({ timeout: 20_000 })

  if (options.generate !== false) {
    // 一键生成会新建一个以会话名命名的仪表盘，而不是复用空白仪表盘；等待下拉切换。
    const previousName = await selectedDashboardName(page)
    await generateDashboard(page)
    await expect
      .poll(async () => selectedDashboardName(page), { timeout: 15_000 })
      .not.toBe(previousName)
    const generatedName = await selectedDashboardName(page)
    // 删掉测试里先创建的空白仪表盘，避免用例 21 删除当前仪表盘后空状态被它挡住。
    if (requestedName !== generatedName) {
      await selectDashboardByName(page, requestedName)
      await clickDashboardMoreAction(page, 'delete')
      await clickDialogButton(page, /^删除$/)
      await expect
        .poll(async () => (await dashboardOptions(page)).includes(requestedName), {
          timeout: 10_000,
        })
        .toBe(false)
      await selectDashboardByName(page, generatedName)
    }
    // 一键生成后按 plan §8.10 进入编辑模式（重新选择已有仪表盘会回到运行模式）。
    await setDashboardMode(page, 'edit')
    return { sessionId, dashboardName: generatedName }
  }
  return { sessionId, dashboardName: requestedName }
}

/** 等待仪表盘的 800ms 防抖保存落盘（刷新前使用，避免丢失最后一次修改）。 */
export async function waitForDashboardSaved(page: Page, paneIndex = 0): Promise<void> {
  // scheduleSave 的防抖窗口是 800ms；先覆盖该窗口，再等待「保存中…」消失。
  await page.waitForTimeout(900)
  await expect
    .poll(async () => dashboardButton(page, 'unsaved', paneIndex).count(), { timeout: 10_000 })
    .toBe(0)
}

/** 暂停再恢复仪表盘：恢复时会强制一次刷新，让组件读取 series 的最终值。 */
export async function forceDashboardRefresh(page: Page, paneIndex = 0): Promise<void> {
  await clickDashboardMoreAction(page, 'pause', paneIndex)
  await clickDashboardMoreAction(page, 'pause', paneIndex)
}

/** 演示端口 + JustFloat + 一键生成（用例 14–16、19、23 的公共前置）。 */
export async function setupGeneratedDashboard(
  page: Page,
  options: DashboardSetupOptions = {},
): Promise<DashboardSetup> {
  const setup = await setupDashboardWithVariables(page, { ...options, generate: true })
  await expect
    .poll(async () => (await widgetIds(page)).length, { timeout: 20_000 })
    .toBeGreaterThan(0)
  return setup
}

/** 等待波形图拿到数据（`data-point-count > 0`）。 */
export async function waitForChartData(page: Page, paneIndex = 0): Promise<void> {
  const chart = widgetsByType(page, 'chart.line', paneIndex).first()
  await expect(chart).toBeVisible({ timeout: 15_000 })
  await expect
    .poll(async () => widgetDataNumber(chart, 'data-point-count'), { timeout: 20_000 })
    .toBeGreaterThan(0)
}

/** 读取波形图的 `data-last-idx`（已处理帧数）。 */
export async function chartLastIndex(page: Page, paneIndex = 0): Promise<number> {
  const chart = widgetsByType(page, 'chart.line', paneIndex).first()
  await expect(chart).toBeVisible({ timeout: 15_000 })
  return widgetDataNumber(chart, 'data-last-idx')
}
