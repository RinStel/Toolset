<script lang="ts">
export interface SegmentOption {
  label: string
  value: string | number
  disabled?: boolean
  title?: string
}
</script>

<script setup lang="ts">
const props = withDefaults(
  defineProps<{
    modelValue?: string | number | null
    options?: SegmentOption[]
    size?: 'sm' | 'md'
    ariaLabel?: string
    disabled?: boolean
  }>(),
  {
    modelValue: null,
    options: () => [],
    size: 'md',
    ariaLabel: undefined,
    disabled: false,
  },
)

const emit = defineEmits<{
  'update:modelValue': [value: string | number]
  change: [value: string | number]
}>()

function select(option: SegmentOption): void {
  if (props.disabled || option.disabled) return
  if (option.value === props.modelValue) return
  emit('update:modelValue', option.value)
  emit('change', option.value)
}

function onKeydown(event: KeyboardEvent): void {
  const keys = ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End']
  if (!keys.includes(event.key)) return
  event.preventDefault()
  const buttons = Array.from(
    (event.currentTarget as HTMLElement).querySelectorAll<HTMLButtonElement>('[data-segment]'),
  )
  const enabled = buttons.filter((button) => !button.disabled)
  if (enabled.length === 0) return
  const activeIndex = enabled.findIndex((button) => button.getAttribute('data-active') === 'true')
  let nextIndex: number
  if (event.key === 'Home') nextIndex = 0
  else if (event.key === 'End') nextIndex = enabled.length - 1
  else if (event.key === 'ArrowRight' || event.key === 'ArrowDown') {
    nextIndex = activeIndex < 0 ? 0 : (activeIndex + 1) % enabled.length
  } else {
    nextIndex =
      activeIndex < 0 ? enabled.length - 1 : (activeIndex - 1 + enabled.length) % enabled.length
  }
  const target = enabled[nextIndex]
  if (!target) return
  target.focus()
  target.click()
}
</script>

<template>
  <div
    class="ui-segmented"
    :class="[`ui-segmented--${size}`, { 'is-disabled': disabled }]"
    role="radiogroup"
    :aria-label="ariaLabel"
    @keydown="onKeydown"
  >
    <button
      v-for="option in options"
      :key="String(option.value)"
      class="ui-segmented__item"
      :class="{ 'is-active': option.value === modelValue }"
      type="button"
      role="radio"
      :aria-checked="option.value === modelValue"
      :data-active="option.value === modelValue ? 'true' : 'false'"
      data-segment
      :title="option.title"
      :disabled="disabled || option.disabled"
      @click="select(option)"
    >
      {{ option.label }}
    </button>
  </div>
</template>

<style scoped>
.ui-segmented {
  display: inline-flex;
  align-items: stretch;
  gap: 2px;
  padding: 2px;
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  background: var(--bg-sunken);
  box-shadow: var(--panel-highlight);
}

.ui-segmented.is-disabled {
  opacity: 0.38;
}

.ui-segmented__item {
  height: calc(var(--control-h) - 6px);
  padding: 0 10px;
  border: 1px solid transparent;
  border-radius: 2px;
  background: transparent;
  color: var(--text-dim);
  font-size: 12.5px;
  line-height: 1;
  white-space: nowrap;
  transition:
    background-color 120ms ease,
    color 120ms ease,
    border-color 120ms ease;
}

.ui-segmented--sm .ui-segmented__item {
  height: calc(var(--control-h-sm) - 6px);
  padding: 0 8px;
  font-size: 12px;
}

.ui-segmented__item:hover:not(:disabled) {
  color: var(--text);
}

.ui-segmented__item:active:not(:disabled) {
  background: var(--bg-active);
}

.ui-segmented__item:focus-visible {
  outline: none;
  box-shadow: var(--focus-ring);
}

.ui-segmented__item.is-active {
  border-color: var(--border-strong);
  background: var(--bg-elev-2);
  color: var(--accent);
  box-shadow: 0 1px 2px rgba(0, 0, 0, 0.18);
}

.ui-segmented__item:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
</style>
