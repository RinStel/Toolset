<script setup lang="ts">
/**
 * 通道侧栏（plan §8.1 / §8.2）。
 *
 * 提供者入口、已授权端口列表、当前会话参数与控制线。协议、预设和转发规则的入口
 * 属于后续阶段，这里保留结构和位置注释。
 */

import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { ChevronDown, ChevronRight, Plus } from 'lucide-vue-next'

import type { LinkManagerAuthorizedEntry, TransportSupport } from '@/domains/link/public'
import UiBadge from '@/shared/ui/components/UiBadge.vue'
import UiButton from '@/shared/ui/components/UiButton.vue'
import UiEmpty from '@/shared/ui/components/UiEmpty.vue'

import {
  focusedSessionView,
  listAuthorizedTransports,
  listTransportProviders,
  openAuthorizedEntry,
  requestProvider,
  serialSessions,
} from '../stores/sessions'
import { serialSettings } from '../stores/settings'
import BridgePanel from './BridgePanel.vue'
import PresetPicker from './PresetPicker.vue'
import ProtocolPicker from './ProtocolPicker.vue'
import SessionSettings from './SessionSettings.vue'
import SignalControls from './SignalControls.vue'

const emit = defineEmits<{ action: [] }>()

const focused = computed(() => focusedSessionView())

const refreshTick = ref(0)

interface ProviderEntry {
  kind: string
  title: string
  addLabel: string
  support: TransportSupport
}

const providers = computed<ProviderEntry[]>(() => {
  // 依赖 refreshTick 让浏览器的支持状态在重新检查后刷新。
  void refreshTick.value
  return listTransportProviders()
    .filter((provider) => provider.kind !== 'virtual' || serialSettings.showDemoProvider)
    .map((provider) => ({
      kind: provider.kind,
      title: provider.title,
      addLabel: provider.addLabel,
      support: provider.isSupported(),
    }))
})

const pendingKind = ref<string | null>(null)
const presetOpen = ref(true)
const protocolOpen = ref(true)
const controlOpen = ref(false)

function toggleGroup(group: 'preset' | 'protocol' | 'control'): void {
  if (group === 'preset') presetOpen.value = !presetOpen.value
  else if (group === 'protocol') protocolOpen.value = !protocolOpen.value
  else controlOpen.value = !controlOpen.value
}

async function addProvider(kind: string): Promise<void> {
  if (pendingKind.value !== null) return
  pendingKind.value = kind
  try {
    await requestProvider(kind)
    await refreshAuthorized()
  } finally {
    pendingKind.value = null
    emit('action')
  }
}

const authorizedEntries = ref<LinkManagerAuthorizedEntry[]>([])
const loadingAuthorized = ref(false)

async function refreshAuthorized(): Promise<void> {
  refreshTick.value += 1
  loadingAuthorized.value = true
  try {
    authorizedEntries.value = await listAuthorizedTransports()
  } catch {
    authorizedEntries.value = []
  } finally {
    loadingAuthorized.value = false
  }
}

async function openEntry(entry: LinkManagerAuthorizedEntry): Promise<void> {
  await openAuthorizedEntry(entry)
  await refreshAuthorized()
  emit('action')
}

function entryKey(entry: LinkManagerAuthorizedEntry, index: number): string {
  return `${entry.provider.kind}:${entry.transport.deviceKey}:${String(index)}`
}

watch(
  () => serialSessions.views.length,
  () => {
    void refreshAuthorized()
  },
)

function onWindowFocus(): void {
  void refreshAuthorized()
}

onMounted(() => {
  void refreshAuthorized()
  window.addEventListener('focus', onWindowFocus)
})

onBeforeUnmount(() => {
  window.removeEventListener('focus', onWindowFocus)
})
</script>

