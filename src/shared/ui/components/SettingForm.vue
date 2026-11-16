<script setup lang="ts">
import { computed, ref } from 'vue'
import { ChevronRight } from 'lucide-vue-next'

import type { SettingField, SettingOption } from '../../contracts/settings'

import UiButton from './UiButton.vue'
import UiCheckbox from './UiCheckbox.vue'
import UiFormField from './UiFormField.vue'
import UiInput from './UiInput.vue'
import UiNumberInput from './UiNumberInput.vue'
import UiSelect from './UiSelect.vue'

const props = withDefaults(
  defineProps<{
    /** Ordered field descriptions (plan §6.5 `settingsSchema`). */
    fields?: SettingField[]
    /** Current values keyed by field key. */
    modelValue?: Record<string, unknown>
    advancedTitle?: string
    advancedDefaultOpen?: boolean
    disabled?: boolean
  }>(),
  {
    fields: () => [],
    modelValue: () => ({}),
    advancedTitle: '高级',
    advancedDefaultOpen: false,
    disabled: false,
  },
)

const emit = defineEmits<{
  'update:modelValue': [value: Record<string, unknown>]
  change: [key: string, value: unknown]
}>()

const advancedOpen = ref(props.advancedDefaultOpen)

const basicFields = computed(() => props.fields.filter((field) => !field.advanced))
const advancedFields = computed(() => props.fields.filter((field) => field.advanced))
const orderedFields = computed(() => [...basicFields.value, ...advancedFields.value])
const firstAdvancedIndex = computed(() =>
  advancedFields.value.length > 0 ? basicFields.value.length : -1,
)

function defaultValue(field: SettingField): unknown {
  switch (field.type) {
    case 'number':
      return field.default ?? field.min ?? 0
    case 'text':
      return field.default ?? ''
    case 'select':
      return field.default ?? field.options[0]?.value ?? ''
    default:
      return field.default ?? false
  }
}

function valueOf(field: SettingField): unknown {
  const value = props.modelValue[field.key]
  return value === undefined ? defaultValue(field) : value
}

function numberValue(field: SettingField): number | null {
  const value = valueOf(field)
  if (typeof value === 'number' && Number.isFinite(value)) return value
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : null
}

function textValue(field: SettingField): string {
  const value = valueOf(field)
  if (value === undefined || value === null) return ''
  return String(value)
}

function selectValue(field: SettingField): string | number | null {
  const value = valueOf(field)
  return typeof value === 'string' || typeof value === 'number' ? value : null
}

function booleanValue(field: SettingField): boolean {
  return Boolean(valueOf(field))
}

function selectOptions(field: SettingField): SettingOption[] {
  return field.type === 'select' ? field.options : []
}

function allowCustom(field: SettingField): boolean {
  return field.type === 'select' ? Boolean(field.allowCustom) : false
}

function numberBounds(field: SettingField): {
  min?: number
  max?: number
  step?: number
  unit?: string
} {
  if (field.type === 'number' || field.type === 'select') {
    return { min: field.min, max: field.max, step: field.step, unit: field.unit }
  }
  return {}
}

function maxLengthOf(field: SettingField): number | undefined {
  return field.type === 'text' ? field.maxLength : undefined
}

function hintFor(field: SettingField): string {
  if (field.hint) return field.hint
  if (field.type === 'number' && field.unit) return `单位：${field.unit}`
  return ''
}

function update(field: SettingField, value: unknown): void {
  const next: Record<string, unknown> = { ...props.modelValue, [field.key]: value }
  emit('update:modelValue', next)
  emit('change', field.key, value)
}
</script>

<template>
  <div class="setting-form">
    <template v-for="(field, index) in orderedFields" :key="field.key">
      <div
        v-if="index === firstAdvancedIndex && field.advanced"
        class="setting-form__advanced-head"
      >
        <UiButton
          size="sm"
          variant="ghost"
          :aria-expanded="advancedOpen"
          @click="advancedOpen = !advancedOpen"
        >
          <ChevronRight
            class="setting-form__chevron"
            :class="{ 'is-open': advancedOpen }"
            :size="14"
            aria-hidden="true"
          />
          <span>{{ advancedTitle }}</span>
        </UiButton>
      </div>
      <div
        v-show="!field.advanced || advancedOpen"
        class="setting-form__field"
        :data-testid="`setting-${field.key}`"
      >
        <UiFormField :label="field.label" :hint="hintFor(field)">
          <UiNumberInput
            v-if="field.type === 'number'"
            :model-value="numberValue(field)"
            v-bind="numberBounds(field)"
            :disabled="disabled"
            :aria-label="field.label"
            @update:model-value="update(field, $event)"
          />
          <UiSelect
            v-else-if="field.type === 'select'"
            :model-value="selectValue(field)"
            :options="selectOptions(field)"
            :allow-custom="allowCustom(field)"
            v-bind="numberBounds(field)"
            :disabled="disabled"
            :aria-label="field.label"
            @update:model-value="update(field, $event)"
          />
          <UiCheckbox
            v-else-if="field.type === 'checkbox'"
            :model-value="booleanValue(field)"
            :disabled="disabled"
            :aria-label="field.label"
            @update:model-value="update(field, $event)"
          />
          <UiInput
            v-else
            :model-value="textValue(field)"
            :maxlength="maxLengthOf(field)"
            :disabled="disabled"
            :aria-label="field.label"
            @update:model-value="update(field, $event)"
          />
        </UiFormField>
      </div>
    </template>
  </div>
</template>

<style scoped>
.setting-form {
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
  min-width: 0;
}

.setting-form__field {
  min-width: 0;
}

.setting-form__advanced-head {
  margin-top: 2px;
  border-top: 1px solid var(--border);
  padding-top: var(--space-2);
}

.setting-form__advanced-head :deep(.ui-button) {
  margin-left: -6px;
}

.setting-form__chevron {
  flex: none;
  transition: transform 140ms ease;
}

.setting-form__chevron.is-open {
  transform: rotate(90deg);
}
</style>
