/**
 * 自定义控件仓库（plan §6.10「自定义控件仓库」）。
 *
 * - 索引：localStorage `toolset/tool/serial/widgets.v1`，内容
 *   `Array<{ id, name, updatedAt }>`；
 * - 代码：IndexedDB kv `widgets/<id>`，内容
 *   `CustomWidgetRecord = { id, name, code, createdAt, updatedAt }`。
 *
 * 仓库是仪表盘与自定义控件编辑器之间的唯一数据来源：
 * - 仪表盘导出时把用到的控件记录写入 `.dashboard.json`；
 * - 仪表盘导入时按 id 冲突规则写入（相同代码跳过，不同代码覆盖或保留两者）；
 * - 编辑器保存 / 删除后递增 {@link serialCustomWidgets.revision}，所有宿主据此重新
 *   mount 或显示「找不到自定义控件」。
 */

import { reactive } from 'vue'

import {
  MAX_CUSTOM_WIDGET_CODE_LENGTH,
  compileCustomWidget,
  type CustomWidgetDefinition,
} from '@/domains/dashboard/public'
import { uuid } from '@/shared/lib/id'
import { createToolStorage } from '@/shared/lib/storage/namespace'

import type { DashboardCustomWidgetRecord } from '../dashboard-file'
import { loadDashboard, listDashboardIndex } from '../../stores/dashboards'

/** 索引项；与 plan §6.10 一致。 */
export interface CustomWidgetIndexEntry {
  id: string
  name: string
  updatedAt: number
}

/** 仓库记录；与仪表盘文件中的 `customWidgets` 项结构一致。 */
export type CustomWidgetRecord = DashboardCustomWidgetRecord

/** 仓库统计 / 编译后的摘要，供组件库与放置逻辑使用。 */
export interface CustomWidgetSummary {
  id: string
  name: string
  updatedAt: number
  /** 编译成功时的定义；失败时为 `null`。 */
  definition: CustomWidgetDefinition | null
  /** 编译失败时的错误文案。 */
  compileError: string
  size: {
    default: { w: number; h: number }
    min: { w: number; h: number }
  }
  group: 'chart' | 'value' | 'control'
}

/** 仓库响应式状态；组件只读。 */
export interface CustomWidgetsState {
  index: CustomWidgetIndexEntry[]
  summaries: Record<string, CustomWidgetSummary>
  /** 任何写入 / 删除都会递增；宿主据此重新加载并 mount。 */
  revision: number
}

/** 代码 kv 前缀（完整键为 `toolset/tool/serial/widgets/<id>`）。 */
const CODE_PREFIX = 'widgets/'

const storage = createToolStorage('serial')

function normalizeTimestamp(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : 0
}

/** 把任意来源的数据收敛为合法索引（缺失 / 非法项被丢弃）。 */
export function normalizeCustomWidgetIndex(raw: unknown): CustomWidgetIndexEntry[] {
  if (!Array.isArray(raw)) return []
  const seen = new Set<string>()
  const entries: CustomWidgetIndexEntry[] = []
  for (const item of raw) {
    if (typeof item !== 'object' || item === null) continue
    const record = item as Record<string, unknown>
    if (typeof record.id !== 'string' || record.id.length === 0) continue
    if (seen.has(record.id)) continue
    seen.add(record.id)
    entries.push({
      id: record.id,
      name:
        typeof record.name === 'string' && record.name.trim() !== '' ? record.name : '未命名控件',
      updatedAt: normalizeTimestamp(record.updatedAt),
    })
  }
  return entries
}

const indexStore = storage.local<CustomWidgetIndexEntry[]>('widgets', {
  version: 1,
  defaults: () => [],
  migrate: (raw) => normalizeCustomWidgetIndex(raw),
})

const DEFAULT_SIZE = { w: 6, h: 6 }
const DEFAULT_MIN_SIZE = { w: 2, h: 2 }

function emptySummary(id: string, name: string, updatedAt: number): CustomWidgetSummary {
  return {
    id,
    name,
    updatedAt,
    definition: null,
    compileError: '尚未加载',
    size: { default: { ...DEFAULT_SIZE }, min: { ...DEFAULT_MIN_SIZE } },
    group: 'value',
  }
}

