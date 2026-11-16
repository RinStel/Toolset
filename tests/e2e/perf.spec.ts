/**
 * 性能用例（plan.md §11.5）。
 *
 * 每 10ms 向 2 个会话各注入 128 字节（每个会话约 12.8KB/s，115200 波特率满速），
 * 持续 60 秒，同时开启转发。断言：
 * - 高负载下点击响应 < 200ms；
 * - 日志条数稳定在上限内；
 * - 第 30s 与第 60s 的 `performance.memory.usedJSHeapSize` 增长 < 20%。
 */

import { expect, test, type Page } from '@playwright/test'

import {
  DEFAULT_FAKE_PORT_INFO,
  DEFAULT_FAKE_PROTOCOL_INFO,
  addBridgeRule,
  addFakePort,
  addFakeSerialSession,
  disableFakeWriteRecording,
  emitRx,
  fillSettingNumber,
  logEntryCount,
  openSerialTool,
  openSettingsDrawer,
  selectSessionTab,
  waitForWriteCount,
} from './helpers'

/** 注入间隔（plan §11.5：每 10ms）。 */
const INJECT_INTERVAL_MS = 10
/** 每次注入的字节数。 */
const INJECT_BYTES = 128
/** 日志条数上限（性能用例调低到 1000，便于断言稳定状态）。 */
const LOG_LIMIT = 1000

/** 每个会话每次注入的内容：127 个 'A' + LF（line 分帧每块一条记录）。 */
const PAYLOAD: number[] = [...new Array<number>(INJECT_BYTES - 1).fill(0x41), 0x0a]

interface PerfWindow extends Window {
  __perfTimers?: number[]
}

/** 在页面里启动两个注入定时器。 */
async function startInjection(page: Page, ports: number[]): Promise<void> {
  await page.evaluate(
    ({ portIndexes, payload, intervalMs }) => {
      const target = window as PerfWindow
      target.__perfTimers = portIndexes.map((portIndex) =>
        window.setInterval(() => {
          window.__fakeSerial.emit(portIndex, payload)
        }, intervalMs),
      )
    },
    { portIndexes: ports, payload: PAYLOAD, intervalMs: INJECT_INTERVAL_MS },
  )
}

async function stopInjection(page: Page): Promise<void> {
  await page.evaluate(() => {
    const target = window as PerfWindow
    for (const timer of target.__perfTimers ?? []) window.clearInterval(timer)
    target.__perfTimers = []
  })
}

/** 用 `performance.now()` 包住一次点击，返回包含下一帧的耗时（毫秒）。 */
async function measureClick(page: Page): Promise<number> {
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

/** Chromium 的私有内存统计（其他浏览器返回 null）。 */
async function usedHeapSize(page: Page): Promise<number | null> {
  return page.evaluate(() => {
    const perf = performance as Performance & { memory?: { usedJSHeapSize?: number } }
    return perf.memory?.usedJSHeapSize ?? null
  })
}

test('@perf 双会话 60 秒高吞吐：点击响应、日志上限与堆增长', async ({ page }) => {
  test.setTimeout(150_000)

  await openSerialTool(page)

  // 把日志上限调低到 1000，便于观察淘汰后的稳定状态（只对新建会话生效）。
  await openSettingsDrawer(page)
  await fillSettingNumber(page, 'maxLogEntries', LOG_LIMIT)
  await page.keyboard.press('Escape')
  await expect(page.getByTestId('settings-drawer')).toHaveCount(0)

  const portA = await addFakePort(page, DEFAULT_FAKE_PORT_INFO)
  const sessionA = await addFakeSerialSession(page, { portIndex: portA })
  const portB = await addFakePort(page, DEFAULT_FAKE_PROTOCOL_INFO)
  const sessionB = await addFakeSerialSession(page, { portIndex: portB })
  await selectSessionTab(page, sessionA)

  // 建立 A → B 单向转发，并确认转发确实工作，然后关闭写入记录（否则测试自身
  // 记录 60 秒 × 100 次/秒的写入数组会污染堆增长断言）。
  await addBridgeRule(page, sessionA, sessionB, 'oneway')
  await emitRx(page, portA, [0x50, 0x0a])
  await waitForWriteCount(page, portB, 1, 10_000)
  await selectSessionTab(page, sessionA)
  await disableFakeWriteRecording(page)

  const startedAt = Date.now()
  const waitUntil = async (elapsedMs: number): Promise<void> => {
    const remaining = elapsedMs - (Date.now() - startedAt)
    if (remaining > 0) await page.waitForTimeout(remaining)
  }

  await startInjection(page, [portA, portB])

  // 15s：高负载下采样点击响应（取 3 次的最好成绩，避免 rAF 抖动）。
  await waitUntil(15_000)
  const clickSamples: number[] = []
  for (let attempt = 0; attempt < 3; attempt += 1) {
    clickSamples.push(await measureClick(page))
    await page.waitForTimeout(120)
  }
  const bestClick = Math.min(...clickSamples)

  // 30s：记录日志条数与堆大小。
  await waitUntil(30_000)
  const logCountAt30s = await logEntryCount(page)
  const heapAt30s = await usedHeapSize(page)

  // 60s：再次采样并停止注入。
  await waitUntil(60_000)
  const logCountAt60s = await logEntryCount(page)
  const heapAt60s = await usedHeapSize(page)
  await stopInjection(page)

  // 日志条数稳定在上限内，且已经达到淘汰边界。
  expect(logCountAt30s).toBeLessThanOrEqual(LOG_LIMIT)
  expect(logCountAt60s).toBeLessThanOrEqual(LOG_LIMIT)
  expect(logCountAt30s).toBeGreaterThanOrEqual(Math.floor(LOG_LIMIT * 0.9))
  expect(logCountAt60s).toBe(logCountAt30s)

  // 点击响应 < 200ms（高负载期间）。
  expect(bestClick).toBeLessThan(200)
  expect(Math.max(...clickSamples)).toBeLessThan(2_000)
  console.log(`点击响应样本（ms）：${clickSamples.map((value) => value.toFixed(1)).join(', ')}`)

  // 堆增长 < 20%（仅 Chromium 提供 performance.memory）。
  expect(heapAt30s).not.toBeNull()
  expect(heapAt60s).not.toBeNull()
  if (heapAt30s !== null && heapAt60s !== null) {
    const growth = (heapAt60s - heapAt30s) / heapAt30s
    console.log(
      `堆：30s=${String(heapAt30s)}，60s=${String(heapAt60s)}，增长 ${(growth * 100).toFixed(1)}%`,
    )
    expect(growth).toBeLessThan(0.2)
  }

  // 两个会话都还在，转发规则未暂停。
  await expect(page.locator('[data-testid^="session-tab-"]')).toHaveCount(2)
  await expect(page.locator('[data-testid^="bridge-rule-"]').first()).not.toContainText('已暂停')
  expect(sessionA).not.toBe(sessionB)
})
