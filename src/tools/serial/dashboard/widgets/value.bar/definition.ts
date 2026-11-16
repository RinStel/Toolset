/**
 * 柱状图定义（plan §8.11 `value.bar`）。
 *
 * 多个变量并排显示；`max` 可手动指定或勾选自动（按数据范围）。阈值按顺序取第一个
 * 匹配项改变柱子颜色。
 */

import { ChartColumn } from 'lucide-vue-next'

import type { WidgetDefinition } from '@/domains/dashboard/public'

const definition: WidgetDefinition = {
  type: 'value.bar',
  version: 1,
  title: '柱状图',
  description: '多变量柱状 / 条形图',
  group: 'value',
  icon: ChartColumn,
  defaultSize: { w: 6, h: 6 },
  minSize: { w: 3, h: 3 },
  props: [
    {
      key: 'variables',
      label: '变量',
      type: 'variables',
      tab: 'data',
      min: 1,
      max: 16,
      itemFields: [{ key: 'color', label: '颜色', type: 'color', tab: 'data', default: 'auto' }],
    },
    { key: 'min', label: '最小值', type: 'number', tab: 'data', default: 0, step: 1 },
    { key: 'max', label: '最大值', type: 'number', tab: 'data', default: 100, step: 1 },
    {
      key: 'autoRange',
      label: '自动范围',
      type: 'checkbox',
      tab: 'data',
      default: false,
      help: '勾选后忽略最小值 / 最大值，按数据范围缩放',
    },
    {
      key: 'orientation',
      label: '方向',
      type: 'select',
      tab: 'style',
      default: 'vertical',
      options: [
        { label: '垂直', value: 'vertical' },
        { label: '水平', value: 'horizontal' },
      ],
    },
    { key: 'showValues', label: '显示数值', type: 'checkbox', tab: 'style', default: true },
    { key: 'thresholds', label: '阈值颜色', type: 'thresholds', tab: 'style', default: [] },
  ],
  component: () => import('./Widget.vue'),
}

export default definition
