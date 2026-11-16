import type { ToolRoutes } from '@/shared/contracts/tool'

const routes: ToolRoutes = [
  {
    path: '',
    name: 'seal-strip-home',
    component: () => import('./views/SealStripView.vue'),
    meta: { title: '商品封箱条' },
  },
]

export default routes
