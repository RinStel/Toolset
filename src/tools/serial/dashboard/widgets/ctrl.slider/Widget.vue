<script setup lang="ts">
/**
 * 滑块（plan §8.11 `ctrl.slider`）。
 *
 * - `sendMode = release`：松开时发送（原生 range 的 `change` 事件）；
 * - `sendMode = throttle`：拖动时节流发送（首个事件立即发送，之后每 `throttleMs` 最多一次）；
 * - `feedbackVar`：滑块跟随变量的显示值，用户操作后 2 秒内不被反馈覆盖。
 *
 * 测试钩子（plan §11.3 / §11.4）：根元素 `data-sent-count`，当前值 `data-value`。
 */

import { computed, onScopeDispose, ref, watch } from 'vue'

import type { CommandSpec } from '@/domains/dashboard/public'

import {
  asBoolean,
  asNumber,
  asRecord,
  asString,
  asVarRef,
  clampNumber,
  formatNumber,
  normalizeDecimals,
} from '../shared/format'
import type { WidgetComponentProps } from '../shared/types'
import { useSingleVariable } from '../shared/use-single-variable'
import {
  canSendCommand,
  sendCommandValue,
  sourceTooltipOf,
  useSendState,
} from '../shared/use-send-state'

defineOptions({ name: 'SliderControlWidget' })

const props = defineProps<WidgetComponentProps>()

const send = useSendState()

function commandOf(value: unknown): CommandSpec | null {
  const record = asRecord(value)
  if (typeof record.kind !== 'string' || typeof record.source !== 'string') return null
  return record as unknown as CommandSpec
}

const command = computed(() => commandOf(props.props.command))

const min = computed(() => asNumber(props.props.min, 0))
const maxValue = computed(() => {
  const parsed = asNumber(props.props.max, 100)
  return parsed > min.value ? parsed : min.value + 1
})
const step = computed(() => {
  const parsed = asNumber(props.props.step, 1)
  return parsed > 0 ? parsed : 1
})

const decimals = computed(() => normalizeDecimals(props.props.decimals, 0))
const showValue = computed(() => asBoolean(props.props.showValue, true))
const orientation = computed(() =>
  asString(props.props.orientation) === 'vertical' ? 'vertical' : 'horizontal',
)

const sendMode = computed(() =>
  asString(props.props.sendMode) === 'throttle' ? 'throttle' : 'release',
)
const throttleMs = computed(() =>
  Math.round(clampNumber(asNumber(props.props.throttleMs, 100), 20, 2000)),
)

const disabled = computed(() => !canSendCommand(props.mode, props.ctx, command.value))
const tooltip = computed(() => {
  if (props.mode !== 'run') return undefined
  if (!command.value) return '未配置命令'
  return sourceTooltipOf(props.ctx, command.value)
})

/* ------------------------------------------------------------------------- */
/* 反馈变量与 2 秒保护期                                                       */
/* ------------------------------------------------------------------------- */

const FEEDBACK_PROTECT_MS = 2000

const feedbackRef = computed(() => asVarRef(props.props.feedbackVar))
const feedback = useSingleVariable(() => feedbackRef.value, { last: 1 })

const localValue = ref(min.value)
const protectedUntil = ref(0)
let protectTimer: ReturnType<typeof setTimeout> | null = null
let lastSentAt = 0
let trailingTimer: ReturnType<typeof setTimeout> | null = null

function applyFeedback(): void {
  if (feedbackRef.value === null) return
  const value = feedback.value.value
  if (value === undefined || !Number.isFinite(value)) return
  if (Date.now() < protectedUntil.value) return
  localValue.value = clampNumber(value, min.value, maxValue.value)
}

function beginProtection(): void {
  protectedUntil.value = Date.now() + FEEDBACK_PROTECT_MS
  if (protectTimer !== null) clearTimeout(protectTimer)
  protectTimer = setTimeout(() => {
    protectTimer = null
    protectedUntil.value = 0
    applyFeedback()
  }, FEEDBACK_PROTECT_MS)
}

watch(() => feedback.value.value, applyFeedback, { immediate: true })

onScopeDispose(() => {
  if (protectTimer !== null) clearTimeout(protectTimer)
  protectTimer = null
  if (trailingTimer !== null) clearTimeout(trailingTimer)
  trailingTimer = null
})

/* ------------------------------------------------------------------------- */
/* 发送                                                                        */
/* ------------------------------------------------------------------------- */

