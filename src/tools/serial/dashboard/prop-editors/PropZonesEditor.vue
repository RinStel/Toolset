<script setup lang="ts">
/** zones 属性编辑器：可增删、可排序的区间行（plan §8.10）。 */
import { computed } from 'vue'

import UiButton from '@/shared/ui/components/UiButton.vue'
import UiColorInput from '@/shared/ui/components/UiColorInput.vue'
import UiIconButton from '@/shared/ui/components/UiIconButton.vue'
import UiNumberInput from '@/shared/ui/components/UiNumberInput.vue'

import {
  asArray,
  asNumber,
  asRecord,
  asString,
  type PropEditorContext,
  type PropEditorEmits,
  type PropFieldOf,
} from './types'
import type { Zone } from '@/domains/dashboard/public'

const props = defineProps<{
  field: PropFieldOf<'zones'>
  value: unknown
  context: PropEditorContext
}>()

const emit = defineEmits<PropEditorEmits>()

const rows = computed<Zone[]>(() =>
  asArray(props.value).map((item) => {
    const record = asRecord(item)
    return {
      from: asNumber(record.from, 0),
      to: asNumber(record.to, 100),
      color: asString(record.color, '#d7a64a'),
    }
  }),
)

function commit(next: Zone[]): void {
  emit('update', next)
}

function addRow(): void {
  commit([...rows.value, { from: 0, to: 100, color: '#d7a64a' }])
}

function removeRow(index: number): void {
  commit(rows.value.filter((_, position) => position !== index))
}

function updateRow(index: number, patch: Partial<Zone>): void {
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
  <div class="prop-zones" :data-testid="`prop-zones-${field.key}`">
    <div
      v-for="(row, index) in rows"
      :key="index"
      class="prop-zones__row"
      :data-testid="`prop-zone-row-${field.key}-${index}`"
    >
      <UiNumberInput
        :model-value="row.from"
        size="sm"
        aria-label="起点"
        :data-testid="`prop-zones-from-${field.key}-${index}`"
        @update:model-value="updateRow(index, { from: $event ?? 0 })"
      />
      <span class="prop-zones__dash" aria-hidden="true">–</span>
      <UiNumberInput
        :model-value="row.to"
        size="sm"
        aria-label="终点"
        :data-testid="`prop-zones-to-${field.key}-${index}`"
        @update:model-value="updateRow(index, { to: $event ?? 0 })"
      />
      <UiColorInput
        :model-value="row.color"
        aria-label="区间颜色"
        :data-testid="`prop-zones-color-${field.key}-${index}`"
        @update:model-value="updateRow(index, { color: $event })"
      />
      <div class="prop-zones__actions">
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
      :data-testid="`prop-zones-add-${field.key}`"
      @click="addRow"
    >
      + 添加区间
    </UiButton>
  </div>
</template>

<style scoped>
.prop-zones {
  display: flex;
  flex-direction: column;
  gap: 4px;
  min-width: 0;
}

.prop-zones__row {
  display: grid;
  grid-template-columns: 54px 8px 54px minmax(0, 1fr);
  align-items: center;
  gap: 3px;
  min-width: 0;
}

.prop-zones__dash {
  color: var(--text-faint);
  font-size: 10px;
  text-align: center;
}

.prop-zones__actions {
  display: flex;
  align-items: center;
  gap: 0;
  grid-column: 1 / span 4;
  justify-content: flex-end;
}

.prop-zones__actions :deep(.ui-icon-button) {
  width: 18px;
  height: 18px;
  font-size: 10px;
}
</style>
