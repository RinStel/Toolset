<script setup lang="ts">
/**
 * 会话标签栏（plan §8.3 / §8.1）。
 *
 * 标签显示状态灯、名称、未读数与转发图标；右键或「⋯」菜单提供：重命名、断开、关闭。点击标签会把它绑定到当前焦点 Pane。
 *
 * 标签栏右侧是分屏开关与（窄屏时）侧栏抽屉入口。
 */

import { computed, nextTick, onBeforeUnmount, onMounted, ref } from 'vue'
import {
  Columns2,
  Gauge,
  LayoutPanelLeft,
  Menu,
  MoreHorizontal,
  PanelLeftClose,
  PanelLeftOpen,
  Pencil,
  Rows2,
  Terminal,
  Unplug,
  X,
} from 'lucide-vue-next'

import UiIconButton from '@/shared/ui/components/UiIconButton.vue'

import {
  serialLayout,
  setPaneView,
  setSplitMode,
  type PaneView,
  type SplitMode,
} from '../stores/layout'
import { bridgeRulesForSession } from '../stores/bridge'
import {
  closeSession,
  disconnectSession,
  ensurePanesHaveSessions,
  getSessionView,
  noteTerminalSessionShown,
  renameSession,
  selectSession,
  serialSessions,
  setFocusedPane,
} from '../stores/sessions'

const props = withDefaults(
  defineProps<{ narrow?: boolean; sidebarCollapsed?: boolean; effectiveSplit?: SplitMode }>(),
  {
    narrow: false,
    sidebarCollapsed: false,
    effectiveSplit: 'off',
  },
)

const emit = defineEmits<{ 'open-sidebar': []; 'toggle-sidebar': [] }>()

const views = computed(() => serialSessions.views)
const activeId = computed(() => serialSessions.panes[serialSessions.focusedPane])
const split = computed(() => serialLayout.split)

function isBound(sessionId: string): boolean {
  return serialSessions.panes[0] === sessionId || serialSessions.panes[1] === sessionId
}

function hasBridge(sessionId: string): boolean {
  return bridgeRulesForSession(sessionId).length > 0
}

function isBridgePaused(sessionId: string): boolean {
  return bridgeRulesForSession(sessionId).some((rule) => rule.paused)
}

const primaryPaneView = computed<PaneView>(() => serialLayout.panes[0].view)
const isComboSplit = computed(
  () =>
    props.effectiveSplit === 'horizontal' &&
    serialLayout.panes[0].view === 'terminal' &&
    serialLayout.panes[1].view === 'dashboard',
)

function selectTab(sessionId: string): void {
  closeMenu()
  selectSession(serialSessions.focusedPane, sessionId)
}

function setSingleView(next: PaneView): void {
  setFocusedPane(0)
  setPaneView(0, next)
  if (next === 'terminal' && serialSessions.panes[0] !== null) {
    noteTerminalSessionShown(0, serialSessions.panes[0])
  }
}

function toggleComboSplit(): void {
  if (isComboSplit.value) {
    setSplitMode('off')
    setPaneView(0, 'terminal')
    return
  }
  setPaneView(0, 'terminal')
  setPaneView(1, 'dashboard')
  setSplitMode('horizontal')
  ensurePanesHaveSessions()
  if (serialSessions.panes[0] !== null && serialSessions.panes[1] === null) {
    const previousFocus = serialSessions.focusedPane
    selectSession(1, serialSessions.panes[0])
    setFocusedPane(previousFocus)
  }
}

function toggleSplit(direction: SplitMode): void {
  const next: SplitMode = serialLayout.split === direction ? 'off' : direction
  setSplitMode(next)
  if (next !== 'off') ensurePanesHaveSessions()
}

/* ------------------------------------------------------------------------- */
/* 右键 / 「⋯」菜单                                                            */
/* ------------------------------------------------------------------------- */

