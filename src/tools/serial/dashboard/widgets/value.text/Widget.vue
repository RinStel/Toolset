<script setup lang="ts">
/**
 * 文本（plan §8.11 `value.text`）。
 *
 * 占位符语法与命令模板的 text 模式相同：`{var.<key>}` / `{var.<key>:.1f}`，`{{` `}}`
 * 为字面量花括号；变量取默认数据源，缺失时显示 `--`。
 */

import { computed } from 'vue'

import { EMPTY_SOURCE_DISCONNECTED, type VarRef } from '@/domains/dashboard/public'

import {
  asBoolean,
  asNumber,
  asString,
  clampNumber,
  parseTemplateKeys,
  renderTemplate,
  resolveColor,
} from '../shared/format'
import type { WidgetComponentProps } from '../shared/types'
import { useDefaultSource } from '../shared/runtime'
import { useWidgetData } from '../../runtime/useWidgetData'
import WidgetEmpty from '../shared/WidgetEmpty.vue'

defineOptions({ name: 'TextValueWidget' })

const props = defineProps<WidgetComponentProps>()

const template = computed(() => asString(props.props.template))
const templateKeys = computed(() => parseTemplateKeys(template.value))
const defaultSource = useDefaultSource()

const refs = computed<VarRef[]>(() =>
  templateKeys.value.map((key) => ({ source: defaultSource.value, key })),
)

const data = useWidgetData(() => refs.value, { history: { last: 1 } })

const lookup = computed(() => {
  const map = new Map<string, number | undefined>()
  for (let index = 0; index < templateKeys.value.length; index += 1) {
    map.set(templateKeys.value[index] as string, data.latest.value[index])
  }
  return map
})

const text = computed(() => renderTemplate(template.value, (key) => lookup.value.get(key)))

const emptyText = computed<string | null>(() => {
  if (templateKeys.value.length === 0) return null
  const states = data.sourceStates.value
  if (states.length > 0 && states.every((state) => state === 'unbound')) {
    return EMPTY_SOURCE_DISCONNECTED
  }
  return null
})

const align = computed(() => {
  const value = asString(props.props.align, 'left')
  return value === 'center' || value === 'right' ? value : 'left'
})

const fontSize = computed(() => Math.round(clampNumber(asNumber(props.props.fontSize, 16), 8, 200)))

const color = computed(() => resolveColor(props.props.color, 'var(--text)'))

const bold = computed(() => asBoolean(props.props.bold, false))
</script>

<template>
  <div class="value-text" :data-template="template">
    <WidgetEmpty v-if="emptyText !== null" :text="emptyText" />

    <span
      v-else
      class="value-text__body"
      :style="{
        justifyContent:
          align === 'center' ? 'center' : align === 'right' ? 'flex-end' : 'flex-start',
        color,
        fontSize: `${fontSize}px`,
        fontWeight: bold ? 600 : 400,
        textAlign: align,
      }"
      >{{ text }}</span
    >
  </div>
</template>

<style scoped>
.value-text {
  display: flex;
  align-items: stretch;
  width: 100%;
  height: 100%;
  min-width: 0;
  min-height: 0;
  overflow: hidden;
}

.value-text__body {
  display: flex;
  align-items: center;
  width: 100%;
  height: 100%;
  min-width: 0;
  overflow: hidden;
  font-family: var(--font-ui);
  line-height: 1.35;
  overflow-wrap: anywhere;
  white-space: pre-wrap;
}
</style>
