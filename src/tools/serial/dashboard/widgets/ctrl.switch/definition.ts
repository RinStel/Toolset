/**
 * 开关定义（plan §8.11 `ctrl.switch`）。
 *
 * 打开 / 关闭分别发送 `onCommand` / `offCommand`（`{value}` 分别为 1 和 0）；
 * 设置 `feedbackVar` 后开关状态跟随「该变量的显示值 > 0」，用户操作后 2 秒内不被
 * 反馈覆盖。
 */

import { ToggleLeft } from 'lucide-vue-next'

import type { WidgetDefinition } from '@/domains/dashboard/public'

const definition: WidgetDefinition = {
  type: 'ctrl.switch',
  version: 1,
  title: '开关',
  description: '两态开关，可跟随反馈变量',
  group: 'control',
  icon: ToggleLeft,
  defaultSize: { w: 3, h: 2 },
  minSize: { w: 2, h: 1 },
  props: [
    { key: 'labelOn', label: '打开文本', type: 'text', tab: 'style', default: '开', maxLength: 20 },
    {
      key: 'labelOff',
      label: '关闭文本',
      type: 'text',
      tab: 'style',
      default: '关',
      maxLength: 20,
    },
    { key: 'onCommand', label: '打开命令', type: 'command', tab: 'behavior', default: null },
    { key: 'offCommand', label: '关闭命令', type: 'command', tab: 'behavior', default: null },
    {
      key: 'feedbackVar',
      label: '反馈变量',
      type: 'variable',
      tab: 'behavior',
      help: '设置后开关状态跟随该变量的显示值 > 0',
    },
  ],
  component: () => import('./Widget.vue'),
}

export default definition