const menuFor = ref<string | null>(null)
const menuRoot = ref<HTMLElement | null>(null)

function openMenu(sessionId: string): void {
  menuFor.value = menuFor.value === sessionId ? null : sessionId
}

function closeMenu(): void {
  menuFor.value = null
}

function menuView() {
  return getSessionView(menuFor.value)
}

function canDisconnect(): boolean {
  const state = menuView()?.state
  return state === 'open' || state === 'opening'
}

function renameFromMenu(): void {
  const sessionId = menuFor.value
  closeMenu()
  if (sessionId) void startRename(sessionId)
}

function disconnectFromMenu(): void {
  const sessionId = menuFor.value
  closeMenu()
  if (sessionId) void disconnectSession(sessionId)
}

function closeFromMenu(): void {
  const sessionId = menuFor.value
  closeMenu()
  if (sessionId) void closeSession(sessionId)
}

/* ------------------------------------------------------------------------- */
/* 重命名                                                                     */
/* ------------------------------------------------------------------------- */

const renamingId = ref<string | null>(null)
const renameDraft = ref('')
const listRef = ref<HTMLElement | null>(null)

async function startRename(sessionId: string): Promise<void> {
  const view = getSessionView(sessionId)
  if (!view) return
  renamingId.value = sessionId
  renameDraft.value = view.name
  await nextTick()
  const input = listRef.value?.querySelector<HTMLInputElement>('.serial-tabs__rename')
  input?.focus()
  input?.select()
}

function commitRename(): void {
  const sessionId = renamingId.value
  if (!sessionId) return
  renamingId.value = null
  renameSession(sessionId, renameDraft.value)
}

function cancelRename(): void {
  renamingId.value = null
}

/* ------------------------------------------------------------------------- */
/* 全局键盘与点击外部                                                          */
/* ------------------------------------------------------------------------- */