async function sendCurrent(): Promise<void> {
  if (disabled.value) return
  const ok = await sendCommandValue(props.ctx, command.value, localValue.value)
  if (ok) send.markSent()
  else send.markFailed()
}

function cancelTrailing(): void {
  if (trailingTimer === null) return
  clearTimeout(trailingTimer)
  trailingTimer = null
}

function scheduleThrottledSend(): void {
  const now = Date.now()
  const wait = throttleMs.value - (now - lastSentAt)
  if (wait <= 0) {
    lastSentAt = now
    void sendCurrent()
    return
  }
  if (trailingTimer !== null) return
  trailingTimer = setTimeout(() => {
    trailingTimer = null
    lastSentAt = Date.now()
    void sendCurrent()
  }, wait)
}

function inputValueOf(event: Event): number {
  const target = event.target
  if (target instanceof HTMLInputElement) return Number(target.value)
  return Number((target as HTMLInputElement | null)?.value ?? localValue.value)
}

function onInput(event: Event): void {
  const parsed = inputValueOf(event)
  if (!Number.isFinite(parsed)) return
  localValue.value = clampNumber(parsed, min.value, maxValue.value)
  beginProtection()
  if (disabled.value) return
  if (sendMode.value === 'throttle') scheduleThrottledSend()
}

function onChange(event: Event): void {
  const parsed = inputValueOf(event)
  if (Number.isFinite(parsed)) {
    localValue.value = clampNumber(parsed, min.value, maxValue.value)
  }
  beginProtection()
  if (disabled.value) return
  cancelTrailing()
  lastSentAt = Date.now()
  void sendCurrent()
}
</script>

<template>
  <div
    class="ctrl-slider"
    :class="[{ 'is-readonly': mode === 'edit' }, `is-${orientation}`]"
    :data-sent-count="send.sentCount.value"
    :data-value="localValue"
    data-testid="ctrl-slider"
  >
    <div class="ctrl-slider__track-wrap" :class="send.flashClass.value">
      <input
        class="ctrl-slider__input"
        type="range"
        :min="min"
        :max="maxValue"
        :step="step"
        :value="localValue"
        :disabled="disabled"
        :title="tooltip"
        :aria-label="`滑块 ${min}–${maxValue}`"
        data-testid="ctrl-slider-input"
        @input="onInput"
        @change="onChange"
      />
    </div>
    <span v-if="showValue" class="ctrl-slider__value" data-testid="ctrl-slider-value">
      {{ formatNumber(localValue, decimals) }}
    </span>
  </div>
</template>

<style scoped>
.ctrl-slider {
  display: flex;
  align-items: center;
  gap: 6px;
  width: 100%;
  height: 100%;
  min-width: 0;
  min-height: 0;
  padding: 0 2px;
}

.ctrl-slider.is-vertical {
  flex-direction: column;
  align-items: center;
  justify-content: center;
}

.ctrl-slider__track-wrap {
  position: relative;
  display: flex;
  flex: 1 1 auto;
  align-items: center;
  min-width: 0;
  min-height: 0;
  border-radius: var(--radius-sm);
  transition: box-shadow 120ms ease;
}

.ctrl-slider.is-vertical .ctrl-slider__track-wrap {
  width: 100%;
  height: 100%;
  justify-content: center;
}

.ctrl-slider__track-wrap.is-flash-ok {
  box-shadow: 0 0 0 1px var(--ok);
}

.ctrl-slider__track-wrap.is-flash-danger {
  box-shadow: 0 0 0 1px var(--danger);
}

.ctrl-slider__input {
  flex: 1 1 auto;
  width: 100%;
  min-width: 0;
  height: 18px;
  margin: 0;
  accent-color: var(--accent);
  background: transparent;
  cursor: pointer;
}

.ctrl-slider.is-vertical .ctrl-slider__input {
  width: 18px;
  height: 100%;
  writing-mode: vertical-lr;
  direction: rtl;
}

.ctrl-slider__input:disabled {
  cursor: default;
  opacity: 0.5;
}

.ctrl-slider__input:focus-visible {
  outline: none;
  box-shadow: var(--focus-ring);
}

.ctrl-slider__value {
  flex: none;
  min-width: 34px;
  color: var(--text);
  font-family: var(--font-mono);
  font-size: 11px;
  text-align: right;
  white-space: nowrap;
}

.ctrl-slider.is-vertical .ctrl-slider__value {
  min-width: 0;
  text-align: center;
}

.ctrl-slider.is-readonly {
  pointer-events: none;
}
</style>
