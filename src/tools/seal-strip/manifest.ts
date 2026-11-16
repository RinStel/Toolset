/**
 * 商品封箱条工具清单。
 *
 * `manifest.ts` 只做声明：视图、设置面板与帮助面板全部通过动态 `import()` 按需加载。
 */

import { ShieldCheck } from 'lucide-vue-next'

import type { ToolManifest } from '@/shared/contracts/tool'

const manifest: ToolManifest = {
  id: 'seal-strip',
  title: '商品封箱条',
  summary: '生成 56×34mm 商品封箱条与 A4 二十一联打印版，支持编码核验',
  category: 'other',
  icon: ShieldCheck,
  order: 10,
  layout: 'page',
  keepAlive: true,
  keywords: [
    '商品封箱条',
    '封箱条',
    '封箱证明',
    '防掉包',
    '防伪卡',
    '封签',
    '二维码',
    'seal',
    'rinstel',
    'a4',
  ],
  settings: () => import('./panels/Settings.vue'),
  help: () => import('./panels/Help.vue'),
  backupLabels: {
    settings: '商品封箱条设置',
  },
}

export default manifest
