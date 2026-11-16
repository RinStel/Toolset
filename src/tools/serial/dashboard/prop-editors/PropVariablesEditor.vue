<script setup lang="ts">
/**
 * variables 属性编辑器（plan §8.10）。
 *
 * 变量列表：拖动排序、删除、新增；每项可以展开编辑 `itemFields`（颜色、线宽等）。
 * 每项至少包含 `{ source, key }` 以及 `itemFields` 的默认值。
 */
import { computed, ref } from 'vue'

import UiButton from '@/shared/ui/components/UiButton.vue'
import UiCheckbox from '@/shared/ui/components/UiCheckbox.vue'
import UiColorInput from '@/shared/ui/components/UiColorInput.vue'
import UiIconButton from '@/shared/ui/components/UiIconButton.vue'
import UiInput from '@/shared/ui/components/UiInput.vue'
import UiNumberInput from '@/shared/ui/components/UiNumberInput.vue'
import UiSelect from '@/shared/ui/components/UiSelect.vue'

import { defaultForField } from '../widget-registry'
import {
  asArray,
  asRecord,
  asString,
  asVarRef,
  formatDisplayValue,
  sourceOptions,
  variablesOf,
  type PropEditorContext,
  type PropEditorEmits,
  type PropFieldOf,
} from './types'
import type { WidgetPropField } from '@/domains/dashboard/public'

const props = defineProps<{
  field: PropFieldOf<'variables'>
  value: unknown
  context: PropEditorContext
}>()

const emit = defineEmits<PropEditorEmits>()

const expanded = ref<Record<number, boolean>>({})
const draggingIndex = ref<number | null>(null)
const overIndex = ref<number | null>(null)

const items = computed<Array<Record<string, unknown>>>(() =>
  asArray(props.value).map((item) => asRecord(item)),
)

const minItems = props.field.min ?? 0
const maxItems = props.field.max ?? 16

function createItem(): Record<string, unknown> {
  const item: Record<string, unknown> = {
    source: sourceOptions(props.context)[0]?.value ?? 'main',
    key: '',
  }
  for (const itemField of props.field.itemFields ?? []) {
    const value = defaultForField(itemField)
    if (value !== undefined) item[itemField.key] = value
  }
  return item
}

function commit(next: Array<Record<string, unknown>>): void {
  emit('update', next)
}

function addItem(): void {
  if (items.value.length >= maxItems) return
  commit([...items.value, createItem()])
}

function removeItem(index: number): void {
  if (items.value.length <= minItems) return
  commit(items.value.filter((_, position) => position !== index))
}

function updateItem(index: number, patch: Record<string, unknown>): void {
  commit(items.value.map((item, position) => (position === index ? { ...item, ...patch } : item)))
}

function sourceOf(item: Record<string, unknown>): string {
  return asString(item.source, sourceOptions(props.context)[0]?.value ?? 'main')
}

function keyOf(item: Record<string, unknown>): string {
  return asString(item.key, '')
}

function onSourceChange(index: number, value: string | number | null): void {
  if (typeof value !== 'string') return
  const first = variablesOf(props.context, value)[0]
  updateItem(index, { source: value, key: first?.key ?? '' })
}

function onDragStart(index: number, event: DragEvent): void {
  draggingIndex.value = index
  if (event.dataTransfer) {
    event.dataTransfer.effectAllowed = 'move'
    event.dataTransfer.setData('text/plain', String(index))
  }
}

function onDragOver(index: number, event: DragEvent): void {
  if (draggingIndex.value === null) return
  event.preventDefault()
  overIndex.value = index
}

function onDrop(index: number): void {
  const from = draggingIndex.value
  draggingIndex.value = null
  overIndex.value = null
  if (from === null || from === index) return
  const next = [...items.value]
  const [moved] = next.splice(from, 1)
  if (!moved) return
  next.splice(index, 0, moved)
  commit(next)
}

function endDrag(): void {
  draggingIndex.value = null
  overIndex.value = null
}

function itemFieldValue(item: Record<string, unknown>, itemField: WidgetPropField): unknown {
  return item[itemField.key] ?? defaultForField(itemField)
}

/** 为 select 编辑器取一个合法的选项值（模板里不能写 TS 联合类型断言）。 */
function selectValueOf(
  item: Record<string, unknown>,
  itemField: WidgetPropField,
): string | number | null {
  const value = itemFieldValue(item, itemField)
  return typeof value === 'string' || typeof value === 'number' ? value : null
}

function onItemFieldChange(index: number, itemField: WidgetPropField, value: unknown): void {
  updateItem(index, { [itemField.key]: value })
}

function displayFor(item: Record<string, unknown>): string {
  return formatDisplayValue(props.context, asVarRef(item))
}

function toggleExpanded(index: number): void {
  expanded.value = { ...expanded.value, [index]: !expanded.value[index] }
}
</script>

