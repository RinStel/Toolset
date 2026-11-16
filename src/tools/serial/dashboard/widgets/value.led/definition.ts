/**
 * 指示灯定义（plan §8.11 `value.led`）。
 *
 * 条件（thresholds 类型）按顺序取第一个匹配项：匹配时用该条件的颜色点亮，并把
 * label 显示在灯下；`blink` 打开后匹配时闪烁。
 */

import { CircleDot } from 'lucide-vue-next'

import type { WidgetDefinition } from '@/domains/dashboard/public'

const definition: WidgetDefinition = {
  type: 'value.led',
  version: 1,
  title: '指示灯',
  description: '按条件点亮的指示灯',
  group: 'value',
  icon: CircleDot,
  defaultSize: { w: 3, h: 3 },
  minSize: { w: 2, h: 2 },
  props: [
    { key: 'variable', label: '变量', type: 'variable', tab: 'data' },
    {
      key: 'conditions',
      label: '点亮条件',
      type: 'thresholds',
      tab: 'data',
      default: [],
      help: '按顺序取第一个匹配项；label 显示在灯下',
    },
    {
      key: 'offColor',
      label: '熄灭颜色',
      type: 'color',
      tab: 'style',
      default: 'var(--border)',
    },
    {
      key: 'shape',
      label: '形状',
      type: 'select',
      tab: 'style',
      default: 'circle',
      options: [
        { label: '圆', value: 'circle' },
        { label: '方', value: 'square' },
      ],
    },
    { key: 'blink', label: '匹配时闪烁', type: 'checkbox', tab: 'style', default: false },
    { key: 'showLabel', label: '显示标签', type: 'checkbox', tab: 'style', default: true },
  ],
  component: () => import('./Widget.vue'),
}

export default definition
