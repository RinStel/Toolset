<script setup lang="ts">
import { nextTick, onBeforeUnmount, ref, watch } from 'vue'
import { X } from 'lucide-vue-next'

import UiButton from './UiButton.vue'
import UiIconButton from './UiIconButton.vue'

const props = withDefaults(
  defineProps<{
    modelValue?: boolean
    title?: string
    /** Stacking layer; global services pass a higher value than editors/drawers. */
    zIndex?: number
    /** CSS width of the panel, e.g. `420px` or `min(92vw, 560px)`. */
    width?: string
    /** Renders the confirm button in the danger style. */
    danger?: boolean
    confirmText?: string
    cancelText?: string
    showFooter?: boolean
    showCancel?: boolean
    confirmDisabled?: boolean
    confirmLoading?: boolean
    closable?: boolean
    closeOnOverlay?: boolean
    closeOnEsc?: boolean
  }>(),
  {
    modelValue: false,
    title: '',
    zIndex: 1000,
    width: '480px',
    danger: false,
    confirmText: '确定',
    cancelText: '取消',
    showFooter: true,
    showCancel: true,
    confirmDisabled: false,
    confirmLoading: false,
    closable: true,
    closeOnOverlay: true,
    closeOnEsc: true,
  },
)

const emit = defineEmits<{
  'update:modelValue': [value: boolean]
  confirm: []
  cancel: []
  closed: []
}>()

const panelRef = ref<HTMLElement | null>(null)
let previouslyFocused: HTMLElement | null = null
let wasOpen = false

function focusableElements(panel: HTMLElement): HTMLElement[] {
  const selector = 'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
  return Array.from(panel.querySelectorAll<HTMLElement>(selector)).filter(
    (element) => !element.hasAttribute('disabled'),
  )
}

function onKeydown(event: KeyboardEvent): void {
  if (event.key === 'Escape') {
    event.preventDefault()
    requestClose('escape')
    return
  }
  if (event.key !== 'Tab') return
  const panel = panelRef.value
  if (!panel) return
  const focusables = focusableElements(panel)
  if (focusables.length === 0) {
    event.preventDefault()
    panel.focus()
    return
  }
  const first = focusables[0]
  const last = focusables[focusables.length - 1]
  if (!first || !last) return
  if (event.shiftKey && document.activeElement === first) {
    event.preventDefault()
    last.focus()
  } else if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault()
    first.focus()
  }
}

function requestClose(source: 'button' | 'overlay' | 'escape'): void {
  if (!props.modelValue) return
  if (source === 'overlay' && !props.closeOnOverlay) return
  if (source === 'escape' && !props.closeOnEsc) return
  emit('update:modelValue', false)
  emit('cancel')
}

function onOverlayMouseDown(event: MouseEvent): void {
  if (event.target !== event.currentTarget) return
  requestClose('overlay')
}

async function open(): Promise<void> {
  wasOpen = true
  previouslyFocused =
    typeof document !== 'undefined' && document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null
  document.addEventListener('keydown', onKeydown)
  await nextTick()
  panelRef.value?.focus()
}

function close(): void {
  document.removeEventListener('keydown', onKeydown)
  if (previouslyFocused && typeof previouslyFocused.focus === 'function') {
    previouslyFocused.focus()
  }
  previouslyFocused = null
  if (wasOpen) emit('closed')
  wasOpen = false
}

watch(
  () => props.modelValue,
  (visible) => {
    if (typeof document === 'undefined') return
    if (visible) void open()
    else close()
  },
  { immediate: true },
)

onBeforeUnmount(() => {
  document.removeEventListener('keydown', onKeydown)
})
</script>

<template>
  <Teleport to="body">
    <div
      v-if="modelValue"
      class="ui-dialog"
      :class="{ 'ui-dialog--danger': danger }"
      :style="{ zIndex }"
      role="presentation"
      @mousedown="onOverlayMouseDown"
    >
      <div
        ref="panelRef"
        class="ui-dialog__panel"
        :style="{ width }"
        role="dialog"
        aria-modal="true"
        :aria-label="title || undefined"
        tabindex="-1"
        @mousedown.stop
      >
        <header class="ui-dialog__header">
          <h2 class="ui-dialog__title">
            <slot name="title">{{ title }}</slot>
          </h2>
          <UiIconButton v-if="closable" label="关闭" size="sm" @click="requestClose('button')">
            <X :size="14" />
          </UiIconButton>
        </header>
        <div class="ui-dialog__body">
          <slot />
        </div>
        <footer v-if="showFooter || $slots.footer" class="ui-dialog__footer">
          <slot name="footer">
            <UiButton v-if="showCancel" size="md" @click="requestClose('button')">
              {{ cancelText }}
            </UiButton>
            <UiButton
              :variant="danger ? 'danger-solid' : 'primary'"
              size="md"
              :disabled="confirmDisabled"
              :loading="confirmLoading"
              @click="emit('confirm')"
            >
              {{ confirmText }}
            </UiButton>
          </slot>
        </footer>
      </div>
    </div>
  </Teleport>
</template>

<style scoped>
.ui-dialog {
  position: fixed;
  inset: 0;
  z-index: var(--z-dialog, 1000);
  display: flex;
  align-items: center;
  justify-content: center;
  padding: var(--space-5);
  background: var(--overlay);
  animation: ui-dialog-overlay-in 120ms ease;
}

.ui-dialog__panel {
  display: flex;
  flex-direction: column;
  max-width: calc(100vw - 48px);
  max-height: calc(100vh - 48px);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  background: var(--bg-elev-2);
  box-shadow: var(--shadow-pop);
  outline: none;
  animation: ui-dialog-panel-in 120ms ease;
}

.ui-dialog__header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-2);
  flex: none;
  height: 44px;
  padding: 0 var(--space-3) 0 var(--space-4);
  border-bottom: 1px solid var(--border);
}

.ui-dialog__title {
  margin: 0;
  color: var(--text);
  font-size: 13.5px;
  font-weight: 600;
}

.ui-dialog--danger .ui-dialog__title {
  color: var(--danger);
}

.ui-dialog__body {
  flex: 1 1 auto;
  min-height: 0;
  padding: var(--space-4);
  overflow: auto;
  color: var(--text);
}

.ui-dialog__footer {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: var(--space-2);
  flex: none;
  padding: var(--space-3) var(--space-4);
  border-top: 1px solid var(--border);
}

@keyframes ui-dialog-overlay-in {
  from {
    opacity: 0;
  }
}

@keyframes ui-dialog-panel-in {
  from {
    opacity: 0;
    transform: translateY(-4px);
  }
}
</style>
