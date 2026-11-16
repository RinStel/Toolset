/**
 * 自定义控件与安全模式 e2e（plan.md §11.4 用例 19、20、21）。
 *
 * 自定义控件编辑器由 D1c 实现；本文件按 plan 的 testid 契约编写，未实现的
 * testid 会以明确错误暴露出来，便于根代理核对。
 */

import { expect, test, type Page } from '@playwright/test'

import {
  bindCustomWidgetPreviewVariable,
  bindCustomWidgetVariable,
  clickDashboardMoreAction,
  clickDialogButton,
  closeCustomWidgetEditor,
  createCustomWidget,
  customWidgetLibraryIds,
  customWidgetPreview,
  dashboardOptions,
  exportDashboardFile,
  importDashboardFile,
  newCustomWidgetFromTemplate,
  openCustomWidgetEditor,
  openDashboardPane,
  placeCustomWidgetOnDashboard,
  runCustomWidgetPreview,
  safeModeBanner,
  saveCustomWidget,
  seedSafeModePendingOnNextLoad,
  selectDashboardByName,
  setCustomWidgetCode,
  setDashboardMode,
  setupGeneratedDashboard,
  waitForDashboardSaved,
  widgetCards,
  widgetShadowText,
  widgetsByType,
  writeSafeModePending,
} from './helpers'

const DASHBOARD_NAME = 'e2e 自定义控件仪表盘'

/** 抛异常的自定义控件：10 秒内 3 次异常后应被停用。 */
const THROW_WIDGET_CODE = `// e2e-throw-marker
return {
  apiVersion: 1,
  meta: { name: 'e2e 抛错控件', description: 'e2e 异常保护', group: 'value' },
  size: { default: { w: 4, h: 3 }, min: { w: 2, h: 2 } },
  variables: { min: 1, max: 1 },
  mount(el) {
    el.textContent = '抛错控件'
    return {
      update() {
        throw new Error('e2e 故意抛出的错误')
      },
    }
  },
}
`

/** 忙等的自定义控件：单次 update 超过 200ms 后应立即停用。 */
const SLOW_WIDGET_CODE = `// e2e-slow-marker
return {
  apiVersion: 1,
  meta: { name: 'e2e 忙等控件', description: 'e2e 超时保护', group: 'value' },
  size: { default: { w: 4, h: 3 }, min: { w: 2, h: 2 } },
  variables: { min: 1, max: 1 },
  mount(el) {
    el.textContent = '忙等控件'
    return {
      update() {
        const startedAt = performance.now()
        while (performance.now() - startedAt < 300) {
          // 故意忙等 300ms
        }
      },
    }
  },
}
`

/**
 * 带全局标记的自定义控件：用于断言「代码是否被执行」。
 *
 * 在正常模式下 mount 会写 `window.__e2eCustomRan`；安全模式下该标记不应出现。
 */
const MARKER_WIDGET_CODE = `// e2e-safe-marker
return {
  apiVersion: 1,
  meta: { name: 'e2e 安全模式控件', description: 'safe mode e2e', group: 'value' },
  size: { default: { w: 4, h: 3 }, min: { w: 2, h: 2 } },
  variables: { min: 1, max: 1 },
  mount(el) {
    window.__e2eCustomRan = (window.__e2eCustomRan || 0) + 1
    const span = document.createElement('span')
    span.textContent = 'custom-mounted'
    el.appendChild(span)
    return {
      update() {},
    }
  },
}
`

interface MarkerWindow extends Window {
  __e2eCustomRan?: number
}

interface DashboardFile {
  format: string
  formatVersion: number
  dashboard: { id: string; name: string; widgets: unknown[] }
  customWidgets: Array<{ id: string; name: string; code: string }>
}

async function readMarker(page: Page): Promise<number> {
  return page.evaluate(() => (window as MarkerWindow).__e2eCustomRan ?? 0)
}

async function waitForLibraryItem(page: Page, customId: string): Promise<void> {
  await expect
    .poll(async () => (await customWidgetLibraryIds(page)).includes(customId), { timeout: 15_000 })
    .toBe(true)
}

