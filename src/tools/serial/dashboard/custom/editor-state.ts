/**
 * 自定义控件编辑器的全局打开状态（plan §8.12）。
 *
 * 编辑器由组件库 / 仪表盘 / 宿主的「编辑代码」按钮打开；状态放在模块级，
 * `DashboardPane` 只需无条件挂载 `<CustomWidgetEditor />`，由编辑器自己判断是否显示。
 */

import { reactive } from 'vue'

export interface CustomWidgetEditorState {
  open: boolean
  /** 打开时要选中的控件 id；`null` 表示没有选中项（可新建）。 */
  selectedId: string | null
  /** 由组件库的「+ 新建」入口打开时，直接展示模板选择。 */
  newRequested: boolean
}

/** 编辑器状态；组件只读，修改请使用导出的动作函数。 */
export const customWidgetEditorState = reactive<CustomWidgetEditorState>({
  open: false,
  selectedId: null,
  newRequested: false,
})

/** 打开编辑器。 */
export function openCustomWidgetEditor(
  id: string | null = null,
  options: { new?: boolean } = {},
): void {
  customWidgetEditorState.selectedId = id
  customWidgetEditorState.newRequested = options.new === true
  customWidgetEditorState.open = true
}

/** 关闭编辑器。 */
export function closeCustomWidgetEditor(): void {
  customWidgetEditorState.open = false
  customWidgetEditorState.newRequested = false
}
