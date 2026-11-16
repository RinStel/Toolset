<script lang="ts">
export interface TabItem {
  key: string
  label: string
  disabled?: boolean
  /** Optional badge text, e.g. a session's unread count. */
  badge?: string | number
  title?: string
}
</script>

<script setup lang="ts">
import { ref } from 'vue'

const props = withDefaults(
  defineProps<{
    modelValue?: string
    tabs?: TabItem[]
    size?: 'sm' | 'md'
    ariaLabel?: string
  }>(),
  {
    modelValue: '',
    tabs: () => [],
    size: 'md',
    ariaLabel: undefined,
  },
)

const emit = defineEmits<{
  'update:modelValue': [key: string]
  change: [key: string]
}>()

const listRef = ref<HTMLElement | null>(null)

function focusTab(key: string): void {
  listRef.value?.querySelector<HTMLButtonElement>(`[data-tab-key="${key}"]`)?.focus()
}

function select(tab: TabItem): void {
  if (tab.disabled) return
  if (tab.key !== props.modelValue) {
    emit('update:modelValue', tab.key)
    emit('change', tab.key)
  }
  focusTab(tab.key)
}

function onKeydown(event: KeyboardEvent): void {
  const keys = ['ArrowLeft', 'ArrowRight', 'Home', 'End']
  if (!keys.includes(event.key)) return
  event.preventDefault()
  const buttons = Array.from(
    (event.currentTarget as HTMLElement).querySelectorAll<HTMLButtonElement>('[data-tab-key]'),
  )
  const enabled = buttons.filter((button) => !button.disabled)
  if (enabled.length === 0) return
  const currentIndex = enabled.findIndex(
    (button) => button.getAttribute('data-tab-key') === props.modelValue,
  )
  let nextIndex: number
  if (event.key === 'Home') nextIndex = 0
  else if (event.key === 'End') nextIndex = enabled.length - 1
  else if (event.key === 'ArrowRight') {
    nextIndex = currentIndex < 0 ? 0 : (currentIndex + 1) % enabled.length
  } else {
    nextIndex =
      currentIndex < 0 ? enabled.length - 1 : (currentIndex - 1 + enabled.length) % enabled.length
  }
  const target = enabled[nextIndex]
  if (!target) return
  const tab = props.tabs.find((candidate) => candidate.key === target.dataset.tabKey)
  if (tab) select(tab)
  else target.focus()
}
</script>

<template>
  <div class="ui-tabs" :class="`ui-tabs--${size}`">
    <div
      ref="listRef"
      class="ui-tabs__list"
      role="tablist"
      :aria-label="ariaLabel"
      @keydown="onKeydown"
    >
      <button
        v-for="tab in tabs"
        :key="tab.key"
        class="ui-tabs__tab"
        :class="{ 'is-active': tab.key === modelValue }"
        type="button"
        role="tab"
        :aria-selected="tab.key === modelValue"
        :data-tab-key="tab.key"
        :title="tab.title"
        :disabled="tab.disabled"
        :tabindex="tab.key === modelValue ? 0 : -1"
        @click="select(tab)"
      >
        <span class="ui-tabs__label">{{ tab.label }}</span>
        <span v-if="tab.badge !== undefined && tab.badge !== ''" class="ui-tabs__badge">
          {{ tab.badge }}
        </span>
      </button>
    </div>
    <div v-if="$slots.extra" class="ui-tabs__extra">
      <slot name="extra" />
    </div>
  </div>
</template>

<style scoped>
.ui-tabs {
  display: flex;
  align-items: stretch;
  min-width: 0;
  border-bottom: 1px solid var(--border);
  background: var(--bg-elev);
}

.ui-tabs__list {
  display: flex;
  align-items: stretch;
  flex: 1 1 auto;
  min-width: 0;
  overflow-x: auto;
  scrollbar-width: none;
}

.ui-tabs__tab {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  flex: none;
  height: 34px;
  padding: 0 14px;
  border-bottom: 2px solid transparent;
  background: transparent;
  color: var(--text-dim);
  font-size: 12.5px;
  font-weight: 500;
  white-space: nowrap;
  transition:
    color 120ms ease,
    border-color 120ms ease,
    background-color 120ms ease;
}

.ui-tabs--sm .ui-tabs__tab {
  height: 34px;
  padding: 0 12px;
  font-size: 12px;
}

.ui-tabs__tab:hover:not(:disabled) {
  background: var(--bg-hover);
  color: var(--text);
}

.ui-tabs__tab.is-active {
  border-bottom-color: var(--accent);
  color: var(--text);
}

.ui-tabs__tab:focus-visible {
  outline: none;
  box-shadow: inset 0 0 0 2px var(--accent);
}

.ui-tabs__tab:disabled {
  opacity: 0.38;
  cursor: not-allowed;
}

.ui-tabs__badge {
  min-width: 16px;
  padding: 0 4px;
  border-radius: 2px;
  background: var(--accent);
  color: var(--on-accent);
  font-family: var(--font-mono);
  font-size: 10px;
  line-height: 16px;
  text-align: center;
}

.ui-tabs__extra {
  display: flex;
  align-items: center;
  gap: var(--space-1);
  flex: none;
  padding: 0 var(--space-2);
}
</style>
