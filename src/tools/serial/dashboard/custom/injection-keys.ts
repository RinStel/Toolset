/**
 * 自定义控件宿主需要的注入键（plan §6.10）。
 *
 * `DashboardPane` 提供这些回调，`CustomWidgetHost` 注入使用；编辑器预览则通过
 * props 提供等价实现，不依赖注入。
 */

import type { InjectionKey } from 'vue'

/** 保存实例持久状态（`ctx.saveState()`）：由 Pane 写入仪表盘并触发防抖保存。 */
export type CustomWidgetStateSaver = (instanceId: string, state: Record<string, unknown>) => void

export const CUSTOM_WIDGET_STATE_SAVER_KEY: InjectionKey<CustomWidgetStateSaver> = Symbol(
  'toolset.dashboard.custom.state-saver',
)

/** 打开编辑器并选中某个自定义控件（错误浮层的「编辑代码」）。 */
export type CustomWidgetEditorOpener = (customId: string) => void

export const CUSTOM_WIDGET_EDITOR_OPENER_KEY: InjectionKey<CustomWidgetEditorOpener> = Symbol(
  'toolset.dashboard.custom.editor-opener',
)
