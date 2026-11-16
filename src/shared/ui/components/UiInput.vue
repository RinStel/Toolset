<script setup lang="ts">
withDefaults(
  defineProps<{
    modelValue?: string
    type?: 'text' | 'password' | 'search' | 'email' | 'url'
    placeholder?: string
    disabled?: boolean
    readonly?: boolean
    maxlength?: number
    /** Renders the value in the monospace font (hex/text payloads). */
    monospace?: boolean
    /** Marks the control as invalid for assistive technology. */
    invalid?: boolean
    size?: 'sm' | 'md'
    ariaLabel?: string
  }>(),
  {
    modelValue: '',
    type: 'text',
    placeholder: '',
    disabled: false,
    readonly: false,
    maxlength: undefined,
    monospace: false,
    invalid: false,
    size: 'md',
    ariaLabel: undefined,
  },
)

const emit = defineEmits<{
  'update:modelValue': [value: string]
  change: [value: string]
  enter: [event: KeyboardEvent]
  focus: [event: FocusEvent]
  blur: [event: FocusEvent]
}>()

function onInput(event: Event): void {
  emit('update:modelValue', (event.target as HTMLInputElement).value)
}

function onChange(event: Event): void {
  emit('change', (event.target as HTMLInputElement).value)
}

function onEnter(event: KeyboardEvent): void {
  emit('enter', event)
}

function onFocus(event: FocusEvent): void {
  emit('focus', event)
}

function onBlur(event: FocusEvent): void {
  emit('blur', event)
}
</script>

<template>
  <input
    class="ui-input"
    :class="[`ui-input--${size}`, { 'ui-input--mono': monospace, 'is-invalid': invalid }]"
    :type="type"
    :value="modelValue"
    :placeholder="placeholder"
    :disabled="disabled"
    :readonly="readonly"
    :maxlength="maxlength"
    :aria-label="ariaLabel"
    :aria-invalid="invalid || undefined"
    autocomplete="off"
    spellcheck="false"
    @input="onInput"
    @change="onChange"
    @keydown.enter="onEnter"
    @focus="onFocus"
    @blur="onBlur"
  />
</template>

<style scoped>
.ui-input {
  width: 100%;
  min-width: 0;
  height: var(--control-h);
  padding: 0 10px;
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  background: var(--bg-sunken);
  color: var(--text);
  font-family: var(--font-ui);
  font-size: 12.5px;
  transition:
    border-color 120ms ease,
    background-color 120ms ease,
    box-shadow 120ms ease;
}

.ui-input::placeholder {
  color: var(--text-faint);
}

.ui-input:hover:not(:disabled) {
  border-color: var(--border-strong);
}

.ui-input:focus {
  border-color: var(--accent);
}

.ui-input:focus-visible {
  outline: none;
  box-shadow: var(--focus-ring);
}

.ui-input:disabled {
  opacity: 0.38;
  cursor: not-allowed;
}

.ui-input--sm {
  height: var(--control-h-sm);
  padding: 0 8px;
  font-size: 12px;
}

.ui-input--mono {
  font-family: var(--font-mono);
}

.ui-input.is-invalid {
  border-color: var(--danger);
}

.ui-input.is-invalid:focus-visible {
  box-shadow: 0 0 0 2px var(--danger-soft);
}
</style>
