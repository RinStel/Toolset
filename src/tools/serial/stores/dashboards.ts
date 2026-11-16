/**
 * 仪表盘仓库（plan §8.10「持久化」）。
 *
 * - 索引：localStorage `toolset/tool/serial/dashboards.v1`，内容 `Array<{id,name,updatedAt}>`；
 * - 内容：IndexedDB kv `dashboards/<id>`（结构为 `Dashboard`）。
 *
 * 保存策略：仪表盘的每次修改由调用方按 800ms 防抖调用 {@link scheduleDashboardSave}；
 * 保存前比较 kv 中的 `updatedAt` 与本标签页加载 / 上次写入的基线，发现其他标签页
 * 修改时返回 `conflict`（plan §8.10「多标签页」）。
 */

import { reactive } from 'vue'

import {
  createEmptyDashboard,
  generateDashboard,
  migrateDashboard,
  validateDashboard,
  type Dashboard,
} from '@/domains/dashboard/public'
import type { VariableInfo } from '@/domains/series/public'
import { uuid } from '@/shared/lib/id'
import { createToolStorage } from '@/shared/lib/storage/namespace'

import {
  buildDashboardFileName,
  parseDashboardFile,
  sanitizeDashboardLayout,
  serializeDashboardFile,
  type DashboardCustomWidgetRecord,
} from '../dashboard/dashboard-file'

/** 索引项（plan §8.10）。 */
export interface DashboardIndexEntry {
  id: string
  name: string
  updatedAt: number
}

/** 保存状态；工具栏用它显示「未保存」与冲突提示。 */
export type DashboardSaveStatus = 'saved' | 'saving' | 'error' | 'conflict'

/** 保存结果。 */
export type DashboardSaveResult =
  | { ok: true; dashboard: Dashboard }
  | { ok: false; error: string }
  | { ok: false; conflict: true; remote: Dashboard }

export interface DashboardsState {
  index: DashboardIndexEntry[]
  saveStatus: Record<string, DashboardSaveStatus>
  saveError: Record<string, string>
}

/** 防抖保存延迟（plan §8.10）。 */
export const DASHBOARD_SAVE_DEBOUNCE_MS = 800

const storage = createToolStorage('serial')
const contentPrefix = 'dashboards/'

function contentKey(id: string): string {
  return `${contentPrefix}${id}`
}

function normalizeTimestamp(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : 0
}

/** 把任意来源的数据收敛为合法索引（缺失 / 非法项被丢弃）。 */
export function normalizeDashboardIndex(raw: unknown): DashboardIndexEntry[] {
  if (!Array.isArray(raw)) return []
  const seen = new Set<string>()
  const entries: DashboardIndexEntry[] = []
  for (const item of raw) {
    if (typeof item !== 'object' || item === null) continue
    const record = item as Record<string, unknown>
    if (typeof record.id !== 'string' || record.id.length === 0) continue
    if (seen.has(record.id)) continue
    seen.add(record.id)
    entries.push({
      id: record.id,
      name:
        typeof record.name === 'string' && record.name.trim() !== '' ? record.name : '未命名仪表盘',
      updatedAt: normalizeTimestamp(record.updatedAt),
    })
  }
  return entries
}

const indexStore = storage.local<DashboardIndexEntry[]>('dashboards', {
  version: 1,
  defaults: () => [],
  migrate: (raw) => normalizeDashboardIndex(raw),
})

/** 已加载 / 已保存的 `updatedAt` 基线，用于检测其他标签页的修改。 */
const baselineUpdatedAt = new Map<string, number>()
/** 本标签页上一次写入的 `updatedAt`，用于区分「自己刚写入」与「其他标签页写入」。 */
const lastWrittenUpdatedAt = new Map<string, number>()
const pendingSaves = new Map<
  string,
  { timer: ReturnType<typeof setTimeout>; dashboard: Dashboard }
>()

/** 仪表盘仓库状态；组件只读。 */
export const serialDashboards = reactive<DashboardsState>({
  index: normalizeDashboardIndex(indexStore.get()),
  saveStatus: {},
  saveError: {},
})

indexStore.subscribe((value) => {
  serialDashboards.index = normalizeDashboardIndex(value)
})

