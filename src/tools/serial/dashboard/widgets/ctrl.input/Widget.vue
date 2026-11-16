<script setup lang="ts">
/**
 * 数值输入（plan §8.11 `ctrl.input`）。
 *
 * `sendOn = enter` 时回车或按钮发送（`button` 时仅按钮）；越界 / 非数字显示行内错误
 * 并且不发送。
 */

import { computed, ref } from 'vue'

import type { CommandSpec } from '@/domains/dashboard/public'

import {
  asNumber,
  asNumberOrNull,
  asRecord,
  asString,
  formatBySpec,
  normalizeDecimals,
} from '../shared/format'
import type { WidgetComponentProps } from '../shared/types'
import {
  canSendCommand,
  sendCommandValue,
  sourceTooltipOf,
  useSendState,
} from '../shared/use-send-state'

defineOptions({ name: 'InputControlWidget' })

const props = defineProps<WidgetComponentProps>()

const send = useSendState()

function commandOf(value: unknown): CommandSpec | null {
  const record = asRecord(value)
  if (typeof record.kind !== 'string' || typeof record.source !== 'string') return null
  return record as unknown as CommandSpec
}

const command = computed(() => commandOf(props.props.command))
const min = computed(() => asNumberOrNull(props.props.min))
const maxValue = computed(() => asNumberOrNull(props.props.max))
const step = computed(() => {
  const parsed = asNumber(props.props.step, 1)
  return parsed > 0 ? parsed : 1
})
const decimals = computed(() => normalizeDecimals(props.props.decimals, 2))
const sendOnEnter = computed(() => asString(props.props.sendOn, 'enter') !== 'button')

const disabled = computed(() => !canSendCommand(props.mode, props.ctx, command.value))
const tooltip = computed(() => {
  if (props.mode !== 'run') return undefined
  if (!command.value) return '未配置命令'
  return sourceTooltipOf(props.ctx, command.value)
})

const text = ref('')
const error = ref('')
const busy = ref(false)

function validate(value: number): string {
  if (!Number.isFinite(value)) return '请输入数字'
  if (min.value !== null && value < min.value) return `不能小于 ${formatBySpec(min.value, '')}`
  if (maxValue.value !== null && value > maxValue.value) {
    return `不能大于 ${formatBySpec(maxValue.value, '')}`
  }
  return ''
}

async function submit(): Promise<void> {
  if (disabled.value || busy.value) return
  const raw = text.value.trim()
  if (raw.length === 0) {
    error.value = '请输入数字'
    return
  }
  const parsed = Number(raw)
  const message = validate(parsed)
  error.value = message
  if (message.length > 0) return
  const normalized = Number(parsed.toFixed(decimals.value))
  busy.value = true
  try {
    const ok = await sendCommandValue(props.ctx, command.value, normalized)
    if (ok) send.markSent()
    else send.markFailed()
  } finally {
    busy.value = false
  }
}

function onKeyDown(event: KeyboardEvent): void {
  if (event.key !== 'Enter') return
  event.preventDefault()
  if (!sendOnEnter.value) return
  void submit()
}

function onStep(direction: 1 | -1): void {
  const current = Number(text.value.trim())
  const base = Number.isFinite(current) ? current : (min.value ?? 0)
  const next = base + direction * step.value
  const bounded =
    maxValue.value !== null && next > maxValue.value
      ? maxValue.value
      : min.value !== null && next < min.value
        ? min.value
        : next
  text.value = Number(bounded.toFixed(decimals.value)).toString()
  error.value = ''
}
</script>

<template>
  <div
    class="ctrl-input"
    :class="[{ 'is-readonly': mode === 'edit' }, send.flashClass.value]"
    :data-sent-count="send.sentCount.value"
    data-testid="ctrl-input"
  >
    <div class="ctrl-input__row">
      <button
        class="ctrl-input__step"
        type="button"
        :disabled="disabled"
        aria-label="减小"
        tabindex="-1"
        @click="onStep(-1)"
      >
        −
      </button>
      <input
        v-model="text"
        class="ctrl-input__field"
        :class="{ 'is-invalid': error.length > 0 }"
        type="text"
        inputmode="decimal"
        :disabled="disabled"
        :title="tooltip"
        :placeholder="error.length > 0 ? error : '数值'"
        :aria-label="'数值输入'"
        :aria-invalid="error.length > 0"
        data-testid="ctrl-input-field"
        @keydown="onKeyDown"
        @input="error = ''"
      />
      <button
        class="ctrl-input__step"
        type="button"
        :disabled="disabled"
        aria-label="增大"
        tabindex="-1"
        @click="onStep(1)"
      >
        +
      </button>
      <button
        class="ctrl-input__send"
        type="button"
        :disabled="disabled || busy"
        :title="tooltip"
        data-testid="ctrl-input-send"
        @click="submit"
      >
        发送
      </button>
    </div>
    <span
      v-if="error.length > 0"
      class="ctrl-input__error"
      role="alert"
      data-testid="ctrl-input-error"
    >
      {{ error }}
    </span>
  </div>
</template>

<style scoped>
.ctrl-input {
  display: flex;
  flex-direction: column;
  justify-content: center;
  gap: 2px;
  width: 100%;
  height: 100%;
  min-width: 0;
  min-height: 0;
  padding: 0 2px;
  border-radius: var(--radius-sm);
  transition: box-shadow 120ms ease;
}

.ctrl-input.is-flash-ok {
  box-shadow: 0 0 0 1px var(--ok);
}

.ctrl-input.is-flash-danger {
  box-shadow: 0 0 0 1px var(--danger);
}

.ctrl-input__row {
  display: flex;
  align-items: center;
  gap: 3px;
  min-width: 0;
}

.ctrl-input__field {
  flex: 1 1 auto;
  min-width: 0;
  height: var(--control-h-sm);
  padding: 0 5px;
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  background: var(--bg-sunken);
  color: var(--text);
  font-family: var(--font-mono);
  font-size: 11px;
}

.ctrl-input__field:disabled {
  opacity: 0.55;
  cursor: default;
}

.ctrl-input__field:focus-visible {
  outline: none;
  border-color: var(--accent);
  box-shadow: var(--focus-ring);
}

.ctrl-input__field.is-invalid {
  border-color: var(--danger);
  box-shadow: 0 0 0 1px var(--danger);
}

.ctrl-input__step {
  flex: none;
  width: 18px;
  height: var(--control-h-sm);
  padding: 0;
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  background: var(--bg-elev-2);
  color: var(--text-dim);
  font-size: 12px;
  line-height: 1;
  cursor: pointer;
}

.ctrl-input__step:disabled {
  opacity: 0.5;
  cursor: default;
}

.ctrl-input__send {
  flex: none;
  height: var(--control-h-sm);
  padding: 0 7px;
  border: 1px solid var(--accent);
  border-radius: var(--radius-sm);
  background: color-mix(in srgb, var(--accent) 18%, var(--bg-elev-2));
  color: var(--text);
  font-size: 11px;
  cursor: pointer;
}

.ctrl-input__send:disabled {
  border-color: var(--border);
  background: var(--bg-sunken);
  color: var(--text-faint);
  cursor: default;
}

.ctrl-input__error {
  overflow: hidden;
  color: var(--danger);
  font-size: 10px;
  line-height: 1.2;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.ctrl-input.is-readonly {
  pointer-events: none;
}
</style>
