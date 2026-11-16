<script setup lang="ts">
/**
 * 日志工具栏（plan §8.4）。每个 Pane 独立，设置持久化在 layout store 中。
 *
 * 搜索 / 暂停刷新属于 Pane 的临时界面状态，由 `SessionPane` 持有并通过 v-model 传入，
 * 不写入存储。
 */

import { computed } from 'vue'
import { Download, Pause, Play, Search, Trash2 } from 'lucide-vue-next'

import {
  DEFAULT_LOG_POLICY,
  exportLog,
  type DisplayMode,
  type ExportFormat,
} from '@/domains/link/public'
import type { LogMode } from '@/domains/link/public'
import { downloadBytes } from '@/shared/lib/download'
import UiButton from '@/shared/ui/components/UiButton.vue'
import UiInput from '@/shared/ui/components/UiInput.vue'
import UiMenu from '@/shared/ui/components/UiMenu.vue'
import UiNumberInput from '@/shared/ui/components/UiNumberInput.vue'
import UiSegmented from '@/shared/ui/components/UiSegmented.vue'
import UiSwitch from '@/shared/ui/components/UiSwitch.vue'
import { toast } from '@/shared/ui/services/toast'

import {
  LOG_FONT_SIZE_MAX,
  LOG_FONT_SIZE_MIN,
  serialLayout,
  updatePaneViewSettings,
  type PaneViewSettings,
} from '../stores/layout'
import {
  clearSessionLog,
  getSessionInstance,
  getSessionView,
  setSessionDisplayMode,
  setSessionLogPolicy,
} from '../stores/sessions'

const props = defineProps<{
  sessionId: string | null
  paneIndex: number
  search: string
  paused: boolean
}>()

const emit = defineEmits<{
  'update:search': [value: string]
  'update:paused': [value: boolean]
}>()

const view = computed(() => getSessionView(props.sessionId))
const paneSettings = computed<PaneViewSettings>(
  () => serialLayout.panes[props.paneIndex] ?? serialLayout.panes[0],
)
const hasProtocol = computed(() => {
  const protocol = view.value?.protocol
  return protocol !== null && protocol !== undefined && protocol.status === 'active'
})

const displayModeOptions = [
  { label: '原始', value: 'raw' },
  { label: '解析', value: 'decoded' },
  { label: '原始+解析', value: 'both' },
]

const exportItems = [
  { key: 'txt', label: '导出 TXT' },
  { key: 'csv', label: '导出 CSV' },
  { key: 'bin', label: '导出 BIN' },
]

/** 日志策略下拉的选项（plan §8.4）。 */
const logPolicyOptions = [
  { label: '全部记录', value: 'all' },
  { label: '抽样记录', value: 'sampled' },
  { label: '不记录数据帧', value: 'none' },
]

const logPolicy = computed(() => view.value?.logPolicy ?? DEFAULT_LOG_POLICY)
const logPolicyActive = computed(() => logPolicy.value.mode !== 'all')

const logPolicyTitle = computed(() => {
  const omitted = view.value?.omittedFrames ?? 0
  const suffix = omitted > 0 ? `；已省略 ${omitted} 帧` : ''
  if (logPolicy.value.mode === 'all') return '记录全部解析帧'
  if (logPolicy.value.mode === 'sampled') {
    return `抽样记录：每秒最多 ${logPolicy.value.maxPerSecond} 条解析帧${suffix}`
  }
  return `不记录数据帧（原始数据与错误帧仍然记录）${suffix}`
})

function onLogPolicyModeChange(value: string | number | null): void {
  if (typeof value !== 'string') return
  const mode = value as LogMode
  setSessionLogPolicy(props.sessionId, {
    mode,
    maxPerSecond: Math.max(1, logPolicy.value.maxPerSecond),
  })
}

function onLogPolicyMaxChange(value: number | null): void {
  if (value === null || !Number.isFinite(value)) return
  setSessionLogPolicy(props.sessionId, { maxPerSecond: Math.max(1, Math.round(value)) })
}

function setPane(patch: Partial<PaneViewSettings>): void {
  updatePaneViewSettings(props.paneIndex, patch)
}

function onDisplayModeChange(value: string | number): void {
  if (typeof value !== 'string') return
  const mode = value as DisplayMode
  setPane({ displayMode: mode })
  // 同时写入会话：设备记忆与预设依赖会话的 displayMode（plan §6.6）。
  setSessionDisplayMode(props.sessionId, mode)
}

function onViewAsChange(hex: boolean): void {
  setPane({ viewAs: hex ? 'hex' : 'text' })
}

