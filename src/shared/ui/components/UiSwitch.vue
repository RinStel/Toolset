<script setup lang="ts">
const props = withDefaults(
  defineProps<{
    modelValue?: boolean
    label?: string
    disabled?: boolean
    size?: 'sm' | 'md'
  }>(),
  {
    modelValue: false,
    label: '',
    disabled: false,
    size: 'md',
  },
)

const emit = defineEmits<{
  'update:modelValue': [value: boolean]
  change: [value: boolean]
}>()

function toggle(): void {
  if (props.disabled) return
  const next = !props.modelValue
  emit('update:modelValue', next)
  emit('change', next)
}
</script>

<template>
  <label
    class="ui-switch"
    :class="[`ui-switch--${size}`, { 'is-disabled': disabled, 'is-on': modelValue }]"
  >
    <button
      class="ui-switch__track"
      :class="{ 'is-on': modelValue }"
      type="button"
      role="switch"
      :aria-checked="modelValue"
      :disabled="disabled"
      @click="toggle"
    >
      <span class="ui-switch__thumb" />
    </button>
    <span v-if="label || $slots.default" class="ui-switch__label">
      <slot>{{ label }}</slot>
    </span>
  </label>
</template>

<style scoped>
/* The switch is rendered as a compact, square instrument chip. */
.ui-switch {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  height: var(--control-h-sm);
  padding: 0 10px;
  border: 1px solid transparent;
  border-radius: var(--radius-sm);
  background: transparent;
  color: var(--text-dim);
  font-size: 12px;
  line-height: 1;
  white-space: nowrap;
  cursor: pointer;
  user-select: none;
  transition:
    background-color 120ms ease,
    border-color 120ms ease,
    color 120ms ease;
}

.ui-switch--md {
  height: var(--control-h);
  font-size: 12.5px;
}

.ui-switch:hover:not(.is-disabled) {
  background: var(--bg-hover);
  color: var(--text);
}

.ui-switch.is-on {
  border-color: var(--accent);
  background: var(--accent-soft);
  color: var(--text);
}

.ui-switch.is-disabled {
  opacity: 0.38;
  cursor: not-allowed;
}

.ui-switch__track {
  position: relative;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex: none;
  width: 15px;
  height: 15px;
  padding: 0;
  border: 1px solid var(--border-strong);
  border-radius: 2px;
  background: var(--bg-sunken);
  transition:
    background-color 120ms ease,
    border-color 120ms ease;
}

.ui-switch--sm .ui-switch__track {
  width: 14px;
  height: 14px;
}

.ui-switch__track.is-on {
  border-color: var(--accent);
  background: var(--bg-sunken);
}

.ui-switch__track:focus-visible {
  outline: none;
  box-shadow: var(--focus-ring);
}

.ui-switch__track:disabled {
  cursor: not-allowed;
}

.ui-switch__thumb {
  display: block;
  width: 6px;
  height: 6px;
  border-radius: 1px;
  background: var(--text-faint);
  transition: background-color 120ms ease;
}

.ui-switch__track.is-on .ui-switch__thumb {
  background: var(--accent);
}

.ui-switch__label {
  line-height: 1;
}
</style>