function onDocumentKeydown(event: KeyboardEvent): void {
  if (event.key === 'Escape') {
    closeMenu()
    return
  }
  if (event.isComposing) return
  if (!event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return
  const match = /^([1-9])$/.exec(event.key)
  if (!match) return
  const index = Number(match[1]) - 1
  const view = serialSessions.views[index]
  if (!view) return
  event.preventDefault()
  selectSession(serialSessions.focusedPane, view.id)
}

function onDocumentPointerDown(event: PointerEvent): void {
  if (menuFor.value === null) return
  const root = menuRoot.value
  if (root && event.target instanceof Node && root.contains(event.target)) return
  closeMenu()
}

onMounted(() => {
  document.addEventListener('keydown', onDocumentKeydown)
  document.addEventListener('pointerdown', onDocumentPointerDown, true)
})

onBeforeUnmount(() => {
  document.removeEventListener('keydown', onDocumentKeydown)
  document.removeEventListener('pointerdown', onDocumentPointerDown, true)
})
</script>

<template>
  <div class="serial-tabs">
    <button
      v-if="narrow"
      class="serial-tabs__drawer-button"
      type="button"
      title="打开通道侧栏"
      @click="emit('open-sidebar')"
    >
      <Menu :size="16" aria-hidden="true" />
      <span>通道</span>
    </button>
    <button
      v-else
      class="serial-tabs__sidebar-toggle"
      type="button"
      :title="sidebarCollapsed ? '展开通道侧栏' : '收起通道侧栏'"
      :aria-label="sidebarCollapsed ? '展开通道侧栏' : '收起通道侧栏'"
      :aria-pressed="!sidebarCollapsed"
      data-testid="sidebar-collapse-toggle"
      @click="emit('toggle-sidebar')"
    >
      <PanelLeftOpen v-if="sidebarCollapsed" :size="15" aria-hidden="true" />
      <PanelLeftClose v-else :size="15" aria-hidden="true" />
    </button>

    <div ref="listRef" class="serial-tabs__list" role="tablist" aria-label="会话">
      <span v-if="views.length === 0" class="serial-tabs__empty-hint">未打开通道</span>
      <div
        v-for="view in views"
        :key="view.id"
        class="serial-tabs__tab"
        :class="{
          'is-active': view.id === activeId,
          'is-bound': isBound(view.id),
        }"
        :data-testid="`session-tab-${view.id}`"
        @contextmenu.prevent="openMenu(view.id)"
      >
        <div class="serial-tabs__tab-main" v-if="renamingId === view.id">
          <span class="serial-tabs__dot" :class="`is-${view.state}`" aria-hidden="true" />
          <input
            v-model="renameDraft"
            class="serial-tabs__rename"
            type="text"
            aria-label="重命名会话"
            @click.stop
            @keydown.enter.prevent="commitRename"
            @keydown.esc.prevent="cancelRename"
            @blur="commitRename"
          />
        </div>
        <button
          v-else
          class="serial-tabs__tab-main"
          type="button"
          role="tab"
          :aria-selected="view.id === activeId"
          @click="selectTab(view.id)"
        >
          <span class="serial-tabs__dot" :class="`is-${view.state}`" aria-hidden="true" />
          <span class="serial-tabs__name">{{ view.name }}</span>
          <span v-if="view.unread > 0" class="serial-tabs__unread">
            {{ view.unread > 99 ? '99+' : view.unread }}
          </span>
          <span
            v-if="hasBridge(view.id)"
            class="serial-tabs__bridge"
            :class="{ 'is-paused': isBridgePaused(view.id) }"
            title="参与转发规则"
            aria-hidden="true"
            >⇄</span
          >
        </button>
        <UiIconButton
          class="serial-tabs__more"
          label="会话操作"
          size="sm"
          @click.stop="openMenu(view.id)"
        >
          <MoreHorizontal :size="14" aria-hidden="true" />
        </UiIconButton>
      </div>
    </div>

    <div v-if="menuFor" ref="menuRoot" class="serial-tabs__menu" role="menu">
      <button class="serial-tabs__menu-item" type="button" role="menuitem" @click="renameFromMenu">
        <Pencil :size="13" aria-hidden="true" />
        重命名
      </button>
      <button
        class="serial-tabs__menu-item"
        type="button"
        role="menuitem"
        :disabled="!canDisconnect()"
        @click="disconnectFromMenu"
      >
        <Unplug :size="13" aria-hidden="true" />
        断开
      </button>
      <button
        class="serial-tabs__menu-item is-danger"
        type="button"
        role="menuitem"
        @click="closeFromMenu"
      >
        <X :size="13" aria-hidden="true" />
        关闭
      </button>
    </div>

    <div class="serial-tabs__extra">
      <template v-if="effectiveSplit === 'off'">
        <div class="serial-tabs__view-switch" role="radiogroup" aria-label="主视图">
          <button
            class="serial-tabs__view-button"
            :class="{ 'is-active': primaryPaneView === 'terminal' }"
            type="button"
            role="radio"
            :aria-checked="primaryPaneView === 'terminal'"
            data-testid="pane-view-terminal"
            @click="setSingleView('terminal')"
          >
            <Terminal :size="12" aria-hidden="true" />
            <span>终端</span>
          </button>
          <button
            class="serial-tabs__view-button"
            :class="{ 'is-active': primaryPaneView === 'dashboard' }"
            type="button"
            role="radio"
            :aria-checked="primaryPaneView === 'dashboard'"
            data-testid="pane-view-dashboard"
            @click="setSingleView('dashboard')"
          >
            <Gauge :size="12" aria-hidden="true" />
            <span>仪表盘</span>
          </button>
        </div>
        <span class="serial-tabs__divider" aria-hidden="true" />
      </template>

      <button
        class="serial-tabs__combo"
        :class="{ 'is-active': isComboSplit }"
        type="button"
        :disabled="narrow"
        :aria-pressed="isComboSplit"
        title="同屏布局：左侧终端 + 右侧仪表盘"
        data-testid="split-combo-toggle"
        @click="toggleComboSplit"
      >
        <LayoutPanelLeft :size="13" aria-hidden="true" />
        <span>同屏：终端+仪表盘</span>
      </button>
      <UiIconButton
        label="左右分屏"
        size="sm"
        :active="split === 'horizontal'"
        :disabled="narrow"
        data-testid="split-toggle"
        @click="toggleSplit('horizontal')"
      >
        <Columns2 :size="15" aria-hidden="true" />
      </UiIconButton>
      <UiIconButton
        label="上下分屏"
        size="sm"
        :active="split === 'vertical'"
        :disabled="narrow"
        data-testid="split-vertical-toggle"
        @click="toggleSplit('vertical')"
      >
        <Rows2 :size="15" aria-hidden="true" />
      </UiIconButton>
    </div>
  </div>
