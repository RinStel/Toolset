<script setup lang="ts">
/** number 属性编辑器（plan §8.10）。 */
import { computed } from 'vue'

import UiNumberInput from '@/shared/ui/components/UiNumberInput.vue'

import { asNumber, type PropEditorContext, type PropEditorEmits, type PropFieldOf } from './types'

const props = defineProps<{
  field: PropFieldOf<'number'>
  value: unknown
  context: PropEditorContext
}>()

const emit = defineEmits<PropEditorEmits>()

const current = computed<number | null>(() => {
  if (typeof props.value === 'number' && Number.isFinite(props.value)) return props.value
  return props.field.default ?? null
})
</script>

<template>
  <UiNumberInput
    :model-value="current"
    :min="field.min"
    :max="field.max"
    :step="field.step ?? 1"
    :unit="field.unit"
    size="sm"
    :aria-label="field.label"
    :data-testid="`prop-input-${field.key}`"
    @update:model-value="emit('update', $event === null ? asNumber(field.default, 0) : $event)"
  />
</template>
