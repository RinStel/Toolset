<script setup lang="ts">
import { ref, watch } from 'vue'

const props = withDefaults(
  defineProps<{
    modelValue?: number | null
    min?: number
    max?: number
    step?: number
    precision?: number
    /** Unit shown inside the control, e.g. `ms`. */
    unit?: string
    placeholder?: string
    disabled?: boolean
    size?: 'sm' | 'md'
    ariaLabel?: string
  }>(),
  {
    modelValue: null,
    min: undefined,
    max: undefined,
    step: 1,
    precision: undefined,
    unit: undefined,
    placeholder: '',
    disabled: false,
    size: 'md',
    ariaLabel: undefined,
  },
)

const emit = defineEmits<{
  'update:modelValue': [value: number | null]
  change: [value: number | null]
}>()

const draft = ref(toDraft(props.modelValue))

watch(
  () => props.modelValue,
  (value) => {
    if (parseValue(draft.value) !== value) draft.value = toDraft(value)
  },
)

function toDraft(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return ''
  return String(value)
}

function parseValue(text: string): number | null {
  const trimmed = text.trim()
  if (trimmed === '') return null
  const parsed = Number(trimmed)
  return Number.isFinite(parsed) ? parsed : null
}

function clamp(value: number): number {
  let result = value
  if (props.min !== undefined) result = Math.max(props.min, result)
  if (props.max !== undefined) result = Math.min(props.max, result)
  if (props.precision !== undefined) {
    const factor = 10 ** props.precision
    result = Math.round(result * factor) / factor
  }
  return result
}

function onInput(event: Event): void {
  draft.value = (event.target as HTMLInputElement).value
  const parsed = parseValue(draft.value)
  if (parsed !== null) emit('update:modelValue', parsed)
  else emit('update:modelValue', null)
}

function commit(): void {
  const parsed = parseValue(draft.value)
  const next = parsed === null ? null : clamp(parsed)
  draft.value = toDraft(next)
  if (next !== props.modelValue) emit('update:modelValue', next)
  emit('change', next)
}

function onKeydown(event: KeyboardEvent): void {
  if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') return
  event.preventDefault()
  const base = parseValue(draft.value) ?? props.min ?? 0
  const step = props.step ?? 1
  const direction = event.key === 'ArrowUp' ? 1 : -1
  const next = clamp(base + direction * step)
  draft.value = toDraft(next)
  emit('update:modelValue', next)
  emit('change', next)
}
</script>

<template>
  <div class="ui-number-input" :class="[`ui-number-input--${size}`, { 'is-disabled': disabled }]">
    <input
      class="ui-number-input__control"
      type="text"
      inputmode="decimal"
      :value="draft"
      :placeholder="placeholder"
      :disabled="disabled"
      :aria-label="ariaLabel"
      autocomplete="off"
      spellcheck="false"
      @input="onInput"
      @blur="commit"
      @keydown.enter="commit"
      @keydown="onKeydown"
    />
    <span v-if="unit" class="ui-number-input__unit">{{ unit }}</span>
  </div>
</template>

<style scoped>
.ui-number-input {
  display: inline-flex;
  align-items: center;
  width: 100%;
  min-width: 0;
  height: var(--control-h);
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  background: var(--bg-sunken);
  transition:
    border-color 120ms ease,
    box-shadow 120ms ease;
}

.ui-number-input:hover:not(.is-disabled) {
  border-color: var(--border-strong);
}

.ui-number-input:focus-within {
  border-color: var(--accent);
}

.ui-number-input:focus-within:has(.ui-number-input__control:focus-visible) {
  box-shadow: var(--focus-ring);
}

.ui-number-input--sm {
  height: var(--control-h-sm);
}

.ui-number-input.is-disabled {
  opacity: 0.38;
}

.ui-number-input__control {
  flex: 1 1 auto;
  min-width: 0;
  height: 100%;
  padding: 0 10px;
  border: none;
  background: transparent;
  color: var(--text);
  font-family: var(--font-mono);
  font-size: 12.5px;
}

.ui-number-input__control:focus-visible {
  outline: none;
  box-shadow: none;
}

.ui-number-input--sm .ui-number-input__control {
  padding: 0 8px;
  font-size: 12px;
}

.ui-number-input__unit {
  flex: none;
  padding-right: 10px;
  color: var(--text-faint);
  font-family: var(--font-mono);
  font-size: 11px;
  white-space: nowrap;
}
</style>
