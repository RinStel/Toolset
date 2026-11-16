<script setup lang="ts">
/**
 * 当前会话的连接参数、连接 / 断开与重命名（plan §8.2 / §8.3 / §9）。
 *
 * 参数表单直接使用提供者的 `settingsSchema`，因此新增传输类型不需要改本组件。
 * 连接状态下表单禁用，并提示「断开后可修改连接参数」。
 */

import { computed, nextTick, ref } from 'vue'
import { Pencil } from 'lucide-vue-next'

import UiButton from '@/shared/ui/components/UiButton.vue'
import UiFormField from '@/shared/ui/components/UiFormField.vue'
import UiIconButton from '@/shared/ui/components/UiIconButton.vue'
import SettingForm from '@/shared/ui/components/SettingForm.vue'
import { toast } from '@/shared/ui/services/toast'

import {
  clampDemoInterval,
  demoIntervalForFormat,
  findTransportProvider,
  getSessionInstance,
  getSessionView,
  renameSession,
} from '../stores/sessions'

const props = defineProps<{ sessionId: string | null }>()

const view = computed(() => getSessionView(props.sessionId))
const instance = computed(() => getSessionInstance(props.sessionId))
const provider = computed(() => findTransportProvider(view.value?.providerKind ?? ''))
const fields = computed(() => provider.value?.settingsSchema ?? [])

const STATE_LABELS: Record<string, string> = {
  idle: '未连接',
  opening: '正在连接…',
  open: '已连接',
  closed: '已断开',
  closing: '正在断开…',
  error: '连接错误',
}

const state = computed(() => view.value?.state ?? 'idle')
const stateLabel = computed(() => STATE_LABELS[state.value] ?? '未知状态')
const canConnect = computed(() => ['idle', 'closed', 'error'].includes(state.value))
const canDisconnect = computed(() => state.value === 'open' || state.value === 'opening')
const canEditSettings = computed(() => !['opening', 'open', 'closing'].includes(state.value))

const values = computed<Record<string, unknown>>(() => ({ ...(view.value?.settings ?? {}) }))

function onFieldChange(key: string, value: unknown): void {
  const session = instance.value
  if (!session || !canEditSettings.value) return
  session.stageSettings({ [key]: value })

  // 演示端口的 UI 联动（plan §6.6）：切换数据格式时同步一个合理的上报间隔。
  if (view.value?.providerKind !== 'virtual') return
  if (key === 'format') {
    session.stageSettings({
      interval: clampDemoInterval(value, demoIntervalForFormat(value)),
    })
  } else if (key === 'interval') {
    const format = view.value.settings.format ?? 'sensor-a5'
    const numeric = typeof value === 'number' ? value : Number(value)
    session.stageSettings({ interval: clampDemoInterval(format, numeric) })
  }
}

async function connect(): Promise<void> {
  const session = instance.value
  if (!session || !canConnect.value) return
  try {
    await session.open()
  } catch {
    // 失败原因由会话的 `lastError` 显示，这里不再重复弹提示。
  }
}

async function disconnect(): Promise<void> {
  const session = instance.value
  if (!session || !canDisconnect.value) return
  try {
    await session.close()
  } catch (error) {
    toast.show({ type: 'error', message: `断开失败：${errorText(error)}` })
  }
}

const renaming = ref(false)
const renameDraft = ref('')
const renameInput = ref<HTMLInputElement | null>(null)

async function startRename(): Promise<void> {
  if (!view.value) return
  renameDraft.value = view.value.name
  renaming.value = true
  await nextTick()
  renameInput.value?.focus()
  renameInput.value?.select()
}

function commitRename(): void {
  if (!renaming.value) return
  renaming.value = false
  const sessionId = props.sessionId
  if (!sessionId) return
  renameSession(sessionId, renameDraft.value)
}

function cancelRename(): void {
  renaming.value = false
}

function errorText(error: unknown): string {
  if (error instanceof Error && error.message.length > 0) return error.message
  return String(error)
}
</script>

