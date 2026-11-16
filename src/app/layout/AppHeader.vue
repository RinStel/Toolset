<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import { Boxes, ChevronDown, CircleHelp, Monitor, Moon, Settings, Sun } from 'lucide-vue-next'

import UiButton from '@/shared/ui/components/UiButton.vue'
import UiIconButton from '@/shared/ui/components/UiIconButton.vue'

import { APP_SUBTITLE, APP_TITLE } from '../config/app'
import { groupToolsByCategory } from '../config/categories'
import { tools } from '../registry'
import { appearance, cycleTheme, resolvedTheme, themeLabel } from '../stores/appearance'

const emit = defineEmits<{
  'open-settings': []
  'open-help': []
}>()

const router = useRouter()
const menuOpen = ref(false)
const menuRoot = ref<HTMLElement | null>(null)

const groups = computed(() => groupToolsByCategory(tools))

const themeIcon = computed(() => {
  if (appearance.theme === 'system') return Monitor
  return resolvedTheme.value === 'light' ? Sun : Moon
})

const themeButtonLabel = computed(() => `切换主题（当前：${themeLabel(appearance.theme)}）`)

function toggleMenu(): void {
  menuOpen.value = !menuOpen.value
}

function closeMenu(): void {
  menuOpen.value = false
}

function goHome(): void {
  closeMenu()
  void router.push('/')
}

function openTool(id: string): void {
  closeMenu()
  void router.push(`/tools/${id}`)
}

function onCycleTheme(): void {
  cycleTheme()
}

function onDocumentPointerDown(event: PointerEvent): void {
  const root = menuRoot.value
  if (root && event.target instanceof Node && root.contains(event.target)) return
  closeMenu()
}

function onDocumentKeydown(event: KeyboardEvent): void {
  if (event.key === 'Escape') closeMenu()
}

watch(menuOpen, (open) => {
  if (typeof document === 'undefined') return
  if (open) {
    document.addEventListener('pointerdown', onDocumentPointerDown, true)
    document.addEventListener('keydown', onDocumentKeydown)
  } else {
    document.removeEventListener('pointerdown', onDocumentPointerDown, true)
    document.removeEventListener('keydown', onDocumentKeydown)
  }
})

onBeforeUnmount(() => {
  if (typeof document === 'undefined') return
  document.removeEventListener('pointerdown', onDocumentPointerDown, true)
  document.removeEventListener('keydown', onDocumentKeydown)
})
</script>

<template>
  <header class="app-header">
    <div class="app-header__left">
      <button class="app-header__brand" type="button" title="返回首页" @click="goHome">
        <span class="app-header__mark" aria-hidden="true" />
        <span class="app-header__brand-name">{{ APP_TITLE }}</span>
        <span class="app-header__brand-divider" aria-hidden="true" />
        <span class="app-header__brand-sub">{{ APP_SUBTITLE }}</span>
      </button>
    </div>

    <div ref="menuRoot" class="app-header__center">
      <UiButton
        class="app-header__tools-trigger"
        size="md"
        aria-haspopup="menu"
        :aria-expanded="menuOpen"
        data-testid="tools-menu-trigger"
        @click="toggleMenu"
      >
        <Boxes :size="14" aria-hidden="true" />
        <span>工具</span>
        <ChevronDown :size="12" aria-hidden="true" />
      </UiButton>
      <div v-if="menuOpen" class="tools-menu" role="menu" aria-label="工具">
        <div v-if="groups.length === 0" class="tools-menu__empty">暂无可用工具</div>
        <div v-for="group in groups" :key="group.category.key" class="tools-menu__group">
          <div class="tools-menu__group-title">{{ group.category.title }}</div>
          <button
            v-for="tool in group.tools"
            :key="tool.id"
            class="tools-menu__item"
            type="button"
            role="menuitem"
            :data-testid="`tool-menu-${tool.id}`"
            @click="openTool(tool.id)"
          >
            <component :is="tool.icon" class="tools-menu__icon" :size="14" aria-hidden="true" />
            <span class="tools-menu__label">{{ tool.title }}</span>
          </button>
        </div>
      </div>
    </div>

    <div class="app-header__right">
      <UiIconButton
        class="app-header__icon"
        :label="themeButtonLabel"
        data-testid="theme-toggle"
        @click="onCycleTheme"
      >
        <component :is="themeIcon" :size="15" aria-hidden="true" />
      </UiIconButton>
      <UiIconButton
        class="app-header__icon"
        label="设置"
        data-testid="settings-open"
        @click="emit('open-settings')"
      >
        <Settings :size="15" aria-hidden="true" />
      </UiIconButton>
      <UiIconButton
        class="app-header__icon"
        label="帮助"
        data-testid="help-open"
        @click="emit('open-help')"
      >
        <CircleHelp :size="15" aria-hidden="true" />
      </UiIconButton>
    </div>
  </header>
