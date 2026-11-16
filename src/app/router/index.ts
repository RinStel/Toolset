/**
 * Application router (plan.md §7.1). Uses hash history so the built `dist/` can be
 * served from any static host without server side rewrites.
 */

import { createRouter, createWebHashHistory } from 'vue-router'
import type { RouteLocationNormalized, RouteRecordRaw } from 'vue-router'

import type { ToolManifest } from '@/shared/contracts/tool'

import HomeView from '../layout/HomeView.vue'
import NotFoundView from '../layout/NotFoundView.vue'
import { toolRoutes } from '../registry'
import { APP_NAME, toolPageTitle } from '../config/app'

export const routes: RouteRecordRaw[] = [
  {
    path: '/',
    name: 'home',
    component: HomeView,
  },
  ...toolRoutes,
  {
    path: '/:pathMatch(.*)*',
    name: 'not-found',
    component: NotFoundView,
  },
]

/** Document title for a route (plan §7.1). Exported for clarity and testing. */
export function resolveDocumentTitle(route: RouteLocationNormalized): string {
  const tool = route.meta.tool as ToolManifest | undefined
  if (tool) return toolPageTitle(tool.title)
  if (route.name === 'home') return APP_NAME
  return '页面不存在 · Toolset'
}

const router = createRouter({
  history: createWebHashHistory(),
  routes,
})

router.afterEach((to) => {
  if (typeof document === 'undefined') return
  document.title = resolveDocumentTitle(to)
})

export default router
