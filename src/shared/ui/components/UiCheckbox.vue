<script setup lang="ts">
import { Check, Minus } from 'lucide-vue-next'

withDefaults(
  defineProps<{
    modelValue?: boolean
    label?: string
    disabled?: boolean
    indeterminate?: boolean
    size?: 'sm' | 'md'
  }>(),
  {
    modelValue: false,
    label: '',
    disabled: false,
    indeterminate: false,
    size: 'md',
  },
)

const emit = defineEmits<{
  'update:modelValue': [value: boolean]
  change: [value: boolean]
}>()

function onChange(event: Event): void {
  const checked = (event.target as HTMLInputElement).checked
  emit('update:modelValue', checked)
  emit('change', checked)
}
</script>

<template>
  <label class="ui-checkbox" :class="[`ui-checkbox--${size}`, { 'is-disabled': disabled }]">
    <input
      class="ui-checkbox__input"
      type="checkbox"
      :checked="modelValue"
      :disabled="disabled"
      @change="onChange"
    />
    <span class="ui-checkbox__box" aria-hidden="true">
      <Minus v-if="indeterminate && !modelValue" :size="12" />
      <Check v-else-if="modelValue" :size="12" />
    </span>
    <span v-if="label || $slots.default" class="ui-checkbox__label">
      <slot>{{ label }}</slot>
    </span>
  </label>
</template>

<style scoped>
.ui-checkbox {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  min-height: var(--control-h-sm);
  color: var(--text-dim);
  font-size: 12.5px;
  cursor: pointer;
  user-select: none;
}

.ui-checkbox--md {
  min-height: var(--control-h);
  font-size: 12.5px;
}

.ui-checkbox--sm {
  min-height: var(--control-h-sm);
  font-size: 12px;
}

.ui-checkbox:hover:not(.is-disabled) {
  color: var(--text);
}

.ui-checkbox.is-disabled {
  opacity: 0.38;
  cursor: not-allowed;
}

.ui-checkbox__input {
  position: absolute;
  width: 1px;
  height: 1px;
  margin: -1px;
  padding: 0;
  overflow: hidden;
  clip-path: inset(50%);
  white-space: nowrap;
  border: 0;
}

.ui-checkbox__box {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex: none;
  width: 16px;
  height: 16px;
  border: 1px solid var(--border-strong);
  border-radius: 2px;
  background: var(--bg-sunken);
  color: var(--on-accent);
  transition:
    background-color 120ms ease,
    border-color 120ms ease;
}

.ui-checkbox:hover:not(.is-disabled) .ui-checkbox__box {
  border-color: var(--accent);
}

.ui-checkbox__input:checked + .ui-checkbox__box,
.ui-checkbox__input:indeterminate + .ui-checkbox__box {
  border-color: var(--accent);
  background: var(--accent);
}

.ui-checkbox__input:focus-visible + .ui-checkbox__box {
  box-shadow: var(--focus-ring);
}

.ui-checkbox__label {
  line-height: 1.4;
}
</style>
