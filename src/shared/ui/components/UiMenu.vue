<script lang="ts">
import type { Component } from 'vue'

export interface MenuItem {
  key: string
  label: string
  disabled?: boolean
  /** Renders the entry in the danger colour (destructive actions). */
  danger?: boolean
  /** Draws a separator line above this entry. */
  separatorBefore?: boolean
  /** Keeps the menu open after selecting this entry. */
  keepOpen?: boolean
  icon?: Component
  /** Optional test id kept on the rendered menu item. */
  testId?: string
}
</script>

<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue'

const props = withDefaults(
  defineProps<{
    modelValue?: boolean
    items?: MenuItem[]
    align?: 'start' | 'end'
    minWidth?: string
    disabled?: boolean
    ariaLabel?: string
  }>(),
  {
    modelValue: undefined,
    items: () => [],
    align: 'end',
    minWidth: '160px',
    disabled: false,
    ariaLabel: undefined,
  },
)

const emit = defineEmits<{
  'update:modelValue': [value: boolean]
  select: [key: string]
}>()

const rootRef = ref<HTMLElement | null>(null)
const triggerRef = ref<HTMLElement | null>(null)
const panelRef = ref<HTMLElement | null>(null)
const activeIndex = ref(-1)
/** Open state used when the parent does not bind v-model (uncontrolled usage). */
const internalOpen = ref(false)
const isOpen = computed(() => props.modelValue ?? internalOpen.value)
/** Fixed-position style for the teleported panel (keeps it visible outside overflow-hidden containers). */
const panelStyle = ref<Record<string, string>>({})

function updatePanelPosition(): void {
  const trigger = triggerRef.value
  if (!trigger || typeof window === 'undefined') return
  const rect = trigger.getBoundingClientRect()
  const style: Record<string, string> = {
    position: 'fixed',
    top: `${Math.round(rect.bottom + 4)}px`,
    minWidth: props.minWidth,
  }
  if (props.align === 'end') {
    style.right = `${Math.round(window.innerWidth - rect.right)}px`
  } else {
    style.left = `${Math.round(rect.left)}px`
  }
  panelStyle.value = style
}

function onViewportChange(): void {
  updatePanelPosition()
}

function enabledIndexes(): number[] {
  const indexes: number[] = []
  props.items.forEach((item, index) => {
    if (!item.disabled) indexes.push(index)
  })
  return indexes
}

function openMenu(): void {
  if (props.disabled) return
  internalOpen.value = true
  emit('update:modelValue', true)
}

function closeMenu(restoreFocus = true): void {
  if (!isOpen.value) return
  internalOpen.value = false
  emit('update:modelValue', false)
  if (restoreFocus) {
    nextTick(() => {
      const focusable = triggerRef.value?.querySelector<HTMLElement>('button, [tabindex]')
      ;(focusable ?? triggerRef.value)?.focus()
    })
  }
}

function toggle(): void {
  if (props.disabled) return
  if (isOpen.value) closeMenu(false)
  else openMenu()
}

function focusActive(): void {
  void nextTick(() => {
    panelRef.value?.querySelector<HTMLElement>(`[data-menu-index="${activeIndex.value}"]`)?.focus()
  })
}

function moveActive(delta: number): void {
  const enabled = enabledIndexes()
  if (enabled.length === 0) return
  const position = enabled.indexOf(activeIndex.value)
  const nextPosition =
    position < 0
      ? delta > 0
        ? 0
        : enabled.length - 1
      : (position + delta + enabled.length) % enabled.length
  const nextIndex = enabled[nextPosition]
  if (nextIndex === undefined) return
  activeIndex.value = nextIndex
  focusActive()
}

function onItemClick(item: MenuItem): void {
  if (item.disabled) return
  emit('select', item.key)
  if (!item.keepOpen) closeMenu()
}

function onTriggerKeydown(event: KeyboardEvent): void {
  if (props.disabled) return
  if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return
  event.preventDefault()
  if (!isOpen.value) openMenu()
  moveActive(event.key === 'ArrowDown' ? 1 : -1)
}

function onPanelKeydown(event: KeyboardEvent): void {
  switch (event.key) {
    case 'Escape':
      event.preventDefault()
      closeMenu()
      break
    case 'Tab':
      closeMenu(false)
      break
    case 'ArrowDown':
      event.preventDefault()
      moveActive(1)
      break
    case 'ArrowUp':
      event.preventDefault()
      moveActive(-1)
      break
    case 'Home': {
      event.preventDefault()
      const first = enabledIndexes()[0]
      if (first !== undefined) {
        activeIndex.value = first
        focusActive()
      }
      break
    }
    case 'End': {
      event.preventDefault()
      const enabled = enabledIndexes()
      const last = enabled[enabled.length - 1]
      if (last !== undefined) {
        activeIndex.value = last
        focusActive()
      }
      break
    }
  }
}

