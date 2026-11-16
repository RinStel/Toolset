/**
 * 插件仓库（plan §6.5）：代码存 IndexedDB kv，索引存 localStorage，内置协议只读。
 */

import { uuid } from '../../shared/lib/id'
import { createDomainStorage } from '../../shared/lib/storage/namespace'
import { BUILTIN_PROTOCOLS, isBuiltinProtocol } from './builtin'
import { compileProtocol } from './runtime/compile'
import type { ProtocolRecord, ProtocolSummary } from './types'

/** 代码在 `toolset/protocol/` kv 里的键前缀：`plugins/<id>`。 */
const CODE_KEY_PREFIX = 'plugins/'

interface ProtocolIndexEntry {
  id: string
  name: string
  updatedAt: number
}

export interface ProtocolSaveInput {
  /** 省略时生成新的 UUID。 */
  id?: string
  name: string
  code: string
}

export interface ProtocolExportFile {
  fileName: string
  code: string
}

export interface ProtocolRepository {
  /** 内置 + 自定义插件，内置在前。 */
  list(): Promise<ProtocolSummary[]>
  get(id: string): Promise<ProtocolRecord | undefined>
  save(input: ProtocolSaveInput): Promise<ProtocolRecord>
  /** @returns 是否真的删除了记录。 */
  remove(id: string): Promise<boolean>
  /** 导入 `.js` 文本；编译失败时用文件名作为协议名。 */
  importFile(text: string, fileName: string): Promise<ProtocolRecord>
  /** @returns 文件名为 `<name>.protocol.js`。 */
  exportFile(id: string): Promise<ProtocolExportFile>
  /** 列表变化通知；返回取消函数。 */
  subscribe(listener: (records: ProtocolSummary[]) => void): () => void
}

const storage = createDomainStorage('protocol')
const codeStore = storage.kv
const indexStore = storage.local<ProtocolIndexEntry[]>('index', {
  version: 1,
  defaults: () => [],
})

function sanitizeFileName(name: string): string {
  const cleaned = name.replace(/[\\/:*?"<>|]/g, '_').trim()
  return cleaned.length > 0 ? cleaned : '未命名协议'
}

function fileNameToProtocolName(fileName: string): string {
  const base = fileName.replace(/\\/g, '/').split('/').pop() ?? fileName
  const name = base
    .replace(/\.protocol\.js$/i, '')
    .replace(/\.js$/i, '')
    .trim()
  return name.length > 0 ? name : '导入的协议'
}

function isIndexEntry(value: unknown): value is ProtocolIndexEntry {
  if (typeof value !== 'object' || value === null) return false
  const entry = value as Partial<ProtocolIndexEntry>
  return (
    typeof entry.id === 'string' &&
    typeof entry.name === 'string' &&
    typeof entry.updatedAt === 'number'
  )
}

function readIndex(): ProtocolIndexEntry[] {
  const raw: unknown = indexStore.get()
  if (!Array.isArray(raw)) return []
  return raw.filter(isIndexEntry).map((entry) => ({
    id: entry.id,
    name: entry.name,
    updatedAt: entry.updatedAt,
  }))
}

function writeIndex(entries: ProtocolIndexEntry[]): void {
  indexStore.set(entries)
}

function buildSummaries(): ProtocolSummary[] {
  const builtins: ProtocolSummary[] = BUILTIN_PROTOCOLS.map((record) => ({
    id: record.id,
    name: record.name,
    builtin: true,
    updatedAt: record.updatedAt,
  }))
  const custom: ProtocolSummary[] = readIndex()
    .map((entry) => ({
      id: entry.id,
      name: entry.name,
      builtin: false,
      updatedAt: entry.updatedAt,
    }))
    .sort((left, right) => left.name.localeCompare(right.name, 'zh-Hans-CN'))
  return [...builtins, ...custom]
}

function isProtocolRecord(value: unknown): value is ProtocolRecord {
  if (typeof value !== 'object' || value === null) return false
  const record = value as Partial<ProtocolRecord>
  return (
    typeof record.id === 'string' &&
    typeof record.name === 'string' &&
    typeof record.code === 'string' &&
    typeof record.createdAt === 'number' &&
    typeof record.updatedAt === 'number'
  )
}

/** 创建仓库实例（测试用；应用使用 `getProtocolRepository()` 单例）。 */
export function createProtocolRepository(): ProtocolRepository {
  const listeners = new Set<(records: ProtocolSummary[]) => void>()

  function notify(): void {
    const records = buildSummaries()
    for (const listener of [...listeners]) {
      try {
        listener(records)
      } catch {
        // 单个订阅者出错不能影响其他订阅者。
      }
    }
  }

  const repository: ProtocolRepository = {
    async list(): Promise<ProtocolSummary[]> {
      return buildSummaries()
    },

    async get(id: string): Promise<ProtocolRecord | undefined> {
      const builtin = BUILTIN_PROTOCOLS.find((record) => record.id === id)
      if (builtin !== undefined) return builtin
      const stored = await codeStore.get<unknown>(CODE_KEY_PREFIX + id)
      return isProtocolRecord(stored) ? stored : undefined
    },

    async save(input: ProtocolSaveInput): Promise<ProtocolRecord> {
      if (isBuiltinProtocol(input.id ?? '')) throw new Error('内置协议不可修改')
      const id = input.id !== undefined && input.id.trim().length > 0 ? input.id : uuid()
      const name = input.name.trim()
      const existing = await codeStore.get<unknown>(CODE_KEY_PREFIX + id)
      const now = Date.now()
      const record: ProtocolRecord = {
        id,
        name: name.length > 0 ? name : '未命名协议',
        code: input.code,
        createdAt: isProtocolRecord(existing) ? existing.createdAt : now,
        updatedAt: now,
      }
      await codeStore.set(CODE_KEY_PREFIX + id, record)
      writeIndex([
        ...readIndex().filter((entry) => entry.id !== id),
        { id, name: record.name, updatedAt: record.updatedAt },
      ])
      notify()
      return record
    },

    async remove(id: string): Promise<boolean> {
      if (isBuiltinProtocol(id)) throw new Error('内置协议不可删除')
      await codeStore.delete(CODE_KEY_PREFIX + id)
      const before = readIndex()
      const after = before.filter((entry) => entry.id !== id)
      const removed = after.length !== before.length
      if (removed) writeIndex(after)
      notify()
      return removed
    },

    async importFile(text: string, fileName: string): Promise<ProtocolRecord> {
      const compiled = compileProtocol(text)
      const name = compiled.ok ? compiled.definition.meta.name : fileNameToProtocolName(fileName)
      return repository.save({ name, code: text })
    },

    async exportFile(id: string): Promise<ProtocolExportFile> {
      const record = await repository.get(id)
      if (record === undefined) throw new Error(`协议不存在：${id}`)
      return {
        fileName: `${sanitizeFileName(record.name)}.protocol.js`,
        code: record.code,
      }
    },

    subscribe(listener: (records: ProtocolSummary[]) => void): () => void {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
  }

  return repository
}

let singleton: ProtocolRepository | undefined

/** 应用使用的仓库单例。 */
export function getProtocolRepository(): ProtocolRepository {
  singleton ??= createProtocolRepository()
  return singleton
}
