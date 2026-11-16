/**
 * 文本组件定义（plan §8.11 `value.text`）。
 *
 * `template` 的占位符语法与命令模板的 text 模式相同：`{var.<key>}` / `{var.<key>:.1f}`；
 * 变量取默认数据源，缺失时显示 `--`。
 */

import { Type } from 'lucide-vue-next'

import type { WidgetDefinition } from '@/domains/dashboard/public'

const definition: WidgetDefinition = {
  type: 'value.text',
  version: 1,
  title: '文本',
  description: '按模板组合变量值的文本标签',
  group: 'value',
  icon: Type,
  defaultSize: { w: 6, h: 2 },
  minSize: { w: 2, h: 1 },
  props: [
    {
      key: 'template',
      label: '模板',
      type: 'textarea',
      tab: 'data',
      rows: 3,
      default: '温度 {var.temp:.1f} °C',
      help: '{var.<key>} 取变量显示值，可加 :.1f 等格式；{{ 和 }} 表示花括号',
    },
    {
      key: 'align',
      label: '对齐',
      type: 'select',
      tab: 'style',
      default: 'left',
      options: [
        { label: '左', value: 'left' },
        { label: '中', value: 'center' },
        { label: '右', value: 'right' },
      ],
    },
    {
      key: 'fontSize',
      label: '字号',
      type: 'number',
      tab: 'style',
      default: 16,
      min: 8,
      max: 200,
      step: 1,
      unit: 'px',
    },
    { key: 'color', label: '颜色', type: 'color', tab: 'style', default: 'var(--text)' },
    { key: 'bold', label: '加粗', type: 'checkbox', tab: 'style', default: false },
  ],
  component: () => import('./Widget.vue'),
}

export default definition
