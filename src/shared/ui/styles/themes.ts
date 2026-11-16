/**
 * 站点 UI 风格预设注册表。
 *
 * 与 `theme.css` 中的 `:root[data-style='<id>']` 主题变量块一一对应。
 * 后续扩展新风格时，只需：
 * 1. 在此处扩展 `UiStyleId` 并在 `UI_STYLE_PRESETS` 中注册预设；
 * 2. 在 `src/shared/ui/styles/theme.css` 中添加对应的 `[data-style='<id>']` 明暗令牌块。
 */

export type UiStyleId = 'industrial' | 'moss'

export interface UiStylePreset {
  id: UiStyleId
  label: string
  description: string
  accentDark: string
  accentLight: string
}

export const DEFAULT_UI_STYLE: UiStyleId = 'industrial'

export const UI_STYLE_PRESETS: readonly UiStylePreset[] = Object.freeze([
  {
    id: 'industrial',
    label: '工业钴蓝',
    description: '碳灰仪器面板 + 工程钴蓝强调色',
    accentDark: '#3b82f6',
    accentLight: '#2563eb',
  },
  {
    id: 'moss',
    label: '工业墨绿',
    description: '石墨暖灰表面 + 哑光苔绿强调色',
    accentDark: '#4f9d7a',
    accentLight: '#1f5c47',
  },
])

export function isUiStyleId(value: unknown): value is UiStyleId {
  return UI_STYLE_PRESETS.some((preset) => preset.id === value)
}

export function uiStyleLabel(style: UiStyleId): string {
  return UI_STYLE_PRESETS.find((preset) => preset.id === style)?.label ?? '工业钴蓝'
}
