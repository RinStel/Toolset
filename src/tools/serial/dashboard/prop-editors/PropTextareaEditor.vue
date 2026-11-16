<script setup lang="ts">
/** textarea 属性编辑器（plan §8.10）。 */
import { computed } from 'vue'

import { asString, type PropEditorContext, type PropEditorEmits, type PropFieldOf } from './types'

const props = defineProps<{
  field: PropFieldOf<'textarea'>
  value: unknown
  context: PropEditorContext
}>()

const emit = defineEmits<PropEditorEmits>()

const current = computed(() => asString(props.value, props.field.default ?? ''))
</script>

<template>
  <textarea
    class="prop-textarea"
    :rows="field.rows ?? 3"
    :value="current"
    :aria-label="field.label"
    spellcheck="false"
    :data-testid="`prop-input-${field.key}`"
    @input="emit('update', ($event.target as HTMLTextAreaElement).value)"
  />
</template>

<style scoped>
.prop-textarea {
  width: 100%;
  min-width: 0;
  padding: 4px 6px;
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  background: var(--bg-sunken);
  color: var(--text);
  font-family: var(--font-mono);
  font-size: 11px;
  line-height: 1.5;
  resize: vertical;
}

.prop-textarea:hover {
  border-color: var(--border-strong);
}

.prop-textarea:focus {
  border-color: var(--accent);
}

.prop-textarea:focus-visible {
  outline: none;
  box-shadow: var(--focus-ring);
}
</style>
