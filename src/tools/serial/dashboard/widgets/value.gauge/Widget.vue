<script setup lang="ts">
/**
 * 仪表组件（plan §8.11 `value.gauge`）。
 *
 * 270° / 180° 圆弧、分区上色、刻度与指针；显示值超过 `min`–`max` 时钳制在端点。
 * 指针角度同时写入 `data-angle`，便于测试与调试（plan §11.3）。
 */

import { computed } from 'vue'

import { SERIES_COLORS } from '@/domains/dashboard/public'

import {
  asBoolean,
  asNumber,
  asVarRef,
  asZones,
  clampNumber,
  formatNumber,
  normalizeDecimals,
  resolveColor,
} from '../shared/format'
import type { WidgetComponentProps } from '../shared/types'
import { useSingleVariable } from '../shared/use-single-variable'
import WidgetEmpty from '../shared/WidgetEmpty.vue'

defineOptions({ name: 'GaugeValueWidget' })

const props = defineProps<WidgetComponentProps>()

const variable = useSingleVariable(() => asVarRef(props.props.variable), { last: 200 })

const min = computed(() => asNumber(props.props.min, 0))
const maxValue = computed(() => {
  const parsed = asNumber(props.props.max, 100)
  return parsed > min.value ? parsed : min.value + 1
})

const ratio = computed(() => {
  const value = variable.value.value
  if (value === undefined || !Number.isFinite(value)) return 0
  return clampNumber((value - min.value) / (maxValue.value - min.value), 0, 1)
})

const arcSpan = computed(() => (String(props.props.arc) === '180' ? 180 : 270))
const startAngle = computed(() => (arcSpan.value === 270 ? 135 : 180))
const needleAngle = computed(() => startAngle.value + ratio.value * arcSpan.value)

const decimals = computed(() =>
  normalizeDecimals(props.props.decimals, variable.meta.value.decimals),
)

const valueText = computed(() => formatNumber(variable.value.value, decimals.value))

const needleColor = computed(() =>
  resolveColor(
    props.props.needleColor,
    variable.meta.value.color.length > 0
      ? variable.meta.value.color
      : (SERIES_COLORS[0] ?? 'var(--accent)'),
  ),
)

const zones = computed(() =>
  asZones(props.props.zones).map((zone) => {
    const from = clampNumber((zone.from - min.value) / (maxValue.value - min.value), 0, 1)
    const to = clampNumber((zone.to - min.value) / (maxValue.value - min.value), 0, 1)
    return {
      fromRatio: Math.min(from, to),
      toRatio: Math.max(from, to),
      color: zone.color,
    }
  }),
)

function polar(angle: number, radius: number): { x: number; y: number } {
  const radians = (angle * Math.PI) / 180
  return { x: 100 + radius * Math.cos(radians), y: 100 + radius * Math.sin(radians) }
}

function arcPath(fromRatio: number, toRatio: number, radius: number): string {
  const from = polar(startAngle.value + fromRatio * arcSpan.value, radius)
  const to = polar(startAngle.value + toRatio * arcSpan.value, radius)
  const sweep = Math.abs(toRatio - fromRatio) * arcSpan.value
  const largeArc = sweep > 180 ? 1 : 0
  return `M ${from.x.toFixed(3)} ${from.y.toFixed(3)} A ${radius} ${radius} 0 ${largeArc} 1 ${to.x.toFixed(3)} ${to.y.toFixed(3)}`
}

const trackPath = computed(() => arcPath(0, 1, 82))

const needle = computed(() => polar(needleAngle.value, 64))

const tickLines = computed(() => {
  if (!asBoolean(props.props.showTicks, true)) return []
  const count = Math.max(2, Math.round(asNumber(props.props.ticks, 5)))
  const lines: Array<{ angle: number; x1: number; y1: number; x2: number; y2: number }> = []
  for (let index = 0; index <= count; index += 1) {
    const tickRatio = index / count
    const angle = startAngle.value + tickRatio * arcSpan.value
    const outer = polar(angle, 82)
    const inner = polar(angle, 73)
    lines.push({ angle, x1: outer.x, y1: outer.y, x2: inner.x, y2: inner.y })
  }
  return lines
})

