<script setup lang="ts">
/**
 * variable 属性编辑器：数据源下拉 + 变量下拉 + 当前值，并接受从变量列表拖入的变量
 * （plan §8.10）。
 */
import { computed, ref } from 'vue'

import type { VarRef } from '@/domains/dashboard/public'

import {
  asVarRef,
  formatDisplayValue,
  sourceOptions,
  variablesOf,
  type PropEditorContext,
  type PropEditorEmits,
  type PropFieldOf,
} from './types'

const props = defineProps<{
  field: PropFieldOf<'variable'>
  value: unknown
  context: PropEditorContext
}>()

const emit = defineEmits<PropEditorEmits>()

const dragging = ref(false)

const current = computed<VarRef | null>(() => asVarRef(props.value) ?? props.field.default ?? null)

const sources = computed(() => sourceOptions(props.context))

const currentSource = computed(() => current.value?.source ?? sources.value[0]?.value ?? 'main')

const variables = computed(() => variablesOf(props.context, currentSource.value))

const displayValue = computed(() => formatDisplayValue(props.context, current.value))

function onSourceChange(value: string | number | null): void {
  if (typeof value !== 'string') return
  const first = variablesOf(props.context, value)[0]
  emit('update', first ? { source: value, key: first.key } : { source: value, key: '' })
}

function onKeyChange(value: string | number | null): void {
  if (typeof value !== 'string' || value.length === 0) return
  emit('update', { source: currentSource.value, key: value })
}

function onDrop(event: DragEvent): void {
  dragging.value = false
  const raw = event.dataTransfer?.getData('application/x-toolset-variable')
  if (!raw) return
  try {
    const parsed = JSON.parse(raw) as { source?: unknown; key?: unknown }
    if (typeof parsed.source === 'string' && typeof parsed.key === 'string') {
      emit('update', { source: parsed.source, key: parsed.key })
      event.preventDefault()
    }
  } catch {
    // 忽略非法拖放数据
  }
}
</script>

<template>
  <div
    class="prop-variable"
    :class="{ 'is-drop-target': dragging }"
    @dragover.prevent="dragging = true"
    @dragleave="dragging = false"
    @drop="onDrop"
  >
    <div class="prop-variable__row">
      <select
        class="prop-variable__select"
        :value="currentSource"
        aria-label="数据源"
        :data-testid="`prop-variable-source-${field.key}`"
        @change="onSourceChange(($event.target as HTMLSelectElement).value)"
      >
        <option v-for="item in sources" :key="item.value" :value="item.value">
          {{ item.label }}
        </option>
      </select>
      <select
        class="prop-variable__select"
        :value="current?.key ?? ''"
        aria-label="变量"
        :data-testid="`prop-variable-key-${field.key}`"
        @change="onKeyChange(($event.target as HTMLSelectElement).value)"
      >
        <option value="">未绑定变量</option>
        <option v-for="item in variables" :key="item.key" :value="item.key">
          {{ item.label }}（{{ item.key }}）
        </option>
      </select>
    </div>
    <div class="prop-variable__meta">
      <span class="prop-variable__value" :data-testid="`prop-variable-value-${field.key}`">
        {{ displayValue }}
      </span>
      <span class="prop-variable__hint">也可以把变量拖到这里</span>
    </div>
  </div>
</template>

<style scoped>
.prop-variable {
  display: flex;
  flex-direction: column;
  gap: 3px;
  min-width: 0;
  padding: 2px;
  border: 1px dashed transparent;
  border-radius: var(--radius-sm);
}

.prop-variable.is-drop-target {
  border-color: var(--accent);
  background: var(--accent-soft);
}

.prop-variable__row {
  display: flex;
  flex-direction: column;
  gap: 3px;
  min-width: 0;
}

.prop-variable__select {
  width: 100%;
  min-width: 0;
  height: var(--control-h-sm);
  padding: 0 4px;
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  background: var(--bg-sunken);
  color: var(--text);
  font-size: 11px;
}

.prop-variable__select:focus-visible {
  outline: none;
  box-shadow: var(--focus-ring);
}

.prop-variable__meta {
  display: flex;
  align-items: baseline;
  gap: 6px;
  min-width: 0;
}

.prop-variable__value {
  color: var(--text);
  font-family: var(--font-mono);
  font-size: 11px;
}

.prop-variable__hint {
  margin-left: auto;
  color: var(--text-faint);
  font-size: 9px;
}

.prop-variable :deep(.ui-select) {
  width: 100%;
}
</style>
