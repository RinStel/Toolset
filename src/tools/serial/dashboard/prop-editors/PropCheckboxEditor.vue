<script setup lang="ts">
/** checkbox 属性编辑器（plan §8.10）。 */
import { computed } from 'vue'

import UiCheckbox from '@/shared/ui/components/UiCheckbox.vue'

import type { PropEditorContext, PropEditorEmits, PropFieldOf } from './types'

const props = defineProps<{
  field: PropFieldOf<'checkbox'>
  value: unknown
  context: PropEditorContext
}>()

const emit = defineEmits<PropEditorEmits>()

const current = computed(() =>
  typeof props.value === 'boolean' ? props.value : (props.field.default ?? false),
)
</script>

<template>
  <UiCheckbox
    :model-value="current"
    size="sm"
    :aria-label="field.label"
    :data-testid="`prop-input-${field.key}`"
    @update:model-value="emit('update', $event)"
  />
</template>
