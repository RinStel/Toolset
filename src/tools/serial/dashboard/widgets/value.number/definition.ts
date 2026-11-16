/**
 * 数值组件定义（plan §8.11 `value.number`）。
 *
 * 显示值先应用变量元信息的 scale/offset/decimals/单位；`decimals` 留空表示继承
 * 变量设置。阈值按顺序取第一个匹配项改变数值颜色。
 */

import { Hash } from 'lucide-vue-next'

import type { WidgetDefinition } from '@/domains/dashboard/public'

const definition: WidgetDefinition = {
  type: 'value.number',
  version: 1,
  title: '数值',
  description: '显示一个变量的最新值，可带阈值变色与迷你曲线',
  group: 'value',
  icon: Hash,
  defaultSize: { w: 4, h: 3 },
  minSize: { w: 2, h: 2 },
  props: [
    { key: 'variable', label: '变量', type: 'variable', tab: 'data' },
    {
      key: 'decimals',
      label: '小数位',
      type: 'number',
      tab: 'data',
      min: 0,
      max: 10,
      step: 1,
      help: '留空继承变量设置',
    },
    {
      key: 'fontSize',
      label: '字号',
      type: 'number',
      tab: 'style',
      min: 8,
      max: 200,
      step: 1,
      unit: 'px',
      help: '留空按组件尺寸自动缩放',
    },
    { key: 'showUnit', label: '显示单位', type: 'checkbox', tab: 'style', default: true },
    { key: 'showLabel', label: '显示变量名', type: 'checkbox', tab: 'style', default: true },
    { key: 'color', label: '颜色', type: 'color', tab: 'style', default: 'auto' },
    {
      key: 'thresholds',
      label: '阈值颜色',
      type: 'thresholds',
      tab: 'style',
      default: [],
      help: '按顺序取第一个匹配项',
    },
    { key: 'sparkline', label: '迷你曲线', type: 'checkbox', tab: 'style', default: false },
    {
      key: 'sparkPoints',
      label: '曲线点数',
      type: 'number',
      tab: 'style',
      default: 100,
      min: 10,
      max: 1000,
      step: 10,
      visibleWhen: { key: 'sparkline', equals: true },
    },
    { key: 'showMinMax', label: '显示最小/最大', type: 'checkbox', tab: 'style', default: false },
  ],
  component: () => import('./Widget.vue'),
}

export default definition