/** 仓库状态；`revision` 用于让宿主在保存 / 删除 / 导入后重新 mount。 */
export const serialCustomWidgets = reactive<CustomWidgetsState>({
  index: normalizeCustomWidgetIndex(indexStore.get()),
  summaries: {},
  revision: 0,
})

/** 仓库变化订阅者（保存 / 删除 / 导入后通知）。 */
const changeListeners = new Set<() => void>()

/** 订阅仓库变化；返回取消订阅函数。 */
export function subscribeCustomWidgets(listener: () => void): () => void {
  changeListeners.add(listener)
  return () => {
    changeListeners.delete(listener)
  }
}

function bumpRevision(): void {
  serialCustomWidgets.revision += 1
  for (const listener of changeListeners) {
    try {
      listener()
    } catch (error) {
      console.error('[custom-widget] 仓库订阅回调失败', error)
    }
  }
}

function buildSummaries(
  entries: CustomWidgetIndexEntry[],
  records: Map<string, CustomWidgetRecord>,
) {
  const summaries: Record<string, CustomWidgetSummary> = {}
  for (const entry of entries) {
    const record = records.get(entry.id)
    if (record === undefined) {
      summaries[entry.id] = emptySummary(entry.id, entry.name, entry.updatedAt)
      continue
    }
    const compiled = compileCustomWidget(record.code)
    if (!compiled.ok) {
      summaries[entry.id] = {
        ...emptySummary(entry.id, entry.name, entry.updatedAt),
        compileError: compiled.error,
      }
      continue
    }
    const definition = compiled.definition
    summaries[entry.id] = {
      id: entry.id,
      name: record.name,
      updatedAt: entry.updatedAt,
      definition,
      compileError: '',
      size: {
        default: { ...(definition.size?.default ?? DEFAULT_SIZE) },
        min: { ...(definition.size?.min ?? DEFAULT_MIN_SIZE) },
      },
      group: definition.meta.group ?? 'value',
    }
  }
  return summaries
}

/** 重新读取索引并编译全部代码（组件库 / 编辑器打开时调用）。 */
export async function refreshCustomWidgets(): Promise<void> {
  const entries = normalizeCustomWidgetIndex(indexStore.get())
  serialCustomWidgets.index = entries
  const records = new Map<string, CustomWidgetRecord>()
  await Promise.all(
    entries.map(async (entry) => {
      const record = await readRecord(entry.id)
      if (record !== undefined) records.set(entry.id, record)
    }),
  )
  serialCustomWidgets.summaries = buildSummaries(entries, records)
  bumpRevision()
}

/** 仓库索引（按最近更新倒序）。 */
export function listCustomWidgetIndex(): CustomWidgetIndexEntry[] {
  return [...serialCustomWidgets.index].sort((left, right) => right.updatedAt - left.updatedAt)
}

/** 按 id 查找索引项。 */
export function findCustomWidgetIndexEntry(id: string): CustomWidgetIndexEntry | undefined {
  return serialCustomWidgets.index.find((entry) => entry.id === id)
}

/** 编译摘要；未加载时返回 `undefined`。 */
export function getCustomWidgetSummary(id: string): CustomWidgetSummary | undefined {
  return serialCustomWidgets.summaries[id]
}

function codeKey(id: string): string {
  return `${CODE_PREFIX}${id}`
}

async function readRecord(id: string): Promise<CustomWidgetRecord | undefined> {
  try {
    const raw = await storage.kv.get<unknown>(codeKey(id))
    if (raw === undefined) return undefined
    if (typeof raw !== 'object' || raw === null) return undefined
    const record = raw as Record<string, unknown>
    if (typeof record.id !== 'string' || record.id !== id) return undefined
    if (typeof record.code !== 'string') return undefined
    const createdAt = normalizeTimestamp(record.createdAt) || Date.now()
    return {
      id,
      name:
        typeof record.name === 'string' && record.name.trim() !== '' ? record.name : '未命名控件',
      code: record.code,
      createdAt,
      updatedAt: normalizeTimestamp(record.updatedAt) || createdAt,
    }
  } catch (error) {
    console.error('[custom-widget] 读取自定义控件失败', error)
    return undefined
  }
}