<template>
  <aside class="channel-sidebar" data-testid="channel-sidebar">
    <section class="channel-sidebar__section">
      <h2 class="channel-sidebar__title">通道</h2>
      <div class="channel-sidebar__providers">
        <template v-for="provider in providers" :key="provider.kind">
          <UiButton
            block
            size="md"
            :disabled="!provider.support.ok || pendingKind === provider.kind"
            :data-testid="`add-provider-${provider.kind}`"
            @click="addProvider(provider.kind)"
          >
            <Plus :size="14" aria-hidden="true" />
            {{ provider.addLabel }}
          </UiButton>
          <p v-if="!provider.support.ok && provider.support.reason" class="channel-sidebar__reason">
            {{ provider.support.reason }}
          </p>
        </template>
      </div>
    </section>

    <section class="channel-sidebar__section">
      <h2 class="channel-sidebar__title">已授权端口</h2>
      <p v-if="loadingAuthorized && authorizedEntries.length === 0" class="channel-sidebar__hint">
        正在读取端口…
      </p>
      <p v-else-if="authorizedEntries.length === 0" class="channel-sidebar__hint">
        没有已授权的端口。点击上方的「新增」选择设备。
      </p>
      <div v-else class="channel-sidebar__ports">
        <button
          v-for="(entry, index) in authorizedEntries"
          :key="entryKey(entry, index)"
          class="channel-sidebar__port"
          type="button"
          @click="openEntry(entry)"
        >
          <span class="channel-sidebar__port-label">{{ entry.transport.label }}</span>
          <span class="channel-sidebar__port-key">{{ entry.transport.deviceKey }}</span>
          <UiBadge v-if="entry.sessionId !== null" tone="ok">已打开</UiBadge>
        </button>
      </div>
    </section>

    <section v-if="focused" class="channel-sidebar__section">
      <h2 class="channel-sidebar__title">当前会话</h2>
      <SessionSettings :session-id="focused.id" />

      <div class="channel-sidebar__group">
        <button
          class="channel-sidebar__group-toggle"
          type="button"
          :aria-expanded="presetOpen"
          aria-controls="channel-group-preset"
          @click="toggleGroup('preset')"
        >
          <ChevronDown v-if="presetOpen" :size="15" aria-hidden="true" />
          <ChevronRight v-else :size="15" aria-hidden="true" />
          <span>预设</span>
        </button>
        <div v-show="presetOpen" id="channel-group-preset" class="channel-sidebar__group-body">
          <PresetPicker :session-id="focused.id" />
        </div>
      </div>

      <div class="channel-sidebar__group">
        <button
          class="channel-sidebar__group-toggle"
          type="button"
          :aria-expanded="protocolOpen"
          aria-controls="channel-group-protocol"
          @click="toggleGroup('protocol')"
        >
          <ChevronDown v-if="protocolOpen" :size="15" aria-hidden="true" />
          <ChevronRight v-else :size="15" aria-hidden="true" />
          <span>协议</span>
        </button>
        <div v-show="protocolOpen" id="channel-group-protocol" class="channel-sidebar__group-body">
          <ProtocolPicker :session-id="focused.id" />
        </div>
      </div>

      <div class="channel-sidebar__group">
        <button
          class="channel-sidebar__group-toggle"
          type="button"
          :aria-expanded="controlOpen"
          aria-controls="channel-group-control"
          @click="toggleGroup('control')"
        >
          <ChevronDown v-if="controlOpen" :size="15" aria-hidden="true" />
          <ChevronRight v-else :size="15" aria-hidden="true" />
          <span>控制线</span>
        </button>
        <div v-show="controlOpen" id="channel-group-control" class="channel-sidebar__group-body">
          <SignalControls :session-id="focused.id" />
        </div>
      </div>

      <div class="channel-sidebar__group">
        <BridgePanel :session-id="focused.id" :default-expanded="false" />
      </div>
    </section>

    <section v-else class="channel-sidebar__section">
      <UiEmpty compact title="还没有打开的通道" description="新增一个串口或演示端口开始调试。" />
    </section>
  </aside>
</template>

<style scoped>
.channel-sidebar {
  display: flex;
  flex-direction: column;
  gap: 16px;
  height: 100%;
  min-height: 0;
  padding: 12px 12px 18px;
  overflow-y: auto;
  background: var(--bg-elev);
}

.channel-sidebar__section {
  display: flex;
  flex-direction: column;
  gap: 10px;
  min-width: 0;
}

.channel-sidebar__section + .channel-sidebar__section {
  padding-top: 14px;
  border-top: 1px solid var(--border);
}

.channel-sidebar__title {
  display: flex;
  align-items: center;
  gap: 10px;
  margin: 0;
  color: var(--text-faint);
  font-size: 11px;
  font-weight: 500;
  letter-spacing: 0.08em;
  text-transform: uppercase;
}

.channel-sidebar__title::after {
  content: '';
  flex: 1 1 auto;
  height: 1px;
  background: var(--border);
}

.channel-sidebar__subtitle {
  margin: 0;
  color: var(--text-faint);
  font-size: 11px;
  font-weight: 500;
  letter-spacing: 0.08em;
}

.channel-sidebar__group {
  display: flex;
  flex-direction: column;
  gap: 8px;
  min-width: 0;
}

.channel-sidebar__group-toggle {
  display: flex;
  align-items: center;
  gap: 6px;
  width: 100%;
  height: var(--control-h);
  padding: 0 8px;
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  background: var(--bg-sunken);
  color: var(--text);
  font-size: 12px;
  font-weight: 600;
  text-align: left;
}

.channel-sidebar__group-toggle:hover {
  border-color: var(--border-strong);
  background: var(--bg-hover);
  color: var(--text);
}

.channel-sidebar__group-toggle:focus-visible {
  outline: none;
  box-shadow: var(--focus-ring);
}

.channel-sidebar__group-body {
  padding: 0 2px;
}

.channel-sidebar__providers {
  display: grid;
  grid-template-columns: minmax(0, 1fr);
  gap: 8px;
}

.channel-sidebar__reason {
  margin: 0;
  color: var(--warn);
  font-size: 11px;
  line-height: 1.5;
}

.channel-sidebar__hint {
  margin: 0;
  color: var(--text-faint);
  font-size: 12px;
  line-height: 1.55;
}

.channel-sidebar__ports {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.channel-sidebar__port {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
  height: 32px;
  padding: 0 8px;
  border: 1px solid transparent;
  border-radius: var(--radius-sm);
  color: var(--text);
  font-size: 12.5px;
  text-align: left;
}

.channel-sidebar__port:hover {
  border-color: var(--border);
  background: var(--bg-hover);
}

.channel-sidebar__port:focus-visible {
  outline: none;
  box-shadow: var(--focus-ring);
}

.channel-sidebar__port-label {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.channel-sidebar__port-key {
  flex: none;
  margin-left: auto;
  color: var(--text-faint);
  font-family: var(--font-mono);
  font-size: 10.5px;
}

.channel-sidebar__divider {
  height: 1px;
  margin: 2px 0;
  background: var(--border);
}

.channel-sidebar :deep(.ui-badge) {
  flex: none;
  margin-left: 2px;
}
</style>
