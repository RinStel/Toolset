<script setup lang="ts">
/**
 * 柱状图（plan §8.11 `value.bar`）。
 *
 * 多个变量并排（垂直）或并列（水平）；`autoRange` 关闭时使用 `min`–`max` 作为刻度
 * 范围；阈值按顺序取第一个匹配项改变柱子颜色。
 */

import { computed } from 'vue'

import {
  asArray,
  asBoolean,
  asNumber,
  asString,
  asThresholds,
  asVarRef,
  clampNumber,
  firstMatchingThreshold,
  formatNumber,
  seriesColorOf,
} from '../shared/format'
import type { WidgetComponentProps } from '../shared/types'
import { useWidgetData } from '../../runtime/useWidgetData'
import WidgetEmpty from '../shared/WidgetEmpty.vue'
import {
  EMPTY_NO_VARIABLE,
  EMPTY_SOURCE_DISCONNECTED,
  EMPTY_WAITING_DATA,
  SERIES_COLORS,
  type VarRef,
} from '@/domains/dashboard/public'

defineOptions({ name: 'BarValueWidget' })

const props = defineProps<WidgetComponentProps>()

const refs = computed<VarRef[]>(() => {
  const result: VarRef[] = []
  for (const item of asArray(props.props.variables)) {
    const ref = asVarRef(item)
    if (ref) result.push(ref)
  }
  return result
})

const data = useWidgetData(() => refs.value, { history: { last: 200 } })

const thresholds = computed(() => asThresholds(props.props.thresholds))

const min = computed(() => asNumber(props.props.min, 0))
const max = computed(() => {
  const parsed = asNumber(props.props.max, 100)
  return parsed > min.value ? parsed : min.value + 1
})

const autoRange = computed(() => asBoolean(props.props.autoRange, false))

interface BarRow {
  key: string
  label: string
  unit: string
  color: string
  value: number | undefined
  valueText: string
  ratio: number
}

const rows = computed<BarRow[]>(() => {
  const values = refs.value.map((_, index) => data.latest.value[index])
  const finiteValues = values.filter((value): value is number => value !== undefined)
  let lower = min.value
  let upper = max.value
  if (autoRange.value && finiteValues.length > 0) {
    lower = Math.min(0, ...finiteValues)
    upper = Math.max(0, ...finiteValues)
    if (upper - lower < 1e-9) upper = lower + 1
  }
  const span = upper - lower

  return refs.value.map((ref, index) => {
    const meta = data.variables.value[index]
    const value = data.latest.value[index]
    const matched = firstMatchingThreshold(value, thresholds.value)
    const item = asArray(props.props.variables)[index]
    const itemColor =
      item && typeof item === 'object' ? (item as Record<string, unknown>).color : ''
    const color = matched
      ? matched.color
      : seriesColorOf(itemColor, meta?.color ?? '', index, SERIES_COLORS)
    return {
      key: `${ref.source}/${ref.key}`,
      label: meta?.label ?? ref.key,
      unit: meta?.unit ?? '',
      color,
      value,
      valueText:
        value === undefined
          ? '--'
          : `${formatNumber(value, meta?.decimals ?? 2)}${meta?.unit ? ` ${meta.unit}` : ''}`,
      ratio: value === undefined ? 0 : clampNumber((value - lower) / span, 0, 1),
    }
  })
})

const emptyText = computed<string | null>(() => {
  if (refs.value.length === 0) return EMPTY_NO_VARIABLE
  const states = data.sourceStates.value
  if (states.length > 0 && states.every((state) => state === 'unbound')) {
    return EMPTY_SOURCE_DISCONNECTED
  }
  if (data.latest.value.every((value) => value === undefined)) return EMPTY_WAITING_DATA
  return null
})

const orientation = computed(() =>
  asString(props.props.orientation) === 'horizontal' ? 'horizontal' : 'vertical',
)
const showValues = computed(() => asBoolean(props.props.showValues, true))
</script>

<template>
  <div
    class="value-bar"
    :class="`is-${orientation}`"
    :data-count="rows.length"
    data-testid="value-bar"
  >
    <WidgetEmpty v-if="emptyText !== null" :text="emptyText" />

    <div v-else class="value-bar__items">
      <div v-for="row in rows" :key="row.key" class="value-bar__item" data-testid="value-bar-row">
        <div class="value-bar__track">
          <div
            class="value-bar__fill"
            :style="{
              background: row.color,
              [orientation === 'vertical' ? 'height' : 'width']: `${(row.ratio * 100).toFixed(2)}%`,
            }"
          />
        </div>
        <div class="value-bar__meta">
          <span v-if="showValues" class="value-bar__value">{{ row.valueText }}</span>
          <span class="value-bar__label" :title="row.label">{{ row.label }}</span>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.value-bar {
  display: flex;
  width: 100%;
  height: 100%;
  min-width: 0;
  min-height: 0;
  overflow: hidden;
}

.value-bar.is-vertical {
  align-items: stretch;
}

.value-bar.is-horizontal {
  align-items: stretch;
}

.value-bar__items {
  display: flex;
  flex: 1 1 auto;
  gap: 6px;
  min-width: 0;
  min-height: 0;
  padding: 2px;
}

.value-bar.is-vertical .value-bar__items {
  flex-direction: row;
  align-items: stretch;
}

.value-bar.is-horizontal .value-bar__items {
  flex-direction: column;
  align-items: stretch;
}

.value-bar__item {
  display: flex;
  flex: 1 1 0;
  gap: 4px;
  min-width: 0;
  min-height: 0;
}

.value-bar.is-vertical .value-bar__item {
  flex-direction: column;
}

.value-bar.is-horizontal .value-bar__item {
  flex-direction: row;
  align-items: center;
}

.value-bar__track {
  position: relative;
  flex: 1 1 auto;
  min-width: 8px;
  min-height: 8px;
  overflow: hidden;
  border-radius: var(--radius-sm);
  background: var(--bg-sunken);
}

.value-bar.is-vertical .value-bar__track {
  display: flex;
  flex-direction: column;
  justify-content: flex-end;
}

.value-bar.is-horizontal .value-bar__track {
  display: flex;
  flex-direction: row;
  justify-content: flex-start;
}

.value-bar__fill {
  min-width: 2px;
  min-height: 2px;
  border-radius: var(--radius-sm);
  transition:
    height 120ms linear,
    width 120ms linear;
}

.value-bar.is-horizontal .value-bar__track {
  order: 1;
}

.value-bar__meta {
  display: flex;
  gap: 2px;
  min-width: 0;
  overflow: hidden;
}

.value-bar.is-vertical .value-bar__meta {
  flex-direction: column;
  align-items: center;
}

.value-bar.is-horizontal .value-bar__meta {
  order: 0;
  flex-direction: row;
  align-items: baseline;
  width: 46%;
  max-width: 46%;
  flex: none;
}

.value-bar__value {
  flex: none;
  color: var(--text);
  font-family: var(--font-mono);
  font-size: 11px;
  white-space: nowrap;
}

.value-bar__label {
  overflow: hidden;
  color: var(--text-faint);
  font-size: 10px;
  line-height: 1.3;
  text-overflow: ellipsis;
  white-space: nowrap;
}
</style>