/* ------------------------------------------------------------------------- */
/* 索引与查询                                                                  */
/* ------------------------------------------------------------------------- */

/** 索引副本（按最近更新倒序）。 */
export function listDashboardIndex(): DashboardIndexEntry[] {
  return [...serialDashboards.index].sort((left, right) => right.updatedAt - left.updatedAt)
}

/** 按 id 查找索引项。 */
export function getDashboardIndexEntry(id: string): DashboardIndexEntry | undefined {
  return serialDashboards.index.find((entry) => entry.id === id)
}

/** 仪表盘名称；找不到时回落到「未命名仪表盘」。 */
export function dashboardName(id: string | null | undefined): string {
  if (!id) return ''
  return getDashboardIndexEntry(id)?.name ?? '未命名仪表盘'
}

/** 当前保存状态。 */
export function dashboardSaveStatus(id: string | null | undefined): DashboardSaveStatus {
  if (!id) return 'saved'
  return serialDashboards.saveStatus[id] ?? 'saved'
}

/** 当前保存错误信息。 */
export function dashboardSaveError(id: string | null | undefined): string {
  if (!id) return ''
  return serialDashboards.saveError[id] ?? ''
}

function setSaveStatus(id: string, status: DashboardSaveStatus, error = ''): void {
  serialDashboards.saveStatus[id] = status
  if (error.length > 0) serialDashboards.saveError[id] = error
  else delete serialDashboards.saveError[id]
}

function upsertIndexEntry(dashboard: Dashboard): void {
  const next = serialDashboards.index.filter((entry) => entry.id !== dashboard.id)
  next.push({ id: dashboard.id, name: dashboard.name, updatedAt: dashboard.updatedAt })
  serialDashboards.index = next
  indexStore.set(serialDashboards.index)
}

function writeIndex(entries: DashboardIndexEntry[]): void {
  serialDashboards.index = entries
  indexStore.set(entries)
}

/* ------------------------------------------------------------------------- */
/* 读取                                                                        */
/* ------------------------------------------------------------------------- */

/**
 * 加载仪表盘：`migrateDashboard → validateDashboard → normalize`（plan §8.10）。
 *
 * 内容不存在或校验失败时返回 `null`，并把保存状态置为 `error`（调用方可回退空状态）。
 */
export async function loadDashboard(id: string): Promise<Dashboard | null> {
  const raw = await storage.kv.get<unknown>(contentKey(id))
  if (raw === undefined) {
    setSaveStatus(id, 'error', '仪表盘内容不存在')
    return null
  }
  const migrated = migrateDashboard(raw)
  if (!migrated.ok) {
    setSaveStatus(id, 'error', migrated.error)
    return null
  }
  const validated = validateDashboard(migrated.dashboard)
  if (!validated.ok) {
    setSaveStatus(id, 'error', validated.errors[0] ?? '仪表盘内容校验失败')
    return null
  }
  const dashboard = sanitizeDashboardLayout(validated.dashboard)
  baselineUpdatedAt.set(id, dashboard.updatedAt)
  lastWrittenUpdatedAt.set(id, dashboard.updatedAt)
  setSaveStatus(id, 'saved')
  return dashboard
}

/* ------------------------------------------------------------------------- */
/* 写入                                                                        */
/* ------------------------------------------------------------------------- */

/** 把仪表盘写入 kv 索引；新仪表盘直接写，不参与防抖。 */
async function writeNewDashboard(dashboard: Dashboard): Promise<Dashboard> {
  const plain = JSON.parse(JSON.stringify(dashboard)) as Dashboard
  await storage.kv.set(contentKey(plain.id), plain)
  upsertIndexEntry(plain)
  baselineUpdatedAt.set(plain.id, plain.updatedAt)
  lastWrittenUpdatedAt.set(plain.id, plain.updatedAt)
  setSaveStatus(plain.id, 'saved')
  return plain
}

function nextUpdatedAt(dashboard: Dashboard): number {
  const now = Date.now()
  const baseline = baselineUpdatedAt.get(dashboard.id) ?? 0
  return Math.max(now, dashboard.updatedAt + 1, baseline + 1)
}

/**
 * 立即保存一份仪表盘。
 *
 * 保存前读取 kv 中的 `updatedAt`：如果比本标签页的基线新（且不是本标签页上次写入的
 * 版本），返回 `conflict` 且不写入，由界面提示「该仪表盘已在其他标签页修改」。
 */
