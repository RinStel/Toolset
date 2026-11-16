/**
 * 仪表盘注入键（plan §8.10）。
 *
 * `DashboardPane` 创建运行时并用 `provide` 注入；`WidgetFrame` 再把同一实例提供给
 * 内置组件（`Widget.vue` 通过 `useWidgetData` 使用）。自定义控件宿主（D1c）使用
 * `CustomWidgetContext`，不直接使用这些键。
 */

import type { InjectionKey } from 'vue'

import type { DashboardRuntime } from './context'

/** 仪表盘运行时。 */
export const DASHBOARD_RUNTIME_KEY: InjectionKey<DashboardRuntime> = Symbol(
  'toolset.dashboard.runtime',
)

/** 当前 Pane 的下标（用于调试与快捷键）。 */
export const DASHBOARD_PANE_KEY: InjectionKey<number> = Symbol('toolset.dashboard.pane')
