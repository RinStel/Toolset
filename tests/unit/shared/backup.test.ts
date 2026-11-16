// @vitest-environment happy-dom
import 'fake-indexeddb/auto'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  BACKUP_FORMAT,
  INVALID_BACKUP_ERROR,
  MAX_BACKUP_BYTES,
  clearAllLocalData,
  exportBackup,
  importBackup,
  listBackupItems,
  parseBackup,
  type BackupFile,
  type BackupSection,
} from '@/shared/lib/storage/backup'
import { createKvStore } from '@/shared/lib/storage/idb'

/** Controllable Web Storage (plan §6.11 tests): quota failures per key. */
class FakeStorage implements Storage {
  private readonly entries = new Map<string, string>()
  readonly failOnWrite = new Set<string>()

  get length(): number {
    return this.entries.size
  }

  clear(): void {
    this.entries.clear()
  }

  getItem(key: string): string | null {
    return this.entries.get(key) ?? null
  }

  key(index: number): string | null {
    return [...this.entries.keys()][index] ?? null
  }

  removeItem(key: string): void {
    this.entries.delete(key)
  }

  setItem(key: string, value: string): void {
    if (this.failOnWrite.has(key)) throw quotaError()
    this.entries.set(key, String(value))
  }

  keys(): string[] {
    return [...this.entries.keys()]
  }
}

let storage: FakeStorage

function quotaError(): Error {
  return Object.assign(new Error('quota exceeded'), { name: 'QuotaExceededError' })
}

function writeLocal(key: string, raw: string): void {
  storage.setItem(key, raw)
}

function section(
  namespace: string,
  local: Record<string, string> = {},
  kv: Record<string, unknown> = {},
): BackupSection {
  return { namespace, local, kv }
}

function makeFile(overrides: Partial<BackupFile> = {}): BackupFile {
  return {
    format: BACKUP_FORMAT,
    formatVersion: 1,
    appName: 'Toolset · 嵌入式工具箱',
    createdAt: '2026-01-02T03:04:05.000Z',
    userAgent: 'vitest',
    sections: [],
    ...overrides,
  }
}

function expectParsed(text: string): Extract<ReturnType<typeof parseBackup>, { ok: true }> {
  const result = parseBackup(text)
  if (!result.ok) throw new Error(`预期解析成功，实际失败：${result.error}`)
  return result
}

