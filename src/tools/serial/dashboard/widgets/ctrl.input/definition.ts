/**
 * 数值输入定义（plan §8.11 `ctrl.input`）。
 *
 * 回车或按钮发送（`sendOn`）；越界或非数字时行内报错且不发送。
 */

import { TextCursorInput } from 'lucide-vue-next'

import type { WidgetDefinition } from '@/domains/dashboard/public'

const definition: WidgetDefinition = {
  type: 'ctrl.input',
  version: 1,
  title: '数值输入',
  description: '输入数值并发送，支持范围校验',
  group: 'control',
  icon: TextCursorInput,
  defaultSize: { w: 4, h: 2 },
  minSize: { w: 3, h: 1 },
  props: [
    {
      key: 'min',
      label: '最小值',
      type: 'number',
      tab: 'data',
      step: 1,
      help: '留空表示不限制',
    },
    {
      key: 'max',
      label: '最大值',
      type: 'number',
      tab: 'data',
      step: 1,
      help: '留空表示不限制',
    },
    { key: 'step', label: '步进', type: 'number', tab: 'data', default: 1, min: 0.001, step: 0.1 },
    {
      key: 'decimals',
      label: '小数位',
      type: 'number',
      tab: 'data',
      default: 2,
      min: 0,
      max: 10,
      step: 1,
    },
    { key: 'command', label: '命令', type: 'command', tab: 'behavior', default: null },
    {
      key: 'sendOn',
      label: '发送方式',
      type: 'select',
      tab: 'behavior',
      default: 'enter',
      options: [
        { label: '回车或按钮', value: 'enter' },
        { label: '仅按钮', value: 'button' },
      ],
    },
  ],
  component: () => import('./Widget.vue'),
}

export default definition
