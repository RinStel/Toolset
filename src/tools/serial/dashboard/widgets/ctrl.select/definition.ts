/**
 * 下拉选择定义（plan §8.11 `ctrl.select`）。
 *
 * 选中项的 value 作为 `{value}` 发送；`feedbackVar` 让下拉跟随变量显示值。
 */

import { ListFilter } from 'lucide-vue-next'

import type { WidgetDefinition } from '@/domains/dashboard/public'

const definition: WidgetDefinition = {
  type: 'ctrl.select',
  version: 1,
  title: '下拉选择',
  description: '从选项列表中选择并发送',
  group: 'control',
  icon: ListFilter,
  defaultSize: { w: 4, h: 2 },
  minSize: { w: 3, h: 1 },
  props: [
    {
      key: 'options',
      label: '选项',
      type: 'options',
      tab: 'data',
      default: [
        { label: '选项 1', value: 1 },
        { label: '选项 2', value: 2 },
      ],
    },
    { key: 'command', label: '命令', type: 'command', tab: 'behavior', default: null },
    {
      key: 'feedbackVar',
      label: '反馈变量',
      type: 'variable',
      tab: 'behavior',
      help: '设置后下拉跟随该变量的显示值',
    },
  ],
  component: () => import('./Widget.vue'),
}

export default definition
