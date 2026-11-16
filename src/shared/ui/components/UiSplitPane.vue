<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue'

const props = withDefaults(
  defineProps<{
    /** Share of the first pane; emitted as `update:ratio`. */
    ratio?: number
    /** `horizontal` stacks panes side by side, `vertical` stacks them top/bottom. */
    direction?: 'horizontal' | 'vertical'
    min?: number
    max?: number
    /** Ratio change applied by the arrow keys. */
    keyboardStep?: number
    disabled?: boolean
  }>(),
  {
    ratio: 0.5,
    direction: 'vertical',
    min: 0.2,
    max: 0.8,
    keyboardStep: 0.02,
    disabled: false,
  },
)

const emit = defineEmits<{
  'update:ratio': [value: number]
  'resize-start': []
  'resize-end': []
}>()

const rootRef = ref<HTMLElement | null>(null)
const dragging = ref(false)
const liveRatio = ref(clampRatio(props.ratio))

const isHorizontal = computed(() => props.direction === 'horizontal')

const firstStyle = computed(() => {
  const percent = `${clampRatio(liveRatio.value) * 100}%`
  return isHorizontal.value ? { width: percent } : { height: percent }
})

watch(
  () => props.ratio,
  (value) => {
    if (dragging.value) return
    liveRatio.value = clampRatio(value)
  },
)

function clampRatio(value: number): number {
  if (!Number.isFinite(value)) return props.min
  return Math.min(props.max, Math.max(props.min, value))
}

function setRatio(value: number): void {
  const next = clampRatio(value)
  liveRatio.value = next
  emit('update:ratio', next)
}

function onPointerDown(event: PointerEvent): void {
  if (props.disabled) return
  event.preventDefault()
  dragging.value = true
  const divider = event.currentTarget as HTMLElement
  if (typeof divider.setPointerCapture === 'function') {
    divider.setPointerCapture(event.pointerId)
  }
  window.addEventListener('pointermove', onPointerMove)
  window.addEventListener('pointerup', endDrag)
  window.addEventListener('pointercancel', endDrag)
  emit('resize-start')
}

function onPointerMove(event: PointerEvent): void {
  const root = rootRef.value
  if (!root || !dragging.value) return
  const rect = root.getBoundingClientRect()
  const next = isHorizontal.value
    ? (event.clientX - rect.left) / (rect.width || 1)
    : (event.clientY - rect.top) / (rect.height || 1)
  setRatio(next)
}

function endDrag(): void {
  if (!dragging.value) return
  dragging.value = false
  window.removeEventListener('pointermove', onPointerMove)
  window.removeEventListener('pointerup', endDrag)
  window.removeEventListener('pointercancel', endDrag)
  emit('resize-end')
}

function onDividerKeydown(event: KeyboardEvent): void {
  if (props.disabled) return
  const keys = ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End']
  if (!keys.includes(event.key)) return
  event.preventDefault()
  let next = liveRatio.value
  if (event.key === 'Home') next = props.min
  else if (event.key === 'End') next = props.max
  else if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') next -= props.keyboardStep
  else next += props.keyboardStep
  setRatio(next)
}

function reset(): void {
  if (props.disabled) return
  setRatio(0.5)
}

onBeforeUnmount(() => {
  endDrag()
})
</script>

<template>
  <div
    ref="rootRef"
    class="ui-split-pane"
    :class="[`ui-split-pane--${direction}`, { 'is-dragging': dragging, 'is-disabled': disabled }]"
  >
    <div class="ui-split-pane__pane" :style="firstStyle">
      <slot name="first" />
    </div>
    <div
      class="ui-split-pane__divider"
      role="separator"
      :aria-orientation="isHorizontal ? 'vertical' : 'horizontal'"
      :aria-valuenow="Math.round(liveRatio * 100)"
      :aria-disabled="disabled || undefined"
      :tabindex="disabled ? -1 : 0"
      @pointerdown="onPointerDown"
      @keydown="onDividerKeydown"
      @dblclick="reset"
    />
    <div class="ui-split-pane__pane">
      <slot name="second" />
    </div>
  </div>
</template>

<style scoped>
.ui-split-pane {
  display: flex;
  width: 100%;
  height: 100%;
  min-width: 0;
  min-height: 0;
}

.ui-split-pane--horizontal {
  flex-direction: row;
}

.ui-split-pane--vertical {
  flex-direction: column;
}

.ui-split-pane__pane {
  position: relative;
  display: flex;
  flex-direction: column;
  flex: 1 1 0;
  min-width: 0;
  min-height: 0;
  overflow: hidden;
}

.ui-split-pane__pane:first-child {
  flex: none;
}

.ui-split-pane__divider {
  position: relative;
  flex: none;
  background: var(--border);
  transition: background-color 120ms ease;
}

.ui-split-pane__divider::after {
  content: '';
  position: absolute;
  inset: -3px;
}

.ui-split-pane__divider:hover,
.ui-split-pane__divider:focus-visible {
  background: var(--accent);
  outline: none;
}

.ui-split-pane--horizontal > .ui-split-pane__divider {
  width: 3px;
  cursor: col-resize;
}

.ui-split-pane--vertical > .ui-split-pane__divider {
  height: 3px;
  cursor: row-resize;
}

.ui-split-pane.is-dragging .ui-split-pane__divider {
  background: var(--accent);
}

.ui-split-pane.is-dragging {
  user-select: none;
  cursor: grabbing;
}

.ui-split-pane.is-disabled .ui-split-pane__divider {
  cursor: default;
}

.ui-split-pane.is-disabled .ui-split-pane__divider:hover {
  background: var(--border);
}
</style>
