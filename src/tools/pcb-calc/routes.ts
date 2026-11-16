import type { ToolRoutes } from '@/shared/contracts/tool'

const routes: ToolRoutes = [
  {
    path: '',
    name: 'pcb-calc-home',
    component: () => import('./views/PcbCalcView.vue'),
    meta: { title: 'PCB 走线计算' },
  },
]

export default routes
