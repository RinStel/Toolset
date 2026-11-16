/**
 * 自定义控件安全模式状态（plan §6.10「安全模式」/ §9）。
 *
 * - 启动检查在仪表盘模块加载时调用一次：读到 `toolset/safe-mode/pending` 时把对应控件
 *   加入 blocked，并在仪表盘顶部显示横幅；
 * - URL 为 `?safe=1` 时不执行任何自定义控件，同样显示横幅；
 * - 横幅上的「重新启用」从 blocked 中移除并递增版本号，宿主据此重新 mount；
 * - 「编辑代码」打开编辑器。
 */

import { reactive } from 'vue'

import { isSafeModeUrl, safeMode } from '@/domains/dashboard/public'

/** 安全模式界面状态；组件只读。 */
export interface CustomSafeModeState {
  /** blocked 列表或全局开关变化时递增，宿主据此重新检查。 */
  version: number
  /** URL 是否处于全局安全模式。 */
  global: boolean
  /** 启动检查发现的上次卡死控件 id / 名称；没有时为 `null`。 */
  stoppedId: string | null
  stoppedName: string
}

export const customSafeModeState = reactive<CustomSafeModeState>({
  version: 0,
  global: false,
  stoppedId: null,
  stoppedName: '',
})

let initialized = false

/** 读取当前 URL 是否处于全局安全模式（`#/tools/serial?safe=1` 或 `?safe=1`）。 */
export function detectGlobalCustomWidgetSafeMode(): boolean {
  if (typeof window === 'undefined') return false
  return isSafeModeUrl(window.location.search + window.location.hash)
}

/**
 * 启动检查；由 `DashboardPane` 在模块加载时调用一次。
 *
 * 重复调用会被忽略，确保 pending 只会被消费一次。
 */
export function initCustomWidgetSafeMode(): void {
  if (initialized) return
  initialized = true
  customSafeModeState.global = detectGlobalCustomWidgetSafeMode()
  try {
    const stopped = safeMode.checkStartup()
    if (stopped !== null) {
      customSafeModeState.stoppedId = stopped.customId
      customSafeModeState.stoppedName = stopped.name
    }
  } catch (error) {
    console.error('[custom-widget] 安全模式启动检查失败', error)
  }
  customSafeModeState.version += 1
}

/** 通知宿主重新检查 blocked / 全局安全模式。 */
export function bumpCustomWidgetSafeMode(): void {
  customSafeModeState.version += 1
}

/** 重新启用一个被暂停的控件。 */
export function unblockCustomWidget(customId: string): void {
  try {
    safeMode.unblock(customId)
  } catch (error) {
    console.error('[custom-widget] 无法重新启用控件', error)
  }
  if (customSafeModeState.stoppedId === customId) {
    customSafeModeState.stoppedId = null
    customSafeModeState.stoppedName = ''
  }
  bumpCustomWidgetSafeMode()
}

/** 强制暂停一个控件（预留给调试与测试）。 */
export function blockCustomWidget(customId: string): void {
  safeMode.block(customId)
  bumpCustomWidgetSafeMode()
}

/** 退出全局安全模式：去掉 URL 中的 `safe` 参数。 */
export function exitGlobalCustomWidgetSafeMode(): void {
  if (typeof window === 'undefined') {
    customSafeModeState.global = false
    return
  }
  const location = window.location
  const search = new URLSearchParams(location.search)
  search.delete('safe')
  let hash = location.hash || '#/tools/serial'
  const queryIndex = hash.indexOf('?')
  if (queryIndex >= 0) {
    const route = hash.slice(0, queryIndex)
    const hashQuery = new URLSearchParams(hash.slice(queryIndex + 1))
    hashQuery.delete('safe')
    const rest = hashQuery.toString()
    hash = rest.length > 0 ? `${route}?${rest}` : route
  }
  const nextSearch = search.toString()
  const url = `${location.pathname}${nextSearch.length > 0 ? `?${nextSearch}` : ''}${hash}`
  customSafeModeState.global = false
  try {
    window.location.replace(url)
  } catch (error) {
    console.error('[custom-widget] 退出安全模式失败', error)
  }
}

/** 仅供测试重置模块状态。 */
export function resetCustomWidgetSafeModeForTests(): void {
  initialized = false
  customSafeModeState.global = false
  customSafeModeState.stoppedId = null
  customSafeModeState.stoppedName = ''
  customSafeModeState.version += 1
}
