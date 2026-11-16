<script setup lang="ts">
/**
 * 一个 Pane（plan §8.1 / §8.10）。
 *
 * 顶部右侧的分段控件切换「终端 | 仪表盘」：终端视图是日志工具栏 / 日志列表 /
 * 可拖动发送面板 / 状态栏；仪表盘视图通过 `defineAsyncComponent` 加载
 * `dashboard/DashboardPane.vue`（只使用终端时不加载仪表盘代码与 uPlot）。
 *
 * 焦点 Pane 由 sessions store 记录；点击 Pane 任意位置都会把它设为焦点。
 */

import { computed, defineAsyncComponent, onBeforeUnmount, onMounted, ref, watch } from 'vue'

import UiButton from '@/shared/ui/components/UiButton.vue'
import UiEmpty from '@/shared/ui/components/UiEmpty.vue'
import UiSplitPane from '@/shared/ui/components/UiSplitPane.vue'

import {
  SEND_PANEL_HEIGHT_MAX,
  SEND_PANEL_HEIGHT_MIN,
  SPLIT_RATIO_MAX,
  SPLIT_RATIO_MIN,
  serialLayout,
  setPaneView,
  setSendPanelHeight,
  updatePaneViewSettings,
  type PaneView,
} from '../stores/layout'
import {
  getSessionInstance,
  getSessionView,
  listTransportProviders,
  noteTerminalSessionShown,
  requestProvider,
  serialSessions,
  setFocusedPane,
} from '../stores/sessions'
import { serialSettings } from '../stores/settings'
import LogList from './LogList.vue'
import LogToolbar from './LogToolbar.vue'
import SendPanel from './SendPanel.vue'
import StatusBar from './StatusBar.vue'

/** 仪表盘视图必须异步加载（plan §8.1 / check-chunks 规则 4）。 */
const DashboardPane = defineAsyncComponent(() => import('../dashboard/DashboardPane.vue'))

const props = withDefaults(
  defineProps<{
    paneIndex: number
    sessionId: string | null
    split?: boolean
  }>(),
  { split: false },
)

const view = computed(() => getSessionView(props.sessionId))
const focused = computed(() => serialSessions.focusedPane === props.paneIndex)
const paneSettings = computed(() => serialLayout.panes[props.paneIndex] ?? serialLayout.panes[0])
const paneView = computed<PaneView>(() => paneSettings.value.view)

const search = ref('')
const paused = ref(false)

const mainRef = ref<HTMLElement | null>(null)
const containerHeight = ref(0)
const liveRatio = ref(0.65)
let observer: ResizeObserver | null = null

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

function computeRatio(): number {
  const height = containerHeight.value
  if (height <= 0) return 0.65
  return clamp(1 - serialLayout.sendPanelHeight / height, SPLIT_RATIO_MIN, SPLIT_RATIO_MAX)
}

function measure(): void {
  const element = mainRef.value
  if (!element) return
  containerHeight.value = element.clientHeight
  liveRatio.value = computeRatio()
}

function onRatioChange(value: number): void {
  liveRatio.value = value
}

function onResizeEnd(): void {
  const height = containerHeight.value
  if (height <= 0) return
  const maxHeight = Math.min(SEND_PANEL_HEIGHT_MAX, Math.round(height * (1 - SPLIT_RATIO_MIN)))
  const next = Math.round(clamp((1 - liveRatio.value) * height, SEND_PANEL_HEIGHT_MIN, maxHeight))
  setSendPanelHeight(next)
}

function setView(next: PaneView): void {
  setFocusedPane(props.paneIndex)
  setPaneView(props.paneIndex, next)
  if (next === 'terminal' && props.sessionId) {
    noteTerminalSessionShown(props.paneIndex, props.sessionId)
  }
}

onMounted(() => {
  measure()
  const element = mainRef.value
  if (element && typeof ResizeObserver !== 'undefined') {
    observer = new ResizeObserver(() => {
      containerHeight.value = element.clientHeight
      liveRatio.value = computeRatio()
    })
    observer.observe(element)
  }
  window.addEventListener('resize', measure)
})

onBeforeUnmount(() => {
  observer?.disconnect()
  observer = null
  window.removeEventListener('resize', measure)
})

watch(
  () => props.sessionId,
  () => {
    search.value = ''
    paused.value = false
    if (props.sessionId) noteTerminalSessionShown(props.paneIndex, props.sessionId)
    // 切换会话时让 Pane 显示该会话记忆的显示模式（预设 / 设备记忆依赖）。
    const session = getSessionInstance(props.sessionId)
    if (!session) return
    const pane = serialLayout.panes[props.paneIndex] ?? serialLayout.panes[0]
    if (pane.displayMode !== session.displayMode) {
      updatePaneViewSettings(props.paneIndex, { displayMode: session.displayMode })
    }
  },
  { immediate: true },
)

