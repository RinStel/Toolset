/**
 * 滑块定义（plan §8.11 `ctrl.slider`）。
 *
 * 发送模式：松开时发送 / 拖动时节流发送（节流间隔 `throttleMs`）。`feedbackVar` 让
 * 滑块跟随变量的显示值，用户操作后 2 秒内不被反馈覆盖。
 */

import { SlidersHorizontal } from 'lucide-vue-next'

import type { WidgetDefinition } from '@/domains/dashboard/public'

const definition: WidgetDefinition = {
  type: 'ctrl.slider',
  version: 1,
  title: '滑块',
  description: '拖动发送一个数值，可跟随反馈变量',
  group: 'control',
  icon: SlidersHorizontal,
  defaultSize: { w: 6, h: 2 },
  minSize: { w: 3, h: 1 },
  props: [
    { key: 'min', label: '最小值', type: 'number', tab: 'data', default: 0, step: 1 },
    { key: 'max', label: '最大值', type: 'number', tab: 'data', default: 100, step: 1 },
    { key: 'step', label: '步进', type: 'number', tab: 'data', default: 1, min: 0.001, step: 0.1 },
    { key: 'feedbackVar', label: '反馈变量', type: 'variable', tab: 'data' },
    {
      key: 'orientation',
      label: '方向',
      type: 'select',
      tab: 'style',
      default: 'horizontal',
      options: [
        { label: '水平', value: 'horizontal' },
        { label: '垂直', value: 'vertical' },
      ],
    },
    { key: 'showValue', label: '显示数值', type: 'checkbox', tab: 'style', default: true },
    {
      key: 'decimals',
      label: '小数位',
      type: 'number',
      tab: 'style',
      default: 0,
      min: 0,
      max: 10,
      step: 1,
    },
    { key: 'command', label: '命令', type: 'command', tab: 'behavior', default: null },
    {
      key: 'sendMode',
      label: '发送模式',
      type: 'select',
      tab: 'behavior',
      default: 'release',
      options: [
        { label: '松开时发送', value: 'release' },
        { label: '拖动时节流发送', value: 'throttle' },
      ],
    },
    {
      key: 'throttleMs',
      label: '节流间隔',
      type: 'number',
      tab: 'behavior',
      default: 100,
      min: 20,
      max: 2000,
      step: 10,
      unit: 'ms',
      visibleWhen: { key: 'sendMode', equals: 'throttle' },
    },
  ],
  component: () => import('./Widget.vue'),
}

export default definition
