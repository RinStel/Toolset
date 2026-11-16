/**
 * Tool registry validation and sorting (plan.md §6.2).
 *
 * This module stays a pure function over the module maps produced by
 * `import.meta.glob` so the six validation rules can be unit tested without the
 * Vite glob machinery. `registry/index.ts` owns discovery, logging and the router
 * records; all decision logic lives here.
 */

import type { ToolManifest, ToolRoutes } from '@/shared/contracts/tool'

import {
  getCategory,
  isKnownCategory,
  OTHER_CATEGORY_KEY,
  type ToolCategory,
} from '../config/categories'

/** Module map keyed by source path, as returned by `import.meta.glob`. */
export type ModuleMap = Record<string, unknown>

/** A validated tool together with the route records it owns. */
export interface ToolRegistration {
  tool: ToolManifest
  routes: ToolRoutes
}

/** Result of {@link buildRegistry}: sorted tools, their routes and warnings. */
export interface RegistryBuildResult {
  tools: ToolManifest[]
  routes: ToolRegistration[]
  warnings: string[]
}

export interface BuildRegistryOptions {
  /**
   * Development mode. Validation failures throw immediately instead of skipping
   * the broken tool (plan §6.2).
   */
  dev?: boolean
  /** Overrides the default `console.error` reporting in production mode. */
  onError?: (message: string) => void
}

/** Tool directory id rules (plan §6.1). */
export const TOOL_ID_PATTERN = /^[a-z][a-z0-9-]*$/

/** Order value used when a manifest omits `order`. */
export const DEFAULT_TOOL_ORDER = 100

const VALID_LAYOUTS: ReadonlySet<string> = new Set<ToolManifest['layout']>(['workspace', 'page'])
const DEFAULT_CATEGORY_ORDER = 99
const TOOL_MODULE_PATTERN = /(?:^|\/)src\/tools\/([^/]+)\/(manifest|routes)\.ts$/

