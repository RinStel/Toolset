/**
 * 按钮定义（plan §8.11 `ctrl.button`）。
 *
 * 点击发送 `command`（值取 `value`）；`momentary` 打开时按下发送 `command`、松开
 * 发送 `releaseCommand`；`confirm` 打开时先弹确认框。
 */

import { Send } from 'lucide-vue-next'

import type { WidgetDefinition } from '@/domains/dashboard/public'

const definition: WidgetDefinition = {
  type: 'ctrl.button',
  version: 1,
  title: '按钮',
  description: '点击发送一条命令',
  group: 'control',
  icon: Send,
  defaultSize: { w: 3, h: 2 },
  minSize: { w: 2, h: 1 },
  props: [
    {
      key: 'label',
      label: '文本',
      type: 'text',
      tab: 'style',
      default: '发送',
      maxLength: 40,
    },
    { key: 'color', label: '颜色', type: 'color', tab: 'style', default: 'var(--accent)' },
    { key: 'command', label: '命令', type: 'command', tab: 'behavior', default: null },
    {
      key: 'value',
      label: '发送值',
      type: 'number',
      tab: 'behavior',
      default: 1,
      step: 1,
      help: '作为 {value} 传给命令模板',
    },
    {
      key: 'momentary',
      label: '点动模式',
      type: 'checkbox',
      tab: 'behavior',
      default: false,
      help: '按下发送命令，松开发送释放命令',
    },
    {
      key: 'releaseCommand',
      label: '释放命令',
      type: 'command',
      tab: 'behavior',
      default: null,
      visibleWhen: { key: 'momentary', equals: true },
    },
    {
      key: 'confirm',
      label: '发送前确认',
      type: 'checkbox',
      tab: 'behavior',
      default: false,
    },
  ],
  component: () => import('./Widget.vue'),
}

export default definition