function onDocumentPointerDown(event: Event): void {
  const root = rootRef.value
  const panel = panelRef.value
  if (
    event.target instanceof Node &&
    ((root && root.contains(event.target)) || (panel && panel.contains(event.target)))
  ) {
    return
  }
  closeMenu(false)
}

watch(isOpen, (open) => {
  if (typeof document === 'undefined') return
  if (open) {
    activeIndex.value = enabledIndexes()[0] ?? -1
    document.addEventListener('pointerdown', onDocumentPointerDown, true)
    window.addEventListener('resize', onViewportChange)
    window.addEventListener('scroll', onViewportChange, true)
    void nextTick(() => {
      updatePanelPosition()
      focusActive()
    })
  } else {
    document.removeEventListener('pointerdown', onDocumentPointerDown, true)
    window.removeEventListener('resize', onViewportChange)
    window.removeEventListener('scroll', onViewportChange, true)
  }
})

onBeforeUnmount(() => {
  document.removeEventListener('pointerdown', onDocumentPointerDown, true)
  window.removeEventListener('resize', onViewportChange)
  window.removeEventListener('scroll', onViewportChange, true)
})
</script>

<template>
  <div ref="rootRef" class="ui-menu">
    <!-- capture：触发按钮（如 UiButton）可能调用 stopPropagation，冒泡阶段收不到点击。 -->
    <span
      ref="triggerRef"
      class="ui-menu__trigger"
      @click.capture="toggle"
      @keydown="onTriggerKeydown"
    >
      <slot name="trigger" />
    </span>
    <Teleport to="body">
      <div
        v-if="isOpen"
        ref="panelRef"
        class="ui-menu__panel ui-menu__panel--floating"
        :class="`ui-menu__panel--${align}`"
        role="menu"
        :aria-label="ariaLabel"
        :style="panelStyle"
        @keydown="onPanelKeydown"
      >
        <template v-for="(item, index) in items" :key="item.key">
          <div v-if="item.separatorBefore" class="ui-menu__separator" role="separator" />
          <button
            class="ui-menu__item"
            :class="{
              'is-active': index === activeIndex,
              'is-danger': item.danger,
            }"
            type="button"
            role="menuitem"
            :data-menu-index="index"
            :data-testid="item.testId"
            :disabled="item.disabled"
            @click="onItemClick(item)"
            @mouseenter="activeIndex = index"
          >
            <component :is="item.icon" v-if="item.icon" :size="14" aria-hidden="true" />
            <span class="ui-menu__label">{{ item.label }}</span>
          </button>
        </template>
        <div v-if="items.length === 0" class="ui-menu__empty">无可用操作</div>
      </div>
    </Teleport>
  </div>
</template>

<style scoped>
.ui-menu {
  position: relative;
  display: inline-flex;
}

.ui-menu__trigger {
  display: inline-flex;
}

.ui-menu__panel {
  position: absolute;
  top: calc(100% + 4px);
  z-index: var(--z-menu, 2000);
  display: flex;
  flex-direction: column;
  min-width: 180px;
  max-height: 360px;
  padding: 4px;
  overflow: auto;
  border: 1px solid var(--border);
  border-radius: var(--radius);
  background: var(--bg-elev-2);
  box-shadow: var(--shadow-pop);
}

.ui-menu__panel--start {
  left: 0;
}

.ui-menu__panel--end {
  right: 0;
}

.ui-menu__item {
  display: flex;
  align-items: center;
  gap: 10px;
  width: 100%;
  min-height: var(--control-h);
  padding: 8px 12px;
  border-radius: var(--radius-sm);
  background: transparent;
  color: var(--text);
  font-size: 12.5px;
  text-align: left;
  white-space: nowrap;
}

.ui-menu__item:hover:not(:disabled),
.ui-menu__item.is-active:not(:disabled) {
  background: var(--bg-hover);
}

.ui-menu__item:focus-visible {
  outline: none;
  box-shadow: inset 0 0 0 1px var(--accent);
}

.ui-menu__item.is-danger {
  color: var(--danger);
}

.ui-menu__item.is-danger:hover:not(:disabled),
.ui-menu__item.is-danger.is-active:not(:disabled) {
  background: var(--danger-soft);
}

.ui-menu__item:disabled {
  opacity: 0.38;
  cursor: not-allowed;
}

.ui-menu__item :deep(svg) {
  flex: none;
  width: 15px;
  height: 15px;
}

.ui-menu__separator {
  height: 1px;
  margin: 4px 0;
  background: var(--border);
}

.ui-menu__empty {
  padding: var(--space-2);
  color: var(--text-dim);
  font-size: 11px;
  text-align: center;
}
</style>
