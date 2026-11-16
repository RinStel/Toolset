/**
 * Local configuration backup (plan §6.11).
 *
 * Enumerates, exports, validates, imports and clears every `toolset/` entry stored in
 * localStorage and in the shared IndexedDB `kv` object store. The module is pure
 * TypeScript: the Chinese display names of entries come from `app/config/backup-labels.ts`
 * and from each manifest's `backupLabels`, so the storage layer only exposes stable
 * keys and the relative `name` derived from them.
 *
 * Keys owned by tools live in `toolset/tool/<id>/`, every other entry belongs to
 * `toolset/<first segment>/`. Safety-mode markers (`toolset/safe-mode/`), corrupt-data
 * backups (`.corrupt.`) and foreign keys are never exported or imported (plan §10).
 */

import { createKvStore } from './idb'
import { resolveLocalStorage } from './local'
import { STORAGE_ROOT } from './namespace'

/** Marker written into every backup file. */
export const BACKUP_FORMAT = 'toolset-backup'
/** Only version 1 is understood by this build. */
export const BACKUP_FORMAT_VERSION = 1
/** Files larger than this are rejected before JSON parsing. */
export const MAX_BACKUP_BYTES = 50 * 1024 * 1024
/** Generic validation failure message (plan §9). */
export const INVALID_BACKUP_ERROR = '不是有效的 Toolset 配置文件'

const BACKUP_APP_NAME = 'Toolset · 嵌入式工具箱'
const BACKUP_ROOT_PREFIX = `${STORAGE_ROOT}/`
const TOOL_STORAGE_PREFIX = `${STORAGE_ROOT}/tool/`
const SAFE_MODE_PREFIX = `${STORAGE_ROOT}/safe-mode/`
const CORRUPT_MARKER = '.corrupt.'
const VERSION_SUFFIX = /\.v\d+$/

export interface BackupSection {
  /** `toolset/app/`, `toolset/protocol/`, `toolset/link/`, `toolset/tool/<id>/`, … */
  namespace: string
  /** Full localStorage key → the original raw string. */
  local: Record<string, string>
  /** Full IndexedDB key → the stored value. */
  kv: Record<string, unknown>
}

export interface BackupFile {
  format: 'toolset-backup'
  formatVersion: 1
  appName: string
  /** ISO 8601 timestamp of the export. */
  createdAt: string
  userAgent: string
  sections: BackupSection[]
}

export interface BackupItem {
  /** Full storage key. */
  key: string
  store: 'local' | 'kv'
  /** Key relative to the namespace with the `.v<n>` suffix removed. */
  name: string
  /** Estimated UTF-8 size of the stored payload. */
  bytes: number
}

export interface BackupItemGroup {
  namespace: string
  items: BackupItem[]
}

export interface BackupSelection {
  /** Only include sections whose namespace is listed. */
  namespaces?: string[]
  /** Only include these full keys. */
  keys?: string[]
}

export interface BackupSummary {
  namespace: string
  localCount: number
  kvCount: number
  bytes: number
}

export type ParseBackupResult =
  { ok: true; file: BackupFile; summary: BackupSummary[] } | { ok: false; error: string }

export interface ImportBackupOptions {
  namespaces: string[]
  mode: 'merge' | 'replace'
}

export interface ImportBackupFailure {
  key: string
  error: string
}

export interface ImportBackupResult {
  written: number
  deleted: number
  failed: ImportBackupFailure[]
}

interface EnumeratedEntry {
  key: string
  store: 'local' | 'kv'
  raw?: string
  value?: unknown
}

const textEncoder = typeof TextEncoder === 'function' ? new TextEncoder() : null

