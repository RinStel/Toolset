<script setup lang="ts">
/** text 属性编辑器（plan §8.10）。 */
import { computed } from 'vue'

import UiInput from '@/shared/ui/components/UiInput.vue'

import { asString, type PropEditorContext, type PropEditorEmits, type PropFieldOf } from './types'

const props = defineProps<{
  field: PropFieldOf<'text'>
  value: unknown
  context: PropEditorContext
}>()

const emit = defineEmits<PropEditorEmits>()

const current = computed(() => asString(props.value, props.field.default ?? ''))
</script>

<template>
  <UiInput
    :model-value="current"
    :maxlength="field.maxLength"
    :placeholder="field.placeholder"
    size="sm"
    :aria-label="field.label"
    :data-testid="`prop-input-${field.key}`"
    @update:model-value="emit('update', $event)"
  />
</template>
