/**
 * 仪表盘 Pane 的临时界面状态（plan §8.10）。
 *
 * 这些状态不持久化：模式、暂停、选中组件、数据源与会话的绑定都不跨页面保留
 * （会话本身不会跨页面保留，plan §8.3）。
 */

import { reactive, ref } from 'vue'

/**
 * 会话状态版本号：会话新增 / 移除 / 断开时递增，让组件状态点等轻量 UI 无需订阅
 * 每一帧数据也能刷新（plan §8.10「刷新调度」只通知有数据的组件）。
 */
export const dashboardSessionVersion = ref(0)

/** 会话状态变化后由 DashboardPane 调用。 */
export function bumpDashboardSessionVersion(): void {
  dashboardSessionVersion.value += 1
}

/** 仪表盘模式：编辑 / 运行。 */
export type DashboardMode = 'edit' | 'run'

/** 一个 Pane 的仪表盘界面状态。 */
export interface PaneDashboardState {
  /** 当前加载的仪表盘 id；`null` 表示空状态。 */
  dashboardId: string | null
  mode: DashboardMode
  /** 「暂停全部」：停止向组件推送数据，但 series 继续记录。 */
  paused: boolean
  /** 选中的组件 id。 */
  selectedIds: string[]
  /** 数据源 alias → 会话 id（`null` 表示未绑定）；不持久化。 */
  bindings: Record<string, string | null>
  /**
   * 打开仪表盘后要绑定到第一个数据源的会话（预设联动使用，plan §8.13）。
   * 仪表盘加载完成后由 Pane 消费并清空。
   */
  pinnedDefaultSession: string | null
}

function createPaneState(): PaneDashboardState {
  return {
    dashboardId: null,
    mode: 'run',
    paused: false,
    selectedIds: [],
    bindings: {},
    pinnedDefaultSession: null,
  }
}

/** 两个 Pane 的仪表盘界面状态；组件只读。 */
export const dashboardPanes = reactive<[PaneDashboardState, PaneDashboardState]>([
  createPaneState(),
  createPaneState(),
])

/** 读取一个 Pane 的仪表盘状态。 */
export function paneDashboardState(paneIndex: number): PaneDashboardState {
  return dashboardPanes[paneIndex === 1 ? 1 : 0]
}

/** 切换模式。 */
export function setPaneDashboardMode(paneIndex: number, mode: DashboardMode): void {
  paneDashboardState(paneIndex).mode = mode === 'edit' ? 'edit' : 'run'
}

/** 暂停 / 恢复全部组件的数据推送。 */
export function setPaneDashboardPaused(paneIndex: number, paused: boolean): void {
  paneDashboardState(paneIndex).paused = paused
}

/** 设置选中的组件 id。 */
export function setPaneDashboardSelection(paneIndex: number, ids: readonly string[]): void {
  paneDashboardState(paneIndex).selectedIds = [...ids]
}

/** 切换一个数据源的绑定会话。 */
export function setDashboardPaneBinding(
  paneIndex: number,
  alias: string,
  sessionId: string | null,
): void {
  const state = paneDashboardState(paneIndex)
  state.bindings = { ...state.bindings, [alias]: sessionId }
}

/** 清空绑定（打开另一个仪表盘 / 关闭仪表盘时）。 */
export function resetDashboardPaneBindings(paneIndex: number): void {
  const state = paneDashboardState(paneIndex)
  state.bindings = {}
  state.pinnedDefaultSession = null
}

/** 记住「打开该仪表盘后要绑定的会话」；下一次加载后消费。 */
export function pinDashboardDefaultSession(paneIndex: number, sessionId: string | null): void {
  paneDashboardState(paneIndex).pinnedDefaultSession = sessionId
}

/** 读取并清空待绑定的会话。 */
export function consumePinnedDefaultSession(paneIndex: number): string | null {
  const state = paneDashboardState(paneIndex)
  const sessionId = state.pinnedDefaultSession
  state.pinnedDefaultSession = null
  return sessionId
}

/** 仪表盘切换 / 关闭时清理选中与临时绑定。 */
export function resetDashboardPaneState(paneIndex: number, dashboardId: string | null): void {
  const state = paneDashboardState(paneIndex)
  state.dashboardId = dashboardId
  state.paused = false
  state.selectedIds = []
  state.bindings = {}
  state.pinnedDefaultSession = null
}