function utf8Length(text: string): number {
  return textEncoder ? textEncoder.encode(text).length : text.length
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function currentUserAgent(): string {
  if (typeof navigator === 'undefined') return ''
  return typeof navigator.userAgent === 'string' ? navigator.userAgent : ''
}

/** Namespace of a full storage key, following the rule in plan §6.11. */
export function backupNamespaceOf(key: string): string {
  if (key.startsWith(TOOL_STORAGE_PREFIX)) {
    const toolId = key.slice(TOOL_STORAGE_PREFIX.length).split('/')[0]
    if (toolId) return `${TOOL_STORAGE_PREFIX}${toolId}/`
  }
  const first = key.slice(BACKUP_ROOT_PREFIX.length).split('/')[0]
  if (first) return `${BACKUP_ROOT_PREFIX}${first}/`
  return BACKUP_ROOT_PREFIX
}

/** Item name: the key without its namespace and without a `.v<n>` suffix. */
export function backupNameOf(key: string): string {
  const namespace = backupNamespaceOf(key)
  const relative = key.startsWith(namespace)
    ? key.slice(namespace.length)
    : key.slice(BACKUP_ROOT_PREFIX.length)
  return relative.replace(VERSION_SUFFIX, '')
}

/** True for keys that may be exported: `toolset/`, not corrupt, not safety mode. */
export function isBackupKey(key: string): boolean {
  return (
    key.length > BACKUP_ROOT_PREFIX.length &&
    key.startsWith(BACKUP_ROOT_PREFIX) &&
    !key.includes(CORRUPT_MARKER) &&
    !key.startsWith(SAFE_MODE_PREFIX)
  )
}

function readLocalKeys(storage: Storage): string[] {
  const keys: string[] = []
  try {
    for (let index = 0; index < storage.length; index += 1) {
      const key = storage.key(index)
      if (key !== null) keys.push(key)
    }
  } catch {
    return []
  }
  return keys.sort()
}

function readLocalRaw(storage: Storage, key: string): string | null {
  try {
    return storage.getItem(key)
  } catch {
    return null
  }
}

function entryBytes(entry: EnumeratedEntry): number {
  if (entry.store === 'local') return utf8Length(entry.raw ?? '')
  const json = JSON.stringify(entry.value)
  return utf8Length(json ?? '')
}

function sectionBytes(section: BackupSection): number {
  let bytes = 0
  for (const raw of Object.values(section.local)) bytes += utf8Length(raw)
  for (const value of Object.values(section.kv)) {
    const json = JSON.stringify(value)
    bytes += utf8Length(json ?? '')
  }
  return bytes
}

/** Reads every backup-eligible entry from localStorage and IndexedDB. */
async function collectBackupEntries(): Promise<EnumeratedEntry[]> {
  const entries: EnumeratedEntry[] = []

  const storage = resolveLocalStorage()
  if (storage) {
    for (const key of readLocalKeys(storage)) {
      if (!isBackupKey(key)) continue
      const raw = readLocalRaw(storage, key)
      if (raw === null) continue
      entries.push({ key, store: 'local', raw })
    }
  }

  // `createKvStore('')` keeps the public KvStore API unchanged while exposing full keys.
  const kv = createKvStore('')
  let keys: string[] = []
  try {
    keys = await kv.keys()
  } catch {
    keys = []
  }
  for (const key of keys) {
    if (!isBackupKey(key)) continue
    let value: unknown
    try {
      value = await kv.get(key)
    } catch {
      continue
    }
    if (value === undefined) continue
    entries.push({ key, store: 'kv', value })
  }

  return entries
}

/** Lists backup items grouped by namespace, omitting excluded keys (plan §6.11). */
export async function listBackupItems(): Promise<BackupItemGroup[]> {
  const groups = new Map<string, BackupItem[]>()
  for (const entry of await collectBackupEntries()) {
    const namespace = backupNamespaceOf(entry.key)
    const item: BackupItem = {
      key: entry.key,
      store: entry.store,
      name: backupNameOf(entry.key),
      bytes: entryBytes(entry),
    }
    const items = groups.get(namespace)
    if (items) items.push(item)
    else groups.set(namespace, [item])
  }
  return [...groups.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([namespace, items]) => ({
      namespace,
      items: [...items].sort((left, right) => left.key.localeCompare(right.key)),
    }))
}

/** Builds a backup file, optionally restricted to namespaces and/or full keys. */
export async function exportBackup(select?: BackupSelection): Promise<BackupFile> {
  const namespaceFilter = select?.namespaces ? new Set(select.namespaces) : null
  const keyFilter = select?.keys ? new Set(select.keys) : null
  const sections = new Map<string, BackupSection>()

  for (const entry of await collectBackupEntries()) {
    if (keyFilter && !keyFilter.has(entry.key)) continue
    const namespace = backupNamespaceOf(entry.key)
    if (namespaceFilter && !namespaceFilter.has(namespace)) continue
    let section = sections.get(namespace)
    if (!section) {
      section = { namespace, local: {}, kv: {} }
      sections.set(namespace, section)
    }
    if (entry.store === 'local') section.local[entry.key] = entry.raw ?? ''
    else section.kv[entry.key] = entry.value
  }

  return {
    format: 'toolset-backup',
    formatVersion: 1,
    appName: BACKUP_APP_NAME,
    createdAt: new Date().toISOString(),
    userAgent: currentUserAgent(),
    sections: [...sections.values()].sort((left, right) =>
      left.namespace.localeCompare(right.namespace),
    ),
  }
}

function isValidNamespace(namespace: string): boolean {
  return (
    namespace.length > BACKUP_ROOT_PREFIX.length &&
    namespace.startsWith(BACKUP_ROOT_PREFIX) &&
    namespace.endsWith('/')
  )
}

function validateSectionKey(key: string, namespace: string): string | null {
  if (key.startsWith(BACKUP_ROOT_PREFIX) && key.startsWith(namespace)) return null
  return `不是有效的 Toolset 配置文件：键「${key}」不属于命名空间「${namespace}」`
}

function invalid(): ParseBackupResult {
  return { ok: false, error: INVALID_BACKUP_ERROR }
}

/**
 * Validates a backup file read from disk (plan §6.11). Error messages follow plan §9:
 * a generic message for structural problems and a dedicated one for future versions.
 */
export function parseBackup(text: string): ParseBackupResult {
  if (utf8Length(text) > MAX_BACKUP_BYTES) {
    return { ok: false, error: '配置文件过大（超过 50 MB），无法导入' }
  }

  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    return invalid()
  }

  if (!isRecord(parsed)) return invalid()
  if (parsed.format !== BACKUP_FORMAT) return invalid()

  const version = parsed.formatVersion
  if (typeof version !== 'number' || !Number.isInteger(version) || version < 1) return invalid()
  if (version > BACKUP_FORMAT_VERSION) {
    return {
      ok: false,
      error: `配置文件版本过新（formatVersion ${version}），请升级后再导入`,
    }
  }

  const rawSections = parsed.sections
  if (!Array.isArray(rawSections)) return invalid()
  const sections: BackupSection[] = []

  for (const rawSection of rawSections) {
    if (!isRecord(rawSection)) return invalid()
    const namespace = rawSection.namespace
    if (typeof namespace !== 'string' || !isValidNamespace(namespace)) return invalid()

    const rawLocal = rawSection.local
    const rawKv = rawSection.kv
    if (!isRecord(rawLocal) || !isRecord(rawKv)) return invalid()

    const local: Record<string, string> = {}
    for (const [key, value] of Object.entries(rawLocal)) {
      const keyError = validateSectionKey(key, namespace)
      if (keyError !== null) return { ok: false, error: keyError }
      if (typeof value !== 'string') {
        return {
          ok: false,
          error: `不是有效的 Toolset 配置文件：键「${key}」的值必须是字符串`,
        }
      }
      local[key] = value
    }

    const kv: Record<string, unknown> = {}
    for (const key of Object.keys(rawKv)) {
      const keyError = validateSectionKey(key, namespace)
      if (keyError !== null) return { ok: false, error: keyError }
      kv[key] = rawKv[key]
    }

    sections.push({ namespace, local, kv })
  }

  const file: BackupFile = {
    format: 'toolset-backup',
    formatVersion: 1,
    appName: typeof parsed.appName === 'string' ? parsed.appName : '',
    createdAt: typeof parsed.createdAt === 'string' ? parsed.createdAt : '',
    userAgent: typeof parsed.userAgent === 'string' ? parsed.userAgent : '',
    sections,
  }
  const summary = sections.map((section) => ({
    namespace: section.namespace,
    localCount: Object.keys(section.local).length,
    kvCount: Object.keys(section.kv).length,
    bytes: sectionBytes(section),
  }))
  return { ok: true, file, summary }
}