beforeEach(async () => {
  storage = new FakeStorage()
  vi.stubGlobal('localStorage', storage)
  await clearAllLocalData()
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('listBackupItems', () => {
  it('按命名空间分组，name 去掉命名空间与 .v<n> 后缀', async () => {
    const appRaw = JSON.stringify({ version: 1, data: { theme: 'dark' } })
    const layoutRaw = JSON.stringify({ version: 1, data: [] })
    writeLocal('toolset/app/settings.v1', appRaw)
    writeLocal('toolset/tool/serial/layout.v1', layoutRaw)
    writeLocal('toolset/link/presets.v2', 'presets')
    await createKvStore('toolset/tool/serial/').set('dashboards/d1', { id: 'd1' })
    await createKvStore('toolset/protocol/').set('plugins/p1', { id: 'p1' })

    const groups = await listBackupItems()
    expect(groups.map((group) => group.namespace)).toEqual([
      'toolset/app/',
      'toolset/link/',
      'toolset/protocol/',
      'toolset/tool/serial/',
    ])

    const app = groups.find((group) => group.namespace === 'toolset/app/')
    expect(app?.items).toHaveLength(1)
    expect(app?.items[0]).toMatchObject({ key: 'toolset/app/settings.v1', store: 'local' })
    expect(app?.items[0]?.name).toBe('settings')
    expect(app?.items[0]?.bytes).toBe(new TextEncoder().encode(appRaw).length)

    const link = groups.find((group) => group.namespace === 'toolset/link/')
    expect(link?.items[0]?.name).toBe('presets')

    const serial = groups.find((group) => group.namespace === 'toolset/tool/serial/')
    const serialNames = serial?.items.map((item) => `${item.store}:${item.name}`) ?? []
    expect(serialNames).toEqual(expect.arrayContaining(['local:layout', 'kv:dashboards/d1']))
    const dashboard = serial?.items.find((item) => item.store === 'kv')
    expect(dashboard?.bytes).toBe(new TextEncoder().encode(JSON.stringify({ id: 'd1' })).length)

    const protocol = groups.find((group) => group.namespace === 'toolset/protocol/')
    expect(protocol?.items.map((item) => item.name)).toEqual(['plugins/p1'])
  })

  it('排除非 toolset 键、corrupt 备份和 safe-mode 标记', async () => {
    writeLocal('outside/key', 'x')
    writeLocal('toolset-other/key', 'x')
    writeLocal('toolset/app/settings.v1.corrupt.1700000000000', 'x')
    writeLocal('toolset/safe-mode/pending', '1')
    writeLocal('toolset/safe-mode/blocked', '1')
    writeLocal('toolset/tool/serial/settings.v1', 'x')
    const kv = createKvStore('')
    await kv.set('other/raw', 1)
    await kv.set('toolset/safe-mode/pending', 1)
    await kv.set('toolset/protocol/index.v1.corrupt.2', 2)

    const groups = await listBackupItems()
    expect(groups.map((group) => group.namespace)).toEqual(['toolset/tool/serial/'])
    expect(groups[0]?.items.map((item) => item.key)).toEqual(['toolset/tool/serial/settings.v1'])

    const file = await exportBackup()
    const exportedKeys = file.sections.flatMap((entry) => [
      ...Object.keys(entry.local),
      ...Object.keys(entry.kv),
    ])
    expect(exportedKeys).toEqual(['toolset/tool/serial/settings.v1'])
    expect(exportedKeys.some((key) => key.includes('.corrupt.'))).toBe(false)
    expect(exportedKeys.some((key) => key.startsWith('toolset/safe-mode/'))).toBe(false)
    expect(exportedKeys).not.toContain('other/raw')
  })
})

describe('exportBackup', () => {
  it('导出原始 local 字符串和 kv 值，并记录文件元数据', async () => {
    const settingsRaw = JSON.stringify({ version: 1, data: { theme: 'light' } })
    writeLocal('toolset/app/settings.v1', settingsRaw)
    writeLocal('toolset/link/presets.v2', 'presets-raw')
    await createKvStore('toolset/tool/serial/').set('dashboards/d1', { id: 'd1', name: '主面板' })

    const file = await exportBackup()
    expect(file.format).toBe('toolset-backup')
    expect(file.formatVersion).toBe(1)
    expect(file.appName).toContain('Toolset')
    expect(Number.isNaN(Date.parse(file.createdAt))).toBe(false)
    expect(typeof file.userAgent).toBe('string')

    const app = file.sections.find((entry) => entry.namespace === 'toolset/app/')
    expect(app?.local['toolset/app/settings.v1']).toBe(settingsRaw)
    expect(app?.kv).toEqual({})

    const serial = file.sections.find((entry) => entry.namespace === 'toolset/tool/serial/')
    expect(serial?.kv['toolset/tool/serial/dashboards/d1']).toEqual({ id: 'd1', name: '主面板' })
  })

  it('按命名空间和按完整键筛选', async () => {
    writeLocal('toolset/app/settings.v1', 'app-raw')
    writeLocal('toolset/link/presets.v1', 'link-raw')
    await createKvStore('toolset/tool/serial/').set('dashboards/d1', { id: 'd1' })

    const byNamespace = await exportBackup({ namespaces: ['toolset/link/'] })
    expect(byNamespace.sections).toEqual([
      {
        namespace: 'toolset/link/',
        local: { 'toolset/link/presets.v1': 'link-raw' },
        kv: {},
      },
    ])

    const byKeys = await exportBackup({ keys: ['toolset/tool/serial/dashboards/d1'] })
    expect(byKeys.sections).toHaveLength(1)
    expect(byKeys.sections[0]?.namespace).toBe('toolset/tool/serial/')
    expect(byKeys.sections[0]?.kv['toolset/tool/serial/dashboards/d1']).toEqual({ id: 'd1' })

    const byBoth = await exportBackup({
      namespaces: ['toolset/app/'],
      keys: ['toolset/app/settings.v1'],
    })
    expect(byBoth.sections).toHaveLength(1)
    expect(byBoth.sections[0]?.local).toEqual({ 'toolset/app/settings.v1': 'app-raw' })
  })
})

describe('parseBackup', () => {
  it('接受合法文件并返回每个命名空间的数量与大小摘要', () => {
    const file = makeFile({
      sections: [
        section('toolset/app/', { 'toolset/app/settings.v1': '{"version":1,"data":{}}' }),
        section('toolset/tool/serial/', {}, { 'toolset/tool/serial/dashboards/d1': { id: 'd1' } }),
      ],
    })

    const result = expectParsed(JSON.stringify(file))
    expect(result.file.format).toBe('toolset-backup')
    expect(result.file.formatVersion).toBe(1)
    expect(result.file.createdAt).toBe(file.createdAt)
    expect(result.summary).toEqual([
      {
        namespace: 'toolset/app/',
        localCount: 1,
        kvCount: 0,
        bytes: new TextEncoder().encode('{"version":1,"data":{}}').length,
      },
      {
        namespace: 'toolset/tool/serial/',
        localCount: 0,
        kvCount: 1,
        bytes: new TextEncoder().encode(JSON.stringify({ id: 'd1' })).length,
      },
    ])
  })

  it('逐条校验格式、版本、命名空间、键前缀和值类型', () => {
    const valid = makeFile({
      sections: [section('toolset/app/', { 'toolset/app/settings.v1': '{}' })],
    })

    const cases: Array<{ name: string; text: string; message: string | RegExp }> = [
      { name: '不是 JSON', text: '{oops', message: INVALID_BACKUP_ERROR },
      {
        name: 'format 不匹配',
        text: JSON.stringify({ ...valid, format: 'other-backup' }),
        message: INVALID_BACKUP_ERROR,
      },
      {
        name: 'formatVersion 过新',
        text: JSON.stringify({ ...valid, formatVersion: 2 }),
        message: '配置文件版本过新（formatVersion 2），请升级后再导入',
      },
      {
        name: 'formatVersion 类型错误',
        text: JSON.stringify({ ...valid, formatVersion: '1' }),
        message: INVALID_BACKUP_ERROR,
      },
      {
        name: 'sections 不是数组',
        text: JSON.stringify({ ...valid, sections: {} }),
        message: INVALID_BACKUP_ERROR,
      },
      {
        name: '命名空间非法',
        text: JSON.stringify({ ...valid, sections: [section('toolset/app', {})] }),
        message: INVALID_BACKUP_ERROR,
      },
      {
        name: '命名空间不属于 toolset',
        text: JSON.stringify({ ...valid, sections: [section('other/app/', {})] }),
        message: INVALID_BACKUP_ERROR,
      },
      {
        name: '键不属于命名空间',
        text: JSON.stringify({
          ...valid,
          sections: [section('toolset/app/', { 'toolset/link/presets.v1': 'x' })],
        }),
        message: /不属于命名空间/,
      },
      {
        name: 'local 值不是字符串',
        text: JSON.stringify({
          ...valid,
          sections: [section('toolset/app/', { 'toolset/app/settings.v1': 1 as never })],
        }),
        message: /必须是字符串/,
      },
      {
        name: 'kv 不是对象',
        text: JSON.stringify({
          ...valid,
          sections: [{ namespace: 'toolset/app/', local: {}, kv: [] }],
        }),
        message: INVALID_BACKUP_ERROR,
      },
      {
        name: '文件超过 50MB',
        text: 'x'.repeat(MAX_BACKUP_BYTES + 1),
        message: /超过 50 MB/,
      },
    ]

    for (const testCase of cases) {
      const result = parseBackup(testCase.text)
      expect(result.ok, testCase.name).toBe(false)
      if (result.ok) continue
      expect(result.error, testCase.name).toMatch(
        typeof testCase.message === 'string'
          ? new RegExp(testCase.message.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
          : testCase.message,
      )
    }
  })
})

describe('importBackup', () => {
  it('merge 覆盖同名键并保留其他键', async () => {
    writeLocal('toolset/app/settings.v1', 'old')
    writeLocal('toolset/app/other.v1', 'keep')
    await createKvStore('toolset/protocol/').set('plugins/keep', { id: 'keep' })

    const file = makeFile({
      sections: [section('toolset/app/', { 'toolset/app/settings.v1': 'new' })],
    })
    const result = await importBackup(file, { namespaces: ['toolset/app/'], mode: 'merge' })

    expect(result).toEqual({ written: 1, deleted: 0, failed: [] })
    expect(storage.getItem('toolset/app/settings.v1')).toBe('new')
    expect(storage.getItem('toolset/app/other.v1')).toBe('keep')
    expect(await createKvStore('toolset/protocol/').get('plugins/keep')).toEqual({ id: 'keep' })
  })

  it('replace 先删除所选命名空间的 local 与 kv 键，其他命名空间保留', async () => {
    writeLocal('toolset/app/settings.v1', 'old')
    writeLocal('toolset/app/extra.v1', 'extra')
    writeLocal('toolset/link/presets.v1', 'link')
    await createKvStore('toolset/app/').set('index', 1)
    await createKvStore('toolset/link/').set('devices', { favorite: 'a' })

    const file = makeFile({
      sections: [
        section('toolset/app/', { 'toolset/app/settings.v1': 'new' }, { 'toolset/app/index': 2 }),
      ],
    })
    const result = await importBackup(file, { namespaces: ['toolset/app/'], mode: 'replace' })

    expect(result.deleted).toBe(3)
    expect(result.written).toBe(2)
    expect(result.failed).toEqual([])
    expect(storage.getItem('toolset/app/settings.v1')).toBe('new')
    expect(storage.getItem('toolset/app/extra.v1')).toBeNull()
    expect(storage.getItem('toolset/link/presets.v1')).toBe('link')
    expect(await createKvStore('toolset/app/').get('index')).toBe(2)
    expect(await createKvStore('toolset/link/').get('devices')).toEqual({ favorite: 'a' })
  })

  it('单个键写入失败时记录 failed 并继续处理其余键', async () => {
    writeLocal('toolset/app/settings.v1', 'old')
    storage.failOnWrite.add('toolset/app/broken.v1')
    const circular: Record<string, unknown> = {}
    circular.self = circular

    const file = makeFile({
      sections: [
        section(
          'toolset/app/',
          {
            'toolset/app/settings.v1': 'new',
            'toolset/app/broken.v1': 'will-fail',
          },
          { 'toolset/app/circular': circular },
        ),
      ],
    })
    const result = await importBackup(file, { namespaces: ['toolset/app/'], mode: 'merge' })

    expect(result.written).toBe(1)
    expect(result.failed.map((failure) => failure.key).sort()).toEqual([
      'toolset/app/broken.v1',
      'toolset/app/circular',
    ])
    expect(result.failed.find((failure) => failure.key === 'toolset/app/broken.v1')?.error).toBe(
      'quota exceeded',
    )
    expect(result.failed.find((failure) => failure.key === 'toolset/app/circular')?.error).toBe(
      'IndexedDB 值必须可序列化',
    )
    expect(storage.getItem('toolset/app/settings.v1')).toBe('new')
  })

  it('未选择的命名空间完全不受影响', async () => {
    writeLocal('toolset/app/settings.v1', 'old')
    writeLocal('toolset/link/presets.v1', 'link-old')

    const file = makeFile({
      sections: [
        section('toolset/app/', { 'toolset/app/settings.v1': 'app-new' }),
        section('toolset/link/', { 'toolset/link/presets.v1': 'link-new' }),
      ],
    })
    const result = await importBackup(file, { namespaces: ['toolset/app/'], mode: 'replace' })

    expect(result.written).toBe(1)
    expect(storage.getItem('toolset/app/settings.v1')).toBe('app-new')
    expect(storage.getItem('toolset/link/presets.v1')).toBe('link-old')
  })
})

describe('clearAllLocalData', () => {
  it('删除所有 toolset/ 开头的 local 键、清空 kv，并保留其他 local 键', async () => {
    writeLocal('toolset/app/settings.v1', 'a')
    writeLocal('toolset/tool/serial/settings.v1', 'b')
    writeLocal('other/keep', 'keep')
    writeLocal('toolset-other/keep', 'keep')
    await createKvStore('toolset/protocol/').set('plugins/p', { id: 'p' })
    await createKvStore('other/').set('raw', 1)

    await clearAllLocalData()

    expect(storage.keys().sort()).toEqual(['other/keep', 'toolset-other/keep'])
    expect(storage.getItem('toolset/app/settings.v1')).toBeNull()
    expect(await createKvStore('toolset/protocol/').get('plugins/p')).toBeUndefined()
    expect(await createKvStore('').keys()).toEqual([])
  })
})

describe('KvStore 开发模式校验', () => {
  it('拒绝函数与循环引用，接受可结构化克隆的值', async () => {
    const kv = createKvStore('dev-guard/')

    await expect(kv.set('fn', () => 1)).rejects.toThrow('IndexedDB 值必须可序列化')
    const circular: Record<string, unknown> = {}
    circular.self = circular
    await expect(kv.set('circular', circular)).rejects.toThrow('IndexedDB 值必须可序列化')

    await kv.set('ok', { nested: [1, 2, 3], flag: true })
    expect(await kv.get('ok')).toEqual({ nested: [1, 2, 3], flag: true })
  })
})
