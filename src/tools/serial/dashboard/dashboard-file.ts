/**
 * 仪表盘导入 / 导出文件格式（plan §8.10「仪表盘导入/导出」）。
 *
 * 文件：`<名称>.dashboard.json`，内容为
 * `{ format: 'toolset-dashboard', formatVersion: 1, dashboard, customWidgets }`。
 * 解析时先 `migrateDashboard`，再 `validateDashboard`，最后用 `normalize` 修正越界布局。
 */

import {
  migrateDashboard,
  normalize,
  validateDashboard,
  type Dashboard,
  type WidgetInstance,
} from '@/domains/dashboard/public'

/** 文件标识（plan §8.10）。 */
export const DASHBOARD_FILE_FORMAT = 'toolset-dashboard'

/** 文件格式版本（plan §8.10）。 */
export const DASHBOARD_FILE_VERSION = 1

/**
 * 仪表盘文件中携带的自定义控件记录（plan §6.10 / §8.10）。
 *
 * `domains/dashboard` 的 public 入口没有导出该类型，这里按存储结构声明一份，
 * 供 D1c 的自定义控件仓库复用。
 */
export interface DashboardCustomWidgetRecord {
  id: string
  name: string
  code: string
  createdAt: number
  updatedAt: number
}

/** 仪表盘文件结构。 */
export interface DashboardFile {
  format: typeof DASHBOARD_FILE_FORMAT
  formatVersion: typeof DASHBOARD_FILE_VERSION
  dashboard: Dashboard
  customWidgets: DashboardCustomWidgetRecord[]
}

export type ParseDashboardFileResult =
  { ok: true; file: DashboardFile } | { ok: false; error: string }

/** 文件名：`<名称>.dashboard.json`，非法字符替换为 `_`（plan §8.4 同一规则）。 */
export function buildDashboardFileName(name: string): string {
  const safe = name.trim().replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_')
  return `${safe.length > 0 ? safe : '仪表盘'}.dashboard.json`
}

/** 用 `normalize` 修正组件的越界与重叠，返回新的 WidgetInstance 数组。 */
export function sanitizeDashboardLayout(dashboard: Dashboard): Dashboard {
  const rects = dashboard.widgets.map((widget) => ({
    id: widget.id,
    x: widget.x,
    y: widget.y,
    w: widget.w,
    h: widget.h,
  }))
  const normalized = normalize(rects)
  const byId = new Map(normalized.map((rect) => [rect.id, rect]))
  const widgets: WidgetInstance[] = dashboard.widgets.map((widget) => {
    const rect = byId.get(widget.id)
    if (!rect) return { ...widget }
    return { ...widget, x: rect.x, y: rect.y, w: rect.w, h: rect.h }
  })
  return { ...dashboard, widgets }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function parseCustomWidgets(value: unknown): DashboardCustomWidgetRecord[] {
  if (!Array.isArray(value)) return []
  const records: DashboardCustomWidgetRecord[] = []
  for (const raw of value) {
    if (!isRecord(raw)) continue
    if (typeof raw.id !== 'string' || raw.id.length === 0) continue
    if (typeof raw.name !== 'string') continue
    if (typeof raw.code !== 'string') continue
    const createdAt = typeof raw.createdAt === 'number' ? raw.createdAt : Date.now()
    const updatedAt = typeof raw.updatedAt === 'number' ? raw.updatedAt : createdAt
    records.push({ id: raw.id, name: raw.name, code: raw.code, createdAt, updatedAt })
  }
  return records
}

/** 序列化仪表盘文件（带 2 空格缩进，便于人工检查）。 */
export function serializeDashboardFile(
  dashboard: Dashboard,
  customWidgets: DashboardCustomWidgetRecord[] = [],
): string {
  const file: DashboardFile = {
    format: DASHBOARD_FILE_FORMAT,
    formatVersion: DASHBOARD_FILE_VERSION,
    dashboard,
    customWidgets,
  }
  return JSON.stringify(file, null, 2)
}

/**
 * 解析并校验仪表盘文件。
 *
 * 失败时返回第 9 节的统一文案：「不是有效的仪表盘文件：<第一条校验错误>」。
 */
export function parseDashboardFile(text: string | unknown): ParseDashboardFileResult {
  let raw: unknown = text
  if (typeof text === 'string') {
    try {
      raw = JSON.parse(text) as unknown
    } catch {
      return { ok: false, error: '不是有效的仪表盘文件：无法解析 JSON' }
    }
  }
  if (!isRecord(raw)) return { ok: false, error: '不是有效的仪表盘文件：内容必须是对象' }
  if (raw.format !== DASHBOARD_FILE_FORMAT) {
    return { ok: false, error: '不是有效的仪表盘文件：缺少 format 标识' }
  }
  if (raw.formatVersion !== DASHBOARD_FILE_VERSION) {
    if (typeof raw.formatVersion === 'number' && raw.formatVersion > DASHBOARD_FILE_VERSION) {
      return {
        ok: false,
        error: `仪表盘文件版本过新（formatVersion ${raw.formatVersion}），请升级后再导入`,
      }
    }
    return { ok: false, error: '不是有效的仪表盘文件：formatVersion 必须为 1' }
  }

  const migrated = migrateDashboard(raw.dashboard)
  if (!migrated.ok) {
    return { ok: false, error: `不是有效的仪表盘文件：${migrated.error}` }
  }
  const validated = validateDashboard(migrated.dashboard)
  if (!validated.ok) {
    return {
      ok: false,
      error: `不是有效的仪表盘文件：${validated.errors[0] ?? '未知校验错误'}`,
    }
  }

  return {
    ok: true,
    file: {
      format: DASHBOARD_FILE_FORMAT,
      formatVersion: DASHBOARD_FILE_VERSION,
      dashboard: sanitizeDashboardLayout(validated.dashboard),
      customWidgets: parseCustomWidgets(raw.customWidgets),
    },
  }
}