function selectedNamespaces(namespaces: readonly string[]): string[] {
  return [...new Set(namespaces)].sort()
}

async function replaceNamespaceData(
  namespaces: readonly string[],
  storage: Storage | null,
  result: ImportBackupResult,
): Promise<void> {
  const matchesNamespace = (key: string): boolean =>
    namespaces.some((namespace) => key.startsWith(namespace))

  if (storage) {
    for (const key of readLocalKeys(storage)) {
      if (!matchesNamespace(key)) continue
      try {
        storage.removeItem(key)
        result.deleted += 1
      } catch (error) {
        result.failed.push({ key, error: errorMessage(error) })
      }
    }
  }

  const kv = createKvStore('')
  let keys: string[] = []
  try {
    keys = await kv.keys()
  } catch (error) {
    result.failed.push({ key: '', error: errorMessage(error) })
    return
  }
  for (const key of keys) {
    if (!matchesNamespace(key)) continue
    try {
      await kv.delete(key)
      result.deleted += 1
    } catch (error) {
      result.failed.push({ key, error: errorMessage(error) })
    }
  }
}

/**
 * Imports a validated backup file (plan §6.11).
 *
 * `merge` overwrites identically named keys and keeps the rest. `replace` first deletes
 * every existing local and kv entry of the selected namespaces, then writes the file.
 * A failing key is recorded in `failed` and does not stop the remaining keys.
 */
