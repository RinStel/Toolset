<script setup lang="ts">
/**
 * 开关（plan §8.11 `ctrl.switch`）。
 *
 * 打开 / 关闭分别发送 `onCommand` / `offCommand`（`{value}` 1 / 0）。设置 `feedbackVar`
 * 后开关状态跟随该变量显示值 > 0，用户操作后 2 秒内不被反馈覆盖。
 */

import { computed, onScopeDispose, ref } from 'vue'

import type { CommandSpec } from '@/domains/dashboard/public'

import { asRecord, asString, asVarRef } from '../shared/format'
import type { WidgetComponentProps } from '../shared/types'
import { useSingleVariable } from '../shared/use-single-variable'
import { sendCommandValue, sourceTooltipOf, useSendState } from '../shared/use-send-state'

defineOptions({ name: 'SwitchControlWidget' })

const props = defineProps<WidgetComponentProps>()

const send = useSendState()

function commandOf(value: unknown): CommandSpec | null {
  const record = asRecord(value)
  if (typeof record.kind !== 'string' || typeof record.source !== 'string') return null
  return record as unknown as CommandSpec
}

const onCommand = computed(() => commandOf(props.props.onCommand))
const offCommand = computed(() => commandOf(props.props.offCommand))

const labelOn = computed(() => asString(props.props.labelOn, '开'))
const labelOff = computed(() => asString(props.props.labelOff, '关'))

const feedbackRef = computed(() => asVarRef(props.props.feedbackVar))
const feedback = useSingleVariable(() => feedbackRef.value, { last: 1 })
const hasFeedback = computed(() => feedbackRef.value !== null)

/** 用户操作后的本地状态；反馈变量在保护期内不覆盖它。 */
const localOn = ref(false)
/** 保护期截止时间（毫秒时间戳）。 */
const overrideUntil = ref(0)
/** 保护期到期的重算触发。 */
const overrideTick = ref(0)

const FEEDBACK_PROTECT_MS = 2000
let protectTimer: ReturnType<typeof setTimeout> | null = null

function protectFor(): void {
  overrideUntil.value = Date.now() + FEEDBACK_PROTECT_MS
  if (protectTimer !== null) clearTimeout(protectTimer)
  protectTimer = setTimeout(() => {
    overrideUntil.value = 0
    overrideTick.value += 1
    protectTimer = null
  }, FEEDBACK_PROTECT_MS)
}

onScopeDispose(() => {
  if (protectTimer !== null) clearTimeout(protectTimer)
  protectTimer = null
})

const isOn = computed(() => {
  void overrideTick.value
  if (!hasFeedback.value) return localOn.value
  if (Date.now() < overrideUntil.value) return localOn.value
  const value = feedback.value.value
  return value !== undefined && value > 0
})

const currentCommand = computed(() => (isOn.value ? offCommand.value : onCommand.value))

const sourceOpen = computed(() => {
  const command = currentCommand.value
  if (!command) return false
  return props.ctx.sourceState(command.source) === 'open'
})

const disabled = computed(
  () =>
    props.mode !== 'run' ||
    (onCommand.value === null && offCommand.value === null) ||
    !sourceOpen.value,
)

const tooltip = computed(() => {
  if (props.mode !== 'run') return undefined
  if (onCommand.value === null && offCommand.value === null) return '未配置命令'
  return sourceTooltipOf(props.ctx, currentCommand.value)
})

const activeColor = computed(() => 'var(--accent)')

async function toggle(): Promise<void> {
  if (disabled.value) return
  const next = !isOn.value
  localOn.value = next
  protectFor()
  const command = next ? onCommand.value : offCommand.value
  if (!command) return
  const ok = await sendCommandValue(props.ctx, command, next ? 1 : 0)
  if (ok) send.markSent()
  else send.markFailed()
}
</script>

<template>
  <div
    class="ctrl-switch"
    :class="{ 'is-readonly': mode === 'edit' }"
    :data-sent-count="send.sentCount.value"
    data-testid="ctrl-switch"
  >
    <button
      class="ctrl-switch__button"
      :class="[send.flashClass.value, { 'is-on': isOn }]"
      type="button"
      role="switch"
      :aria-checked="isOn"
      :disabled="disabled"
      :title="tooltip"
      data-testid="ctrl-switch-toggle"
      :style="{ '--switch-color': activeColor }"
      @click="toggle"
    >
      <span class="ctrl-switch__track" aria-hidden="true">
        <span class="ctrl-switch__knob" />
      </span>
      <span class="ctrl-switch__label">{{ isOn ? labelOn : labelOff }}</span>
    </button>
  </div>
</template>

<style scoped>
.ctrl-switch {
  display: flex;
  align-items: stretch;
  width: 100%;
  height: 100%;
  min-width: 0;
  min-height: 0;
}

.ctrl-switch__button {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  flex: 1 1 auto;
  min-width: 0;
  padding: 2px 8px;
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  background: var(--bg-sunken);
  color: var(--text-dim);
  font-family: var(--font-ui);
  font-size: 12px;
  cursor: pointer;
  transition:
    border-color 120ms ease,
    color 120ms ease;
}

.ctrl-switch__button:hover:not(:disabled) {
  border-color: var(--border-strong);
  color: var(--text);
}

.ctrl-switch__button.is-on {
  border-color: var(--switch-color, var(--accent));
  color: var(--text);
  background: color-mix(in srgb, var(--switch-color, var(--accent)) 14%, var(--bg-sunken));
}

.ctrl-switch__button:disabled {
  cursor: default;
  opacity: 0.55;
}

.ctrl-switch__button.is-flash-ok {
  border-color: var(--ok);
  box-shadow: 0 0 0 1px var(--ok);
}

.ctrl-switch__button.is-flash-danger {
  border-color: var(--danger);
  box-shadow: 0 0 0 1px var(--danger);
}

.ctrl-switch__track {
  position: relative;
  flex: none;
  width: 24px;
  height: 13px;
  border-radius: 999px;
  background: var(--bg-active);
  transition: background-color 140ms ease;
}

.ctrl-switch__button.is-on .ctrl-switch__track {
  background: var(--switch-color, var(--accent));
}

.ctrl-switch__knob {
  position: absolute;
  top: 1px;
  left: 1px;
  width: 11px;
  height: 11px;
  border-radius: 50%;
  background: var(--bg-elev-2);
  box-shadow: 0 1px 2px rgba(0, 0, 0, 0.35);
  transition: transform 140ms ease;
}

.ctrl-switch__button.is-on .ctrl-switch__knob {
  transform: translateX(11px);
}

.ctrl-switch__label {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.ctrl-switch.is-readonly {
  pointer-events: none;
}
</style>
