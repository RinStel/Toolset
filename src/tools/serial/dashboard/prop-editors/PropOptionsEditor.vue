<script setup lang="ts">
/** options 属性编辑器：可增删、可排序的选项行（plan §8.10）。 */
import { computed } from 'vue'

import UiButton from '@/shared/ui/components/UiButton.vue'
import UiIconButton from '@/shared/ui/components/UiIconButton.vue'
import UiInput from '@/shared/ui/components/UiInput.vue'

import {
  asArray,
  asRecord,
  asString,
  type PropEditorContext,
  type PropEditorEmits,
  type PropFieldOf,
} from './types'

const props = defineProps<{
  field: PropFieldOf<'options'>
  value: unknown
  context: PropEditorContext
}>()

const emit = defineEmits<PropEditorEmits>()

interface OptionRow {
  label: string
  value: string | number
}

const rows = computed<OptionRow[]>(() =>
  asArray(props.value).map((item) => {
    const record = asRecord(item)
    const rawValue = record.value
    return {
      label: asString(record.label),
      value:
        typeof rawValue === 'number' || typeof rawValue === 'string'
          ? rawValue
          : asString(rawValue, ''),
    }
  }),
)

function commit(next: OptionRow[]): void {
  emit('update', next)
}

function addRow(): void {
  commit([...rows.value, { label: '选项', value: `option${rows.value.length + 1}` }])
}

function removeRow(index: number): void {
  commit(rows.value.filter((_, position) => position !== index))
}

function updateRow(index: number, patch: Partial<OptionRow>): void {
  commit(rows.value.map((row, position) => (position === index ? { ...row, ...patch } : row)))
}

function moveRow(index: number, delta: number): void {
  const target = index + delta
  if (target < 0 || target >= rows.value.length) return
  const next = [...rows.value]
  const [row] = next.splice(index, 1)
  if (!row) return
  next.splice(target, 0, row)
  commit(next)
}
</script>

<template>
  <div class="prop-options" :data-testid="`prop-options-${field.key}`">
    <div
      v-for="(row, index) in rows"
      :key="index"
      class="prop-options__row"
      :data-testid="`prop-options-row-${field.key}-${index}`"
    >
      <UiInput
        :model-value="row.label"
        size="sm"
        placeholder="显示名"
        aria-label="显示名"
        :data-testid="`prop-options-label-${field.key}-${index}`"
        @update:model-value="updateRow(index, { label: $event })"
      />
      <UiInput
        :model-value="String(row.value)"
        size="sm"
        placeholder="值"
        aria-label="值"
        :data-testid="`prop-options-value-${field.key}-${index}`"
        @update:model-value="updateRow(index, { value: $event })"
      />
      <div class="prop-options__actions">
        <UiIconButton label="上移" size="sm" :disabled="index === 0" @click="moveRow(index, -1)">
          ↑
        </UiIconButton>
        <UiIconButton
          label="下移"
          size="sm"
          :disabled="index === rows.length - 1"
          @click="moveRow(index, 1)"
        >
          ↓
        </UiIconButton>
        <UiIconButton label="删除" size="sm" variant="danger" @click="removeRow(index)">
          ×
        </UiIconButton>
      </div>
    </div>
    <UiButton
      size="sm"
      variant="ghost"
      :data-testid="`prop-options-add-${field.key}`"
      @click="addRow"
    >
      + 添加选项
    </UiButton>
  </div>
</template>

<style scoped>
.prop-options {
  display: flex;
  flex-direction: column;
  gap: 4px;
  min-width: 0;
}

.prop-options__row {
  display: flex;
  align-items: center;
  gap: 3px;
  min-width: 0;
}

.prop-options__row :deep(.ui-input) {
  flex: 1 1 0;
  min-width: 0;
}

.prop-options__actions {
  display: flex;
  align-items: center;
  gap: 0;
  flex: none;
}

.prop-options__actions :deep(.ui-icon-button) {
  width: 18px;
  height: 18px;
  font-size: 10px;
}
</style>
