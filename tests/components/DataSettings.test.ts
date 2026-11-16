// @vitest-environment happy-dom
import 'fake-indexeddb/auto'

import { flushPromises, mount } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  downloadText: vi.fn(),
  confirm: vi.fn(),
  toastShow: vi.fn(),
  reload: vi.fn(),
}))

vi.mock('@/shared/lib/download', () => ({
  downloadText: mocks.downloadText,
}))

vi.mock('@/shared/ui/services/confirm', () => ({
  confirm: mocks.confirm,
}))

vi.mock('@/shared/ui/services/toast', () => ({
  toast: { show: mocks.toastShow, dismiss: vi.fn(), clear: vi.fn() },
}))

vi.mock('@/app/registry', () => {
  const icon = { name: 'FakeIcon', render: () => null }
  const tools = [
    {
      id: 'serial',
      title: '串口上位机',
      summary: '测试工具',
      category: 'comm',
      icon,
      layout: 'workspace',
      backupLabels: {
        settings: '串口设置',
        dashboards: '仪表盘索引',
        'dashboards/*': '仪表盘',
      },
    },
  ]
  return { tools, getTool: (id: string) => tools.find((tool) => tool.id === id) }
})

// Keep every real helper but wrap `importBackup` so one test can force partial failure.
vi.mock('@/shared/lib/storage/backup', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/shared/lib/storage/backup')>()
  return { ...actual, importBackup: vi.fn(actual.importBackup) }
})

import DataSettings from '@/app/layout/DataSettings.vue'
import { clearAllLocalData, importBackup, type BackupFile } from '@/shared/lib/storage/backup'
import { createKvStore } from '@/shared/lib/storage/idb'

const APP_SETTINGS_RAW = JSON.stringify({ version: 1, data: { theme: 'dark', fontSize: 13 } })
const SERIAL_SETTINGS_RAW = JSON.stringify({ version: 1, data: { baudRate: 115200 } })

let wrapper: ReturnType<typeof mount> | null = null

function mountSettings(): ReturnType<typeof mount> {
  wrapper = mount(DataSettings, {
    props: { reload: mocks.reload, reloadDelay: 0 },
    attachTo: document.body,
  })
  return wrapper
}

function click(testId: string): void {
  const element = document.querySelector<HTMLElement>(`[data-testid="${testId}"]`)
  expect(element, `missing [data-testid="${testId}"]`).not.toBeNull()
  element?.click()
}

function dialogText(testId = 'data-import-dialog'): string {
  return document.querySelector(`[data-testid="${testId}"]`)?.textContent ?? ''
}

function checkboxByNamespace(testId: string, namespace: string): HTMLInputElement | null {
  return document.querySelector<HTMLInputElement>(
    `[data-testid="${testId}"][data-namespace="${namespace}"] input`,
  )
}

function checkboxSelector(key: string): string {
  return `[data-testid="data-export-item"][data-storage-key="${key}"] input`
}

function toggleCheckbox(selector: string): void {
  const element = document.querySelector<HTMLInputElement>(selector)
  expect(element, `missing ${selector}`).not.toBeNull()
  element?.click()
}

async function seedLocalData(): Promise<void> {
  window.localStorage.setItem('toolset/app/settings.v1', APP_SETTINGS_RAW)
  window.localStorage.setItem('toolset/tool/serial/settings.v1', SERIAL_SETTINGS_RAW)
  await createKvStore('toolset/tool/serial/').set('dashboards/d1', { id: 'd1', name: '主面板' })
}

function backupText(): string {
  const file: BackupFile = {
    format: 'toolset-backup',
    formatVersion: 1,
    appName: 'Toolset · 嵌入式工具箱',
    createdAt: '2026-02-03T04:05:06.000Z',
    userAgent: 'vitest',
    sections: [
      {
        namespace: 'toolset/app/',
        local: { 'toolset/app/settings.v1': '{"version":1,"data":{"theme":"light"}}' },
        kv: {},
      },
      {
        namespace: 'toolset/tool/serial/',
        local: { 'toolset/tool/serial/settings.v1': '{"version":1,"data":{"baudRate":9600}}' },
        kv: { 'toolset/tool/serial/dashboards/d1': { id: 'd1' } },
      },
    ],
  }
  return JSON.stringify(file)
}

