<script setup lang="ts">
import { nextTick, onBeforeUnmount, ref, watch } from 'vue'
import { X } from 'lucide-vue-next'

import UiIconButton from './UiIconButton.vue'

const props = withDefaults(
  defineProps<{
    modelValue?: boolean
    title?: string
    /** CSS width of the drawer, the settings drawer uses `420px`. */
    width?: string
    closable?: boolean
    closeOnOverlay?: boolean
    closeOnEsc?: boolean
  }>(),
  {
    modelValue: false,
    title: '',
    width: '420px',
    closable: true,
    closeOnOverlay: true,
    closeOnEsc: true,
  },
)

const emit = defineEmits<{
  'update:modelValue': [value: boolean]
  close: []
  closed: []
}>()

const panelRef = ref<HTMLElement | null>(null)
let previouslyFocused: HTMLElement | null = null
let wasOpen = false

function requestClose(source: 'button' | 'overlay' | 'escape'): void {
  if (!props.modelValue) return
  if (source === 'overlay' && !props.closeOnOverlay) return
  if (source === 'escape' && !props.closeOnEsc) return
  emit('update:modelValue', false)
  emit('close')
}

function onKeydown(event: KeyboardEvent): void {
  if (event.key !== 'Escape') return
  event.preventDefault()
  requestClose('escape')
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
    <div v-if="modelValue" class="ui-drawer" role="presentation" @mousedown="onOverlayMouseDown">
      <aside
        ref="panelRef"
        class="ui-drawer__panel"
        :style="{ width }"
        role="dialog"
        aria-modal="true"
        :aria-label="title || undefined"
        tabindex="-1"
        @mousedown.stop
      >
        <header class="ui-drawer__header">
          <h2 class="ui-drawer__title">
            <slot name="title">{{ title }}</slot>
          </h2>
          <UiIconButton v-if="closable" label="关闭" size="sm" @click="requestClose('button')">
            <X :size="14" />
          </UiIconButton>
        </header>
        <div class="ui-drawer__body">
          <slot />
        </div>
        <footer v-if="$slots.footer" class="ui-drawer__footer">
          <slot name="footer" />
        </footer>
      </aside>
    </div>
  </Teleport>
</template>

<style scoped>
.ui-drawer {
  position: fixed;
  inset: 0;
  z-index: var(--z-dialog, 1000);
  display: flex;
  justify-content: flex-end;
  background: var(--overlay);
  animation: ui-drawer-overlay-in 120ms ease;
}

.ui-drawer__panel {
  display: flex;
  flex-direction: column;
  max-width: 100vw;
  height: 100%;
  border-left: 1px solid var(--border);
  background: var(--bg-elev-2);
  box-shadow: var(--shadow-pop);
  outline: none;
  animation: ui-drawer-panel-in 140ms ease;
}

.ui-drawer__header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-2);
  flex: none;
  height: 44px;
  padding: 0 var(--space-3) 0 var(--space-4);
  border-bottom: 1px solid var(--border);
}

.ui-drawer__title {
  margin: 0;
  color: var(--text);
  font-size: 13.5px;
  font-weight: 600;
}

.ui-drawer__body {
  flex: 1 1 auto;
  min-height: 0;
  padding: var(--space-4);
  overflow: auto;
}

.ui-drawer__footer {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: var(--space-2);
  flex: none;
  padding: var(--space-3) var(--space-4);
  border-top: 1px solid var(--border);
}

@keyframes ui-drawer-overlay-in {
  from {
    opacity: 0;
  }
}

@keyframes ui-drawer-panel-in {
  from {
    transform: translateX(20px);
    opacity: 0;
  }
}
</style>
