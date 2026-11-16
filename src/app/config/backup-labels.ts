/**
 * Chinese display names for the local backup UI (plan §6.11 / §7.2).
 *
 * Namespaces owned by the app shell and the domains are mapped here; tool namespaces
 * use the manifest `title`. Item names are resolved in this order:
 * `manifest.backupLabels` → this file's mapping → the raw storage name. Both maps
 * support a trailing `/*` wildcard so kv-backed items such as `plugins/<id>` and
 * `dashboards/<id>` can share one label.
 */

import type { ToolManifest } from '@/shared/contracts/tool'

/** Namespace → Chinese name. Unknown namespaces fall back to the raw prefix. */
export const NAMESPACE_LABELS: Readonly<Record<string, string>> = {
  'toolset/app/': '外观设置',
  'toolset/protocol/': '协议插件',
  'toolset/link/': '连接预设与设备记忆',
}

/**
 * Namespace → item name → Chinese name.
 *
 * Tool entries normally come from `manifest.backupLabels`; the serial mapping below is
 * the floor used until (and if) the manifest declares its own labels.
 */
export const ITEM_LABELS: Readonly<Record<string, Readonly<Record<string, string>>>> = {
  'toolset/app/': {
    settings: '外观设置',
  },
  'toolset/protocol/': {
    index: '协议索引',
    'plugins/*': '协议插件代码',
  },
  'toolset/link/': {
    presets: '连接预设',
    devices: '设备记忆',
  },
  'toolset/tool/serial/': {
    settings: '串口设置',
    layout: '界面布局',
    quick: '快捷发送',
    macros: '宏',
    dashboards: '仪表盘索引',
    'dashboards/*': '仪表盘',
    widgets: '自定义控件索引',
    'widgets/*': '自定义控件',
  },
}

const TOOL_NAMESPACE_PATTERN = /^toolset\/tool\/([^/]+)\/$/

/** Looks a label up by exact name first, then by `prefix/*` wildcard. */
function matchLabel(
  labels: Readonly<Record<string, string>> | undefined,
  name: string,
): string | undefined {
  if (!labels) return undefined
  const exact = labels[name]
  if (exact !== undefined) return exact
  for (const [pattern, label] of Object.entries(labels)) {
    if (pattern.endsWith('/*') && name.startsWith(pattern.slice(0, -1))) return label
  }
  return undefined
}

function findToolNamespace(namespace: string, tools: readonly ToolManifest[]): ToolManifest | null {
  const match = TOOL_NAMESPACE_PATTERN.exec(namespace)
  const toolId = match?.[1]
  if (!toolId) return null
  return tools.find((tool) => tool.id === toolId) ?? null
}

/** Chinese name of a storage namespace. */
export function getNamespaceLabel(namespace: string, tools: readonly ToolManifest[]): string {
  const tool = findToolNamespace(namespace, tools)
  if (tool) return tool.title
  return NAMESPACE_LABELS[namespace] ?? namespace
}

/** Chinese name of one storage entry; falls back to the raw `name`. */
export function getItemLabel(
  namespace: string,
  name: string,
  tools: readonly ToolManifest[],
): string {
  const tool = findToolNamespace(namespace, tools)
  const fromManifest = matchLabel(tool?.backupLabels, name)
  if (fromManifest !== undefined) return fromManifest
  const fromConfig = matchLabel(ITEM_LABELS[namespace], name)
  if (fromConfig !== undefined) return fromConfig
  return name
}
