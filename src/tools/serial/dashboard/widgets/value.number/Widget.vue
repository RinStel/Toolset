<script setup lang="ts">
/**
 * 数值组件（plan §8.11 `value.number`）。
 *
 * 显示一个变量的最新值：先应用变量元信息的 scale/offset/decimals/单位；`decimals`
 * 可覆盖；`thresholds` 按顺序取第一个匹配项改变数值颜色；可选迷你曲线与最小/最大。
 */

import { computed, nextTick, ref, watch } from 'vue'

import { SERIES_COLORS } from '@/domains/dashboard/public'

import {
  asBoolean,
  asNumberOrNull,
  asThresholds,
  asVarRef,
  clampNumber,
  firstMatchingThreshold,
  formatNumber,
  normalizeDecimals,
  resolveCanvasColor,
  resolveColor,
} from '../shared/format'
import type { WidgetComponentProps } from '../shared/types'
import { useSingleVariable } from '../shared/use-single-variable'
import WidgetEmpty from '../shared/WidgetEmpty.vue'

defineOptions({ name: 'NumberValueWidget' })

const props = defineProps<WidgetComponentProps>()

const sparkPoints = computed(() => {
  const parsed = asNumberOrNull(props.props.sparkPoints)
  return parsed === null ? 100 : Math.round(clampNumber(parsed, 10, 1000))
})

const variable = useSingleVariable(() => asVarRef(props.props.variable), {
  last: Math.max(10, sparkPoints.value),
})

const decimals = computed(() =>
  normalizeDecimals(props.props.decimals, variable.meta.value.decimals),
)

const valueText = computed(() => formatNumber(variable.value.value, decimals.value))

const showUnit = computed(() => asBoolean(props.props.showUnit, true))
const showLabel = computed(() => asBoolean(props.props.showLabel, true))
const showEffectiveLabel = computed(
  () =>
    showLabel.value &&
    !(
      props.instance.common.showTitle &&
      props.instance.common.title.trim() === variable.meta.value.label.trim()
    ),
)
const showMinMax = computed(() => asBoolean(props.props.showMinMax, false))
const sparkline = computed(() => asBoolean(props.props.sparkline, false))

const baseColor = computed(() =>
  resolveColor(
    props.props.color,
    variable.meta.value.color.length > 0 ? variable.meta.value.color : (SERIES_COLORS[0] ?? ''),
  ),
)

const displayColor = computed(() => {
  const matched = firstMatchingThreshold(variable.value.value, asThresholds(props.props.thresholds))
  return matched ? matched.color : baseColor.value
})

const fontSize = computed(() => {
  const fixed = asNumberOrNull(props.props.fontSize)
  if (fixed !== null) return `${Math.round(clampNumber(fixed, 8, 200))}px`
  const width = Math.max(40, props.size.width)
  const height = Math.max(24, props.size.height)
  const digits = Math.max(3, valueText.value.length)
  const byHeight = height * 0.4
  const byWidth = width / (digits * 0.62)
  return `${Math.max(11, Math.min(byHeight, byWidth, 96)).toFixed(1)}px`
})

const rangeText = computed(() => {
  const slice = variable.data.slices.value[0]
  if (!slice || slice.v.length === 0) return ''
  let min = Number.POSITIVE_INFINITY
  let max = Number.NEGATIVE_INFINITY
  for (const value of slice.v) {
    if (!Number.isFinite(value)) continue
    if (value < min) min = value
    if (value > max) max = value
  }
  if (!Number.isFinite(min) || !Number.isFinite(max)) return ''
  return `最小 ${formatNumber(min, decimals.value)} / 最大 ${formatNumber(max, decimals.value)}`
})

/* ------------------------------------------------------------------------- */
/* 迷你曲线                                                                    */
/* ------------------------------------------------------------------------- */

const canvas = ref<HTMLCanvasElement | null>(null)

function drawSparkline(): void {
  const element = canvas.value
  if (!element) return
  const width = Math.max(24, element.clientWidth)
  const height = Math.max(12, element.clientHeight)
  if (element.width !== width || element.height !== height) {
    element.width = width
    element.height = height
  }
  const context = element.getContext('2d')
  if (!context) return
  context.clearRect(0, 0, width, height)
  const slice = variable.data.slices.value[0]
  if (!slice || slice.v.length < 2) return
  const values = slice.v.length > sparkPoints.value ? slice.v.slice(-sparkPoints.value) : slice.v
  let min = Number.POSITIVE_INFINITY
  let max = Number.NEGATIVE_INFINITY
  for (const value of values) {
    if (!Number.isFinite(value)) continue
    if (value < min) min = value
    if (value > max) max = value
  }
  if (!Number.isFinite(min) || !Number.isFinite(max)) return
  if (min === max) {
    min -= 1
    max += 1
  }
  context.strokeStyle = resolveCanvasColor(
    displayColor.value,
    props.ctx.theme,
    variable.meta.value.color,
  )
  context.lineWidth = 1
  context.beginPath()
  for (let index = 0; index < values.length; index += 1) {
    const value = values[index] as number
    const x = (index / (values.length - 1)) * (width - 1)
    const y = height - 1 - ((value - min) / (max - min)) * (height - 2)
    if (index === 0) context.moveTo(x, y)
    else context.lineTo(x, y)
  }
  context.stroke()
}

watch(
  () => [sparkline.value, variable.data.frameIndex.value, displayColor.value] as const,
  () => {
    if (!sparkline.value) return
    void nextTick(drawSparkline)
  },
  { immediate: true },
)
</script>

<template>
  <div
    class="value-number"
    :class="{ 'is-empty': variable.empty.value !== null }"
    :data-display-value="valueText"
    :data-value-color="displayColor"
    :style="{ color: displayColor }"
  >
    <WidgetEmpty v-if="variable.empty.value !== null" :text="variable.empty.value" />

    <template v-else>
      <span v-if="showEffectiveLabel" class="value-number__label">{{
        variable.meta.value.label
      }}</span>
      <span class="value-number__main">
        <span class="value-number__value" :style="{ fontSize }">{{ valueText }}</span>
        <span v-if="showUnit && variable.meta.value.unit.length > 0" class="value-number__unit">{{
          variable.meta.value.unit
        }}</span>
      </span>
      <canvas v-if="sparkline" ref="canvas" class="value-number__spark" aria-hidden="true" />
      <span v-if="showMinMax && rangeText.length > 0" class="value-number__range">
        {{ rangeText }}
      </span>
    </template>
  </div>
</template>

<style scoped>
.value-number {
  display: flex;
  flex-direction: column;
  align-items: stretch;
  justify-content: center;
  gap: 2px;
  width: 100%;
  height: 100%;
  min-width: 0;
  min-height: 0;
  overflow: hidden;
}

.value-number__label {
  overflow: hidden;
  color: var(--text-dim);
  font-size: 11px;
  line-height: 1.3;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.value-number__main {
  display: flex;
  align-items: baseline;
  gap: 4px;
  min-width: 0;
}

.value-number__value {
  font-family: var(--font-mono);
  font-weight: 600;
  line-height: 1.05;
  letter-spacing: -0.01em;
  white-space: nowrap;
}

.value-number__unit {
  flex: none;
  color: var(--text-dim);
  font-size: 11px;
}

.value-number__spark {
  width: 100%;
  height: 22px;
  min-height: 12px;
}

.value-number__range {
  overflow: hidden;
  color: var(--text-faint);
  font-family: var(--font-mono);
  font-size: 10px;
  text-overflow: ellipsis;
  white-space: nowrap;
}
</style>
