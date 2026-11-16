<script setup lang="ts">
/**
 * expression 属性编辑器（plan §8.10）。
 *
 * 单行 JS 表达式输入框，失焦时用 `new Function` 校验语法（不求值）。
 */
import { computed, ref } from 'vue'

import UiInput from '@/shared/ui/components/UiInput.vue'

import { asString, type PropEditorContext, type PropEditorEmits, type PropFieldOf } from './types'

const props = defineProps<{
  field: PropFieldOf<'expression'>
  value: unknown
  context: PropEditorContext
}>()

const emit = defineEmits<PropEditorEmits>()

const error = ref('')
const current = computed(() => asString(props.value, props.field.default ?? ''))

function validate(): void {
  const source = current.value.trim()
  if (source.length === 0) {
    error.value = ''
    return
  }
  try {
    // 只编译不执行：语法错误在这里抛出。
    new Function(`"use strict"; return (${source});`)
    error.value = ''
  } catch (exception) {
    error.value = exception instanceof Error ? exception.message : String(exception)
  }
}

function onChange(value: string): void {
  if (error.value.length > 0) error.value = ''
  emit('update', value)
}
</script>

<template>
  <div class="prop-expression">
    <UiInput
      :model-value="current"
      size="sm"
      monospace
      placeholder="JS 表达式，例如 v.x * 2"
      aria-label="表达式"
      :invalid="error.length > 0"
      :data-testid="`prop-input-${field.key}`"
      @update:model-value="onChange"
      @blur="validate"
    />
    <p v-if="error" class="prop-expression__error">语法错误：{{ error }}</p>
  </div>
</template>

<style scoped>
.prop-expression {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
}

.prop-expression__error {
  margin: 0;
  color: var(--danger);
  font-size: 10px;
  line-height: 1.4;
  overflow-wrap: anywhere;
}
</style>
