<script setup lang="ts">
/**
 * 串口助手主视图（plan §8.1）。
 *
 * 布局：280px 侧栏 +（标签栏 + 一或两个 Pane）。窗口宽度小于 900px 时侧栏改为抽屉，
 * 并强制关闭分屏。Pane 内是日志工具栏 / 日志列表 / 可拖动发送面板 / 状态栏。
 */

import { computed, onBeforeUnmount, onMounted, ref, watch, watchEffect } from 'vue'
import { Cable } from 'lucide-vue-next'

import UiButton from '@/shared/ui/components/UiButton.vue'
import UiDrawer from '@/shared/ui/components/UiDrawer.vue'
import UiEmpty from '@/shared/ui/components/UiEmpty.vue'
import UiSplitPane from '@/shared/ui/components/UiSplitPane.vue'

import { serialLayout, setPaneView, setSplitRatio } from '../stores/layout'
import {
  listTransportProviders,
  requestProvider,
  selectSession,
  serialSessions,
  setFocusedPane,
} from '../stores/sessions'
import { applyColorVariables, serialSettings } from '../stores/settings'
import ChannelSidebar from '../components/ChannelSidebar.vue'
import SessionPane from '../components/SessionPane.vue'
import SessionTabs from '../components/SessionTabs.vue'

/** 侧栏切换为抽屉的窗口宽度断点（plan §7.4）。 */
const NARROW_MAX_WIDTH = 900

const rootRef = ref<HTMLElement | null>(null)
const sidebarOpen = ref(false)
const sidebarCollapsed = ref(false)
const narrow = ref(false)
let mediaQuery: MediaQueryList | null = null

const views = computed(() => serialSessions.views)

/** 没有会话时仍允许显示仪表盘（plan §8.1）。 */
const hasDashboardPane = computed(() =>
  serialLayout.panes.some((pane) => pane.view === 'dashboard'),
)

const showPanes = computed(() => views.value.length > 0 || hasDashboardPane.value)

/** 没有会话时从空状态打开仪表盘。 */
function openEmptyDashboard(): void {
  setPaneView(0, 'dashboard')
}

const effectiveSplit = computed<'off' | 'horizontal' | 'vertical'>(() =>
  narrow.value ? 'off' : serialLayout.split,
)

const splitDirection = computed<'horizontal' | 'vertical'>(() =>
  serialLayout.split === 'vertical' ? 'vertical' : 'horizontal',
)

const emptyProviders = computed(() =>
  listTransportProviders()
    .filter((provider) => provider.kind !== 'virtual' || serialSettings.showDemoProvider)
    .map((provider) => ({ provider, support: provider.isSupported() })),
)

const unsupportedProviders = computed(() =>
  emptyProviders.value.filter((entry) => !entry.support.ok),
)

function onMediaChange(event: MediaQueryListEvent): void {
  narrow.value = event.matches
  if (event.matches) sidebarOpen.value = false
}

function onSidebarAction(): void {
  if (narrow.value) sidebarOpen.value = false
}

watch(narrow, (value) => {
  if (value) sidebarOpen.value = false
})

// 分屏关闭（含窄屏强制关闭）后只显示第一个 Pane：把焦点与绑定收回到 Pane 0。
watch(
  effectiveSplit,
  (value) => {
    if (value !== 'off' || serialSessions.focusedPane !== 1) return
    if (serialSessions.panes[0] === null && serialSessions.panes[1] !== null) {
      selectSession(0, serialSessions.panes[1])
      return
    }
    setFocusedPane(0)
  },
  { immediate: true },
)

// 颜色设置写到工具根元素；根元素挂载后生效，设置面板修改时立即更新。
watchEffect(() => {
  applyColorVariables(rootRef.value)
})

onMounted(() => {
  if (typeof window !== 'undefined' && typeof window.matchMedia === 'function') {
    mediaQuery = window.matchMedia(`(max-width: ${NARROW_MAX_WIDTH}px)`)
    narrow.value = mediaQuery.matches
    mediaQuery.addEventListener('change', onMediaChange)
  }
})

