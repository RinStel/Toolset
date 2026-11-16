<script setup lang="ts">
/**
 * 下拉选择（plan §8.11 `ctrl.select`）。
 *
 * 选中项的 value 作为 `{value}` 发送；`feedbackVar` 让下拉跟随变量显示值（用户操作后
 * 2 秒内不被覆盖）。
 */

import { computed, onScopeDispose, ref, watch } from 'vue'

import type { CommandSpec } from '@/domains/dashboard/public'

import { asOptions, asRecord, asVarRef } from '../shared/format'
import type { WidgetComponentProps } from '../shared/types'
import { useSingleVariable } from '../shared/use-single-variable'
import {
  canSendCommand,
  sendCommandValue,
  sourceTooltipOf,
  useSendState,
} from '../shared/use-send-state'

defineOptions({ name: 'SelectControlWidget' })

const props = defineProps<WidgetComponentProps>()

const send = useSendState()

function commandOf(value: unknown): CommandSpec | null {
  const record = asRecord(value)
  if (typeof record.kind !== 'string' || typeof record.source !== 'string') return null
  return record as unknown as CommandSpec
}

const command = computed(() => commandOf(props.props.command))
const options = computed(() => asOptions(props.props.options))

const feedbackRef = computed(() => asVarRef(props.props.feedbackVar))
const feedback = useSingleVariable(() => feedbackRef.value, { last: 1 })

const FEEDBACK_PROTECT_MS = 2000

const selectedIndex = ref(0)
const protectedUntil = ref(0)
let protectTimer: ReturnType<typeof setTimeout> | null = null

function beginProtection(): void {
  protectedUntil.value = Date.now() + FEEDBACK_PROTECT_MS
  if (protectTimer !== null) clearTimeout(protectTimer)
  protectTimer = setTimeout(() => {
    protectTimer = null
    protectedUntil.value = 0
    applyFeedback()
  }, FEEDBACK_PROTECT_MS)
}

function applyFeedback(): void {
  if (feedbackRef.value === null) return
  const value = feedback.value.value
  if (value === undefined || !Number.isFinite(value)) return
  if (Date.now() < protectedUntil.value) return
  const index = options.value.findIndex(
    (option) => Number(option.value) === value || String(option.value) === String(value),
  )
  if (index >= 0) selectedIndex.value = index
}

watch(() => feedback.value.value, applyFeedback, { immediate: true })

onScopeDispose(() => {
  if (protectTimer !== null) clearTimeout(protectTimer)
  protectTimer = null
})

const disabled = computed(() => {
  if (props.mode !== 'run') return true
  if (options.value.length === 0) return true
  if (!canSendCommand(props.mode, props.ctx, command.value)) return true
  return false
})

const tooltip = computed(() => {
  if (props.mode !== 'run') return undefined
  if (!command.value) return '未配置命令'
  return sourceTooltipOf(props.ctx, command.value)
})

const selectedValue = computed(() => options.value[selectedIndex.value]?.value ?? '')

async function onChange(event: Event): Promise<void> {
  const target = event.target
  const index = target instanceof HTMLSelectElement ? target.selectedIndex : 0
  selectedIndex.value = Math.max(0, Math.min(index, options.value.length - 1))
  beginProtection()
  if (disabled.value) return
  const ok = await sendCommandValue(props.ctx, command.value, selectedValue.value)
  if (ok) send.markSent()
  else send.markFailed()
}
</script>

<template>
  <div
    class="ctrl-select"
    :class="{ 'is-readonly': mode === 'edit' }"
    :data-sent-count="send.sentCount.value"
    data-testid="ctrl-select"
  >
    <select
      class="ctrl-select__field"
      :class="send.flashClass.value"
      :value="String(selectedValue)"
      :disabled="disabled"
      :title="tooltip"
      aria-label="下拉选择"
      data-testid="ctrl-select-field"
      @change="onChange"
    >
      <option v-if="options.length === 0" value="">未配置选项</option>
      <option v-for="(option, index) in options" :key="index" :value="String(option.value)">
        {{ option.label }}
      </option>
    </select>
  </div>
</template>

<style scoped>
.ctrl-select {
  display: flex;
  align-items: stretch;
  width: 100%;
  height: 100%;
  min-width: 0;
  min-height: 0;
}

.ctrl-select__field {
  flex: 1 1 auto;
  min-width: 0;
  height: 100%;
  padding: 0 6px;
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  background: var(--bg-sunken);
  color: var(--text);
  font-family: var(--font-ui);
  font-size: 11px;
  cursor: pointer;
}

.ctrl-select__field:focus-visible {
  outline: none;
  border-color: var(--accent);
  box-shadow: var(--focus-ring);
}

.ctrl-select__field:disabled {
  opacity: 0.55;
  cursor: default;
}

.ctrl-select__field.is-flash-ok {
  border-color: var(--ok);
  box-shadow: 0 0 0 1px var(--ok);
}

.ctrl-select__field.is-flash-danger {
  border-color: var(--danger);
  box-shadow: 0 0 0 1px var(--danger);
}

.ctrl-select.is-readonly {
  pointer-events: none;
}
</style>
