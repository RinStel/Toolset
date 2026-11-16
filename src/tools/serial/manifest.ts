/**
 * 串口上位机工具清单（plan §6.1 / §8）。
 *
 * `manifest.ts` 只做声明：视图、设置面板和帮助面板都通过动态 `import()` 加载，
 * 以免工具代码进入入口包（`pnpm check:chunks`）。
 */

import { Cable } from 'lucide-vue-next'

import type { ToolManifest } from '@/shared/contracts/tool'

const manifest: ToolManifest = {
  id: 'serial',
  title: '串口上位机',
  summary: '串口调试、协议解析、波形图表与控件面板',
  category: 'comm',
  icon: Cable,
  order: 10,
  layout: 'workspace',
  keepAlive: true,
  keywords: ['串口', 'serial', 'uart', '上位机', '波形', 'vofa', '示波器'],
  settings: () => import('./panels/Settings.vue'),
  help: () => import('./panels/Help.vue'),
  backupLabels: {
    settings: '串口设置',
    layout: '界面布局',
    quick: '快捷发送',
    macros: '宏',
    dashboards: '仪表盘索引',
    'dashboards/*': '仪表盘',
    widgets: '自定义控件索引',
    'widgets/*': '自定义控件',
    'custom-widget-safety': '自定义控件安全提示',
  },
}

export default manifest
