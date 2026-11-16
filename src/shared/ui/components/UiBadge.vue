<script setup lang="ts">
withDefaults(
  defineProps<{
    tone?: 'default' | 'accent' | 'ok' | 'warn' | 'danger' | 'muted'
    variant?: 'soft' | 'solid' | 'outline'
    size?: 'sm' | 'md'
    title?: string
  }>(),
  {
    tone: 'default',
    variant: 'soft',
    size: 'sm',
    title: undefined,
  },
)
</script>

<template>
  <span
    class="ui-badge"
    :class="[`ui-badge--${tone}`, `ui-badge--${variant}`, `ui-badge--${size}`]"
    :title="title"
  >
    <slot />
  </span>
</template>

<style scoped>
.ui-badge {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  min-height: 18px;
  padding: 0 6px;
  border: 1px solid transparent;
  border-radius: 2px;
  font-family: var(--font-mono);
  font-size: 11px;
  line-height: 18px;
  white-space: nowrap;
}

.ui-badge--md {
  min-height: 20px;
  padding: 0 8px;
  font-size: 12px;
  line-height: 20px;
}

.ui-badge--default,
.ui-badge--muted {
  color: var(--text-dim);
}

.ui-badge--accent {
  color: var(--accent);
}

.ui-badge--ok {
  color: var(--ok);
}

.ui-badge--warn {
  color: var(--warn);
}

.ui-badge--danger {
  color: var(--danger);
}

.ui-badge--soft {
  background: var(--bg-hover);
}

.ui-badge--soft.ui-badge--accent {
  background: var(--accent-soft);
}

.ui-badge--soft.ui-badge--ok {
  background: var(--ok-soft);
}

.ui-badge--soft.ui-badge--warn {
  background: var(--warn-soft);
}

.ui-badge--soft.ui-badge--danger {
  background: var(--danger-soft);
}

.ui-badge--outline {
  border-color: currentColor;
  background: transparent;
}

.ui-badge--solid {
  background: var(--bg-hover);
  color: var(--text);
}

.ui-badge--solid.ui-badge--default,
.ui-badge--solid.ui-badge--muted {
  color: var(--text-dim);
}

.ui-badge--solid.ui-badge--accent {
  background: var(--accent);
  color: var(--on-accent);
}

.ui-badge--solid.ui-badge--ok {
  background: var(--ok);
  color: var(--on-accent);
}

.ui-badge--solid.ui-badge--warn {
  background: var(--warn);
  color: var(--on-accent);
}

.ui-badge--solid.ui-badge--danger {
  background: var(--danger);
  color: var(--on-danger);
}
</style>