export async function saveDashboardNow(dashboard: Dashboard): Promise<DashboardSaveResult> {
  const id = dashboard.id
  setSaveStatus(id, 'saving')
  const remoteRaw = await storage.kv.get<unknown>(contentKey(id))
  if (remoteRaw !== undefined) {
    const migrated = migrateDashboard(remoteRaw)
    if (migrated.ok) {
      const remoteUpdatedAt = migrated.dashboard.updatedAt
      const baseline = baselineUpdatedAt.get(id)
      const lastWritten = lastWrittenUpdatedAt.get(id)
      if (baseline !== undefined && remoteUpdatedAt > baseline && remoteUpdatedAt !== lastWritten) {
        setSaveStatus(id, 'conflict')
        return { ok: false, conflict: true, remote: migrated.dashboard }
      }
      if (baseline === undefined) baselineUpdatedAt.set(id, remoteUpdatedAt)
    }
  }

  try {
    const next: Dashboard = { ...dashboard, updatedAt: nextUpdatedAt(dashboard) }
    const plain = JSON.parse(JSON.stringify(next)) as Dashboard
    await storage.kv.set(contentKey(id), plain)
    dashboard.updatedAt = plain.updatedAt
    baselineUpdatedAt.set(id, plain.updatedAt)
    lastWrittenUpdatedAt.set(id, plain.updatedAt)
    upsertIndexEntry(plain)
    setSaveStatus(id, 'saved')
    return { ok: true, dashboard: plain }
  } catch (error) {
    setSaveStatus(id, 'error', errorMessage(error))
    return { ok: false, error: errorMessage(error) }
  }
}

/** 800ms 防抖保存；同一个仪表盘的后续调用会重置计时器。 */
export function scheduleDashboardSave(dashboard: Dashboard): void {
  const id = dashboard.id
  const pending = pendingSaves.get(id)
  if (pending !== undefined) clearTimeout(pending.timer)
  setSaveStatus(id, 'saving')
  const timer = setTimeout(() => {
    pendingSaves.delete(id)
    void saveDashboardNow(dashboard)
  }, DASHBOARD_SAVE_DEBOUNCE_MS)
  pendingSaves.set(id, { timer, dashboard })
}

/** 立即冲刷一个仪表盘（切换 / 卸载 / 关闭前调用）。 */
export async function flushDashboardSave(id: string): Promise<DashboardSaveResult | null> {
  const pending = pendingSaves.get(id)
  if (pending === undefined) return null
  clearTimeout(pending.timer)
  pendingSaves.delete(id)
  return saveDashboardNow(pending.dashboard)
}

/** 立即冲刷所有待保存的仪表盘。 */
export async function flushAllDashboardSaves(): Promise<void> {
  for (const id of [...pendingSaves.keys()]) {
    await flushDashboardSave(id)
  }
}

/** 取消某个仪表盘的待保存任务（删除 / 重新加载前调用）。 */
export function cancelDashboardSave(id: string): void {
  const pending = pendingSaves.get(id)
  if (pending === undefined) return
  clearTimeout(pending.timer)
  pendingSaves.delete(id)
}

/* ------------------------------------------------------------------------- */
/* CRUD                                                                        */
/* ------------------------------------------------------------------------- */

/** 新建空白仪表盘并立即写入。 */
export async function createDashboardRecord(
  options: Parameters<typeof createEmptyDashboard>[0] = {},
): Promise<Dashboard> {
  return writeNewDashboard(createEmptyDashboard(options))
}

/** 一键生成并立即写入。 */
export async function generateDashboardRecord(
  variables: VariableInfo[],
  options: { alias: string; name: string },
): Promise<Dashboard> {
  return writeNewDashboard(generateDashboard(variables, options))
}

/** 复制仪表盘；新 id，名称加「（副本）」。 */
export async function duplicateDashboardRecord(id: string): Promise<Dashboard | null> {
  const source = await loadDashboard(id)
  if (!source) return null
  const copy: Dashboard = {
    ...(JSON.parse(JSON.stringify(source)) as Dashboard),
    id: uuid(),
    name: `${source.name}（副本）`,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  }
  return writeNewDashboard(copy)
}

