<script setup lang="ts">
import type { Component } from 'vue'

withDefaults(
  defineProps<{
    title?: string
    description?: string
    /** Optional lucide icon component shown above the title. */
    icon?: Component
    /** Optional small uppercase label above the rule (decorative). */
    eyebrow?: string
    compact?: boolean
  }>(),
  {
    title: '暂无数据',
    description: '',
    icon: undefined,
    eyebrow: '',
    compact: false,
  },
)
</script>

<template>
  <div class="ui-empty" :class="{ 'ui-empty--compact': compact }">
    <component :is="icon" v-if="icon" class="ui-empty__icon" :size="20" aria-hidden="true" />
    <span v-if="eyebrow && !compact" class="ui-empty__eyebrow">{{ eyebrow }}</span>
    <span v-if="!compact" class="ui-empty__rule" aria-hidden="true" />
    <h3 v-if="title || $slots.title" class="ui-empty__title">
      <slot name="title">{{ title }}</slot>
    </h3>
    <p v-if="description || $slots.description" class="ui-empty__description">
      <slot name="description">{{ description }}</slot>
    </p>
    <div v-if="$slots.default || $slots.actions" class="ui-empty__actions">
      <slot />
      <slot name="actions" />
    </div>
  </div>
</template>

<style scoped>
.ui-empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 8px;
  padding: 40px 24px;
  color: var(--text-faint);
  text-align: center;
}

.ui-empty--compact {
  gap: 6px;
  padding: var(--space-3);
}

.ui-empty__icon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 32px;
  height: 32px;
  padding: 6px;
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  color: var(--text-faint);
}

.ui-empty__eyebrow {
  color: var(--text-faint);
  font-family: var(--font-mono);
  font-size: 10px;
  letter-spacing: 0.12em;
}

.ui-empty__rule {
  width: 32px;
  height: 1px;
  background: var(--border-strong);
}

.ui-empty__title {
  margin: 0;
  color: var(--text-dim);
  font-size: 13px;
  font-weight: 500;
}

.ui-empty--compact .ui-empty__title {
  font-size: 12px;
}

.ui-empty__description {
  max-width: 340px;
  margin: 0;
  color: var(--text-dim);
  font-size: 11px;
  line-height: 1.6;
}

.ui-empty__actions {
  display: flex;
  align-items: center;
  justify-content: center;
  flex-wrap: wrap;
  gap: 8px;
  margin-top: 4px;
}
</style>
