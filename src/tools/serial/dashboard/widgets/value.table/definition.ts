/**
 * 变量表定义（plan §8.11 `value.table`）。
 *
 * `variables` 为空（0 个）时显示该数据源的全部变量；列开关控制显示哪些统计列；
 * 表头「重置统计」调用该数据源 series 的 `resetStats()`。
 *
 * 说明：`source` 目前用文本字段（留空 = 默认数据源）。属性面板的 `select` 只接受
 * 静态选项，无法按仪表盘的数据源列表动态生成，因此这里记录 alias。
 */

import { Table } from 'lucide-vue-next'

import type { WidgetDefinition } from '@/domains/dashboard/public'

const definition: WidgetDefinition = {
  type: 'value.table',
  version: 1,
  title: '变量表',
  description: '多变量的值、统计与速率表格',
  group: 'value',
  icon: Table,
  defaultSize: { w: 8, h: 6 },
  minSize: { w: 4, h: 3 },
  props: [
    {
      key: 'variables',
      label: '变量',
      type: 'variables',
      tab: 'data',
      min: 0,
      max: 64,
      itemFields: [{ key: 'color', label: '颜色', type: 'color', tab: 'data', default: 'auto' }],
    },
    {
      key: 'source',
      label: '数据源',
      type: 'text',
      tab: 'data',
      default: '',
      placeholder: '留空 = 默认数据源',
      help: '数据源 alias；留空表示仪表盘的默认数据源',
    },
    { key: 'colValue', label: '值', type: 'checkbox', tab: 'style', default: true },
    { key: 'colMin', label: '最小', type: 'checkbox', tab: 'style', default: false },
    { key: 'colMax', label: '最大', type: 'checkbox', tab: 'style', default: false },
    { key: 'colMean', label: '平均', type: 'checkbox', tab: 'style', default: false },
    { key: 'colRate', label: '速率', type: 'checkbox', tab: 'style', default: false },
    { key: 'colCount', label: '样本数', type: 'checkbox', tab: 'style', default: false },
    { key: 'compact', label: '紧凑行高', type: 'checkbox', tab: 'style', default: false },
  ],
  component: () => import('./Widget.vue'),
}

export default definition