/** 读取一条控件记录；不存在时返回 `undefined`。 */
export async function getCustomWidgetRecord(id: string): Promise<CustomWidgetRecord | undefined> {
  return readRecord(id)
}

/** 读取多条控件记录（导出仪表盘时使用）。 */
export async function loadCustomWidgetRecords(
  ids: readonly string[],
): Promise<CustomWidgetRecord[]> {
  const seen = new Set<string>()
  const records: CustomWidgetRecord[] = []
  for (const id of ids) {
    if (seen.has(id)) continue
    seen.add(id)
    const record = await readRecord(id)
    if (record !== undefined) records.push(record)
  }
  return records
}

function writeIndex(entries: CustomWidgetIndexEntry[]): void {
  serialCustomWidgets.index = normalizeCustomWidgetIndex(entries)
  indexStore.set(serialCustomWidgets.index)
}

function upsertIndexEntry(record: CustomWidgetRecord): void {
  const next = serialCustomWidgets.index.filter((entry) => entry.id !== record.id)
  next.push({ id: record.id, name: record.name, updatedAt: record.updatedAt })
  writeIndex(next)
}

/** 代码文件名：`<名称>.widget.js`（非法字符替换为 `_`）。 */
export function buildCustomWidgetFileName(name: string): string {
  const safe = name.trim().replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_')
  return `${safe.length > 0 ? safe : '自定义控件'}.widget.js`
}

/** 编译代码并按需读取 meta 名称。 */
export function compileCustomWidgetCode(code: string):
  | {
      ok: true
      definition: CustomWidgetDefinition
    }
  | {
      ok: false
      error: string
      line?: number
    } {
  return compileCustomWidget(code)
}

export interface SaveCustomWidgetInput {
  /** 已有的控件 id；省略时新建。 */
  id?: string | null
  code: string
  /** 覆盖名称；默认使用编译后的 `meta.name`。 */
  name?: string
  /** 导入时显式指定 id（保留两者时也用于改写引用）。 */
  recordId?: string | null
}

/**
 * 保存自定义控件：先编译校验，再写 kv 与索引。
 *
 * @throws 编译失败、代码超过 256KB 或存储写入失败时抛出可在界面展示的错误
 */
export async function saveCustomWidget(input: SaveCustomWidgetInput): Promise<CustomWidgetRecord> {
  if (input.code.length > MAX_CUSTOM_WIDGET_CODE_LENGTH) {
    throw new Error('自定义控件代码不能超过 256KB')
  }
  const compiled = compileCustomWidget(input.code)
  if (!compiled.ok) throw new Error(compiled.error)
  const id = input.id ?? input.recordId ?? uuid()
  const existing = await readRecord(id)
  const now = Date.now()
  const record: CustomWidgetRecord = {
    id,
    name:
      input.name?.trim() !== undefined && input.name.trim() !== ''
        ? input.name.trim()
        : compiled.definition.meta.name,
    code: input.code,
    createdAt: existing?.createdAt ?? now,
    updatedAt: existing !== undefined ? Math.max(now, existing.updatedAt + 1) : now,
  }
  await storage.kv.set(codeKey(id), record)
  upsertIndexEntry(record)
  serialCustomWidgets.summaries = {
    ...serialCustomWidgets.summaries,
    [id]: {
      id,
      name: record.name,
      updatedAt: record.updatedAt,
      definition: compiled.definition,
      compileError: '',
      size: {
        default: { ...(compiled.definition.size?.default ?? DEFAULT_SIZE) },
        min: { ...(compiled.definition.size?.min ?? DEFAULT_MIN_SIZE) },
      },
      group: compiled.definition.meta.group ?? 'value',
    },
  }
  bumpRevision()
  return record
}