<template>
  <div class="prop-variables" :data-testid="`prop-variables-${field.key}`">
    <div v-if="items.length === 0" class="prop-variables__empty">未绑定变量</div>

    <div
      v-for="(item, index) in items"
      :key="index"
      class="prop-variables__item"
      :class="{ 'is-over': overIndex === index }"
      draggable="true"
      :data-testid="`prop-var-row-${field.key}-${index}`"
      @dragstart="onDragStart(index, $event)"
      @dragover="onDragOver(index, $event)"
      @drop="onDrop(index)"
      @dragend="endDrag"
    >
      <div class="prop-variables__main">
        <span class="prop-variables__drag" title="拖动排序" aria-hidden="true">≡</span>
        <div class="prop-variables__selects">
          <select
            class="prop-variables__select"
            :value="sourceOf(item)"
            aria-label="数据源"
            :data-testid="`prop-var-source-${field.key}-${index}`"
            @change="onSourceChange(index, ($event.target as HTMLSelectElement).value)"
          >
            <option
              v-for="source in sourceOptions(context)"
              :key="source.value"
              :value="source.value"
            >
              {{ source.label }}
            </option>
          </select>
          <select
            class="prop-variables__select"
            :value="keyOf(item)"
            aria-label="变量"
            :data-testid="`prop-var-key-${field.key}-${index}`"
            @change="updateItem(index, { key: ($event.target as HTMLSelectElement).value })"
          >
            <option value="">未绑定变量</option>
            <option
              v-for="variable in variablesOf(context, sourceOf(item))"
              :key="variable.key"
              :value="variable.key"
            >
              {{ variable.label }}（{{ variable.key }}）
            </option>
          </select>
        </div>
        <span class="prop-variables__value">{{ displayFor(item) }}</span>
        <UiIconButton
          v-if="(field.itemFields ?? []).length > 0"
          label="展开变量选项"
          size="sm"
          :active="expanded[index] === true"
          :data-testid="`prop-var-expand-${field.key}-${index}`"
          @click="toggleExpanded(index)"
        >
          <span aria-hidden="true">⋯</span>
        </UiIconButton>
        <UiIconButton
          label="删除变量"
          size="sm"
          variant="danger"
          :disabled="items.length <= minItems"
          :data-testid="`prop-var-remove-${field.key}-${index}`"
          @click="removeItem(index)"
        >
          <span aria-hidden="true">×</span>
        </UiIconButton>
      </div>

      <div v-if="expanded[index]" class="prop-variables__fields">
        <div
          v-for="itemField in field.itemFields ?? []"
          :key="itemField.key"
          class="prop-variables__field"
          :data-testid="`prop-item-${field.key}-${itemField.key}-${index}`"
        >
          <span class="prop-variables__field-label">{{ itemField.label }}</span>
          <UiSelect
            v-if="itemField.type === 'select'"
            :model-value="selectValueOf(item, itemField)"
            :options="itemField.options"
            size="sm"
            :aria-label="itemField.label"
            @update:model-value="onItemFieldChange(index, itemField, $event)"
          />
          <UiCheckbox
            v-else-if="itemField.type === 'checkbox'"
            :model-value="Boolean(itemFieldValue(item, itemField))"
            label="开启"
            size="sm"
            :aria-label="itemField.label"
            @update:model-value="onItemFieldChange(index, itemField, $event)"
          />
          <UiColorInput
            v-else-if="itemField.type === 'color'"
            :model-value="asString(itemFieldValue(item, itemField), '#3b82f6')"
            :aria-label="itemField.label"
            @update:model-value="onItemFieldChange(index, itemField, $event)"
          />
          <UiNumberInput
            v-else-if="itemField.type === 'number'"
            :model-value="
              typeof itemFieldValue(item, itemField) === 'number'
                ? (itemFieldValue(item, itemField) as number)
                : null
            "
            :min="itemField.min"
            :max="itemField.max"
            :step="itemField.step ?? 1"
            :unit="itemField.unit"
            size="sm"
            :aria-label="itemField.label"
            @update:model-value="onItemFieldChange(index, itemField, $event)"
          />
          <UiInput
            v-else
            :model-value="asString(itemFieldValue(item, itemField))"
            size="sm"
            :aria-label="itemField.label"
            @update:model-value="onItemFieldChange(index, itemField, $event)"
          />
        </div>
      </div>
    </div>

    <UiButton
      size="sm"
      variant="ghost"
      :disabled="items.length >= maxItems"
      :data-testid="`prop-variables-add-${field.key}`"
      @click="addItem"
    >
      + 添加变量
    </UiButton>
    <p v-if="items.length >= maxItems" class="prop-variables__limit">
      该组件最多绑定 {{ maxItems }} 个变量
    </p>
  </div>
</template>

<style scoped>
.prop-variables {
  display: flex;
  flex-direction: column;
  gap: 4px;
  min-width: 0;
}

.prop-variables__empty {
  color: var(--text-faint);
  font-size: 11px;
}

.prop-variables__item {
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding: 2px 3px;
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  background: var(--bg-sunken);
}

.prop-variables__item.is-over {
  border-color: var(--accent);
}

.prop-variables__main {
  display: flex;
  align-items: center;
  gap: 4px;
  min-width: 0;
}

.prop-variables__drag {
  flex: none;
  color: var(--text-faint);
  cursor: grab;
}

.prop-variables__selects {
  display: flex;
  align-items: center;
  gap: 3px;
  flex: 1 1 auto;
  min-width: 0;
}

.prop-variables__select {
  flex: 1 1 auto;
  min-width: 0;
  height: var(--control-h-sm);
  padding: 0 3px;
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  background: var(--bg-sunken);
  color: var(--text);
  font-size: 10px;
}

.prop-variables__select:focus-visible {
  outline: none;
  box-shadow: var(--focus-ring);
}

.prop-variables__value {
  flex: none;
  min-width: 42px;
  color: var(--text);
  font-family: var(--font-mono);
  font-size: 10px;
  text-align: right;
}

.prop-variables__fields {
  display: flex;
  flex-direction: column;
  gap: 3px;
  padding: 3px 0 2px 12px;
}

.prop-variables__field {
  display: grid;
  grid-template-columns: 68px minmax(0, 1fr);
  align-items: center;
  gap: 4px;
  min-width: 0;
}

.prop-variables__field-label {
  color: var(--text-faint);
  font-size: 10px;
}

.prop-variables__limit {
  margin: 0;
  color: var(--warn);
  font-size: 10px;
}
</style>
