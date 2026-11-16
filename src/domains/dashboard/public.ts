/**
 * 仪表盘领域的公共入口（plan §6.7 / §6.9 / §6.10）。
 *
 * 工具只能通过本文件使用仪表盘领域；内部实现（schema 解析细节、guard 内部状态机、
 * safe-mode 存储实现等）不对外导出。
 */

/* 6.9 / 6.10 / 8.11 的类型与常量 */
export {
  DASHBOARD_SCHEMA_VERSION,
  COLS,
  DEFAULT_ROW_HEIGHT,
  MIN_ROW_HEIGHT,
  MAX_ROW_HEIGHT,
  MIN_WIDGET_W,
  MAX_WIDGET_W,
  MIN_WIDGET_H,
  MAX_WIDGET_H,
  DEFAULT_SOURCE_ALIAS,
  DEFAULT_WIDGET_VERSION,
  MAX_WIDGET_STATE_BYTES,
  MAX_CUSTOM_WIDGET_CODE_LENGTH,
  SOURCE_ALIAS_PATTERN,
  COLOR_AUTO,
  SERIES_COLORS,
  EMPTY_NO_VARIABLE,
  EMPTY_WAITING_DATA,
  EMPTY_SOURCE_DISCONNECTED,
} from './types'
export type {
  Dashboard,
  DashboardSource,
  VariableMetaOverride,
  VarRef,
  WidgetInstance,
  CommonProps,
  WidgetPropTab,
  PropBase,
  WidgetPropField,
  Threshold,
  Zone,
  CommandSpec,
  WidgetGroup,
  WidgetDefinition,
  CustomWidgetGroup,
  CustomWidgetMeta,
  CustomWidgetSize,
  CustomWidgetDefinition,
  CustomWidgetInstance,
  WidgetSeriesData,
  WidgetFrameData,
  CustomWidgetVariable,
  CustomWidgetContext,
} from './types'

/* 校验、迁移、默认值 */
export { validateDashboard, migrateDashboard, createEmptyDashboard } from './schema'
export type {
  ValidateDashboardResult,
  ValidateDashboardSuccess,
  ValidateDashboardFailure,
  MigrateDashboardResult,
  MigrateDashboardSuccess,
  MigrateDashboardFailure,
  CreateDashboardOptions,
} from './schema'

/* 24 列网格布局 */
export {
  GRID_GAP,
  collides,
  compact,
  moveItem,
  resizeItem,
  placeNew,
  normalize,
  calcColumnWidth,
  rectToPixels,
  gridPixelHeight,
} from './layout'
export type { Rect, PlaceNewResult, PlaceNewPosition, PixelRect } from './layout'

/* 命令渲染 */
export { renderCommand } from './commands'
export type {
  CommandAction,
  CommandValue,
  CommandVarLookup,
  RenderCommandContext,
  RenderCommandResult,
} from './commands'

/* 撤销/重做 */
export { createHistory, DEFAULT_HISTORY_LIMIT, DEFAULT_MERGE_WINDOW_MS } from './history'
export type { History, HistoryOptions } from './history'

/* 一键生成 */
export { generateDashboard } from './generate'
export type { GenerateDashboardOptions } from './generate'

/* 自定义控件：编译、调用保护、安全模式、模板 */
export { compileCustomWidget } from './custom/compile'
export type {
  CustomWidgetCompileResult,
  CustomWidgetCompileSuccess,
  CustomWidgetCompileFailure,
} from './custom/compile'

export { createCallGuard } from './custom/guard'
export type {
  CallGuard,
  CallGuardDisabledReason,
  CallGuardErrorInfo,
  CallGuardOptions,
  CustomWidgetCallKind,
} from './custom/guard'

export {
  safeMode,
  isSafeModeUrl,
  SAFE_MODE_PENDING_KEY,
  SAFE_MODE_BLOCKED_KEY,
  SAFE_MODE_QUERY_PARAM,
} from './custom/safe-mode'
export type {
  SafeMode,
  SafeModeOptions,
  SafeModePending,
  SafeModeStorage,
  SafeModeStoppedWidget,
} from './custom/safe-mode'

export { CUSTOM_WIDGET_TEMPLATES } from './custom/templates'
export type { CustomWidgetTemplate } from './custom/templates'
