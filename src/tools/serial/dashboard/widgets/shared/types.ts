/**
 * 内置组件的公共类型（plan §8.11）。
 *
 * `WidgetFrame.vue` 渲染每个内置组件时传入 `instance` / `props` / `size` / `mode` /
 * `ctx` 五个 props；这里把它们收拢成一份类型，14 个组件的 `Widget.vue` 共用。
 */

import type { CommandSpec, VarRef, WidgetInstance } from '@/domains/dashboard/public'

import type { DashboardVariableMeta } from '../../runtime/context'

/** 组件所处模式；`edit` 模式下控件不响应发送（plan §8.10）。 */
export type WidgetMode = 'edit' | 'run'

/** 组件尺寸（像素），由 `WidgetFrame` 的 ResizeObserver 提供。 */
export interface WidgetSize {
  width: number
  height: number
}

/**
 * 组件运行时上下文（`WidgetFrame.widgetCtx`）。
 *
 * `send` / `sendBytes` 已经由外框包装：成功/失败会闪烁外框边框，失败还会弹出 Toast。
 */
export interface WidgetContext {
  send(cmd: CommandSpec | string, value?: number | boolean | string): Promise<unknown>
  sendBytes(bytes: Uint8Array | number[], source?: string): Promise<unknown>
  /** 数据源状态；省略 `source` 时取默认数据源。 */
  sourceState(source?: string): 'open' | 'closed' | 'unbound'
  /** 读取主题 CSS 变量，如 `theme('--accent')`。 */
  theme(cssVar: string): string
  /** 解析变量元信息（显示名、单位、颜色、小数位、scale/offset）。 */
  resolveMeta(ref: VarRef): DashboardVariableMeta
  /** 请求下一次刷新（属性变化时）。 */
  requestUpdate(): void
}

/** 内置组件收到的全部 props。 */
export interface WidgetComponentProps {
  instance: WidgetInstance
  props: Record<string, unknown>
  size: WidgetSize
  mode: WidgetMode
  ctx: WidgetContext
}