onBeforeUnmount(() => {
  mediaQuery?.removeEventListener('change', onMediaChange)
  mediaQuery = null
})
</script>

<template>
  <div ref="rootRef" class="serial-tool" data-testid="serial-tool">
    <div class="serial-tool__body">
      <div v-if="!narrow && !sidebarCollapsed" class="serial-tool__sidebar">
        <ChannelSidebar @action="onSidebarAction" />
      </div>

      <div class="serial-tool__main">
        <template v-if="showPanes">
          <SessionTabs
            :narrow="narrow"
            :sidebar-collapsed="sidebarCollapsed"
            :effective-split="effectiveSplit"
            @open-sidebar="sidebarOpen = true"
            @toggle-sidebar="sidebarCollapsed = !sidebarCollapsed"
          />
          <div class="serial-tool__panes">
            <SessionPane
              v-if="effectiveSplit === 'off'"
              :pane-index="0"
              :session-id="serialSessions.panes[0]"
              :split="false"
            />
            <UiSplitPane
              v-else
              :direction="splitDirection"
              :ratio="serialLayout.ratio"
              :min="0.2"
              :max="0.8"
              @update:ratio="setSplitRatio"
            >
              <template #first>
                <SessionPane :pane-index="0" :session-id="serialSessions.panes[0]" :split="true" />
              </template>
              <template #second>
                <SessionPane :pane-index="1" :session-id="serialSessions.panes[1]" :split="true" />
              </template>
            </UiSplitPane>
          </div>
        </template>

        <div v-else class="serial-tool__empty">
          <UiEmpty
            :icon="Cable"
            eyebrow="NO CHANNEL"
            title="还没有打开的通道"
            description="从通道栏新增一个串口或演示端口开始调试。"
          >
            <template v-for="item in emptyProviders" :key="item.provider.kind">
              <UiButton
                size="sm"
                :disabled="!item.support.ok"
                @click="requestProvider(item.provider.kind)"
              >
                {{ item.provider.addLabel }}
              </UiButton>
            </template>
            <UiButton v-if="narrow" size="sm" variant="ghost" @click="sidebarOpen = true">
              打开通道侧栏
            </UiButton>
            <UiButton
              size="sm"
              variant="ghost"
              data-testid="empty-open-dashboard"
              @click="openEmptyDashboard"
            >
              打开仪表盘
            </UiButton>
            <p
              v-for="item in unsupportedProviders"
              :key="`reason-${item.provider.kind}`"
              class="serial-tool__empty-reason"
            >
              {{ item.support.reason }}
            </p>
          </UiEmpty>
        </div>
      </div>
    </div>

    <UiDrawer v-model="sidebarOpen" title="通道" width="300px">
      <ChannelSidebar @action="onSidebarAction" />
    </UiDrawer>
  </div>
</template>

<style scoped>
.serial-tool {
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 0;
  background: var(--bg);
}

.serial-tool__body {
  display: flex;
  flex: 1 1 auto;
  min-width: 0;
  min-height: 0;
}

.serial-tool__sidebar {
  flex: none;
  width: 280px;
  min-height: 0;
  border-right: 1px solid var(--border);
  background: var(--bg-elev);
}

.serial-tool__main {
  display: flex;
  flex-direction: column;
  flex: 1 1 auto;
  min-width: 0;
  min-height: 0;
  background: var(--bg);
}

.serial-tool__panes {
  flex: 1 1 auto;
  min-width: 0;
  min-height: 0;
}

.serial-tool__empty {
  display: flex;
  align-items: center;
  justify-content: center;
  flex: 1 1 auto;
  min-height: 0;
  background: var(--bg);
}

.serial-tool__empty-reason {
  flex-basis: 100%;
  margin: 0;
  color: var(--warn);
  font-size: 11px;
  line-height: 1.5;
}
</style>
