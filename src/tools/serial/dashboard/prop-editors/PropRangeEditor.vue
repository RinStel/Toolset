<script setup lang="ts">
/** range 属性编辑器：min/max 各带「自动」复选框（plan §8.10）。 */
import { computed } from 'vue'

import UiCheckbox from '@/shared/ui/components/UiCheckbox.vue'
import UiNumberInput from '@/shared/ui/components/UiNumberInput.vue'

import { asRecord, type PropEditorContext, type PropEditorEmits, type PropFieldOf } from './types'

const props = defineProps<{
  field: PropFieldOf<'range'>
  value: unknown
  context: PropEditorContext
}>()

const emit = defineEmits<PropEditorEmits>()

interface RangeValue {
  min: number | null
  max: number | null
}

const current = computed<RangeValue>(() => {
  const fallback = props.field.default ?? { min: null, max: null }
  const record = asRecord(props.value)
  const min = record.min === undefined ? fallback.min : (record.min as number | null)
  const max = record.max === undefined ? fallback.max : (record.max as number | null)
  return {
    min: typeof min === 'number' && Number.isFinite(min) ? min : null,
    max: typeof max === 'number' && Number.isFinite(max) ? max : null,
  }
})

function update(patch: Partial<RangeValue>): void {
  emit('update', { ...current.value, ...patch })
}
</script>

<template>
  <div class="prop-range">
    <div class="prop-range__row">
      <UiNumberInput
        :model-value="current.min"
        :disabled="current.min === null"
        :placeholder="current.min === null ? '自动' : ''"
        size="sm"
        :aria-label="`${field.label}最小值`"
        :data-testid="`prop-range-min-${field.key}`"
        @update:model-value="update({ min: $event })"
      />
      <UiCheckbox
        :model-value="current.min === null"
        label="自动"
        size="sm"
        :data-testid="`prop-range-auto-min-${field.key}`"
        @update:model-value="update({ min: $event ? null : 0 })"
      />
    </div>
    <div class="prop-range__row">
      <UiNumberInput
        :model-value="current.max"
        :disabled="current.max === null"
        :placeholder="current.max === null ? '自动' : ''"
        size="sm"
        :aria-label="`${field.label}最大值`"
        :data-testid="`prop-range-max-${field.key}`"
        @update:model-value="update({ max: $event })"
      />
      <UiCheckbox
        :model-value="current.max === null"
        label="自动"
        size="sm"
        :data-testid="`prop-range-auto-max-${field.key}`"
        @update:model-value="update({ max: $event ? null : 100 })"
      />
    </div>
  </div>
</template>

<style scoped>
.prop-range {
  display: flex;
  flex-direction: column;
  gap: 4px;
  min-width: 0;
}

.prop-range__row {
  display: flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
}

.prop-range__row :deep(.ui-number-input) {
  flex: 1 1 auto;
  min-width: 0;
}
</style>
