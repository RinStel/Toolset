<script setup lang="ts">
import { computed } from 'vue'
import { Loader2 } from 'lucide-vue-next'

const props = withDefaults(
  defineProps<{
    /**
     * Button hierarchy:
     * - `secondary` (default): outlined surface for secondary actions.
     * - `primary`: one solid green action per view/operation area.
     * - `ghost`: borderless toolbar action.
     * - `danger`: outlined red destructive action.
     * - `danger-solid`: final destructive action inside a confirmation dialog.
     */
    variant?: 'default' | 'secondary' | 'primary' | 'ghost' | 'danger' | 'danger-solid'
    /** `sm` is 26px tall (12px type), `md` is 30px tall (12.5px type). */
    size?: 'sm' | 'md'
    type?: 'button' | 'submit' | 'reset'
    disabled?: boolean
    /** Shows a spinner and disables the button. */
    loading?: boolean
    /** Stretches the button to the full width of its container. */
    block?: boolean
  }>(),
  {
    variant: 'secondary',
    size: 'md',
    type: 'button',
    disabled: false,
    loading: false,
    block: false,
  },
)

const emit = defineEmits<{ click: [event: MouseEvent] }>()

const isDisabled = computed(() => props.disabled || props.loading)
const visualVariant = computed(() => (props.variant === 'default' ? 'secondary' : props.variant))

function onClick(event: MouseEvent): void {
  if (isDisabled.value) {
    event.preventDefault()
    event.stopPropagation()
    return
  }
  emit('click', event)
}
</script>

<template>
  <button
    class="ui-button"
    :class="[
      `ui-button--${visualVariant}`,
      `ui-button--${size}`,
      { 'ui-button--block': block, 'is-loading': loading },
    ]"
    :type="type"
    :disabled="isDisabled"
    :aria-busy="loading || undefined"
    @click="onClick"
  >
    <Loader2 v-if="loading" class="ui-button__spinner" :size="14" aria-hidden="true" />
    <slot />
  </button>
</template>

<style scoped>
.ui-button {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  flex: none;
  height: var(--control-h);
  padding: 0 12px;
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  background: var(--bg-elev-2);
  color: var(--text);
  font-family: var(--font-ui);
  font-size: 12.5px;
  font-weight: 500;
  line-height: 1;
  white-space: nowrap;
  user-select: none;
  transition:
    background-color 120ms ease,
    border-color 120ms ease,
    color 120ms ease,
    box-shadow 120ms ease;
}

.ui-button :deep(svg) {
  flex: none;
  width: 15px;
  height: 15px;
}

.ui-button:hover:not(:disabled) {
  border-color: var(--border-strong);
  background: var(--bg-hover);
}

.ui-button:active:not(:disabled) {
  background: var(--bg-active);
  box-shadow: inset 0 1px 2px rgba(0, 0, 0, 0.35);
}

.ui-button:focus-visible {
  outline: none;
  box-shadow: var(--focus-ring);
}

.ui-button:disabled {
  opacity: 0.38;
  cursor: not-allowed;
}

.ui-button--sm {
  height: var(--control-h-sm);
  padding: 0 9px;
  font-size: 12px;
}

.ui-button--sm :deep(svg) {
  width: 14px;
  height: 14px;
}

.ui-button--block {
  width: 100%;
}

.ui-button--primary {
  border-color: var(--accent);
  background: var(--accent);
  color: var(--on-accent);
  font-weight: 600;
}

.ui-button--primary:hover:not(:disabled) {
  border-color: var(--accent-hover);
  background: var(--accent-hover);
}

.ui-button--primary:active:not(:disabled) {
  border-color: var(--accent-hover);
  background: var(--accent-hover);
  filter: brightness(0.92);
}

.ui-button--ghost {
  border-color: transparent;
  background: transparent;
  color: var(--text-dim);
}

.ui-button--ghost:hover:not(:disabled) {
  border-color: var(--border);
  background: var(--bg-hover);
  color: var(--text);
}

.ui-button--ghost:active:not(:disabled) {
  background: var(--bg-active);
}

.ui-button--danger {
  border-color: var(--danger);
  background: transparent;
  color: var(--danger);
}

.ui-button--danger:hover:not(:disabled) {
  border-color: var(--danger);
  background: var(--danger-soft);
  color: var(--danger);
}

.ui-button--danger-solid {
  border-color: var(--danger);
  background: var(--danger);
  color: var(--on-danger);
  font-weight: 600;
}

.ui-button--danger-solid:hover:not(:disabled) {
  border-color: var(--danger);
  background: var(--danger);
  filter: brightness(1.08);
}

.ui-button--danger-solid:active:not(:disabled) {
  border-color: var(--danger);
  background: var(--danger);
  filter: brightness(0.88);
}

.ui-button.is-loading {
  cursor: progress;
}

.ui-button__spinner {
  flex: none;
  animation: ui-button-spin 800ms linear infinite;
}

@keyframes ui-button-spin {
  to {
    transform: rotate(360deg);
  }
}
</style>
