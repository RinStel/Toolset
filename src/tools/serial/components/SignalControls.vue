<script setup lang="ts">
/**
 * DTR / RTS 三态控制与 Break（plan §8.2 / §8.9）。
 *
 * 传输层只能设置布尔值，无法「取消设置」，因此「未设置」只在尚未操作时显示，
 * 选中后不可再回到该状态。
 */

import { computed, onBeforeUnmount, ref } from 'vue'

import UiButton from '@/shared/ui/components/UiButton.vue'
import UiSegmented from '@/shared/ui/components/UiSegmented.vue'
import UiTooltip from '@/shared/ui/components/UiTooltip.vue'
import { toast } from '@/shared/ui/services/toast'

import { getSessionInstance, getSessionView } from '../stores/sessions'

const props = defineProps<{ sessionId: string | null }>()

/** Break 保持时间（plan §8.2）。 */
const BREAK_DURATION_MS = 250

const view = computed(() => getSessionView(props.sessionId))
const instance = computed(() => getSessionInstance(props.sessionId))
const capabilities = computed(() => instance.value?.transport.capabilities)
const signalsSupported = computed(() => capabilities.value?.signals === true)
const breakSupported = computed(() => capabilities.value?.break === true)
const isOpen = computed(() => view.value?.state === 'open')
const unsupportedReason = '该通道不支持控制线'

const lineOptions = [
  { label: '未设置', value: 'none' },
  { label: '高', value: 'high' },
  { label: '低', value: 'low' },
]

function stateToValue(value: boolean | null): string {
  if (value === null) return 'none'
  return value ? 'high' : 'low'
}

const dtrValue = computed(() => stateToValue(view.value?.signals.dtr ?? null))
const rtsValue = computed(() => stateToValue(view.value?.signals.rts ?? null))

function lineOptionsFor(current: string) {
  return lineOptions.map((option) => ({
    ...option,
    disabled: option.value === 'none' && current !== 'none',
  }))
}

async function applyLine(line: 'dtr' | 'rts', next: string | number): Promise<void> {
  if (next === 'none') return
  const session = instance.value
  if (!session || session.state !== 'open' || !signalsSupported.value) return
  const value = next === 'high'
  try {
    await session.setSignals({ [line]: value })
  } catch (error) {
    toast.show({ type: 'error', message: signalErrorMessage(error) })
  }
}

const breakActive = ref(false)
let breakTimer: ReturnType<typeof setTimeout> | undefined

function clearBreakTimer(): void {
  if (breakTimer === undefined) return
  clearTimeout(breakTimer)
  breakTimer = undefined
}

async function onBreak(): Promise<void> {
  const session = instance.value
  if (!session || session.state !== 'open' || !breakSupported.value || breakActive.value) return
  clearBreakTimer()
  breakActive.value = true
  try {
    await session.setSignals({ brk: true })
  } catch (error) {
    breakActive.value = false
    toast.show({ type: 'error', message: signalErrorMessage(error) })
    return
  }
  breakTimer = setTimeout(() => {
    breakTimer = undefined
    breakActive.value = false
    if (session.state === 'open') void session.setSignals({ brk: false }).catch(() => {})
  }, BREAK_DURATION_MS)
}

onBeforeUnmount(() => {
  clearBreakTimer()
  const session = instance.value
  if (session && breakActive.value && session.state === 'open') {
    void session.setSignals({ brk: false }).catch(() => {})
  }
})

function signalErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message.length > 0) return error.message
  return `设置控制线失败：${String(error)}`
}
</script>

<template>
  <div class="signal-controls">
    <div class="signal-controls__row">
      <span class="signal-controls__label">DTR</span>
      <UiTooltip v-if="!signalsSupported" :content="unsupportedReason">
        <UiSegmented
          :model-value="dtrValue"
          :options="lineOptionsFor(dtrValue)"
          size="sm"
          disabled
          aria-label="DTR"
          data-testid="signal-dtr"
        />
      </UiTooltip>
      <UiSegmented
        v-else
        :model-value="dtrValue"
        :options="lineOptionsFor(dtrValue)"
        size="sm"
        :disabled="!isOpen"
        aria-label="DTR"
        data-testid="signal-dtr"
        @update:model-value="applyLine('dtr', $event)"
      />
    </div>

    <div class="signal-controls__row">
      <span class="signal-controls__label">RTS</span>
      <UiTooltip v-if="!signalsSupported" :content="unsupportedReason">
        <UiSegmented
          :model-value="rtsValue"
          :options="lineOptionsFor(rtsValue)"
          size="sm"
          disabled
          aria-label="RTS"
          data-testid="signal-rts"
        />
      </UiTooltip>
      <UiSegmented
        v-else
        :model-value="rtsValue"
        :options="lineOptionsFor(rtsValue)"
        size="sm"
        :disabled="!isOpen"
        aria-label="RTS"
        data-testid="signal-rts"
        @update:model-value="applyLine('rts', $event)"
      />
    </div>

    <div class="signal-controls__row">
      <span class="signal-controls__label">Break</span>
      <UiTooltip v-if="!breakSupported" :content="unsupportedReason">
        <UiButton size="sm" disabled data-testid="signal-break">发送 Break</UiButton>
      </UiTooltip>
      <UiButton
        v-else
        size="sm"
        data-testid="signal-break"
        :disabled="!isOpen || breakActive"
        :loading="breakActive"
        @click="onBreak"
      >
        发送 Break
      </UiButton>
    </div>
  </div>
</template>

<style scoped>
.signal-controls {
  display: flex;
  flex-direction: column;
  gap: 6px;
  min-width: 0;
}

.signal-controls__row {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
}

.signal-controls__label {
  flex: 0 0 34px;
  color: var(--text-faint);
  font-family: var(--font-mono);
  font-size: 10px;
  letter-spacing: 0.06em;
}

.signal-controls__row :deep(.ui-segmented) {
  flex: 1 1 auto;
  min-width: 0;
}

.signal-controls__row :deep(.ui-tooltip) {
  flex: 1 1 auto;
  min-width: 0;
}

.signal-controls__row :deep(.ui-segmented__item) {
  flex: 1 1 0;
  padding: 0 3px;
}
</style>
