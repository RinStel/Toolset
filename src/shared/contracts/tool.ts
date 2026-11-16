import type { Component } from 'vue'
import type { RouteRecordRaw } from 'vue-router'

/** Layout used by the app shell when hosting a tool. */
export type ToolLayout = 'workspace' | 'page'

/**
 * Manifest discovered from `src/tools/<id>/manifest.ts`.
 *
 * The registry validates `id`, `layout` and `category`; see plan §6.2.
 */
export interface ToolManifest {
  /** Must match `/^[a-z][a-z0-9-]*$/` and equal the tool directory name. */
  id: string
  title: string
  /** Short description, at most 40 characters. */
  summary: string
  /** Key of an entry in `app/config/categories.ts`; unknown keys fall back to `other`. */
  category: string
  icon: Component
  /** Ascending order inside a category, defaults to 100. */
  order?: number
  layout: ToolLayout
  /** Keep the tool instance alive when navigating away, defaults to false. */
  keepAlive?: boolean
  keywords?: string[]
  /** Lazily loaded settings panel component. */
  settings?: () => Promise<{ default: Component }>
  /** Lazily loaded help panel component. */
  help?: () => Promise<{ default: Component }>
  /**
   * Chinese labels for the tool's storage entries in the local backup UI
   * (plan §6.11). Keys are storage item names without namespace or `.v<n>` suffix;
   * `prefix/*` wildcards are supported for kv-backed items such as `dashboards/*`.
   */
  backupLabels?: Record<string, string>
}

/** Route records owned by one tool. `path: ''` denotes the tool home route. */
export type ToolRoutes = RouteRecordRaw[]
