<script setup lang="ts">
import { computed, ref, watch } from 'vue'

import UiButton from './UiButton.vue'

const HEX_COLOR = /^#[0-9a-f]{6}$/
const SHORT_HEX_COLOR = /^#[0-9a-f]{3}$/

const props = withDefaults(
  defineProps<{
    /** Hex colour string, e.g. `#8fb8c9`. */
    modelValue?: string
    /** Enables the "恢复默认" button when provided. */
    defaultValue?: string
    allowDefault?: boolean
    disabled?: boolean
    ariaLabel?: string
  }>(),
  {
    modelValue: '#000000',
    defaultValue: undefined,
    allowDefault: false,
    disabled: false,
    ariaLabel: '颜色',
  },
)

const emit = defineEmits<{
  'update:modelValue': [value: string]
  change: [value: string]
}>()

const draft = ref(props.modelValue)

watch(
  () => props.modelValue,
  (value) => {
    if (normalizeHex(value) !== normalizeHex(draft.value)) draft.value = value
  },
)

const colorValue = computed(() => normalizeHex(props.modelValue) ?? '#000000')

const canReset = computed(() => {
  if (!props.allowDefault) return false
  const fallback = normalizeHex(props.defaultValue ?? '')
  return fallback !== null && fallback !== normalizeHex(props.modelValue)
})

function normalizeHex(input: string): string | null {
  const trimmed = input.trim().toLowerCase()
  if (trimmed === '') return null
  const value = trimmed.startsWith('#') ? trimmed : `#${trimmed}`
  if (HEX_COLOR.test(value)) return value
  if (!SHORT_HEX_COLOR.test(value)) return null
  const red = value[1] ?? ''
  const green = value[2] ?? ''
  const blue = value[3] ?? ''
  return `#${red}${red}${green}${green}${blue}${blue}`
}

function commit(value: string): void {
  const normalized = normalizeHex(value)
  if (!normalized) return
  draft.value = normalized
  emit('update:modelValue', normalized)
  emit('change', normalized)
}

function onNativeInput(event: Event): void {
  commit((event.target as HTMLInputElement).value)
}

function onTextInput(event: Event): void {
  draft.value = (event.target as HTMLInputElement).value
}

function onTextCommit(): void {
  const normalized = normalizeHex(draft.value)
  if (normalized) {
    commit(normalized)
    return
  }
  draft.value = props.modelValue
}

function reset(): void {
  const fallback = normalizeHex(props.defaultValue ?? '')
  if (!fallback) return
  commit(fallback)
  draft.value = fallback
}
</script>

<template>
  <div class="ui-color-input" :class="{ 'is-disabled': disabled }">
    <label class="ui-color-input__swatch" :style="{ background: colorValue }">
      <input
        class="ui-color-input__native"
        type="color"
        :value="colorValue"
        :disabled="disabled"
        :aria-label="ariaLabel"
        @input="onNativeInput"
      />
    </label>
    <input
      class="ui-color-input__text"
      type="text"
      :value="draft"
      :disabled="disabled"
      :aria-label="`${ariaLabel}（十六进制）`"
      spellcheck="false"
      autocomplete="off"
      @input="onTextInput"
      @blur="onTextCommit"
      @keydown.enter="onTextCommit"
    />
    <UiButton v-if="canReset" size="sm" variant="ghost" :disabled="disabled" @click="reset">
      恢复默认
    </UiButton>
  </div>
</template>

<style scoped>
.ui-color-input {
  display: inline-flex;
  align-items: center;
  gap: var(--space-2);
  width: 100%;
  min-width: 0;
}

.ui-color-input.is-disabled {
  opacity: 0.38;
}

.ui-color-input__swatch {
  position: relative;
  flex: none;
  width: var(--control-h);
  height: var(--control-h);
  border: 1px solid var(--border-strong);
  border-radius: var(--radius-sm);
  overflow: hidden;
  cursor: pointer;
}

.ui-color-input__swatch:focus-within {
  box-shadow: var(--focus-ring);
}

.ui-color-input__native {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  padding: 0;
  border: none;
  opacity: 0;
  cursor: pointer;
}

.ui-color-input__text {
  flex: 1 1 auto;
  min-width: 0;
  height: var(--control-h);
  padding: 0 10px;
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  background: var(--bg-sunken);
  color: var(--text);
  font-family: var(--font-mono);
  font-size: 12px;
  text-transform: lowercase;
}

.ui-color-input__text:hover {
  border-color: var(--border-strong);
}

.ui-color-input__text:focus {
  border-color: var(--accent);
}

.ui-color-input__text:focus-visible {
  outline: none;
  box-shadow: var(--focus-ring);
}
</style>
