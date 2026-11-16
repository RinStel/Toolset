/**
 * PCB 走线计算工具清单。
 *
 * `manifest.ts` 只做轻量声明：视图、设置面板与帮助面板全部通过动态 `import()` 按需加载。
 */

import { CircuitBoard } from 'lucide-vue-next'

import type { ToolManifest } from '@/shared/contracts/tool'

const manifest: ToolManifest = {
  id: 'pcb-calc',
  title: 'PCB 走线计算',
  summary: '特征阻抗、高速接口预设、防串扰间距、载流压降与过孔参数速算',
  category: 'calc',
  icon: CircuitBoard,
  order: 10,
  layout: 'page',
  keepAlive: true,
  keywords: [
    'pcb',
    'layout',
    '阻抗',
    '特征阻抗',
    '差分',
    '微带线',
    '带状线',
    '共面波导',
    '串扰',
    '3w',
    '5w',
    '载流',
    '线宽',
    '压降',
    '过孔',
    'via',
    'usb',
    'hdmi',
    'pcie',
    'eth',
    '立创',
    'jlc',
    'impedance',
  ],
  settings: () => import('./panels/Settings.vue'),
  help: () => import('./panels/Help.vue'),
  backupLabels: {
    settings: 'PCB 走线计算设置',
    presets: '自定义高速接口预设',
    stackups: '自定义层叠预设',
  },
}

export default manifest