export async function importBackup(
  file: BackupFile,
  options: ImportBackupOptions,
): Promise<ImportBackupResult> {
  const namespaces = selectedNamespaces(options.namespaces)
  const result: ImportBackupResult = { written: 0, deleted: 0, failed: [] }
  const storage = resolveLocalStorage()
  const kv = createKvStore('')

  if (options.mode === 'replace') {
    await replaceNamespaceData(namespaces, storage, result)
  }

  for (const section of file.sections) {
    if (!namespaces.includes(section.namespace)) continue

    for (const [key, raw] of Object.entries(section.local)) {
      if (!key.startsWith(section.namespace) || !isBackupKey(key)) {
        result.failed.push({ key, error: '不是有效的备份键' })
        continue
      }
      try {
        if (!storage) throw new Error('当前浏览器不支持 localStorage')
        storage.setItem(key, raw)
        result.written += 1
      } catch (error) {
        result.failed.push({ key, error: errorMessage(error) })
      }
    }

    for (const [key, value] of Object.entries(section.kv)) {
      if (!key.startsWith(section.namespace) || !isBackupKey(key)) {
        result.failed.push({ key, error: '不是有效的备份键' })
        continue
      }
      try {
        await kv.set(key, value)
        result.written += 1
      } catch (error) {
        result.failed.push({ key, error: errorMessage(error) })
      }
    }
  }

  return result
}

/**
 * Removes every `toolset/` localStorage key and empties the IndexedDB `kv` store
 * (plan §6.11). Non-Toolset localStorage keys are left untouched.
 */
export async function clearAllLocalData(): Promise<void> {
  const storage = resolveLocalStorage()
  if (storage) {
    for (const key of readLocalKeys(storage)) {
      if (!key.startsWith(BACKUP_ROOT_PREFIX)) continue
      try {
        storage.removeItem(key)
      } catch {
        // Best effort: a storage that refuses removal is already unusable.
      }
    }
  }

  const kv = createKvStore('')
  let keys: string[] = []
  try {
    keys = await kv.keys()
  } catch {
    return
  }
  for (const key of keys) {
    try {
      await kv.delete(key)
    } catch {
      // Best effort, same as above.
    }
  }
}