<template>
  <div v-if="view" class="session-settings">
    <UiFormField label="名称">
      <div class="session-settings__name">
        <input
          v-if="renaming"
          ref="renameInput"
          v-model="renameDraft"
          class="session-settings__name-input"
          type="text"
          aria-label="会话名称"
          @keydown.enter.prevent="commitRename"
          @keydown.esc.prevent="cancelRename"
          @blur="commitRename"
        />
        <button
          v-else
          class="session-settings__name-text"
          type="button"
          title="双击重命名"
          @dblclick="startRename"
        >
          {{ view.name }}
        </button>
        <UiIconButton label="重命名" size="sm" @click="startRename">
          <Pencil :size="13" aria-hidden="true" />
        </UiIconButton>
      </div>
    </UiFormField>

    <div class="session-settings__status">
      <span class="session-settings__dot" :class="`is-${state}`" aria-hidden="true" />
      <span class="session-settings__status-text">{{ stateLabel }}</span>
      <span class="session-settings__provider">{{ provider?.title ?? view.providerKind }}</span>
    </div>

    <p
      v-if="view.deviceAvailable && state === 'error'"
      class="session-settings__notice"
      data-testid="session-device-available"
    >
      设备已重新插入，可重新连接
    </p>

    <p v-if="view.lastError" class="session-settings__error" role="alert">
      {{ view.lastError }}
    </p>

    <div class="session-settings__actions">
      <UiButton
        block
        variant="primary"
        size="md"
        data-testid="session-connect"
        :disabled="!canConnect"
        :loading="state === 'opening'"
        @click="connect"
      >
        连接
      </UiButton>
      <UiButton
        block
        size="md"
        data-testid="session-disconnect"
        :disabled="!canDisconnect"
        :loading="state === 'closing'"
        @click="disconnect"
      >
        断开
      </UiButton>
    </div>

    <p v-if="!canEditSettings" class="session-settings__hint">断开后可修改连接参数</p>

    <SettingForm
      v-if="fields.length > 0"
      :fields="fields"
      :model-value="values"
      :disabled="!canEditSettings"
      @change="onFieldChange"
    />
    <p v-else class="session-settings__hint">该通道没有可配置的参数。</p>
  </div>
</template>

<style scoped>
.session-settings {
  display: flex;
  flex-direction: column;
  gap: 10px;
  min-width: 0;
}

.session-settings__name {
  display: flex;
  align-items: center;
  gap: 4px;
  min-width: 0;
}

.session-settings__name-text {
  flex: 1 1 auto;
  min-width: 0;
  overflow: hidden;
  padding: 2px 0;
  color: var(--text);
  font-size: 13px;
  font-weight: 600;
  text-align: left;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.session-settings__name-text:hover {
  color: var(--accent-hover);
}

.session-settings__name-input {
  flex: 1 1 auto;
  min-width: 0;
  height: var(--control-h-sm);
  padding: 0 var(--space-2);
  border: 1px solid var(--accent);
  border-radius: var(--radius-sm);
  background: var(--bg-sunken);
  color: var(--text);
  font-size: 12px;
}

.session-settings__name-input:focus-visible {
  outline: none;
  box-shadow: var(--focus-ring);
}

.session-settings__status {
  display: flex;
  align-items: center;
  gap: 8px;
  min-height: 28px;
  padding: 0 8px;
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  background: var(--bg-sunken);
  box-shadow: var(--panel-highlight);
  font-size: 12px;
}

.session-settings__status-text {
  color: var(--text);
  font-weight: 500;
}

.session-settings__provider {
  min-width: 0;
  margin-left: auto;
  overflow: hidden;
  color: var(--text-faint);
  font-family: var(--font-mono);
  font-size: 10px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.session-settings__dot {
  flex: none;
  width: 6px;
  height: 6px;
  border-radius: 1px;
  background: var(--text-faint);
}

.session-settings__dot.is-open {
  background: var(--ok);
  box-shadow: 0 0 0 2px var(--ok-soft);
}

.session-settings__dot.is-opening,
.session-settings__dot.is-closing {
  background: var(--warn);
  animation: session-settings-pulse 900ms ease-in-out infinite;
}

.session-settings__dot.is-error {
  background: var(--danger);
  box-shadow: 0 0 0 2px var(--danger-soft);
}

.session-settings__actions {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
  gap: 6px;
  min-width: 0;
}

.session-settings__hint {
  margin: 0;
  color: var(--text-faint);
  font-size: 11px;
  line-height: 1.5;
}

.session-settings__notice {
  margin: 0;
  color: var(--warn);
  font-size: 11px;
  line-height: 1.5;
}

.session-settings__error {
  margin: 0;
  color: var(--danger);
  font-size: 11px;
  line-height: 1.5;
}

@keyframes session-settings-pulse {
  50% {
    opacity: 0.35;
  }
}
</style>