</template>

<style scoped>
.serial-tabs {
  position: relative;
  display: flex;
  align-items: stretch;
  flex: none;
  height: 36px;
  min-width: 0;
  border-bottom: 1px solid var(--border);
  background: var(--bg-elev);
}

.serial-tabs__drawer-button {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  flex: none;
  padding: 0 var(--space-3);
  border-right: 1px solid var(--border);
  color: var(--text-dim);
  font-size: 12px;
}

.serial-tabs__drawer-button:hover {
  color: var(--text);
  background: var(--bg-hover);
}

.serial-tabs__drawer-button:focus-visible,
.serial-tabs__sidebar-toggle:focus-visible {
  outline: none;
  box-shadow: inset 0 0 0 2px var(--accent);
}

.serial-tabs__sidebar-toggle {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex: none;
  width: 32px;
  border-right: 1px solid var(--border);
  color: var(--text-dim);
  background: transparent;
}

.serial-tabs__sidebar-toggle:hover {
  color: var(--text);
  background: var(--bg-hover);
}

.serial-tabs__list {
  display: flex;
  align-items: stretch;
  flex: 1 1 auto;
  min-width: 0;
  overflow-x: auto;
  scrollbar-width: none;
}

.serial-tabs__tab {
  display: flex;
  align-items: stretch;
  flex: none;
  max-width: 220px;
  border-right: 1px solid var(--border);
  background: transparent;
}

.serial-tabs__tab.is-bound {
  background: var(--bg-hover);
}

.serial-tabs__tab.is-active {
  background: var(--bg);
  box-shadow: inset 0 -2px 0 var(--accent);
}

.serial-tabs__tab-main {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
  height: 100%;
  padding: 0 10px;
  color: var(--text-faint);
  font-size: 12.5px;
}

.serial-tabs__tab.is-active .serial-tabs__tab-main {
  color: var(--text);
  font-weight: 600;
}

.serial-tabs__tab-main:hover {
  color: var(--text);
}

.serial-tabs__tab-main:focus-visible {
  outline: none;
  box-shadow: inset 0 0 0 2px var(--accent);
}

.serial-tabs__dot {
  flex: none;
  width: 7px;
  height: 7px;
  border-radius: 1px;
  background: var(--text-faint);
}

.serial-tabs__dot.is-open {
  background: var(--ok);
}

.serial-tabs__dot.is-opening,
.serial-tabs__dot.is-closing {
  background: var(--warn);
}

.serial-tabs__dot.is-error {
  background: var(--danger);
}

