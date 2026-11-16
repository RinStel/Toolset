/**
 * 串口助手的界面布局状态（plan §8.3）。
 *
 * 持久化到 `toolset/tool/serial/layout.v1`：分屏方向、分屏比例、发送区高度以及
 * 两个 Pane 各自的显示设置。Pane 与会话的绑定关系**不**持久化，因为会话不跨页面保留。
 */

import { reactive, readonly } from 'vue'

import type { DisplayMode } from '@/domains/link/public'
import { createToolStorage } from '@/shared/lib/storage/namespace'

import { serialSettings } from './settings'

/** 分屏方向；`off` 表示单 Pane。 */
export type SplitMode = 'off' | 'horizontal' | 'vertical'

/** Pane 的视图类型（plan §8.1 / §8.3）。 */
export type PaneView = 'terminal' | 'dashboard'

/** 一个 Pane 的显示设置。 */
export interface PaneViewSettings {
  displayMode: DisplayMode
  showTimestamp: boolean
  showTx: boolean
  showSystem: boolean
  showBridge: boolean
  /** 文本或十六进制渲染。 */
  viewAs: 'text' | 'hex'
  /** 自动换行。 */
  wrap: boolean
  /** 新日志到达时自动滚动到底部。 */
  autoScroll: boolean
  /** 日志字号，10–20px。 */
  fontSize: number
  /** Pane 视图：终端或仪表盘（默认 terminal）。 */
  view: PaneView
  /** 仪表盘视图当前打开的仪表盘 id；不持久化内容，仅恢复入口。 */
  dashboardId: string | null
  /** 运行模式下是否显示变量列表（默认 false）。 */
  dashboardSidebar: boolean
}

/** 布局持久化结构（存储版本 1）。 */
export interface SerialLayoutState {
  split: SplitMode
  /** 第一个 Pane 占可用空间的比例，0.2–0.8。 */
  ratio: number
  /** 发送区高度（px），发送区在下、日志在上。 */
  sendPanelHeight: number
  panes: [PaneViewSettings, PaneViewSettings]
}

export const SPLIT_RATIO_MIN = 0.2
export const SPLIT_RATIO_MAX = 0.8
export const SEND_PANEL_HEIGHT_MIN = 120
export const SEND_PANEL_HEIGHT_MAX = 640
export const SEND_PANEL_HEIGHT_DEFAULT = 260
export const LOG_FONT_SIZE_MIN = 10
export const LOG_FONT_SIZE_MAX = 20
export const LOG_FONT_SIZE_DEFAULT = 12

const SPLIT_MODES: readonly SplitMode[] = ['off', 'horizontal', 'vertical']
const DISPLAY_MODES: readonly DisplayMode[] = ['raw', 'decoded', 'both']

function clampNumber(value: unknown, min: number, max: number, fallback: number): number {
  const parsed = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(parsed)) return fallback
  return Math.min(max, Math.max(min, parsed))
}

function normalizeSplit(value: unknown): SplitMode {
  if (typeof value !== 'string' || !(SPLIT_MODES as readonly string[]).includes(value)) return 'off'
  return value as SplitMode
}

function normalizeDisplayMode(value: unknown): DisplayMode {
  if (typeof value !== 'string' || !(DISPLAY_MODES as readonly string[]).includes(value)) {
    return serialSettings.defaultDisplayMode
  }
  return value as DisplayMode
}

function normalizeBoolean(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback
}

/** 新 Pane 的默认显示设置；默认值来自工具设置。 */
export function createDefaultPaneViewSettings(): PaneViewSettings {
  return {
    displayMode: serialSettings.defaultDisplayMode,
    showTimestamp: serialSettings.defaultShowTimestamp,
    showTx: serialSettings.defaultShowTx,
    showSystem: serialSettings.defaultShowSystem,
    showBridge: serialSettings.defaultShowBridge,
    viewAs: 'text',
    wrap: true,
    autoScroll: true,
    fontSize: LOG_FONT_SIZE_DEFAULT,
    view: 'terminal',
    dashboardId: null,
    dashboardSidebar: false,
  }
}

function normalizePane(value: unknown): PaneViewSettings {
  const source = (typeof value === 'object' && value !== null ? value : {}) as Record<
    string,
    unknown
  >
  const defaults = createDefaultPaneViewSettings()
  return {
    displayMode: normalizeDisplayMode(source.displayMode),
    showTimestamp: normalizeBoolean(source.showTimestamp, defaults.showTimestamp),
    showTx: normalizeBoolean(source.showTx, defaults.showTx),
    showSystem: normalizeBoolean(source.showSystem, defaults.showSystem),
    showBridge: normalizeBoolean(source.showBridge, defaults.showBridge),
    viewAs: source.viewAs === 'hex' ? 'hex' : 'text',
    wrap: normalizeBoolean(source.wrap, defaults.wrap),
    autoScroll: normalizeBoolean(source.autoScroll, defaults.autoScroll),
    fontSize: Math.round(
      clampNumber(source.fontSize, LOG_FONT_SIZE_MIN, LOG_FONT_SIZE_MAX, LOG_FONT_SIZE_DEFAULT),
    ),
    view: source.view === 'dashboard' ? 'dashboard' : 'terminal',
    dashboardId:
      typeof source.dashboardId === 'string' && source.dashboardId.length > 0
        ? source.dashboardId
        : null,
    dashboardSidebar: normalizeBoolean(source.dashboardSidebar, false),
  }
}