/** 导入 `.widget.js` 文件文本；名称优先取编译后的 `meta.name`，失败回落到文件名。 */
export async function importCustomWidget(
  text: string,
  fileName: string,
): Promise<CustomWidgetRecord> {
  const fallbackName = fileName
    .replace(/\.widget\.js$/i, '')
    .replace(/\.js$/i, '')
    .trim()
  const compiled = compileCustomWidget(text)
  if (!compiled.ok) {
    throw new Error(`导入失败：${compiled.error}`)
  }
  return saveCustomWidget({
    id: null,
    code: text,
    name: compiled.definition.meta.name || fallbackName,
  })
}

/** 导出控件代码与文件名。 */
export async function exportCustomWidget(id: string): Promise<{ code: string; fileName: string }> {
  const record = await readRecord(id)
  if (record === undefined) throw new Error(`找不到自定义控件（${id}）`)
  return { code: record.code, fileName: buildCustomWidgetFileName(record.name) }
}

/** 删除控件（索引 + kv）；使用中的仪表盘实例会显示「找不到自定义控件」。 */
export async function removeCustomWidget(id: string): Promise<void> {
  await storage.kv.delete(codeKey(id))
  writeIndex(serialCustomWidgets.index.filter((entry) => entry.id !== id))
  const summaries = { ...serialCustomWidgets.summaries }
  delete summaries[id]
  serialCustomWidgets.summaries = summaries
  bumpRevision()
}

/** 复制控件；名称加「副本」。 */
export async function duplicateCustomWidget(id: string): Promise<CustomWidgetRecord> {
  const record = await readRecord(id)
  if (record === undefined) throw new Error(`找不到自定义控件（${id}）`)
  return saveCustomWidget({ id: null, code: record.code, name: `${record.name} 副本` })
}

/* ------------------------------------------------------------------------- */
/* 仪表盘引用                                                                  */
/* ------------------------------------------------------------------------- */

/** 从仪表盘实例中收集自定义控件 id（按出现顺序去重）。 */
export function customWidgetIdsOfDashboard(widgets: ReadonlyArray<{ type: string }>): string[] {
  const ids: string[] = []
  const seen = new Set<string>()
  for (const widget of widgets) {
    if (!widget.type.startsWith('custom:')) continue
    const id = widget.type.slice('custom:'.length)
    if (id.length === 0 || seen.has(id)) continue
    seen.add(id)
    ids.push(id)
  }
  return ids
}

/** 该仪表盘用到的全部自定义控件记录（导出时写入文件）。 */
export async function collectDashboardCustomWidgets(widgets: ReadonlyArray<{ type: string }>) {
  return loadCustomWidgetRecords(customWidgetIdsOfDashboard(widgets))
}

/** 统计有多少个仪表盘正在使用指定控件（删除前确认）。 */
export async function countDashboardsUsingCustomWidget(id: string): Promise<number> {
  const type = `custom:${id}`
  let count = 0
  for (const entry of listDashboardIndex()) {
    const dashboard = await loadDashboard(entry.id)
    if (dashboard?.widgets.some((widget) => widget.type === type)) count += 1
  }
  return count
}

/* ------------------------------------------------------------------------- */
/* 仪表盘导入：控件 id 冲突                                                    */
/* ------------------------------------------------------------------------- */

export interface CustomWidgetImportConflict {
  /** 文件中携带的记录。 */
  incoming: CustomWidgetRecord
  /** 本机已有的记录。 */
  existing: CustomWidgetRecord
  /** 代码完全相同时不冲突，导入时直接跳过。 */
  sameCode: boolean
}

export type CustomWidgetImportChoice = 'overwrite' | 'keep-both'

/** 预检导入控件冲突（相同代码的不算冲突，会在写入时跳过）。 */
export async function inspectCustomWidgetImport(
  records: readonly CustomWidgetRecord[],
): Promise<CustomWidgetImportConflict[]> {
  const conflicts: CustomWidgetImportConflict[] = []
  for (const incoming of records) {
    const existing = await readRecord(incoming.id)
    if (existing === undefined) continue
    if (existing.code === incoming.code) continue
    conflicts.push({ incoming, existing, sameCode: false })
  }
  return conflicts
}