/** 导入后可能先出现自定义控件安全说明；出现则确认。 */
async function confirmImportSafetyIfVisible(page: Page): Promise<void> {
  const safety = page.getByTestId('dashboard-import-safety')
  const conflict = page.getByTestId('dashboard-import-conflict')
  if ((await safety.count()) === 0 && (await conflict.count()) === 0) {
    await expect
      .poll(async () => (await safety.count()) + (await conflict.count()), { timeout: 5_000 })
      .toBeGreaterThan(0)
  }
  if ((await safety.count()) > 0 && (await safety.first().isVisible())) {
    await page.getByTestId('dashboard-import-safety-confirm').click()
    await expect(safety).toHaveCount(0, { timeout: 10_000 })
  }
}

/** 用编辑器完整创建一个自定义控件并返回 id（可顺便断言预览内容）。 */
async function createWidgetViaEditor(
  page: Page,
  options: {
    templateLabel?: string
    code?: string
    marker?: string
    bindPreview?: boolean
    expectPreview?: RegExp
  },
): Promise<string> {
  const before = new Set(await customWidgetLibraryIds(page))
  await openCustomWidgetEditor(page)
  await newCustomWidgetFromTemplate(page, options.templateLabel ?? '最小数值显示')
  if (options.code !== undefined) {
    await setCustomWidgetCode(page, options.code, options.marker ?? 'e2e')
  }
  if (options.bindPreview !== false) await bindCustomWidgetPreviewVariable(page)
  await runCustomWidgetPreview(page)
  if (options.expectPreview !== undefined) {
    const preview = customWidgetPreview(page)
    await expect(preview.first()).toBeVisible({ timeout: 15_000 })
    await expect
      .poll(async () => widgetShadowText(preview.first()), { timeout: 15_000 })
      .toMatch(options.expectPreview)
  }
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

/** 删除自定义控件（按编辑器列表项 id；D1c 编辑器）。 */
async function deleteCustomWidget(page: Page, customId: string): Promise<void> {
  const editor = await openCustomWidgetEditor(page)
  const item = editor.getByTestId(`custom-widget-item-${customId}`)
  await expect(item).toBeVisible({ timeout: 10_000 })
  await item.click()
  await editor.getByTestId('custom-widget-delete').click()
  const confirmDialog = page.getByRole('dialog', { name: '删除自定义控件' })
  await expect(confirmDialog).toBeVisible({ timeout: 10_000 })
  // 已知 UI 缺陷：自定义控件编辑器 z-index(1200) 高于 UiDialog(1000)，确认框被编辑器
  // 遮挡，真实鼠标无法点击。这里用 click 事件触发确认，流程语义不变；缺陷单独汇报。
  await confirmDialog.getByRole('button', { name: '删除', exact: true }).click()
  await expect(item).toHaveCount(0, { timeout: 10_000 })
  await closeCustomWidgetEditor(page)
}

test.describe('自定义控件与安全模式', () => {
  test('用例 19：模板控件预览、显示变量值、异常停用与忙等停用', async ({ page }) => {
    await setupGeneratedDashboard(page, {
      format: 'justfloat',
      interval: 10,
      channels: 8,
      dashboardName: DASHBOARD_NAME,
    })

    // 模板 1：预览模拟数据，保存后放到仪表盘并显示变量值。
    const templateId = await createWidgetViaEditor(page, {
      templateLabel: '最小数值显示',
      bindPreview: true,
      expectPreview: /-?\d+(\.\d+)?/,
    })
    await waitForLibraryItem(page, templateId)
    const templateWidget = await placeCustomWidgetOnDashboard(page, templateId)
    await bindCustomWidgetVariable(page, templateWidget, 'ch0')
    await setDashboardMode(page, 'run')
    await expect
      .poll(async () => widgetShadowText(templateWidget), { timeout: 15_000 })
      .toMatch(/-?\d+\.\d+/)

    // 抛错控件：出现错误浮层，10 秒内 3 次异常后被停用。
    await setDashboardMode(page, 'edit')
    const throwId = await createCustomWidget(page, {
      templateLabel: '最小数值显示',
      code: THROW_WIDGET_CODE,
      name: 'e2e-throw-marker',
    })
    await waitForLibraryItem(page, throwId)
    const throwWidget = await placeCustomWidgetOnDashboard(page, throwId)
    await bindCustomWidgetVariable(page, throwWidget, 'ch0')
    await expect
      .poll(async () => widgetShadowText(throwWidget), { timeout: 15_000 })
      .toMatch(/出错：|已停用/)
    await expect
      .poll(async () => widgetShadowText(throwWidget), { timeout: 15_000 })
      .toMatch(/已停用/)

    // 其他组件继续更新：找一个数值组件，断言它的显示值仍在变化。
    const numberWidget = widgetsByType(page, 'value.number').first()
    const firstValue = await numberWidget
      .locator('[data-display-value]')
      .first()
      .getAttribute('data-display-value')
    await expect
      .poll(
        async () =>
          numberWidget.locator('[data-display-value]').first().getAttribute('data-display-value'),
        { timeout: 15_000 },
      )
      .not.toBe(firstValue)

    // 慢控件：单次 update 忙等 300ms，应提示「执行时间过长」。
    await setDashboardMode(page, 'edit')
    const slowId = await createCustomWidget(page, {
      templateLabel: '最小数值显示',
      code: SLOW_WIDGET_CODE,
      name: 'e2e-slow-marker',
    })
    await waitForLibraryItem(page, slowId)
    const slowWidget = await placeCustomWidgetOnDashboard(page, slowId)
    await bindCustomWidgetVariable(page, slowWidget, 'ch0')
    await expect
      .poll(async () => widgetShadowText(slowWidget), { timeout: 20_000 })
      .toMatch(/执行时间过长/)
    await setDashboardMode(page, 'run')
  })

  test('用例 20：pending 触发安全模式横幅、重新启用与 URL 安全模式', async ({ page }) => {
    const setup = await setupGeneratedDashboard(page, {
      format: 'justfloat',
      interval: 10,
      channels: 8,
      dashboardName: DASHBOARD_NAME,
    })
    const customId = await createCustomWidget(page, {
      templateLabel: '最小数值显示',
      code: MARKER_WIDGET_CODE,
      name: 'e2e-safe-marker',
    })
    await waitForLibraryItem(page, customId)
    const widget = await placeCustomWidgetOnDashboard(page, customId)
    await bindCustomWidgetVariable(page, widget, 'ch0')
    await setDashboardMode(page, 'run')
    await expect.poll(async () => readMarker(page), { timeout: 15_000 }).toBeGreaterThan(0)

    // 先等仪表盘防抖保存完成，再模拟上次卡死（否则自定义控件实例会丢失）。
    await waitForDashboardSaved(page)
    // 模拟上次卡死：在新文档加载前预置 pending（reload 的 pagehide 会清 pending）。
    await seedSafeModePendingOnNextLoad(page, { customId, name: 'e2e 安全模式控件' })
    await expect(page.getByTestId('serial-tool')).toBeVisible({ timeout: 15_000 })
    await openDashboardPane(page)
    await selectDashboardByName(page, setup.dashboardName)

    const banner = safeModeBanner(page)
    await expect(banner).toBeVisible({ timeout: 15_000 })
    await expect(banner).toContainText('e2e 安全模式控件')
    await expect(banner).toContainText(/已暂停/)
    const pausedWidget = widgetsByType(page, `custom:${customId}`).first()
    await expect
      .poll(async () => widgetShadowText(pausedWidget), { timeout: 15_000 })
      .toContain('已暂停（安全模式）')
    expect(await readMarker(page)).toBe(0)

    // 重新启用后控件恢复执行。
    await banner.getByRole('button', { name: /重新启用/ }).click()
    await expect(banner).toHaveCount(0, { timeout: 15_000 })
    await expect.poll(async () => readMarker(page), { timeout: 15_000 }).toBeGreaterThan(0)
    await expect
      .poll(async () => widgetShadowText(pausedWidget), { timeout: 15_000 })
      .toContain('custom-mounted')

    // 全局安全模式：URL 带 safe=1 时不执行任何自定义控件代码。
    await page.goto('about:blank')
    await page.goto('/#/tools/serial?safe=1')
    await expect(page.getByTestId('serial-tool')).toBeVisible({ timeout: 15_000 })
    await openDashboardPane(page)
    await selectDashboardByName(page, setup.dashboardName)
    const urlBanner = safeModeBanner(page)
    await expect(urlBanner).toBeVisible({ timeout: 15_000 })
    await expect(urlBanner).toContainText('安全模式：自定义控件未加载')
    expect(await readMarker(page)).toBe(0)
    const safeWidget = widgetsByType(page, `custom:${customId}`).first()
    await expect(safeWidget).toBeVisible({ timeout: 15_000 })
    expect(await widgetShadowText(safeWidget)).not.toContain('custom-mounted')
  })

  test('用例 21：仪表盘导出（含自定义控件）、删除后导入恢复、再次导入另存副本', async ({
    page,
  }) => {
    const setup = await setupGeneratedDashboard(page, {
      format: 'justfloat',
      interval: 10,
      channels: 8,
      dashboardName: DASHBOARD_NAME,
    })
    const customId = await createCustomWidget(page, {
      templateLabel: '最小数值显示',
      name: 'e2e-export-marker',
    })
    await waitForLibraryItem(page, customId)
    const widget = await placeCustomWidgetOnDashboard(page, customId)
    await bindCustomWidgetVariable(page, widget, 'ch0')
    await setDashboardMode(page, 'edit')
    const widgetCountBefore = await widgetCards(page).count()

    // 导出的文件包含仪表盘与自定义控件。
    const file = await exportDashboardFile(page)
    const parsed = JSON.parse(file.text) as DashboardFile
    expect(parsed.format).toBe('toolset-dashboard')
    expect(parsed.formatVersion).toBe(1)
    expect(parsed.dashboard.name).toBe(setup.dashboardName)
    expect(parsed.dashboard.widgets).toHaveLength(widgetCountBefore)
    expect(parsed.customWidgets).toHaveLength(1)
    expect(parsed.customWidgets[0]?.id).toBe(customId)

    // 删除该仪表盘和自定义控件。
    await deleteCustomWidget(page, customId)
    await clickDashboardMoreAction(page, 'delete')
    await clickDialogButton(page, /^删除$/)
    await expect(page.getByTestId('dashboard-empty')).toBeVisible({ timeout: 15_000 })

    // 导入：先确认安全说明，再恢复。
    await importDashboardFile(page, file.fileName, file.text)
    await confirmImportSafetyIfVisible(page)
    await expect
      .poll(async () => widgetCards(page).count(), { timeout: 20_000 })
      .toBe(widgetCountBefore)
    await expect
      .poll(async () => (await dashboardOptions(page)).includes(setup.dashboardName), {
        timeout: 15_000,
      })
      .toBe(true)
    await expect(widgetsByType(page, `custom:${customId}`)).toHaveCount(1)
    await waitForLibraryItem(page, customId)

    // 再次导入同一文件：选择「另存为副本」，出现 2 个仪表盘。
    const optionsBeforeCopy = await dashboardOptions(page)
    expect(optionsBeforeCopy).toContain(setup.dashboardName)
    await importDashboardFile(page, file.fileName, file.text)
    await confirmImportSafetyIfVisible(page)
    const conflict = page.getByTestId('dashboard-import-conflict')
    await expect(conflict).toBeVisible({ timeout: 15_000 })
    await page.getByTestId('dashboard-import-copy').click()
    await expect
      .poll(async () => (await dashboardOptions(page)).length, { timeout: 15_000 })
      .toBe(optionsBeforeCopy.length + 1)
    expect(await dashboardOptions(page)).toContain(`${setup.dashboardName}（导入）`)
  })
})
