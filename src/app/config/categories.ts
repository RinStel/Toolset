/**
 * Tool categories displayed by the home page and the header dropdown
 * (plan §6.1). The registry falls back to `other` for unknown keys.
 */

import type { ToolManifest } from '@/shared/contracts/tool'

export interface ToolCategory {
  key: string
  title: string
  /** Ascending display order; `other` always comes last. */
  order: number
}

/** Category used when a manifest declares a key that is not in this table. */
export const OTHER_CATEGORY_KEY = 'other'

export const CATEGORIES: readonly ToolCategory[] = [
  { key: 'comm', title: '通信调试', order: 1 },
  { key: 'convert', title: '数据转换', order: 2 },
  { key: 'calc', title: '计算工具', order: 3 },
  { key: OTHER_CATEGORY_KEY, title: '其他', order: 99 },
]

const OTHER_CATEGORY: ToolCategory = CATEGORIES.find(
  (category) => category.key === OTHER_CATEGORY_KEY,
) ?? {
  key: OTHER_CATEGORY_KEY,
  title: '其他',
  order: 99,
}

/** True when `key` is declared in `CATEGORIES`. */
export function isKnownCategory(key: string): boolean {
  return CATEGORIES.some((category) => category.key === key)
}

/** Returns the category definition for `key`, falling back to `other`. */
export function getCategory(key: string): ToolCategory {
  return CATEGORIES.find((category) => category.key === key) ?? OTHER_CATEGORY
}

export interface ToolCategoryGroup {
  category: ToolCategory
  tools: ToolManifest[]
}

/**
 * Groups tools into the categories that actually contain at least one tool,
 * preserving the configured category order. Tools with an unknown category are
 * shown under `other`, matching the registry behaviour.
 */
export function groupToolsByCategory(tools: readonly ToolManifest[]): ToolCategoryGroup[] {
  const buckets = new Map<string, ToolManifest[]>()
  for (const tool of tools) {
    const key = isKnownCategory(tool.category) ? tool.category : OTHER_CATEGORY_KEY
    const bucket = buckets.get(key)
    if (bucket) bucket.push(tool)
    else buckets.set(key, [tool])
  }
  return [...CATEGORIES]
    .sort((a, b) => a.order - b.order)
    .filter((category) => buckets.has(category.key))
    .map((category) => ({ category, tools: buckets.get(category.key) ?? [] }))
}
