/**
 * 仪表盘定义（plan §8.11 `value.gauge`）。
 *
 * 270° / 180° 圆弧 + 指针；超出 `min`–`max` 的值钳制后显示。分区（zones）按数值范围
 * 上色。
 */

import { Gauge } from 'lucide-vue-next'

import type { WidgetDefinition } from '@/domains/dashboard/public'

const definition: WidgetDefinition = {
  type: 'value.gauge',
  version: 1,
  title: '仪表',
  description: '指针式仪表，支持分区与刻度',
  group: 'value',
  icon: Gauge,
  defaultSize: { w: 6, h: 6 },
  minSize: { w: 3, h: 3 },
  props: [
    { key: 'variable', label: '变量', type: 'variable', tab: 'data' },
    {
      key: 'min',
      label: '最小值',
      type: 'number',
      tab: 'data',
      default: 0,
      step: 1,
    },
    {
      key: 'max',
      label: '最大值',
      type: 'number',
      tab: 'data',
      default: 100,
      step: 1,
    },
    {
      key: 'arc',
      label: '圆弧角度',
      type: 'select',
      tab: 'style',
      default: '270',
      options: [
        { label: '270°', value: '270' },
        { label: '180°', value: '180' },
      ],
    },
    { key: 'zones', label: '分区', type: 'zones', tab: 'style', default: [] },
    { key: 'showTicks', label: '显示刻度', type: 'checkbox', tab: 'style', default: true },
    {
      key: 'ticks',
      label: '刻度数量',
      type: 'number',
      tab: 'style',
      default: 5,
      min: 2,
      max: 20,
      step: 1,
    },
    {
      key: 'decimals',
      label: '小数位',
      type: 'number',
      tab: 'style',
      min: 0,
      max: 10,
      step: 1,
      help: '留空继承变量设置',
    },
    { key: 'needleColor', label: '指针颜色', type: 'color', tab: 'style', default: 'auto' },
  ],
  component: () => import('./Widget.vue'),
}

export default definition
