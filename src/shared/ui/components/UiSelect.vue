<script lang="ts">
export interface SelectOption {
  label: string
  value: string | number
  disabled?: boolean
}
</script>

<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { ChevronDown } from 'lucide-vue-next'

import UiNumberInput from './UiNumberInput.vue'

const CUSTOM_VALUE = '__custom__'

const props = withDefaults(
  defineProps<{
    modelValue?: string | number | null
    options?: SelectOption[]
    /** Adds a "自定义…" entry that reveals a numeric input. */
    allowCustom?: boolean
    min?: number
    max?: number
    step?: number
    unit?: string
    placeholder?: string
    disabled?: boolean
    size?: 'sm' | 'md'
    ariaLabel?: string
  }>(),
  {
    modelValue: null,
    options: () => [],
    allowCustom: false,
    min: undefined,
    max: undefined,
    step: undefined,
    unit: undefined,
    placeholder: '',
    disabled: false,
    size: 'md',
    ariaLabel: undefined,
  },
)

const emit = defineEmits<{
  'update:modelValue': [value: string | number | null]
  change: [value: string | number | null]
}>()

const customMode = ref(false)
const customValue = ref<number | null>(null)

function findOption(value: string | number | null): SelectOption | undefined {
  if (value === null) return undefined
  return props.options.find((option) => String(option.value) === String(value))
}

watch(
  () => props.modelValue,
  (value) => {
    const option = findOption(value)
    if (option) {
      customMode.value = false
      return
    }
    if (props.allowCustom && typeof value === 'number' && Number.isFinite(value)) {
      customMode.value = true
      customValue.value = value
    }
  },
  { immediate: true },
)

const selectedValue = computed(() => {
  if (customMode.value) return CUSTOM_VALUE
  if (props.modelValue === null || props.modelValue === undefined) return ''
  return String(props.modelValue)
})

function onSelectChange(event: Event): void {
  const raw = (event.target as HTMLSelectElement).value
  if (raw === CUSTOM_VALUE) {
    customMode.value = true
    if (typeof props.modelValue === 'number' && Number.isFinite(props.modelValue)) {
      customValue.value = props.modelValue
    } else {
      const initial = props.min ?? 0
      customValue.value = initial
      emit('update:modelValue', initial)
      emit('change', initial)
    }
    return
  }
  customMode.value = false
  const option = props.options.find((candidate) => String(candidate.value) === raw)
  const value = option ? option.value : null
  emit('update:modelValue', value)
  emit('change', value)
}

function onCustomInput(value: number | null): void {
  customValue.value = value
  emit('update:modelValue', value)
}
</script>

<template>
  <div
    class="ui-select"
    :class="[`ui-select--${size}`, { 'is-disabled': disabled, 'has-custom': customMode }]"
  >
    <div class="ui-select__control">
      <select
        class="ui-select__native"
        :value="selectedValue"
        :disabled="disabled"
        :aria-label="ariaLabel"
        @change="onSelectChange"
      >
        <option v-if="placeholder" value="" disabled>{{ placeholder }}</option>
        <option
          v-for="option in options"
          :key="String(option.value)"
          :value="String(option.value)"
          :disabled="option.disabled"
        >
          {{ option.label }}
        </option>
        <option v-if="allowCustom" :value="CUSTOM_VALUE">自定义…</option>
      </select>
      <ChevronDown class="ui-select__arrow" :size="14" aria-hidden="true" />
    </div>
    <UiNumberInput
      v-if="customMode"
      class="ui-select__custom"
      :model-value="customValue"
      :min="min"
      :max="max"
      :step="step"
      :unit="unit"
      size="sm"
      aria-label="自定义数值"
      @update:model-value="onCustomInput"
    />
  </div>
</template>

<style scoped>
.ui-select {
  display: inline-flex;
  align-items: center;
  gap: var(--space-1);
  width: 100%;
  min-width: 0;
}

.ui-select__control {
  position: relative;
  display: inline-flex;
  align-items: center;
  flex: 1 1 auto;
  min-width: 0;
}

.ui-select__native {
  width: 100%;
  height: var(--control-h);
  padding: 0 32px 0 10px;
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  background: var(--bg-sunken);
  color: var(--text);
  font-family: var(--font-ui);
  font-size: 12.5px;
  appearance: none;
  cursor: pointer;
  transition:
    border-color 120ms ease,
    box-shadow 120ms ease;
}

.ui-select--sm .ui-select__native {
  height: var(--control-h-sm);
  padding: 0 26px 0 8px;
  font-size: 12px;
}

.ui-select__native:hover:not(:disabled) {
  border-color: var(--border-strong);
}

.ui-select__native:focus {
  border-color: var(--accent);
}

.ui-select__native:focus-visible {
  outline: none;
  box-shadow: var(--focus-ring);
}

.ui-select__native:disabled {
  opacity: 0.38;
  cursor: not-allowed;
}

.ui-select__arrow {
  position: absolute;
  right: var(--space-2);
  color: var(--text-faint);
  pointer-events: none;
}

.ui-select__custom {
  flex: 0 0 auto;
  max-width: 140px;
}
</style>