export interface ImportCustomWidgetsResult {
  /** 实际写入的记录数（不含跳过的相同代码）。 */
  written: number
  /** 相同代码而跳过的记录数。 */
  skipped: number
  /** 旧 id → 新 id 的映射（「保留两者」时生效），用于改写仪表盘实例引用。 */
  idMap: Record<string, string>
}

/**
 * 写入导入的控件记录。
 *
 * - 本机不存在：直接写入；
 * - 代码相同：跳过（不重写，避免无意义地更新 `updatedAt`）；
 * - 代码不同 + `overwrite`：覆盖本机记录；
 * - 代码不同 + `keep-both`：以新 id 写入，并在 `idMap` 中记录映射。
 */
export async function importCustomWidgets(
  records: readonly CustomWidgetRecord[],
  choice: CustomWidgetImportChoice,
): Promise<ImportCustomWidgetsResult> {
  const result: ImportCustomWidgetsResult = { written: 0, skipped: 0, idMap: {} }
  const index: CustomWidgetIndexEntry[] = [...serialCustomWidgets.index]
  for (const incoming of records) {
    const existing = await readRecord(incoming.id)
    if (existing !== undefined && existing.code === incoming.code) {
      result.skipped += 1
      continue
    }
    if (existing === undefined || choice === 'overwrite') {
      const record: CustomWidgetRecord = {
        id: incoming.id,
        name: incoming.name,
        code: incoming.code,
        createdAt: existing?.createdAt ?? incoming.createdAt,
        updatedAt: Math.max(Date.now(), existing?.updatedAt ?? 0, incoming.updatedAt),
      }
      await storage.kv.set(codeKey(record.id), record)
      const position = index.findIndex((entry) => entry.id === record.id)
      const entry = { id: record.id, name: record.name, updatedAt: record.updatedAt }
      if (position >= 0) index[position] = entry
      else index.push(entry)
      result.written += 1
      continue
    }
    const newId = uuid()
    const copy: CustomWidgetRecord = {
      ...incoming,
      id: newId,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    }
    await storage.kv.set(codeKey(newId), copy)
    index.push({ id: newId, name: copy.name, updatedAt: copy.updatedAt })
    result.idMap[incoming.id] = newId
    result.written += 1
  }
  writeIndex(index)
  await refreshCustomWidgets()
  return result
}

/** 改写仪表盘实例中的 `custom:<id>` 引用（「保留两者」时使用，纯函数）。 */
export function remapCustomWidgetTypes<T extends { type: string }>(
  widgets: readonly T[],
  idMap: Readonly<Record<string, string>>,
): T[] {
  if (Object.keys(idMap).length === 0) return [...widgets]
  return widgets.map((widget) => {
    if (!widget.type.startsWith('custom:')) return widget
    const id = widget.type.slice('custom:'.length)
    const mapped = idMap[id]
    if (mapped === undefined) return widget
    return { ...widget, type: `custom:${mapped}` }
  })
}

/* ------------------------------------------------------------------------- */
/* 安全说明「不再提示」                                                        */
/* ------------------------------------------------------------------------- */

export interface CustomWidgetSafetyNoticeState {
  dismissed: boolean
}

const safetyStore = storage.local<CustomWidgetSafetyNoticeState>('custom-widget-safety', {
  version: 1,
  defaults: () => ({ dismissed: false }),
  migrate: (raw) => {
    const record = typeof raw === 'object' && raw !== null ? (raw as Record<string, unknown>) : {}
    return { dismissed: record.dismissed === true }
  },
})

/** 安全说明是否已被勾选「不再提示」。 */
export function isCustomWidgetSafetyNoticeDismissed(): boolean {
  return safetyStore.get().dismissed === true
}

/** 记住「不再提示」；传 `false` 可恢复提示。 */
export function setCustomWidgetSafetyNoticeDismissed(dismissed: boolean): void {
  safetyStore.set({ dismissed })
}

/** 首次加载索引：让组件库在打开工具页时就有数据。 */
void refreshCustomWidgets()