async function selectImportFile(name: string, text: string): Promise<void> {
  const input = document.querySelector<HTMLInputElement>('[data-testid="data-import-input"]')
  if (!input) throw new Error('missing import input')
  Object.defineProperty(input, 'files', {
    configurable: true,
    value: [{ name, text: () => Promise.resolve(text) }],
  })
  input.dispatchEvent(new Event('change'))
  await flushPromises()
}

async function openImportDialog(text = backupText()): Promise<void> {
  await selectImportFile('backup.json', text)
  await vi.waitFor(() =>
    expect(document.querySelector('[data-testid="data-import-confirm"]')).not.toBeNull(),
  )
}

function exportedKeys(content: string): string[] {
  const file = JSON.parse(content) as BackupFile
  return file.sections.flatMap((section) => [
    ...Object.keys(section.local),
    ...Object.keys(section.kv),
  ])
}

/** Formats an ISO timestamp the same way the component does (local time). */
function localStamp(iso: string): string {
  const date = new Date(iso)
  const pad = (value: number): string => String(value).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(
    date.getHours(),
  )}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`
}

beforeEach(async () => {
  window.localStorage.clear()
  await clearAllLocalData()
  mocks.downloadText.mockClear()
  mocks.confirm.mockReset()
  mocks.confirm.mockResolvedValue(true)
  mocks.toastShow.mockClear()
  mocks.reload.mockClear()
  document.body.innerHTML = ''
})

afterEach(() => {
  wrapper?.unmount()
  wrapper = null
  document.body.innerHTML = ''
})

describe('DataSettings 导出', () => {
  it('导出树默认全选，取消命名空间后按所选键导出', async () => {
    await seedLocalData()
    mountSettings()

    click('data-export')
    await vi.waitFor(() =>
      expect(document.querySelectorAll('[data-testid="data-export-item"]').length).toBe(3),
    )

    const itemInputs = [
      ...document.querySelectorAll<HTMLInputElement>('[data-testid="data-export-item"] input'),
    ]
    expect(itemInputs.every((input) => input.checked)).toBe(true)
    expect(checkboxByNamespace('data-export-namespace', 'toolset/app/')?.checked).toBe(true)
    expect(dialogText('data-export-dialog')).toContain('外观设置')
    expect(dialogText('data-export-dialog')).toContain('串口上位机')
    expect(dialogText('data-export-dialog')).toContain('仪表盘')
    expect(dialogText('data-export-dialog')).toContain('已选择 3 项')

    toggleCheckbox('[data-testid="data-export-namespace"][data-namespace="toolset/app/"] input')
    await flushPromises()
    expect(checkboxByNamespace('data-export-namespace', 'toolset/app/')?.checked).toBe(false)
    expect(dialogText('data-export-dialog')).toContain('已选择 2 项')

    click('data-export-confirm')
    await vi.waitFor(() => expect(mocks.downloadText).toHaveBeenCalledTimes(1))

    const [content, filename, mimeType] = mocks.downloadText.mock.calls[0] as [
      string,
      string,
      string,
    ]
    expect(filename).toMatch(/^toolset-backup-\d{8}-\d{6}\.json$/)
    expect(mimeType).toContain('application/json')
    const file = JSON.parse(content) as BackupFile
    expect(file.format).toBe('toolset-backup')
    expect(file.formatVersion).toBe(1)
    const keys = exportedKeys(content)
    expect(keys).not.toContain('toolset/app/settings.v1')
    expect(keys).toEqual(
      expect.arrayContaining([
        'toolset/tool/serial/settings.v1',
        'toolset/tool/serial/dashboards/d1',
      ]),
    )
    expect(mocks.toastShow).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'success', message: '已导出 2 项配置' }),
    )
    expect(document.querySelector('[data-testid="data-export-dialog"]')).toBeNull()
  })

  it('单个条目取消勾选后不导出该条目', async () => {
    await seedLocalData()
    mountSettings()
    click('data-export')
    await vi.waitFor(() =>
      expect(document.querySelector('[data-testid="data-export-item"]')).not.toBeNull(),
    )

    toggleCheckbox(checkboxSelector('toolset/app/settings.v1'))
    await flushPromises()
    click('data-export-confirm')
    await vi.waitFor(() => expect(mocks.downloadText).toHaveBeenCalledTimes(1))

    const [content] = mocks.downloadText.mock.calls[0] as [string]
    expect(exportedKeys(content)).not.toContain('toolset/app/settings.v1')
    expect(exportedKeys(content)).toHaveLength(2)
  })
})

describe('DataSettings 导入', () => {
  it('显示备份时间与各分区条目数，默认合并并勾选导入前备份', async () => {
    mountSettings()
    await openImportDialog()

    expect(dialogText('data-import-summary')).toContain(localStamp('2026-02-03T04:05:06.000Z'))
    expect(dialogText('data-import-summary')).toContain('3 项')
    const dialog = dialogText()
    expect(dialog).toContain('外观设置')
    expect(dialog).toContain('串口上位机')
    expect(dialog).toContain('2 项')

    expect(
      document.querySelector('[data-testid="data-import-mode"]')?.getAttribute('data-mode'),
    ).toBe('merge')
    const segments = [
      ...document.querySelectorAll<HTMLButtonElement>(
        '[data-testid="data-import-mode"] [role="radio"]',
      ),
    ]
    expect(segments.map((segment) => segment.textContent?.trim())).toEqual(['合并', '替换'])
    expect(
      document.querySelector<HTMLInputElement>('[data-testid="data-import-backup-before"] input')
        ?.checked,
    ).toBe(true)

    expect(checkboxByNamespace('data-import-namespace', 'toolset/app/')?.checked).toBe(true)
    expect(checkboxByNamespace('data-import-namespace', 'toolset/tool/serial/')?.checked).toBe(true)
  })

  it('合并导入覆盖同名项、下载导入前备份并刷新页面', async () => {
    window.localStorage.setItem('toolset/app/settings.v1', 'old-app')
    window.localStorage.setItem('toolset/app/extra.v1', 'keep')
    mountSettings()
    await openImportDialog()

    click('data-import-confirm')
    await vi.waitFor(() => expect(mocks.downloadText).toHaveBeenCalledTimes(1))

    const [beforeContent, beforeName] = mocks.downloadText.mock.calls[0] as [string, string]
    expect(beforeName).toContain('before-import')
    expect(exportedKeys(beforeContent)).toEqual(
      expect.arrayContaining(['toolset/app/settings.v1', 'toolset/app/extra.v1']),
    )

    await vi.waitFor(() => expect(mocks.reload).toHaveBeenCalledTimes(1))
    expect(window.localStorage.getItem('toolset/app/settings.v1')).toBe(
      '{"version":1,"data":{"theme":"light"}}',
    )
    expect(window.localStorage.getItem('toolset/app/extra.v1')).toBe('keep')
    expect(await createKvStore('toolset/tool/serial/').get('dashboards/d1')).toEqual({ id: 'd1' })

    expect(mocks.confirm).toHaveBeenCalledWith(
      expect.objectContaining({
        message: '导入后页面将刷新，所有已打开的通道会断开。是否继续？',
      }),
    )
    expect(mocks.toastShow).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'success', message: '导入完成（3 项），页面即将刷新' }),
    )
  })

  it('替换模式先清空所选分区的现有配置', async () => {
    window.localStorage.setItem('toolset/app/settings.v1', 'old-app')
    window.localStorage.setItem('toolset/app/extra.v1', 'extra')
    window.localStorage.setItem('toolset/tool/serial/settings.v1', 'old-serial')
    await createKvStore('toolset/app/').set('index', 1)
    mountSettings()
    await openImportDialog()

    const segments = [
      ...document.querySelectorAll<HTMLButtonElement>(
        '[data-testid="data-import-mode"] [role="radio"]',
      ),
    ]
    segments[1]?.click()
    await flushPromises()
    expect(
      document.querySelector('[data-testid="data-import-mode"]')?.getAttribute('data-mode'),
    ).toBe('replace')

    toggleCheckbox('[data-testid="data-import-backup-before"] input')
    await flushPromises()
    click('data-import-confirm')
    await vi.waitFor(() => expect(mocks.reload).toHaveBeenCalledTimes(1))

    expect(window.localStorage.getItem('toolset/app/settings.v1')).toBe(
      '{"version":1,"data":{"theme":"light"}}',
    )
    expect(window.localStorage.getItem('toolset/app/extra.v1')).toBeNull()
    expect(await createKvStore('toolset/app/').get('index')).toBeUndefined()
    expect(window.localStorage.getItem('toolset/tool/serial/settings.v1')).toBe(
      '{"version":1,"data":{"baudRate":9600}}',
    )
    expect(mocks.downloadText).not.toHaveBeenCalled()
  })

  it('部分失败时列出失败键，等待用户点击刷新页面', async () => {
    vi.mocked(importBackup).mockResolvedValueOnce({
      written: 1,
      deleted: 0,
      failed: [{ key: 'toolset/app/settings.v1', error: '写入失败' }],
    })
    mountSettings()
    await openImportDialog()

    toggleCheckbox('[data-testid="data-import-backup-before"] input')
    await flushPromises()
    click('data-import-confirm')
    await vi.waitFor(() =>
      expect(document.querySelector('[data-testid="data-import-failed"]')).not.toBeNull(),
    )

    expect(dialogText('data-import-failed')).toContain('toolset/app/settings.v1')
    expect(dialogText('data-import-failed')).toContain('写入失败')
    expect(dialogText()).toContain('导入完成，1 项失败')
    expect(mocks.reload).not.toHaveBeenCalled()

    click('data-import-refresh')
    expect(mocks.reload).toHaveBeenCalledTimes(1)
  })

  it('无效文件显示「不是有效的 Toolset 配置文件」', async () => {
    mountSettings()
    await selectImportFile('broken.json', '{not json')
    await vi.waitFor(() =>
      expect(document.querySelector('[data-testid="data-import-error"]')).not.toBeNull(),
    )
    expect(dialogText('data-import-error')).toContain('不是有效的 Toolset 配置文件')

    click('data-import-close')
    await flushPromises()
    expect(document.querySelector('[data-testid="data-import-dialog"]')).toBeNull()
  })
})

describe('DataSettings 清除', () => {
  it('清除前弹出危险确认，确认后清空并刷新', async () => {
    window.localStorage.setItem('toolset/app/settings.v1', APP_SETTINGS_RAW)
    await createKvStore('toolset/protocol/').set('plugins/p1', { id: 'p1' })
    mountSettings()

    mocks.confirm.mockResolvedValue(false)
    click('data-clear')
    await vi.waitFor(() => expect(mocks.confirm).toHaveBeenCalledTimes(1))
    expect(mocks.confirm).toHaveBeenCalledWith(
      expect.objectContaining({
        title: '清除全部本地数据',
        danger: true,
        message: expect.stringContaining('无法恢复'),
      }),
    )
    expect(window.localStorage.getItem('toolset/app/settings.v1')).toBe(APP_SETTINGS_RAW)
    expect(mocks.reload).not.toHaveBeenCalled()

    mocks.confirm.mockResolvedValue(true)
    click('data-clear')
    await vi.waitFor(() => expect(mocks.reload).toHaveBeenCalledTimes(1))
    expect(window.localStorage.getItem('toolset/app/settings.v1')).toBeNull()
    expect(await createKvStore('toolset/protocol/').get('plugins/p1')).toBeUndefined()
    expect(mocks.toastShow).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'success', message: '已清除全部本地数据，页面即将刷新' }),
    )
  })
})