function togglePaused(): void {
  emit('update:paused', !props.paused)
}

function onClearLog(): void {
  if (!props.sessionId) return
  clearSessionLog(props.sessionId)
}

function changeFontSize(delta: number): void {
  const next = Math.min(
    LOG_FONT_SIZE_MAX,
    Math.max(LOG_FONT_SIZE_MIN, paneSettings.value.fontSize + delta),
  )
  if (
    next === Math.min(LOG_FONT_SIZE_MAX, Math.max(LOG_FONT_SIZE_MIN, paneSettings.value.fontSize))
  ) {
    return
  }
  setPane({ fontSize: next })
}

function onExportSelect(key: string): void {
  const format = key as ExportFormat
  const session = getSessionInstance(props.sessionId)
  if (!session) return
  const file = exportLog(session.log.snapshot(), {
    format,
    sessionName: view.value?.name ?? '会话',
    displayMode: paneSettings.value.displayMode,
    viewAs: paneSettings.value.viewAs,
    encoding: session.rxOptions.encoding,
    showTimestamp: paneSettings.value.showTimestamp,
    showTx: paneSettings.value.showTx,
    showSystem: paneSettings.value.showSystem,
    showBridge: paneSettings.value.showBridge,
  })
  downloadBytes(file.data, file.fileName, file.mimeType)
  toast.show({ type: 'success', message: `已导出 ${file.fileName}` })
}
</script>

<template>
  <div class="log-toolbar" data-testid="log-toolbar">
    <div class="log-toolbar__row log-toolbar__row--top">
      <UiSegmented
        :model-value="paneSettings.displayMode"
        :options="displayModeOptions"
        size="sm"
        aria-label="显示模式"
        :disabled="!hasProtocol"
        data-testid="display-mode"
        @update:model-value="onDisplayModeChange"
      />
      <span class="log-toolbar__divider" aria-hidden="true" />
      <div class="log-toolbar__switches">
        <UiSwitch
          :model-value="paneSettings.showTimestamp"
          label="时间戳"
          size="sm"
          data-testid="toggle-timestamp"
          @update:model-value="setPane({ showTimestamp: $event })"
        />
        <UiSwitch
          :model-value="paneSettings.showTx"
          label="TX"
          size="sm"
          data-testid="toggle-tx"
          @update:model-value="setPane({ showTx: $event })"
        />
        <UiSwitch
          :model-value="paneSettings.showSystem"
          label="系统"
          size="sm"
          data-testid="toggle-system"
          @update:model-value="setPane({ showSystem: $event })"
        />
        <UiSwitch
          :model-value="paneSettings.showBridge"
          label="转发"
          size="sm"
          data-testid="toggle-bridge"
          @update:model-value="setPane({ showBridge: $event })"
        />
      </div>
      <span class="log-toolbar__divider" aria-hidden="true" />
      <UiSwitch
        :model-value="paneSettings.viewAs === 'hex'"
        label="HEX"
        size="sm"
        title="切换文本 / HEX 显示"
        data-testid="view-hex"
        @update:model-value="onViewAsChange"
      />
      <div class="log-toolbar__font">
        <UiButton
          size="sm"
          variant="ghost"
          aria-label="减小日志字号"
          :disabled="paneSettings.fontSize <= LOG_FONT_SIZE_MIN"
          @click="changeFontSize(-1)"
        >
          A−
        </UiButton>
        <span class="log-toolbar__font-size">{{ paneSettings.fontSize }}</span>
        <UiButton
          size="sm"
          variant="ghost"
          aria-label="增大日志字号"
          :disabled="paneSettings.fontSize >= LOG_FONT_SIZE_MAX"
          @click="changeFontSize(1)"
        >
          A+
        </UiButton>
      </div>
    </div>

    <div class="log-toolbar__row log-toolbar__row--bottom">
      <div class="log-toolbar__search-wrap">
        <Search class="log-toolbar__search-icon" :size="15" aria-hidden="true" />
        <UiInput
          class="log-toolbar__search"
          :model-value="search"
          size="md"
          type="search"
          placeholder="搜索日志（/ 开头按正则）"
          aria-label="搜索日志"
          data-testid="log-search"
          @update:model-value="emit('update:search', $event)"
        />
      </div>
      <span class="log-toolbar__divider" aria-hidden="true" />
      <div class="log-toolbar__actions">
        <UiSwitch
          :model-value="paneSettings.wrap"
          label="换行"
          size="sm"
          data-testid="toggle-wrap"
          @update:model-value="setPane({ wrap: $event })"
        />
        <UiButton
          class="log-toolbar__pause"
          size="md"
          variant="ghost"
          :class="{ 'is-active': paused }"
          :aria-label="paused ? '继续刷新' : '暂停刷新'"
          data-testid="log-pause"
          @click="togglePaused"
        >
          <Play v-if="paused" :size="15" aria-hidden="true" />
          <Pause v-else :size="15" aria-hidden="true" />
          {{ paused ? '继续' : '暂停' }}
        </UiButton>
        <div
          class="log-toolbar__policy"
          :class="{ 'is-active': logPolicyActive }"
          :title="logPolicyTitle"
        >
          <select
            class="log-toolbar__policy-select"
            :value="logPolicy.mode"
            :disabled="!sessionId"
            aria-label="日志策略"
            data-testid="log-policy"
            @change="onLogPolicyModeChange(($event.target as HTMLSelectElement).value)"
          >
            <option v-for="option in logPolicyOptions" :key="option.value" :value="option.value">
              {{
                option.value === 'sampled'
                  ? `抽样记录（每秒 ${logPolicy.maxPerSecond} 条）`
                  : option.label
              }}
            </option>
          </select>
          <UiNumberInput
            v-if="logPolicy.mode === 'sampled'"
            :model-value="logPolicy.maxPerSecond"
            :min="1"
            :max="10000"
            size="sm"
            aria-label="每秒最多记录条数"
            data-testid="log-policy-max"
            @update:model-value="onLogPolicyMaxChange"
          />
        </div>
        <UiButton size="md" variant="ghost" data-testid="log-clear" @click="onClearLog">
          <Trash2 :size="15" aria-hidden="true" />
          清空
        </UiButton>
        <UiMenu :items="exportItems" @select="onExportSelect">
          <template #trigger>
            <UiButton size="md" variant="ghost" :disabled="!sessionId" data-testid="export-menu">
              <Download :size="15" aria-hidden="true" />
              导出
            </UiButton>
          </template>
        </UiMenu>
      </div>
    </div>
  </div>
