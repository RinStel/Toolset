<script setup lang="ts">
/**
 * 按钮（plan §8.11 `ctrl.button`）。
 *
 * - 普通模式：点击（或回车 / 空格）发送 `command`，值取 `value`；
 * - `momentary`：按下发送 `command`，松开发送 `releaseCommand`（值 0）；
 * - `confirm`：发送前先确认（点动模式为保持手感不做确认）；
 * - 编辑模式 / 数据源未连接 / 未配置命令时禁用，悬停提示「数据源 <alias> 未连接」。
 */

import { computed, ref } from 'vue'

import { confirm } from '@/shared/ui/services/confirm'
import type { CommandSpec } from '@/domains/dashboard/public'

import { asBoolean, asNumberOrNull, asRecord, asString, resolveColor } from '../shared/format'
import type { WidgetComponentProps } from '../shared/types'
import {
  canSendCommand,
  sendCommandValue,
  sourceTooltipOf,
  useSendState,
} from '../shared/use-send-state'

defineOptions({ name: 'ButtonControlWidget' })

const props = defineProps<WidgetComponentProps>()

const send = useSendState()

/** 属性面板的 `command` 值可能是 `null`，这里做一次宽松解析。 */
function commandOf(value: unknown): CommandSpec | null {
  const record = asRecord(value)
  if (typeof record.kind !== 'string' || typeof record.source !== 'string') return null
  return record as unknown as CommandSpec
}

const command = computed(() => commandOf(props.props.command))
const releaseCommand = computed(() => commandOf(props.props.releaseCommand))

const label = computed(() => asString(props.props.label, '发送'))
const color = computed(() => resolveColor(props.props.color, 'var(--accent)'))

const momentary = computed(() => asBoolean(props.props.momentary, false))
const needConfirm = computed(() => asBoolean(props.props.confirm, false))

const value = computed(() => asNumberOrNull(props.props.value) ?? 1)

const disabled = computed(() => !canSendCommand(props.mode, props.ctx, command.value))

const tooltip = computed(() => {
  if (props.mode !== 'run') return undefined
  if (!command.value) return '未配置命令'
  return sourceTooltipOf(props.ctx, command.value)
})

const pressed = ref(false)

async function sendPrimary(): Promise<void> {
  if (disabled.value) return
  if (needConfirm.value && !momentary.value) {
    const accepted = await confirm({
      title: '确认发送',
      message: `是否发送「${label.value}」？`,
    })
    if (!accepted) return
  }
  const ok = await sendCommandValue(props.ctx, command.value, value.value)
  if (ok) send.markSent()
  else send.markFailed()
}

async function sendRelease(): Promise<void> {
  if (disabled.value) return
  const ok = await sendCommandValue(props.ctx, releaseCommand.value, 0)
  if (ok) send.markSent()
  else send.markFailed()
}

function onPointerDown(event: PointerEvent): void {
  if (disabled.value) return
  pressed.value = true
  if (momentary.value) {
    if (event.pointerId !== undefined && typeof event.currentTarget === 'object') {
      const target = event.currentTarget as HTMLElement | null
      target?.setPointerCapture?.(event.pointerId)
    }
    void sendPrimary()
  }
}

function onPointerUp(): void {
  const wasPressed = pressed.value
  pressed.value = false
  if (!momentary.value) return
  if (!wasPressed) return
  void sendRelease()
}

function onClick(): void {
  if (momentary.value) return
  void sendPrimary()
}

function onKeyDown(event: KeyboardEvent): void {
  if (momentary.value || event.key !== ' ') return
  event.preventDefault()
  void sendPrimary()
}
</script>

<template>
  <div
    class="ctrl-button"
    :class="{ 'is-readonly': mode === 'edit' }"
    :data-sent-count="send.sentCount.value"
    data-testid="ctrl-button"
  >
    <button
      class="ctrl-button__button"
      :class="[send.flashClass.value, { 'is-pressed': pressed }]"
      type="button"
      :disabled="disabled"
      :title="tooltip"
      :aria-pressed="momentary ? pressed : undefined"
      data-testid="ctrl-button-send"
      :style="{ '--button-color': color }"
      @pointerdown="onPointerDown"
      @pointerup="onPointerUp"
      @pointerleave="onPointerUp"
      @pointercancel="onPointerUp"
      @click="onClick"
      @keydown="onKeyDown"
    >
      {{ label }}
    </button>
  </div>
</template>

<style scoped>
.ctrl-button {
  display: flex;
  align-items: stretch;
  width: 100%;
  height: 100%;
  min-width: 0;
  min-height: 0;
}

.ctrl-button__button {
  flex: 1 1 auto;
  min-width: 0;
  padding: 2px 8px;
  overflow: hidden;
  border: 1px solid var(--button-color, var(--accent));
  border-radius: var(--radius-sm);
  background: color-mix(in srgb, var(--button-color, var(--accent)) 16%, var(--bg-elev-2));
  color: var(--text);
  font-family: var(--font-ui);
  font-size: 12px;
  font-weight: 500;
  text-overflow: ellipsis;
  white-space: nowrap;
  cursor: pointer;
  transition:
    background-color 120ms ease,
    box-shadow 120ms ease;
}

.ctrl-button__button:hover:not(:disabled) {
  background: color-mix(in srgb, var(--button-color, var(--accent)) 26%, var(--bg-elev-2));
}

.ctrl-button__button.is-pressed {
  background: color-mix(in srgb, var(--button-color, var(--accent)) 42%, var(--bg-elev-2));
}

.ctrl-button__button:disabled {
  border-color: var(--border);
  background: var(--bg-sunken);
  color: var(--text-faint);
  cursor: default;
}

.ctrl-button__button.is-flash-ok {
  box-shadow: 0 0 0 1px var(--ok);
  border-color: var(--ok);
}

.ctrl-button__button.is-flash-danger {
  box-shadow: 0 0 0 1px var(--danger);
  border-color: var(--danger);
}

.ctrl-button.is-readonly {
  pointer-events: none;
}
</style>