</template>

<style scoped>
.app-header {
  position: relative;
  z-index: 20;
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto minmax(0, 1fr);
  align-items: center;
  height: var(--app-header-height, 44px);
  padding: 0 var(--space-3);
  border-bottom: 1px solid var(--border);
  background: var(--bg-elev);
}

.app-header__left {
  display: flex;
  align-items: center;
  min-width: 0;
}

.app-header__brand {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
  height: 32px;
  padding: 0 6px;
  border-radius: var(--radius-sm);
  color: var(--text);
  text-align: left;
  white-space: nowrap;
}

.app-header__brand:hover {
  background: var(--bg-hover);
}

.app-header__brand:focus-visible {
  outline: none;
  box-shadow: var(--focus-ring);
}

.app-header__mark {
  position: relative;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex: none;
  width: 20px;
  height: 20px;
  border-radius: 4px;
  background: var(--accent);
}

.app-header__mark::before {
  content: '';
  position: absolute;
  top: 5px;
  left: 5px;
  width: 10px;
  height: 2px;
  border-radius: 1px;
  background: var(--on-accent);
}

.app-header__mark::after {
  content: '';
  position: absolute;
  top: 7px;
  left: 9px;
  width: 2px;
  height: 8px;
  border-radius: 1px;
  background: var(--on-accent);
}

.app-header__brand-name {
  color: var(--text);
  font-family: var(--font-mono);
  font-size: 13px;
  font-weight: 600;
  letter-spacing: 0.01em;
}

.app-header__brand-divider {
  width: 1px;
  height: 14px;
  background: var(--border-strong);
}

.app-header__brand-sub {
  color: var(--text-faint);
  font-size: 11px;
}

.app-header__center {
  position: relative;
  display: flex;
  align-items: center;
  justify-content: center;
}

.app-header__right {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 2px;
}

.app-header__tools-trigger {
  height: 28px;
  padding: 0 10px;
  border: 1px solid var(--border);
  border-radius: 999px;
  background: var(--bg-elev-2);
  color: var(--text-dim);
}

.app-header__tools-trigger:hover:not(:disabled) {
  border-color: var(--border-strong);
  background: var(--bg-hover);
  color: var(--text);
}

.app-header__icon {
  border: 1px solid transparent;
  background: transparent;
  color: var(--text-dim);
}

.app-header__icon:hover:not(:disabled) {
  border-color: var(--border);
  background: var(--bg-hover);
  color: var(--text);
}

.tools-menu {
  position: absolute;
  top: calc(100% + 6px);
  left: 50%;
  z-index: 30;
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 208px;
  max-height: min(70vh, 480px);
  padding: 4px;
  overflow: auto;
  border: 1px solid var(--border);
  border-radius: var(--radius);
  background: var(--bg-elev-2);
  box-shadow: var(--shadow-pop);
  transform: translateX(-50%);
}

.tools-menu__group {
  display: flex;
  flex-direction: column;
  gap: 1px;
}

.tools-menu__group + .tools-menu__group {
  margin-top: 4px;
  padding-top: 4px;
  border-top: 1px solid var(--border);
}

.tools-menu__group-title {
  padding: 4px 8px;
  color: var(--text-faint);
  font-size: 10px;
  font-weight: 500;
  letter-spacing: 0.08em;
  text-transform: uppercase;
}

.tools-menu__item {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  height: var(--control-h);
  padding: 0 var(--space-2);
  border-radius: var(--radius-sm);
  color: var(--text);
  font-size: 12px;
  text-align: left;
  white-space: nowrap;
}

.tools-menu__item:hover,
.tools-menu__item:focus-visible {
  background: var(--bg-hover);
}

.tools-menu__item:focus-visible {
  outline: none;
  box-shadow: inset 0 0 0 1px var(--accent);
}

.tools-menu__icon {
  flex: none;
  color: var(--text-faint);
}

.tools-menu__label {
  overflow: hidden;
  text-overflow: ellipsis;
}

.tools-menu__empty {
  padding: var(--space-2);
  color: var(--text-dim);
  font-size: 11px;
  text-align: center;
}

@media (max-width: 900px) {
  .app-header__brand-divider,
  .app-header__brand-sub {
    display: none;
  }
}
</style>