.serial-tabs__name {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.serial-tabs__rename {
  width: 110px;
  height: var(--control-h-sm);
  padding: 0 6px;
  border: 1px solid var(--accent);
  border-radius: var(--radius-sm);
  background: var(--bg-sunken);
  color: var(--text);
  font-size: 11px;
}

.serial-tabs__rename:focus-visible {
  outline: none;
  box-shadow: var(--focus-ring);
}

.serial-tabs__unread {
  flex: none;
  min-width: 18px;
  padding: 0 4px;
  border-radius: 2px;
  background: var(--accent);
  color: var(--on-accent);
  font-family: var(--font-mono);
  font-size: 11px;
  font-weight: 600;
  line-height: 18px;
  text-align: center;
}

.serial-tabs__bridge {
  flex: none;
  color: var(--accent);
  font-size: 11px;
}

.serial-tabs__bridge.is-paused {
  color: var(--warn);
}

.serial-tabs__more {
  align-self: center;
  margin-right: 2px;
  opacity: 0;
  transition: opacity 120ms ease;
}

.serial-tabs__tab:hover .serial-tabs__more,
.serial-tabs__tab.is-active .serial-tabs__more,
.serial-tabs__more:focus-visible {
  opacity: 1;
}

.serial-tabs__menu {
  position: absolute;
  top: calc(100% + 2px);
  right: var(--space-2);
  z-index: 40;
  display: flex;
  flex-direction: column;
  min-width: 140px;
  padding: 4px;
  border: 1px solid var(--border);
  border-radius: var(--radius);
  background: var(--bg-elev-2);
  box-shadow: var(--shadow-pop);
}

.serial-tabs__menu-item {
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

.serial-tabs__menu-item:hover:not(:disabled) {
  background: var(--bg-hover);
}

.serial-tabs__menu-item:focus-visible {
  outline: none;
  box-shadow: inset 0 0 0 1px var(--accent);
}

.serial-tabs__menu-item:disabled {
  opacity: 0.38;
}

.serial-tabs__menu-item.is-danger {
  color: var(--danger);
}

.serial-tabs__menu-item.is-danger:hover:not(:disabled) {
  background: var(--danger-soft);
}

.serial-tabs__empty-hint {
  display: inline-flex;
  align-items: center;
  padding: 0 var(--space-3);
  color: var(--text-faint);
  font-size: 12px;
  white-space: nowrap;
}

.serial-tabs__extra {
  display: flex;
  align-items: center;
  flex: none;
  gap: 4px;
  padding: 0 8px;
  border-left: 1px solid var(--border);
}

.serial-tabs__view-switch {
  display: inline-flex;
  align-items: center;
  gap: 2px;
  height: var(--control-h-sm);
  padding: 2px;
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  background: var(--bg-sunken);
}

.serial-tabs__view-button {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  height: calc(var(--control-h-sm) - 6px);
  padding: 0 9px;
  border: 1px solid transparent;
  border-radius: 2px;
  background: transparent;
  color: var(--text-dim);
  font-size: 11.5px;
  font-weight: 500;
  line-height: 1;
  white-space: nowrap;
}

.serial-tabs__view-button:hover {
  color: var(--text);
}

.serial-tabs__view-button:focus-visible {
  outline: none;
  box-shadow: var(--focus-ring);
}

.serial-tabs__view-button.is-active {
  border-color: var(--border-strong);
  background: var(--bg-elev-2);
  color: var(--accent);
}

.serial-tabs__divider {
  width: 1px;
  height: 16px;
  margin: 0 2px;
  background: var(--border);
}

.serial-tabs__combo {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  height: var(--control-h-sm);
  padding: 0 8px;
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  background: transparent;
  color: var(--text-dim);
  font-size: 11.5px;
  font-weight: 500;
  white-space: nowrap;
}

.serial-tabs__combo:hover:not(:disabled) {
  border-color: var(--border-strong);
  background: var(--bg-hover);
  color: var(--text);
}

.serial-tabs__combo.is-active {
  border-color: var(--accent);
  background: var(--accent-soft);
  color: var(--accent);
}

.serial-tabs__combo:disabled {
  opacity: 0.4;
}

.serial-tabs__combo:focus-visible {
  outline: none;
  box-shadow: var(--focus-ring);
}
</style>
