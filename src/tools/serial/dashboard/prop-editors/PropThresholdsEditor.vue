<script setup lang="ts">
/** thresholds 属性编辑器：可增删、可排序的阈值行（plan §8.10）。 */
import { computed } from 'vue'

import UiButton from '@/shared/ui/components/UiButton.vue'
import UiColorInput from '@/shared/ui/components/UiColorInput.vue'
import UiIconButton from '@/shared/ui/components/UiIconButton.vue'
import UiInput from '@/shared/ui/components/UiInput.vue'
import UiNumberInput from '@/shared/ui/components/UiNumberInput.vue'
import UiSelect from '@/shared/ui/components/UiSelect.vue'

import {
  asArray,
  asNumber,
  asRecord,
  asString,
  type PropEditorContext,
  type PropEditorEmits,
  type PropFieldOf,
} from './types'
import type { Threshold } from '@/domains/dashboard/public'

const props = defineProps<{
  field: PropFieldOf<'thresholds'>
  value: unknown
  context: PropEditorContext
}>()

const emit = defineEmits<PropEditorEmits>()

const OP_OPTIONS = [
  { label: '>', value: '>' },
  { label: '≥', value: '>=' },
  { label: '<', value: '<' },
  { label: '≤', value: '<=' },
  { label: '=', value: '==' },
  { label: '≠', value: '!=' },
]

const rows = computed<Threshold[]>(() =>
  asArray(props.value).map((item) => {
    const record = asRecord(item)
    return {
      op: (['>', '>=', '<', '<=', '==', '!='] as const).includes(
        asString(record.op) as Threshold['op'],
      )
        ? (asString(record.op) as Threshold['op'])
        : '>',
      value: asNumber(record.value, 0),
      color: asString(record.color, '#3b82f6'),
      ...(typeof record.label === 'string' ? { label: record.label } : {}),
    }
  }),
)

function commit(next: Threshold[]): void {
  emit('update', next)
}

function addRow(): void {
  commit([...rows.value, { op: '>', value: 0, color: '#3b82f6' }])
}

function removeRow(index: number): void {
  commit(rows.value.filter((_, position) => position !== index))
}

function updateRow(index: number, patch: Partial<Threshold>): void {
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
  <div class="prop-thresholds" :data-testid="`prop-thresholds-${field.key}`">
    <div
      v-for="(row, index) in rows"
      :key="index"
      class="prop-thresholds__row"
      :data-testid="`prop-threshold-row-${field.key}-${index}`"
    >
      <UiSelect
        :model-value="row.op"
        :options="OP_OPTIONS"
        size="sm"
        aria-label="比较符"
        :data-testid="`prop-thresholds-op-${field.key}-${index}`"
        @update:model-value="updateRow(index, { op: $event as Threshold['op'] })"
      />
      <UiNumberInput
        :model-value="row.value"
        size="sm"
        aria-label="阈值"
        :data-testid="`prop-thresholds-value-${field.key}-${index}`"
        @update:model-value="updateRow(index, { value: $event ?? 0 })"
      />
      <UiColorInput
        :model-value="row.color"
        aria-label="阈值颜色"
        :data-testid="`prop-thresholds-color-${field.key}-${index}`"
        @update:model-value="updateRow(index, { color: $event })"
      />
      <UiInput
        :model-value="row.label ?? ''"
        size="sm"
        placeholder="标签"
        aria-label="标签"
        :data-testid="`prop-thresholds-label-${field.key}-${index}`"
        @update:model-value="updateRow(index, { label: $event })"
      />
      <div class="prop-thresholds__actions">
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
      :data-testid="`prop-thresholds-add-${field.key}`"
      @click="addRow"
    >
      + 添加阈值
    </UiButton>
  </div>
</template>

<style scoped>
.prop-thresholds {
  display: flex;
  flex-direction: column;
  gap: 4px;
  min-width: 0;
}

.prop-thresholds__row {
  display: grid;
  grid-template-columns: 46px 64px minmax(0, 1fr);
  align-items: center;
  gap: 4px;
  min-width: 0;
}

.prop-thresholds__row > :nth-child(4) {
  grid-column: 1 / span 2;
}

.prop-thresholds__actions {
  display: flex;
  align-items: center;
  gap: 0;
  min-width: 0;
}

.prop-thresholds__actions :deep(.ui-icon-button) {
  width: 18px;
  height: 18px;
  font-size: 10px;
}
</style>
