/**
 * 本机配置备份 e2e（plan.md §11.4 用例 22）。
 *
 * 新建协议 / 预设 / 快捷发送 / 宏 / 仪表盘 / 自定义控件并修改主题 → 导出全部 →
 * 清除全部 → 替换导入恢复 → 只合并 `toolset/app/` 时其他命名空间不受影响。
 */

import { expect, test, type Locator, type Page } from '@playwright/test'

import {
  addDemoSerialSession,
  addDemoSession,
  clearAllLocalDataViaUi,
  closeProtocolManager,
  createBlankDashboard,
  ensureWideViewport,
  createCustomWidget,
  customWidgetLibraryIds,
  exportBackupViaUi,
  importBackupViaUi,
  localStorageKeysWithPrefix,
  newProtocolFromTemplate,
  openDashboardPane,
  openProtocolManager,
  openSerialTool,
  openTerminalPane,
  pane,
  protocolIdByName,
  saveProtocol,
  selectDashboardByName,
  setDashboardMode,
  setProtocolCode,
  setThemeViaSettings,
  type BackupFileView,
  type BackupSectionView,
} from './helpers'

const PROTOCOL_CODE = `return {
  apiVersion: 1,
  meta: { name: 'e2e 备份协议', description: '本机配置备份用例', version: '1.0.0' },
  framing: { type: 'line' },
  decode: function (frame) {
    return { summary: '备份：' + sdk.text(frame).trim() }
  },
}
`

const DASHBOARD_NAME = 'e2e 备份仪表盘'
const QUICK_ITEM_NAME = 'e2e 快捷项'
const MACRO_NAME = 'e2e 宏'
const PRESET_NAME = 'e2e 预设'

/** 在导出文件里按命名空间查找条目（local 键集合 + kv 键集合）。 */
function entriesOf(file: BackupFileView, namespace: string): { local: string[]; kv: string[] } {
  const section = file.sections.find((item: BackupSectionView) => item.namespace === namespace)
  return {
    local: section === undefined ? [] : Object.keys(section.local),
    kv: section === undefined ? [] : Object.keys(section.kv),
  }
}

function allLocalKeys(file: BackupFileView): string[] {
  return file.sections.flatMap((section) => Object.keys(section.local))
}

function allKvKeys(file: BackupFileView): string[] {
  return file.sections.flatMap((section) => Object.keys(section.kv))
}

/** 点击快捷发送页里的「编辑」并删除名称匹配的条目。 */
async function deleteQuickItemByName(page: Page, name: string): Promise<number> {
  await page.getByRole('tab', { name: '快捷', exact: true }).click()
  await page.getByTestId('quick-edit').click()
  const items = page.locator('[data-testid^="quick-item-"]')
  const before = await items.count()
  const target = items.filter({ hasText: name }).first()
  await expect(target).toBeVisible({ timeout: 10_000 })
  await target.locator('xpath=..').getByRole('button', { name: '删除' }).first().click()
  await expect.poll(async () => items.count(), { timeout: 10_000 }).toBe(before - 1)
  return before - 1
}