function normalizeModulePath(path: string): string {
  return path.replace(/\\/g, '/')
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

interface ModuleEntry {
  directory: string
  module: unknown
}

/** Collects `manifest`/`routes` modules together with their tool directory. */
function collectModules(kind: 'manifest' | 'routes') {
  return (modules: ModuleMap): ModuleEntry[] => {
    const collected: ModuleEntry[] = []
    for (const [path, module] of Object.entries(modules)) {
      const match = TOOL_MODULE_PATTERN.exec(normalizeModulePath(path))
      if (!match || match[2] !== kind) continue
      const directory = match[1]
      if (directory === undefined) continue
      collected.push({ directory, module })
    }
    return collected
  }
}

function indexByDirectory(entries: readonly ModuleEntry[]): Map<string, unknown> {
  const indexed = new Map<string, unknown>()
  for (const entry of entries) {
    if (indexed.has(entry.directory)) continue
    indexed.set(entry.directory, entry.module)
  }
  return indexed
}

const collectManifests = collectModules('manifest')
const collectRoutes = collectModules('routes')

/** Returns the first invalid `path` found in a route tree, or `null`. */
function findInvalidRoutePath(routes: unknown): string | null {
  if (!Array.isArray(routes)) return '路由定义必须是数组'
  for (const record of routes) {
    if (!isRecord(record)) return '路由记录必须是对象'
    const path = record.path
    if (typeof path !== 'string') return '路由记录缺少字符串类型的 path'
    if (path.startsWith('/')) return `路由 path 不得以 / 开头：${path}`
    if (record.children !== undefined) {
      const nested = findInvalidRoutePath(record.children)
      if (nested) return nested
    }
  }
  return null
}

interface AcceptedManifest {
  manifest: ToolManifest
  category: ToolCategory
}

/**
 * Validates the discovered tool modules and returns the sorted tool list.
 *
 * Rules (plan §6.2):
 * 1. manifest and routes must come in pairs;
 * 2. the manifest id must equal the directory name and match {@link TOOL_ID_PATTERN};
 * 3. ids must be unique;
 * 4. the layout must be `workspace` or `page`;
 * 5. unknown categories fall back to `other` with a warning;
 * 6. route paths must be relative (no leading `/`).
 *
 * Rules 1-4 and 6 skip the tool in production and throw in development.
 */
export function buildRegistry(
  manifestModules: ModuleMap,
  routeModules: ModuleMap,
  options: BuildRegistryOptions = {},
): RegistryBuildResult {
  const dev = options.dev ?? false
  const warnings: string[] = []
  const tools: ToolManifest[] = []
  const registrations: ToolRegistration[] = []
  const seenIds = new Set<string>()
  const manifestEntries = collectManifests(manifestModules)
  const routeEntries = collectRoutes(routeModules)
  const manifests = indexByDirectory(manifestEntries)
  const routes = indexByDirectory(routeEntries)
  const directories = [
    ...new Set([
      ...manifestEntries.map((entry) => entry.directory),
      ...routeEntries.map((entry) => entry.directory),
    ]),
  ].sort()

  // Rule 3: ids must be unique. Because rule 2 forces `id === directory`, a
  // duplicate id can only appear when the same directory is discovered twice
  // (overlapping glob inputs); `seenIds` additionally guards the invariant.
  const seenDirectories = new Set<string>()
  const duplicateDirectories = new Set<string>()
  for (const entry of manifestEntries) {
    if (seenDirectories.has(entry.directory)) duplicateDirectories.add(entry.directory)
    else seenDirectories.add(entry.directory)
  }

  function reportError(message: string): void {
    if (dev) throw new Error(`[registry] ${message}`)
    if (options.onError) options.onError(message)
    else console.error(`[registry] ${message}`)
  }

  for (const directory of directories) {
    if (duplicateDirectories.has(directory)) {
      reportError(`工具 id「${directory}」重复，已跳过重复声明的工具。`)
      continue
    }
    const manifestValue = manifests.get(directory)
    if (manifestValue === undefined) {
      reportError(`工具目录 ${directory} 缺少 manifest.ts，已跳过该工具。`)
      continue
    }
    const routesValue = routes.get(directory)
    if (routesValue === undefined) {
      reportError(`工具目录 ${directory} 缺少 routes.ts，已跳过该工具。`)
      continue
    }
    if (!isRecord(manifestValue)) {
      reportError(`工具目录 ${directory} 的 manifest 不是对象，已跳过该工具。`)
      continue
    }

    const manifest = manifestValue as unknown as ToolManifest
    if (typeof manifest.id !== 'string' || !TOOL_ID_PATTERN.test(manifest.id)) {
      reportError(`工具目录 ${directory} 的 id 不合法：${String(manifest.id)}。`)
      continue
    }
    if (manifest.id !== directory) {
      reportError(`工具目录 ${directory} 的 id「${manifest.id}」与目录名不一致。`)
      continue
    }
    if (seenIds.has(manifest.id)) {
      reportError(`工具 id「${manifest.id}」重复，已跳过后出现的工具。`)
      continue
    }
    if (!VALID_LAYOUTS.has(manifest.layout)) {
      reportError(`工具 ${manifest.id} 的 layout「${String(manifest.layout)}」不合法。`)
      continue
    }
    const invalidPath = findInvalidRoutePath(routesValue)
    if (invalidPath) {
      reportError(`工具 ${manifest.id} 的${invalidPath}。`)
      continue
    }

    let category = getCategory(manifest.category)
    if (!isKnownCategory(manifest.category)) {
      warnings.push(
        `工具 ${manifest.id} 使用了未知分类「${String(manifest.category)}」，已归入 ${OTHER_CATEGORY_KEY}。`,
      )
      category = getCategory(OTHER_CATEGORY_KEY)
    }

    seenIds.add(manifest.id)
    const normalized: AcceptedManifest = {
      manifest: { ...manifest, id: directory, category: category.key },
      category,
    }
    tools.push(normalized.manifest)
    registrations.push({ tool: normalized.manifest, routes: routesValue as ToolRoutes })
  }

  registrations.sort((a, b) => {
    const categoryDelta = getCategory(a.tool.category).order - getCategory(b.tool.category).order
    if (categoryDelta !== 0) return categoryDelta
    const orderDelta = (a.tool.order ?? DEFAULT_TOOL_ORDER) - (b.tool.order ?? DEFAULT_TOOL_ORDER)
    if (orderDelta !== 0) return orderDelta
    return a.tool.title.localeCompare(b.tool.title, 'zh-Hans-CN')
  })

  return {
    tools: registrations.map((registration) => registration.tool),
    routes: registrations,
    warnings,
  }
}

/** Category display order used for sorting; exported for tests. */
export function categoryOrder(key: string): number {
  return isKnownCategory(key) ? getCategory(key).order : DEFAULT_CATEGORY_ORDER
}
