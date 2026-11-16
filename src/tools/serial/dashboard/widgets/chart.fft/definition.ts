/**
 * 频谱图定义（plan §8.11 `chart.fft`）。
 *
 * 取变量最近 `size` 个样本做单边幅度谱；采样率默认按最近样本时间间隔中位数估算，
 * 也可以手动填写（Hz）。
 */

import { AudioWaveform } from 'lucide-vue-next'

import type { WidgetDefinition } from '@/domains/dashboard/public'

const definition: WidgetDefinition = {
  type: 'chart.fft',
  version: 1,
  title: '频谱',
  description: '变量最近样本的 FFT 单边幅度谱',
  group: 'chart',
  icon: AudioWaveform,
  defaultSize: { w: 12, h: 8 },
  minSize: { w: 4, h: 4 },
  props: [
    { key: 'variable', label: '变量', type: 'variable', tab: 'data' },
    {
      key: 'size',
      label: 'FFT 点数',
      type: 'number',
      tab: 'data',
      default: 1024,
      min: 256,
      max: 16384,
      step: 256,
      unit: '256–16384（2 的幂）',
    },
    {
      key: 'window',
      label: '窗函数',
      type: 'select',
      tab: 'data',
      default: 'hann',
      options: [
        { label: '无', value: 'none' },
        { label: 'Hann', value: 'hann' },
        { label: 'Hamming', value: 'hamming' },
        { label: 'Blackman', value: 'blackman' },
      ],
    },
    {
      key: 'sampleRate',
      label: '采样率',
      type: 'number',
      tab: 'data',
      min: 0,
      step: 1,
      unit: 'Hz',
      help: '留空按最近样本的时间间隔中位数自动估算',
    },
    {
      key: 'removeDc',
      label: '去除直流',
      type: 'checkbox',
      tab: 'data',
      default: true,
    },
    {
      key: 'average',
      label: '指数平均',
      type: 'number',
      tab: 'data',
      default: 1,
      min: 1,
      max: 16,
      step: 1,
      help: '1 表示不平均；数值越大越平滑',
    },
    {
      key: 'scale',
      label: '纵轴刻度',
      type: 'select',
      tab: 'style',
      default: 'db',
      options: [
        { label: 'dB', value: 'db' },
        { label: '线性', value: 'linear' },
      ],
    },
    { key: 'logX', label: '对数频率轴', type: 'checkbox', tab: 'style', default: false },
    { key: 'showPeak', label: '标出最高峰', type: 'checkbox', tab: 'style', default: true },
    {
      key: 'yRange',
      label: 'Y 轴范围',
      type: 'range',
      tab: 'style',
      default: { min: null, max: null },
    },
  ],
  component: () => import('./Widget.vue'),
}

export default definition