test.describe('本机配置备份', () => {
  test('用例 22：导出全部配置、清除、替换导入恢复、只合并且不影响其他命名空间', async ({
    page,
  }) => {
    test.setTimeout(180_000)

    await ensureWideViewport(page)
    await openSerialTool(page)
    await addDemoSession(page, { connect: true })

    // 1) 新建协议。
    await openProtocolManager(page)
    await newProtocolFromTemplate(page, '最小示例')
    await setProtocolCode(page, PROTOCOL_CODE, 'e2e 备份协议')
    await saveProtocol(page)
    await expect(page.getByTestId('protocol-name')).toContainText('e2e 备份协议')
    const protocolId = await protocolIdByName(page, 'e2e 备份协议')
    await closeProtocolManager(page)

    // 2) 另存预设。
    await page.getByTestId('preset-save').click()
    await page.getByTestId('preset-name').fill(PRESET_NAME)
    await page.getByTestId('preset-save-confirm').click()
    await expect(
      page.getByTestId('preset-select').locator('option').filter({ hasText: PRESET_NAME }),
    ).toHaveCount(1, { timeout: 10_000 })

    // 3) 新建快捷发送项。
    await page.getByRole('tab', { name: '快捷', exact: true }).click()
    await page.getByTestId('quick-edit').click()
    await page.getByTestId('quick-add').click()
    await page.getByLabel('快捷项名称', { exact: true }).fill(QUICK_ITEM_NAME)
    await page.getByLabel('快捷项内容', { exact: true }).fill('E2E')
    await page.getByTestId('quick-item-save').click()
    const quickItems = page.locator('[data-testid^="quick-item-"]')
    await expect(quickItems.filter({ hasText: QUICK_ITEM_NAME })).toHaveCount(1)
    const quickItemTestId = await quickItems
      .filter({ hasText: QUICK_ITEM_NAME })
      .first()
      .getAttribute('data-testid')
    expect(quickItemTestId).not.toBeNull()

    // 4) 新建宏。
    await page.getByRole('tab', { name: '宏', exact: true }).click()
    await page.getByTestId('macro-create').click()
    await page.getByLabel('宏名称', { exact: true }).fill(MACRO_NAME)
    await page.getByTestId('macro-save').click()
    const macroItem = page.locator('[data-testid^="macro-item-"]').filter({ hasText: MACRO_NAME })
    await expect(macroItem).toHaveCount(1, { timeout: 10_000 })
    const macroTestId = await macroItem.first().getAttribute('data-testid')
    expect(macroTestId).not.toBeNull()

    // 5) 新建仪表盘 + 自定义控件。
    await openDashboardPane(page)
    await createBlankDashboard(page, DASHBOARD_NAME)
    const customId = await createCustomWidget(page, {
      templateLabel: '最小数值显示',
      name: 'e2e-备份控件',
    })
    await expect
      .poll(async () => (await customWidgetLibraryIds(page)).includes(customId), {
        timeout: 15_000,
      })
      .toBe(true)

    // 6) 修改主题（显式选择浅色，便于导入恢复后断言）。
    await setThemeViaSettings(page, 'light')
    const savedTheme = 'light'
    expect(await page.locator('html').getAttribute('data-theme')).toBe(savedTheme)

    // 7) 导出全部配置并断言文件结构。
    const file = await exportBackupViaUi(page)
    const backup = JSON.parse(file.text) as BackupFileView
    expect(backup.format).toBe('toolset-backup')
    expect(backup.formatVersion).toBe(1)
    expect(backup.appName.length).toBeGreaterThan(0)
    expect(Number.isNaN(Date.parse(backup.createdAt))).toBe(false)
    expect(backup.userAgent.length).toBeGreaterThan(0)

    const namespaces = backup.sections.map((section) => section.namespace)
    for (const namespace of [
      'toolset/app/',
      'toolset/protocol/',
      'toolset/link/',
      'toolset/tool/serial/',
    ]) {
      expect(namespaces).toContain(namespace)
    }
    const localKeys = allLocalKeys(backup)
    const kvKeys = allKvKeys(backup)
    expect(localKeys).toContain('toolset/app/settings.v1')
    expect(localKeys).toContain('toolset/protocol/index.v1')
    expect(localKeys).toContain('toolset/link/presets.v1')
    expect(localKeys).toContain('toolset/tool/serial/dashboards.v1')
    expect(localKeys).toContain('toolset/tool/serial/widgets.v1')
    expect(kvKeys.some((key) => key.startsWith('toolset/tool/serial/dashboards/'))).toBe(true)
    expect(kvKeys.some((key) => key.startsWith('toolset/tool/serial/widgets/'))).toBe(true)
    // 所有键都属于所在命名空间，且以 toolset/ 开头。
    for (const section of backup.sections) {
      for (const key of Object.keys(section.local)) {
        expect(key.startsWith('toolset/')).toBe(true)
        expect(key.startsWith(section.namespace)).toBe(true)
      }
      for (const key of Object.keys(section.kv)) {
        expect(key.startsWith('toolset/')).toBe(true)
        expect(key.startsWith(section.namespace)).toBe(true)
      }
    }

    // 8) 清除全部本地数据：刷新后数据清空。
    await clearAllLocalDataViaUi(page)
    const remaining = (await localStorageKeysWithPrefix(page, 'toolset/')).filter(
      (key) => !key.startsWith('toolset/safe-mode/'),
    )
    expect(remaining).toEqual([])
    await openDashboardPane(page)
    await expect(page.getByTestId('dashboard-empty')).toBeVisible({ timeout: 15_000 })
    await expect(
      page.locator('[data-testid^="quick-item-"]').filter({ hasText: QUICK_ITEM_NAME }),
    ).toHaveCount(0)

    // 9) 替换导入：刷新后全部数据恢复。
    await importBackupViaUi(page, file.text, { mode: 'replace', backupBefore: false })
    expect(await page.locator('html').getAttribute('data-theme')).toBe(savedTheme)

    // 会话不进入备份；新建一个会话以打开侧栏与发送面板（快捷 / 宏 / 预设都在其中）。
    await addDemoSerialSession(page, { connect: false })
    await openTerminalPane(page)
    await openProtocolManager(page)
    await expect(page.getByTestId(`protocol-item-${protocolId}`)).toBeVisible({ timeout: 10_000 })
    await closeProtocolManager(page)
    await expect(
      page.getByTestId('preset-select').locator('option').filter({ hasText: PRESET_NAME }),
    ).toHaveCount(1, { timeout: 10_000 })

    await page.getByRole('tab', { name: '快捷', exact: true }).click()
    await expect(page.locator(`[data-testid="${quickItemTestId ?? ''}"]`)).toHaveCount(1)
    await page.getByRole('tab', { name: '宏', exact: true }).click()
    await expect(page.locator(`[data-testid="${macroTestId ?? ''}"]`)).toHaveCount(1)

    await openDashboardPane(page)
    await expect
      .poll(
        async () =>
          (await page.getByTestId('dashboard-select').locator('option').allTextContents()).includes(
            DASHBOARD_NAME,
          ),
        { timeout: 15_000 },
      )
      .toBe(true)
    await selectDashboardByName(page, DASHBOARD_NAME)
    await setDashboardMode(page, 'edit')
    await expect
      .poll(async () => (await customWidgetLibraryIds(page)).includes(customId), {
        timeout: 15_000,
      })
      .toBe(true)

    // 10) 只合并 `toolset/app/`：先修改其他命名空间（删除快捷项）并切换主题，
    //     导入后主题恢复，而快捷项保持删除状态（其他命名空间没有被改写）。
    await openTerminalPane(page)
    const quickCountAfterDelete = await deleteQuickItemByName(page, QUICK_ITEM_NAME)
    await setThemeViaSettings(page, 'dark')
    expect(await page.locator('html').getAttribute('data-theme')).not.toBe(savedTheme)

    await importBackupViaUi(page, file.text, {
      namespaces: ['toolset/app/'],
      mode: 'merge',
      backupBefore: false,
    })
    expect(await page.locator('html').getAttribute('data-theme')).toBe(savedTheme)
    await addDemoSerialSession(page, { connect: false })
    await openTerminalPane(page)
    await page.getByRole('tab', { name: '快捷', exact: true }).click()
    await page
      .getByTestId('quick-edit')
      .click()
      .catch(() => undefined)
    await expect
      .poll(async () => page.locator('[data-testid^="quick-item-"]').count(), { timeout: 10_000 })
      .toBe(quickCountAfterDelete)

    // 协议等其他命名空间也仍然存在（没有被清空或重复导入）。
    await openProtocolManager(page)
    await expect(page.getByTestId(`protocol-item-${protocolId}`)).toBeVisible({ timeout: 10_000 })
    await closeProtocolManager(page)
    await expect(pane(page).getByTestId('log-list')).toBeVisible()
  })
})