const minLabel = computed(() => polar(startAngle.value, 96))
const maxLabel = computed(() => polar(startAngle.value + arcSpan.value, 96))

const unitText = computed(() => variable.meta.value.unit)
</script>

<template>
  <div
    class="value-gauge"
    :data-display-value="valueText"
    :data-angle="needleAngle.toFixed(1)"
    :data-ratio="ratio.toFixed(4)"
  >
    <WidgetEmpty v-if="variable.empty.value !== null" :text="variable.empty.value" />

    <div v-else class="value-gauge__body">
      <svg
        class="value-gauge__svg"
        viewBox="0 0 200 200"
        preserveAspectRatio="xMidYMid meet"
        role="img"
        :aria-label="`${variable.meta.value.label} ${valueText}${unitText ? ` ${unitText}` : ''}`"
      >
        <path
          class="value-gauge__track"
          :d="trackPath"
          fill="none"
          stroke="var(--bg-sunken)"
          stroke-width="10"
          stroke-linecap="round"
        />
        <path
          v-for="(zone, index) in zones"
          :key="index"
          class="value-gauge__zone"
          :d="arcPath(zone.fromRatio, zone.toRatio, 82)"
          fill="none"
          :stroke="zone.color"
          stroke-width="10"
          stroke-linecap="butt"
        />
        <line
          v-for="(tick, index) in tickLines"
          :key="`tick-${index}`"
          class="value-gauge__tick"
          :x1="tick.x1"
          :y1="tick.y1"
          :x2="tick.x2"
          :y2="tick.y2"
          stroke="var(--border-strong)"
          stroke-width="1.5"
        />
        <g class="value-gauge__needle" :transform="`rotate(${needleAngle} 100 100)`">
          <line
            x1="100"
            y1="100"
            :x2="needle.x"
            :y2="needle.y"
            :stroke="needleColor"
            stroke-width="3"
            stroke-linecap="round"
          />
          <circle cx="100" cy="100" r="5" :fill="needleColor" />
        </g>
        <text
          class="value-gauge__limit"
          :x="minLabel.x"
          :y="minLabel.y"
          text-anchor="middle"
          dominant-baseline="middle"
        >
          {{ formatNumber(min, 0) }}
        </text>
        <text
          class="value-gauge__limit"
          :x="maxLabel.x"
          :y="maxLabel.y"
          text-anchor="middle"
          dominant-baseline="middle"
        >
          {{ formatNumber(maxValue, 0) }}
        </text>
        <text
          class="value-gauge__value"
          x="100"
          y="150"
          text-anchor="middle"
          dominant-baseline="middle"
        >
          {{ valueText }}
        </text>
        <text
          v-if="unitText.length > 0"
          class="value-gauge__unit"
          x="100"
          y="168"
          text-anchor="middle"
          dominant-baseline="middle"
        >
          {{ unitText }}
        </text>
      </svg>
    </div>
  </div>
</template>

<style scoped>
.value-gauge {
  display: flex;
  align-items: stretch;
  justify-content: center;
  width: 100%;
  height: 100%;
  min-width: 0;
  min-height: 0;
  overflow: hidden;
}

.value-gauge__body {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 100%;
  height: 100%;
  min-width: 0;
  min-height: 0;
}

.value-gauge__svg {
  width: 100%;
  height: 100%;
  max-width: 100%;
  max-height: 100%;
}

.value-gauge__limit {
  fill: var(--text-faint);
  font-family: var(--font-mono);
  font-size: 10px;
}

.value-gauge__value {
  fill: var(--text);
  font-family: var(--font-mono);
  font-size: 22px;
  font-weight: 600;
}

.value-gauge__unit {
  fill: var(--text-dim);
  font-size: 10px;
}
</style>