watch(
  () => paneView.value,
  (next) => {
    if (next === 'terminal' && props.sessionId) {
      noteTerminalSessionShown(props.paneIndex, props.sessionId)
    }
  },
)

const emptyProviders = computed(() => {
  return listTransportProviders()
    .filter((provider) => provider.kind !== 'virtual' || serialSettings.showDemoProvider)
    .map((provider) => ({ provider, support: provider.isSupported() }))
})
</script>

<template>
  <div
    class="session-pane"
    :class="{ 'is-focused': focused }"
    @pointerdown.capture="setFocusedPane(paneIndex)"
  >
    <div v-if="split" class="session-pane__viewbar">
      <span class="session-pane__pane-badge">窗格 {{ paneIndex + 1 }}</span>
      <span v-if="paneView === 'dashboard' || view" class="session-pane__view-name">
        · {{ paneView === 'dashboard' ? '仪表盘' : view?.name }}
      </span>
      <div class="session-pane__view-switch" role="radiogroup" aria-label="Pane 视图">
        <button
          class="session-pane__view-button"
          :class="{ 'is-active': paneView === 'terminal' }"
          type="button"
          role="radio"
          :aria-checked="paneView === 'terminal'"
          data-testid="pane-view-terminal"
          @click="setView('terminal')"
        >
          终端
        </button>
        <button
          class="session-pane__view-button"
          :class="{ 'is-active': paneView === 'dashboard' }"
          type="button"
          role="radio"
          :aria-checked="paneView === 'dashboard'"
          data-testid="pane-view-dashboard"
          @click="setView('dashboard')"
        >
          仪表盘
        </button>
      </div>
    </div>

    <template v-if="paneView === 'dashboard'">
      <DashboardPane :pane-index="paneIndex" :session-id="sessionId" />
    </template>

    <template v-else-if="view">
      <LogToolbar
        v-model:search="search"
        v-model:paused="paused"
        :session-id="sessionId"
        :pane-index="paneIndex"
      />
      <div ref="mainRef" class="session-pane__main">
        <UiSplitPane
          direction="vertical"
          :ratio="liveRatio"
          :min="SPLIT_RATIO_MIN"
          :max="SPLIT_RATIO_MAX"
          @update:ratio="onRatioChange"
          @resize-end="onResizeEnd"
        >
          <template #first>
            <LogList
              :session-id="sessionId"
              :pane-index="paneIndex"
              :search="search"
              :paused="paused"
            />
          </template>
          <template #second>
            <SendPanel :session-id="sessionId" />
          </template>
        </UiSplitPane>
      </div>
      <StatusBar :session-id="sessionId" />
    </template>

    <div v-else class="session-pane__empty">
      <UiEmpty
        compact
        title="该窗格还没有通道"
        description="从侧栏新增端口，或在标签页中选择一个通道。"
      >
        <UiButton
          v-for="item in emptyProviders"
          :key="item.provider.kind"
          size="sm"
          :disabled="!item.support.ok"
          @click="requestProvider(item.provider.kind)"
        >
          {{ item.provider.addLabel }}
        </UiButton>
      </UiEmpty>
    </div>
  </div>
</template>

<style scoped>
.session-pane {
  display: flex;
  flex-direction: column;
  height: 100%;
  min-width: 0;
  min-height: 0;
  background: var(--bg);
}

.session-pane.is-focused {
  box-shadow: inset 0 0 0 1px var(--accent-soft);
}

.session-pane__viewbar {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  flex: none;
  height: 28px;
  padding: 0 8px;
  border-bottom: 1px solid var(--border);
  background: var(--bg-elev);
}

.session-pane__pane-badge {
  flex: none;
  color: var(--text-dim);
  font-size: 11px;
  font-weight: 600;
}

.session-pane.is-focused .session-pane__pane-badge {
  color: var(--accent);
}

.session-pane__view-name {
  min-width: 0;
  overflow: hidden;
  color: var(--text-dim);
  font-size: 11.5px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.session-pane__view-switch {
  display: inline-flex;
  align-items: stretch;
  gap: 2px;
  margin-left: auto;
  padding: 2px;
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  background: var(--bg-sunken);
}

.session-pane__view-button {
  height: 20px;
  padding: 0 10px;
  border: 1px solid transparent;
  border-radius: 2px;
  background: transparent;
  color: var(--text-dim);
  font-size: 11px;
  font-weight: 500;
  line-height: 1;
}

.session-pane__view-button:hover {
  color: var(--text);
}

.session-pane__view-button:focus-visible {
  outline: none;
  box-shadow: var(--focus-ring);
}

.session-pane__view-button.is-active {
  border-color: var(--border-strong);
  background: var(--bg-elev-2);
  color: var(--accent);
}

.session-pane__main {
  position: relative;
  flex: 1 1 auto;
  min-height: 0;
  background: var(--bg-sunken);
}

.session-pane__empty {
  display: flex;
  align-items: center;
  justify-content: center;
  flex: 1 1 auto;
  min-height: 0;
  background: var(--bg);
}
</style>
