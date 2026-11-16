<script setup lang="ts">
/**
 * 指示灯（plan §8.11 `value.led`）。
 *
 * 条件（thresholds 类型）按顺序取第一个匹配项：匹配时用该条件的颜色点亮，并把条件
 * 的 label 显示在灯下；`blink` 打开时匹配状态下闪烁（`is-blink` 类）。
 */

import { computed } from 'vue'

import {
  asBoolean,
  asThresholds,
  asVarRef,
  firstMatchingThreshold,
  formatNumber,
  normalizeDecimals,
  resolveColor,
} from '../shared/format'
import type { WidgetComponentProps } from '../shared/types'
import { useSingleVariable } from '../shared/use-single-variable'
import WidgetEmpty from '../shared/WidgetEmpty.vue'

defineOptions({ name: 'LedValueWidget' })

const props = defineProps<WidgetComponentProps>()

const variable = useSingleVariable(() => asVarRef(props.props.variable), { last: 200 })

const conditions = computed(() => asThresholds(props.props.conditions))

const matched = computed(() => firstMatchingThreshold(variable.value.value, conditions.value))

const lit = computed(() => matched.value !== null)

const lampColor = computed(() =>
  matched.value
    ? resolveColor(matched.value.color, 'var(--ok)')
    : resolveColor(props.props.offColor, 'var(--border)'),
)

const blink = computed(() => asBoolean(props.props.blink, false))

const shape = computed(() => (String(props.props.shape) === 'square' ? 'square' : 'circle'))

const showLabel = computed(() => asBoolean(props.props.showLabel, true))

const displayText = computed(() =>
  formatNumber(variable.value.value, normalizeDecimals(undefined, variable.meta.value.decimals)),
)

const labelText = computed(() => matched.value?.label ?? variable.meta.value.label)
</script>

<template>
  <div class="value-led" :data-display-value="displayText" :data-lit="lit ? 'true' : 'false'">
    <WidgetEmpty v-if="variable.empty.value !== null" :text="variable.empty.value" />

    <div v-else class="value-led__body">
      <span
        class="value-led__lamp"
        :class="[`is-${shape}`, { 'is-lit': lit, 'is-blink': lit && blink }]"
        :style="{ '--lamp-color': lampColor }"
        :data-color="lampColor"
        :data-lit="lit ? 'true' : 'false'"
        data-testid="value-led-lamp"
        aria-hidden="true"
      />
      <span v-if="showLabel" class="value-led__label">{{ labelText }}</span>
    </div>
  </div>
</template>

<style scoped>
.value-led {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 100%;
  height: 100%;
  min-width: 0;
  min-height: 0;
  overflow: hidden;
}

.value-led__body {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 6px;
  min-width: 0;
  min-height: 0;
  padding: 4px;
}

.value-led__lamp {
  flex: none;
  width: clamp(14px, 34%, 46px);
  aspect-ratio: 1;
  border: 1px solid var(--border-strong);
  background: color-mix(in srgb, var(--lamp-color) 22%, transparent);
  transition:
    background-color 140ms ease,
    box-shadow 140ms ease;
}

.value-led__lamp.is-circle {
  border-radius: 50%;
}

.value-led__lamp.is-square {
  border-radius: var(--radius-sm);
}

.value-led__lamp.is-lit {
  border-color: var(--lamp-color);
  background: var(--lamp-color);
  box-shadow: 0 0 8px 1px color-mix(in srgb, var(--lamp-color) 55%, transparent);
}

.value-led__lamp.is-blink {
  animation: value-led-blink 1s steps(2, jump-none) infinite;
}

@keyframes value-led-blink {
  0% {
    opacity: 1;
  }

  100% {
    opacity: 0.25;
  }
}

.value-led__label {
  max-width: 100%;
  overflow: hidden;
  color: var(--text-dim);
  font-size: 11px;
  line-height: 1.3;
  text-align: center;
  text-overflow: ellipsis;
  white-space: nowrap;
}
</style>