function createDefaultLayout(): SerialLayoutState {
  return {
    split: 'off',
    ratio: 0.5,
    sendPanelHeight: SEND_PANEL_HEIGHT_DEFAULT,
    panes: [createDefaultPaneViewSettings(), createDefaultPaneViewSettings()],
  }
}

/** 把任意来源的数据收敛为合法布局（缺失 / 非法字段回落到默认值）。 */
export function normalizeSerialLayout(raw: unknown): SerialLayoutState {
  const source = (typeof raw === 'object' && raw !== null ? raw : {}) as Record<string, unknown>
  const defaults = createDefaultLayout()
  const rawPanes = Array.isArray(source.panes) ? source.panes : []
  return {
    split: normalizeSplit(source.split),
    ratio: clampNumber(source.ratio, SPLIT_RATIO_MIN, SPLIT_RATIO_MAX, defaults.ratio),
    sendPanelHeight: Math.round(
      clampNumber(
        source.sendPanelHeight,
        SEND_PANEL_HEIGHT_MIN,
        SEND_PANEL_HEIGHT_MAX,
        defaults.sendPanelHeight,
      ),
    ),
    panes: [normalizePane(rawPanes[0]), normalizePane(rawPanes[1])],
  }
}

const store = createToolStorage('serial').local<SerialLayoutState>('layout', {
  version: 1,
  defaults: createDefaultLayout,
  migrate: (raw) => normalizeSerialLayout(raw),
})

const state = reactive<SerialLayoutState>(normalizeSerialLayout(store.get()))

store.subscribe((value) => {
  Object.assign(state, normalizeSerialLayout(value))
})

/** 当前布局（只读快照）。 */
export const serialLayout = readonly(state)

function commit(next: SerialLayoutState): void {
  const normalized = normalizeSerialLayout(next)
  Object.assign(state, normalized)
  store.set(normalized)
}

function update(patch: Partial<SerialLayoutState>): void {
  const panes =
    patch.panes ?? ([state.panes[0], state.panes[1]] as [PaneViewSettings, PaneViewSettings])
  commit({ ...state, ...patch, panes })
}

/** 切换分屏方向（`off` 关闭分屏）。 */
export function setSplitMode(split: SplitMode): void {
  update({ split: normalizeSplit(split) })
}

/** 更新左右 / 上下分屏的比例。 */
export function setSplitRatio(ratio: number): void {
  update({ ratio })
}

/** 更新发送区高度（拖动分隔条后调用）。 */
export function setSendPanelHeight(height: number): void {
  update({ sendPanelHeight: height })
}

/** 合并一个 Pane 的显示设置。 */
export function updatePaneViewSettings(paneIndex: number, patch: Partial<PaneViewSettings>): void {
  const index = paneIndex === 1 ? 1 : 0
  const panes = [state.panes[0], state.panes[1]] as [PaneViewSettings, PaneViewSettings]
  panes[index] = { ...panes[index], ...patch }
  update({ panes })
}

/** 把两个 Pane 的显示设置恢复为当前工具设置的默认值。 */
export function resetPaneViewSettings(): void {
  update({ panes: [createDefaultPaneViewSettings(), createDefaultPaneViewSettings()] })
}

/** 切换一个 Pane 的视图（终端 / 仪表盘）。 */
export function setPaneView(paneIndex: number, view: PaneView): void {
  updatePaneViewSettings(paneIndex, { view: view === 'dashboard' ? 'dashboard' : 'terminal' })
}

/** 记录一个 Pane 打开的仪表盘 id；传 null 表示关闭仪表盘视图。 */
export function setPaneDashboardId(paneIndex: number, dashboardId: string | null): void {
  updatePaneViewSettings(paneIndex, { dashboardId })
}

/** 在指定 Pane 中打开一个仪表盘（同时切到仪表盘视图）。 */
export function openDashboardInPane(paneIndex: number, dashboardId: string | null): void {
  updatePaneViewSettings(paneIndex, { view: 'dashboard', dashboardId })
}

/** 切换仪表盘运行模式下的变量列表（左栏）显示。 */
export function setPaneDashboardSidebar(paneIndex: number, visible: boolean): void {
  updatePaneViewSettings(paneIndex, { dashboardSidebar: visible })
}

/**
 * 为「在另一个 Pane 打开仪表盘」准备第二个 Pane：没有分屏时自动开启分屏，
 * 返回目标 Pane 的下标（plan §8.13）。
 */
export function ensureSecondPaneForDashboard(focusedPane: number): 0 | 1 {
  const target: 0 | 1 = focusedPane === 0 ? 1 : 0
  if (state.split === 'off') setSplitMode('horizontal')
  return target
}
