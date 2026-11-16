/**
 * Tool registry entry point (plan.md §6.2).
 *
 * Two eager `import.meta.glob` calls discover the manifests and route tables of
 * every tool. Only `manifest.ts` and `routes.ts` are imported statically; views and
 * panels stay behind dynamic `import()` so they end up in their own chunks
 * (verified by `pnpm check:chunks`).
 */

import type { RouteRecordRaw } from 'vue-router'

import type { ToolManifest } from '@/shared/contracts/tool'

import ToolRouteView from '../router/ToolRouteView.vue'
import { buildRegistry, type ModuleMap, type ToolRegistration } from './validate'

const manifestModules = import.meta.glob('/src/tools/*/manifest.ts', {
  eager: true,
  import: 'default',
}) as ModuleMap

const routeModules = import.meta.glob('/src/tools/*/routes.ts', {
  eager: true,
  import: 'default',
}) as ModuleMap

const registry = buildRegistry(manifestModules, routeModules, { dev: import.meta.env.DEV })

for (const warning of registry.warnings) {
  console.warn(`[registry] ${warning}`)
}

/** Validated tool manifests, sorted by category order, tool order and title. */
export const tools: ToolManifest[] = registry.tools

/** Validated tool registrations (manifest + owned routes), in the same order. */
export const registrations: ToolRegistration[] = registry.routes

/**
 * Top level router records, one per tool:
 * `{ path: '/tools/<id>', component: ToolRouteView, meta: { toolId, tool }, children }`.
 */
export const toolRoutes: RouteRecordRaw[] = registrations.map(({ tool, routes }) => ({
  path: `/tools/${tool.id}`,
  component: ToolRouteView,
  meta: { toolId: tool.id, tool },
  children: routes,
}))

/** Looks a tool up by id. */
export function getTool(id: string): ToolManifest | undefined {
  return tools.find((tool) => tool.id === id)
}
