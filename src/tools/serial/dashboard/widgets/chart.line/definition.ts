/**
 * 波形图定义（plan §8.11 `chart.line`）。
 *
 * `variables` 的 itemFields 支持颜色 / 线宽 / Y 轴 / 显示开关；x 轴支持样本序号与
 * 相对时间两种模式。`component` 使用动态 import，`definition.ts` 不静态引入 uPlot。
 */

import { ChartLine } from 'lucide-vue-next'

import type { WidgetDefinition } from '@/domains/dashboard/public'

const definition: WidgetDefinition = {
  type: 'chart.line',
  version: 1,
  title: '波形图',
  description: '多变量实时波形，支持冻结、缩放与导出',
  group: 'chart',
  icon: ChartLine,
  defaultSize: { w: 12, h: 8 },
  minSize: { w: 4, h: 4 },
  props: [
    {
      key: 'variables',
      label: '变量',
      type: 'variables',
      tab: 'data',
      min: 1,
      max: 16,
      itemFields: [
        { key: 'color', label: '颜色', type: 'color', tab: 'data', default: 'auto' },
        {
          key: 'lineWidth',
          label: '线宽',
          type: 'number',
          tab: 'data',
          default: 1.5,
          min: 0.5,
          max: 4,
          step: 0.1,
        },
        {
          key: 'axis',
          label: 'Y 轴',
          type: 'select',
          tab: 'data',
          default: 'left',
          options: [
            { label: '左', value: 'left' },
            { label: '右', value: 'right' },
          ],
        },
        { key: 'visible', label: '显示', type: 'checkbox', tab: 'data', default: true },
      ],
    },
    {
      key: 'xMode',
      label: '横轴',
      type: 'select',
      tab: 'data',
      default: 'idx',
      options: [
        { label: '样本序号', value: 'idx' },
        { label: '时间', value: 'time' },
      ],
    },
    {
      key: 'window',
      label: '窗口点数',
      type: 'number',
      tab: 'data',
      default: 1000,
      min: 10,
      max: 100000,
      step: 10,
      unit: '点',
      visibleWhen: { key: 'xMode', equals: 'idx' },
    },
    {
      key: 'windowSeconds',
      label: '窗口时长',
      type: 'number',
      tab: 'data',
      default: 10,
      min: 0.1,
      max: 3600,
      step: 0.1,
      unit: '秒',
      visibleWhen: { key: 'xMode', equals: 'time' },
    },
    {
      key: 'yLeft',
      label: '左 Y 轴范围',
      type: 'range',
      tab: 'style',
      default: { min: null, max: null },
    },
    {
      key: 'yRight',
      label: '右 Y 轴范围',
      type: 'range',
      tab: 'style',
      default: { min: null, max: null },
    },
    {
      key: 'lineStyle',
      label: '线型',
      type: 'select',
      tab: 'style',
      default: 'line',
      options: [
        { label: '线', value: 'line' },
        { label: '阶梯', value: 'step' },
        { label: '点', value: 'scatter' },
      ],
    },
    { key: 'showGrid', label: '显示网格', type: 'checkbox', tab: 'style', default: true },
    { key: 'showLegend', label: '显示图例', type: 'checkbox', tab: 'style', default: true },
    {
      key: 'legendPos',
      label: '图例位置',
      type: 'select',
      tab: 'style',
      default: 'top',
      options: [
        { label: '上', value: 'top' },
        { label: '下', value: 'bottom' },
        { label: '右', value: 'right' },
      ],
    },
    { key: 'showPoints', label: '显示数据点', type: 'checkbox', tab: 'style', default: false },
    {
      key: 'cursor',
      label: '悬停光标',
      type: 'checkbox',
      tab: 'behavior',
      default: true,
      help: '运行模式下悬停显示各变量的值',
    },
    {
      key: 'triggerVar',
      label: '触发变量',
      type: 'variable',
      tab: 'behavior',
      help: '选中变量后，配合触发阈值在上升沿自动冻结',
    },
    {
      key: 'triggerLevel',
      label: '触发阈值',
      type: 'number',
      tab: 'behavior',
      step: 0.1,
      help: '触发变量显示值从下向上越过该值时冻结画面',
    },
  ],
  component: () => import('./Widget.vue'),
}

export default definition
