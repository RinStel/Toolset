/**
 * 串口助手的路由（plan §6.2）。
 *
 * `path: ''` 是工具首页；视图使用动态 `import()`，保持入口包纯净。
 */

import type { ToolRoutes } from '@/shared/contracts/tool'

const routes: ToolRoutes = [
  {
    path: '',
    name: 'serial',
    component: () => import('./views/SerialToolView.vue'),
  },
]

export default routes