/** 重命名仪表盘；返回是否成功。 */
export async function renameDashboardRecord(id: string, name: string): Promise<boolean> {
  const trimmed = name.trim()
  if (trimmed.length === 0) return false
  const dashboard = await loadDashboard(id)
  if (!dashboard) return false
  dashboard.name = trimmed
  const result = await saveDashboardNow(dashboard)
  return result.ok
}

/** 删除仪表盘（索引 + 内容）。 */
export async function deleteDashboardRecord(id: string): Promise<void> {
  cancelDashboardSave(id)
  await storage.kv.delete(contentKey(id))
  writeIndex(serialDashboards.index.filter((entry) => entry.id !== id))
  baselineUpdatedAt.delete(id)
  lastWrittenUpdatedAt.delete(id)
  delete serialDashboards.saveStatus[id]
  delete serialDashboards.saveError[id]
}

/* ------------------------------------------------------------------------- */
/* 导入 / 导出                                                                 */
/* ------------------------------------------------------------------------- */

/** 导出文件（文件名 + JSON 文本）；`customWidgets` 由 D1c 的自定义控件仓库提供。 */
export function exportDashboardFile(
  dashboard: Dashboard,
  customWidgets: DashboardCustomWidgetRecord[] = [],
): { fileName: string; text: string } {
  return {
    fileName: buildDashboardFileName(dashboard.name),
    text: serializeDashboardFile(dashboard, customWidgets),
  }
}

/** 解析导入文件；失败时返回第 9 节文案。 */
export function readDashboardFile(text: string): ReturnType<typeof parseDashboardFile> {
  return parseDashboardFile(text)
}

/**
 * 写入导入的仪表盘。
 *
 * - `overwrite`：使用文件中的 id 覆盖同名仪表盘；
 * - `copy`：分配新 id，名称后加「（导入）」。
 */
export async function importDashboardRecord(
  dashboard: Dashboard,
  mode: 'overwrite' | 'copy',
): Promise<Dashboard> {
  if (mode === 'copy') {
    const copy: Dashboard = {
      ...(JSON.parse(JSON.stringify(dashboard)) as Dashboard),
      id: uuid(),
      name: /（导入）$/.test(dashboard.name) ? dashboard.name : `${dashboard.name}（导入）`,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    }
    return writeNewDashboard(copy)
  }
  const existing = getDashboardIndexEntry(dashboard.id)
  if (!existing) {
    return writeNewDashboard(dashboard)
  }
  baselineUpdatedAt.delete(dashboard.id)
  const plain = JSON.parse(JSON.stringify(dashboard)) as Dashboard
  await storage.kv.set(contentKey(plain.id), plain)
  baselineUpdatedAt.set(plain.id, plain.updatedAt)
  lastWrittenUpdatedAt.set(plain.id, plain.updatedAt)
  upsertIndexEntry(plain)
  setSaveStatus(plain.id, 'saved')
  return plain
}

/* ------------------------------------------------------------------------- */
/* 并发修改                                                                    */
/* ------------------------------------------------------------------------- */

/** 选择「覆盖」：忽略其他标签页的修改，用本地内容写入。 */
export async function overwriteDashboardConflict(
  dashboard: Dashboard,
): Promise<DashboardSaveResult> {
  const remoteRaw = await storage.kv.get<unknown>(contentKey(dashboard.id))
  if (remoteRaw !== undefined) {
    const remote = migrateDashboard(remoteRaw)
    if (remote.ok) baselineUpdatedAt.set(dashboard.id, remote.dashboard.updatedAt)
  }
  return saveDashboardNow(dashboard)
}

/** 选择「重新加载」：丢弃本地修改，读取其他标签页写入的版本。 */
export async function reloadDashboardConflict(id: string): Promise<Dashboard | null> {
  cancelDashboardSave(id)
  baselineUpdatedAt.delete(id)
  lastWrittenUpdatedAt.delete(id)
  return loadDashboard(id)
}

/** 当前是否有待保存的仪表盘。 */
export function hasPendingDashboardSave(id: string): boolean {
  return pendingSaves.has(id)
}

function errorMessage(error: unknown): string {
  if (error instanceof Error && error.message.length > 0) return error.message
  return String(error)
}
