<script setup lang="ts">
import { TriangleAlert } from 'lucide-vue-next'

import UiButton from '@/shared/ui/components/UiButton.vue'

withDefaults(
  defineProps<{
    /** Error heading, defaults to the copy required by plan §7.1. */
    title?: string
    /** Human readable error detail. */
    message?: string
  }>(),
  {
    title: '该工具出现错误',
    message: '',
  },
)

const emit = defineEmits<{
  reload: []
  home: []
}>()
</script>

<template>
  <div class="tool-error" data-testid="tool-error">
    <TriangleAlert class="tool-error__icon" :size="32" aria-hidden="true" />
    <h1 class="tool-error__title">{{ title }}</h1>
    <p v-if="message" class="tool-error__message">{{ message }}</p>
    <div class="tool-error__actions">
      <UiButton variant="primary" @click="emit('reload')">重新加载工具</UiButton>
      <UiButton @click="emit('home')">返回首页</UiButton>
    </div>
  </div>
</template>

<style scoped>
.tool-error {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: var(--space-3);
  height: 100%;
  min-height: 240px;
  padding: var(--space-5);
  color: var(--text-dim);
  text-align: center;
}

.tool-error__icon {
  color: var(--danger);
}

.tool-error__title {
  margin: 0;
  color: var(--text);
  font-size: 18px;
  font-weight: 600;
}

.tool-error__message {
  max-width: 640px;
  margin: 0;
  overflow-wrap: anywhere;
  font-family: var(--font-mono);
  font-size: 12px;
  line-height: 1.7;
  white-space: pre-wrap;
}

.tool-error__actions {
  display: flex;
  gap: var(--space-2);
  margin-top: var(--space-2);
}
</style>
