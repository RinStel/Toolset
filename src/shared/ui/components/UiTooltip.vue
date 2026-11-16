<script setup lang="ts">
import { onBeforeUnmount, ref } from 'vue'

const props = withDefaults(
  defineProps<{
    content: string
    placement?: 'top' | 'bottom' | 'left' | 'right'
    /** Delay before the tooltip appears, in milliseconds. */
    delay?: number
    disabled?: boolean
  }>(),
  {
    placement: 'top',
    delay: 300,
    disabled: false,
  },
)

const visible = ref(false)
let timer: ReturnType<typeof setTimeout> | undefined

function clearTimer(): void {
  if (timer === undefined) return
  clearTimeout(timer)
  timer = undefined
}

function show(): void {
  if (props.disabled) return
  clearTimer()
  if (props.delay <= 0) {
    visible.value = true
    return
  }
  timer = setTimeout(() => {
    visible.value = true
  }, props.delay)
}

function hide(): void {
  clearTimer()
  visible.value = false
}

function onKeydown(event: KeyboardEvent): void {
  if (event.key === 'Escape') hide()
}

onBeforeUnmount(clearTimer)
</script>

<template>
  <span
    class="ui-tooltip"
    :class="`ui-tooltip--${placement}`"
    @mouseenter="show"
    @mouseleave="hide"
    @focusin="show"
    @focusout="hide"
    @keydown="onKeydown"
  >
    <slot />
    <span v-if="visible" class="ui-tooltip__bubble" role="tooltip">{{ content }}</span>
  </span>
</template>

<style scoped>
.ui-tooltip {
  position: relative;
  display: inline-flex;
}

.ui-tooltip__bubble {
  position: absolute;
  z-index: 950;
  padding: 6px 10px;
  border: 1px solid var(--border-strong);
  border-radius: var(--radius-sm);
  background: var(--bg-sunken);
  color: var(--text);
  box-shadow: var(--shadow-pop);
  font-size: 12px;
  line-height: 1.4;
  white-space: nowrap;
  pointer-events: none;
}

.ui-tooltip--top .ui-tooltip__bubble {
  bottom: calc(100% + 6px);
  left: 50%;
  transform: translateX(-50%);
}

.ui-tooltip--bottom .ui-tooltip__bubble {
  top: calc(100% + 6px);
  left: 50%;
  transform: translateX(-50%);
}

.ui-tooltip--left .ui-tooltip__bubble {
  right: calc(100% + 6px);
  top: 50%;
  transform: translateY(-50%);
}

.ui-tooltip--right .ui-tooltip__bubble {
  left: calc(100% + 6px);
  top: 50%;
  transform: translateY(-50%);
}
</style>
