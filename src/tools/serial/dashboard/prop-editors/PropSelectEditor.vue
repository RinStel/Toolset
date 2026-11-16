<script setup lang="ts">
/** select 属性编辑器（plan §8.10）。 */
import { computed } from 'vue'

import UiSelect from '@/shared/ui/components/UiSelect.vue'

import type { PropEditorContext, PropEditorEmits, PropFieldOf } from './types'

const props = defineProps<{
  field: PropFieldOf<'select'>
  value: unknown
  context: PropEditorContext
}>()

const emit = defineEmits<PropEditorEmits>()

const current = computed<string | number | null>(() => {
  if (typeof props.value === 'string' || typeof props.value === 'number') return props.value
  return props.field.default ?? null
})
</script>

<template>
  <UiSelect
    :model-value="current"
    :options="field.options"
    size="sm"
    :aria-label="field.label"
    :data-testid="`prop-input-${field.key}`"
    @update:model-value="emit('update', $event)"
  />
</template>
