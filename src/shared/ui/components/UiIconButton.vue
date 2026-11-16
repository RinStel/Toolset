<script setup lang="ts">
withDefaults(
  defineProps<{
    /** Accessible name, also used as the tooltip. */
    label: string
    /** `sm` is 26×26, `md` is 30×30. */
    size?: 'sm' | 'md'
    variant?: 'ghost' | 'default' | 'danger'
    active?: boolean
    disabled?: boolean
  }>(),
  {
    size: 'md',
    variant: 'ghost',
    active: false,
    disabled: false,
  },
)

const emit = defineEmits<{ click: [event: MouseEvent] }>()
</script>

<template>
  <button
    class="ui-icon-button"
    :class="[`ui-icon-button--${size}`, `ui-icon-button--${variant}`, { 'is-active': active }]"
    type="button"
    :aria-label="label"
    :title="label"
    :aria-pressed="active || undefined"
    :disabled="disabled"
    @click="emit('click', $event)"
  >
    <slot />
  </button>
</template>

<style scoped>
.ui-icon-button {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex: none;
  width: var(--control-h);
  height: var(--control-h);
  border: 1px solid transparent;
  border-radius: var(--radius-sm);
  background: transparent;
  color: var(--text-dim);
  transition:
    background-color 120ms ease,
    color 120ms ease,
    border-color 120ms ease;
}

.ui-icon-button :deep(svg) {
  width: 16px;
  height: 16px;
}

.ui-icon-button:hover:not(:disabled) {
  border-color: var(--border);
  background: var(--bg-hover);
  color: var(--text);
}

.ui-icon-button:active:not(:disabled) {
  background: var(--bg-active);
}

.ui-icon-button:focus-visible {
  outline: none;
  box-shadow: var(--focus-ring);
}

.ui-icon-button:disabled {
  opacity: 0.38;
  cursor: not-allowed;
}

.ui-icon-button--sm {
  width: var(--control-h-sm);
  height: var(--control-h-sm);
}

.ui-icon-button--sm :deep(svg) {
  width: 15px;
  height: 15px;
}

.ui-icon-button--default {
  border-color: var(--border);
  background: var(--bg-elev-2);
  color: var(--text);
}

.ui-icon-button--default:hover:not(:disabled) {
  border-color: var(--border-strong);
  background: var(--bg-hover);
}

.ui-icon-button--danger {
  color: var(--danger);
}

.ui-icon-button--danger:hover:not(:disabled) {
  border-color: var(--danger);
  background: var(--danger-soft);
  color: var(--danger);
}

.ui-icon-button.is-active {
  border-color: var(--accent);
  background: var(--accent-soft);
  color: var(--accent);
}
</style>
