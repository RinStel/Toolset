/**
 * XY 图定义（plan §8.11 `chart.xy`）。
 *
 * 一个 x 变量对 1–4 个 y 变量；按点数窗口绘制散点或连线。
 */

import { ChartScatter } from 'lucide-vue-next'

import type { WidgetDefinition } from '@/domains/dashboard/public'

const definition: WidgetDefinition = {
  type: 'chart.xy',
  version: 1,
  title: 'XY 图',
  description: '以一个变量为横轴的散点 / 连线图',
  group: 'chart',
  icon: ChartScatter,
  defaultSize: { w: 8, h: 8 },
  minSize: { w: 4, h: 4 },
  props: [
    {
      key: 'xVar',
      label: 'X 变量',
      type: 'variable',
      tab: 'data',
    },
    {
      key: 'yVars',
      label: 'Y 变量',
      type: 'variables',
      tab: 'data',
      min: 1,
      max: 4,
      itemFields: [{ key: 'color', label: '颜色', type: 'color', tab: 'data', default: 'auto' }],
    },
    {
      key: 'points',
      label: '点数',
      type: 'number',
      tab: 'data',
      default: 500,
      min: 10,
      max: 20000,
      step: 10,
      unit: '点',
    },
    {
      key: 'style',
      label: '样式',
      type: 'select',
      tab: 'style',
      default: 'points',
      options: [
        { label: '点', value: 'points' },
        { label: '线', value: 'line' },
      ],
    },
    {
      key: 'xRange',
      label: 'X 轴范围',
      type: 'range',
      tab: 'style',
      default: { min: null, max: null },
    },
    {
      key: 'yRange',
      label: 'Y 轴范围',
      type: 'range',
      tab: 'style',
      default: { min: null, max: null },
    },
    {
      key: 'equalAspect',
      label: '等比例坐标',
      type: 'checkbox',
      tab: 'style',
      default: false,
      help: 'X / Y 轴使用相同的单位长度',
    },
    {
      key: 'fade',
      label: '旧点淡出',
      type: 'checkbox',
      tab: 'style',
      default: true,
    },
  ],
  component: () => import('./Widget.vue'),
}

export default definition