</template>

<style scoped>
.log-toolbar {
  display: flex;
  flex-direction: column;
  flex: none;
  gap: 6px;
  padding: 8px 10px;
  border-bottom: 1px solid var(--border);
  background: var(--bg-elev);
}

.log-toolbar__row {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 8px;
  min-width: 0;
}

.log-toolbar__row--top {
  min-height: var(--control-h);
}

.log-toolbar__switches {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 2px;
  padding: 2px 4px;
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  background: var(--bg-sunken);
}

.log-toolbar__divider {
  flex: none;
  width: 1px;
  height: 16px;
  margin: 0 2px;
  background: var(--border);
}

.log-toolbar__actions {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 4px;
  min-width: 0;
}

.log-toolbar__search-wrap {
  position: relative;
  display: flex;
  align-items: center;
  flex: 1 1 auto;
  min-width: 240px;
}

.log-toolbar__search-icon {
  position: absolute;
  left: 10px;
  color: var(--text-faint);
  pointer-events: none;
}

.log-toolbar__search {
  flex: 1 1 auto;
}

.log-toolbar__search-wrap :deep(.ui-input) {
  padding-left: 32px;
}

.log-toolbar__font {
  display: flex;
  align-items: center;
  gap: 0;
  margin-left: auto;
}

.log-toolbar__font :deep(.ui-button) {
  font-family: var(--font-mono);
  font-size: 12px;
  padding: 0 8px;
}

.log-toolbar__font-size {
  min-width: 26px;
  color: var(--text-dim);
  font-family: var(--font-mono);
  font-size: 12px;
  text-align: center;
}

.log-toolbar__pause.is-active {
  border-color: var(--accent);
  background: var(--accent-soft);
  color: var(--accent);
}

.log-toolbar__policy {
  display: flex;
  align-items: center;
  gap: 4px;
  flex: none;
  min-height: var(--control-h);
  padding: 0 4px;
  border: 1px solid transparent;
  border-radius: var(--radius-sm);
}

.log-toolbar__policy.is-active {
  border-color: var(--warn);
  background: var(--warn-soft);
}

.log-toolbar__policy-select {
  height: var(--control-h);
  max-width: 240px;
  padding: 0 8px;
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  background: var(--bg-sunken);
  color: var(--text);
  font-size: 12px;
}

.log-toolbar__policy.is-active .log-toolbar__policy-select {
  border-color: var(--warn);
  color: var(--warn);
}

.log-toolbar__policy-select:focus-visible {
  outline: none;
  box-shadow: var(--focus-ring);
}

.log-toolbar__policy :deep(.ui-number-input) {
  width: 84px;
}
</style>
