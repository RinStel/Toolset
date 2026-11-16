<script setup lang="ts">
/**
 * 预设选择器（plan §6.6 / §8.2）。
 *
 * 「预设 ▾」选择 + 套用；另存为把当前会话的连接参数、协议、接收分帧、显示模式与
 * 组包选项保存为预设；导入 / 导出使用 `toolset-presets.json`。
 *
 * 套用规则由 `PresetStore.apply()` 实现：providerKind 不同时拒绝；会话处于 open
 * 状态时只立即套用协议 / rxOptions / 显示模式 / compose，连接参数延迟到下次打开。
 */

import { computed, onMounted, onBeforeUnmount, ref } from 'vue'
import { Download, Save, Upload } from 'lucide-vue-next'

import { getPresetStore, type Preset } from '@/domains/link/public'
import { downloadText } from '@/shared/lib/download'
import UiButton from '@/shared/ui/components/UiButton.vue'
import UiCheckbox from '@/shared/ui/components/UiCheckbox.vue'
import UiInput from '@/shared/ui/components/UiInput.vue'
import { toast } from '@/shared/ui/services/toast'

import {
  ensureSecondPaneForDashboard,
  openDashboardInPane,
  serialLayout,
  updatePaneViewSettings,
} from '../stores/layout'
import { getDashboardIndexEntry } from '../stores/dashboards'
import { pinDashboardDefaultSession } from '../dashboard/pane-state'
import {
  createPresetApplyTarget,
  getSessionInstance,
  getSessionView,
  serialSessions,
} from '../stores/sessions'

const props = defineProps<{ sessionId: string | null }>()

const store = getPresetStore()

const presets = ref<Preset[]>(store.list())
const selectedId = ref('')
const saveMode = ref(false)
const nameDraft = ref('')
const applying = ref(false)
const fileInput = ref<HTMLInputElement | null>(null)

/** 另存预设时是否同时记住当前 Pane 的仪表盘（plan §8.13）。 */
const rememberDashboard = ref(true)

const currentDashboardId = computed(() => {
  const pane = serialLayout.panes[serialSessions.focusedPane]
  if (!pane || pane.view !== 'dashboard') return null
  return pane.dashboardId
})

const canRememberDashboard = computed(() => currentDashboardId.value !== null)

const view = computed(() => getSessionView(props.sessionId))
const instance = computed(() => getSessionInstance(props.sessionId))

let unsubscribe: (() => void) | null = null

onMounted(() => {
  unsubscribe = store.on('change', (records) => {
    presets.value = records
    if (!records.some((preset) => preset.id === selectedId.value)) selectedId.value = ''
  })
})

onBeforeUnmount(() => {
  unsubscribe?.()
  unsubscribe = null
})

function selectedPreset(): Preset | undefined {
  return presets.value.find((preset) => preset.id === selectedId.value)
}

function onSelectEvent(event: Event): void {
  selectedId.value = (event.target as HTMLSelectElement).value
}

async function applyPreset(): Promise<void> {
  const preset = selectedPreset()
  const session = instance.value
  if (!preset) return
  if (!session) {
    toast.show({ type: 'error', message: '请先选择一个会话' })
    return
  }
  applying.value = true
  try {
    // 包装后的目标带 `extras` 槽位，预设里的 dashboardId 会写回这里（plan §8.13）。
    const target = createPresetApplyTarget(session)
    const result = await store.apply(preset, target)
    if (!result.ok) {
      toast.show({ type: 'error', message: result.error })
      return
    }
    updatePaneViewSettings(serialSessions.focusedPane, { displayMode: session.displayMode })
    const dashboardId = target.extras?.dashboardId
    if (typeof dashboardId === 'string' && dashboardId.length > 0) {
      applyDashboardLink(dashboardId, session.id)
    }
    toast.show({
      type: result.deferred ? 'warn' : 'success',
      message: result.deferred
        ? `已套用预设「${preset.name}」，${result.message ?? '连接参数将在断开后生效'}`
        : `已套用预设「${preset.name}」`,
    })
  } finally {
    applying.value = false
  }
}

/**
 * 套用含 dashboardId 的预设（plan §8.13）：
 * 焦点 Pane 是仪表盘 → 切换并绑定默认数据源；终端 → 在另一个 Pane 打开（必要时开启分屏）。
 */
function applyDashboardLink(dashboardId: string, sessionId: string): void {
  if (!getDashboardIndexEntry(dashboardId)) {
    toast.show({ type: 'warn', message: '预设引用的仪表盘不存在' })
    return
  }
  const focused = serialSessions.focusedPane
  const pane = serialLayout.panes[focused]
  const samePane = pane?.view === 'dashboard'
  const targetPane = samePane ? focused : ensureSecondPaneForDashboard(focused)
  pinDashboardDefaultSession(targetPane, sessionId)
  openDashboardInPane(targetPane, dashboardId)
}

function startSave(): void {
  if (!view.value) return
  nameDraft.value = `${view.value.name} 预设`
  saveMode.value = true
}

function cancelSave(): void {
  saveMode.value = false
}

function confirmSave(): void {
  const session = instance.value
  const current = view.value
  if (!session || !current) return
  const name = nameDraft.value.trim()
  if (name.length === 0) {
    toast.show({ type: 'warn', message: '请输入预设名称' })
    return
  }
  try {
    const extras: Record<string, unknown> = {}
    const dashboardId = currentDashboardId.value
    if (rememberDashboard.value && dashboardId !== null) extras.dashboardId = dashboardId
    const preset = store.save({
      name,
      providerKind: current.providerKind,
      settings: { ...current.settings },
      protocolId: current.protocol?.id ?? null,
      rxOptions: { ...session.rxOptions },
      displayMode: session.displayMode,
      compose: { ...session.compose },
      quickGroupId: null,
      logPolicy: { ...session.logPolicy },
      extras,
    })
    selectedId.value = preset.id
    saveMode.value = false
    toast.show({ type: 'success', message: `已保存预设「${preset.name}」` })
  } catch (error) {
    toast.show({ type: 'error', message: `保存预设失败：${errorText(error)}` })
  }
}

function exportPresets(): void {
  try {
    const file = store.exportFile()
    downloadText(file.text, file.fileName, 'application/json;charset=utf-8')
    toast.show({ type: 'success', message: `已导出 ${file.fileName}` })
  } catch (error) {
    toast.show({ type: 'error', message: `导出预设失败：${errorText(error)}` })
  }
}

async function onImportFile(event: Event): Promise<void> {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  input.value = ''
  if (file === undefined) return
  try {
    const result = store.importJson(await file.text())
    if (!result.ok) {
      toast.show({ type: 'error', message: result.error })
      return
    }
    toast.show({
      type: 'success',
      message: `已导入预设：新增 ${result.added} 个，更新 ${result.updated} 个`,
    })
  } catch (error) {
    toast.show({ type: 'error', message: `导入预设失败：${errorText(error)}` })
  }
}

function errorText(error: unknown): string {
  if (error instanceof Error && error.message.length > 0) return error.message
  return String(error)
}
</script>

<template>
  <section class="preset-picker">
    <div class="preset-picker__row">
      <select
        class="preset-picker__select"
        :value="selectedId"
        :disabled="!view"
        aria-label="预设"
        data-testid="preset-select"
        @change="onSelectEvent"
      >
        <option value="">选择预设</option>
        <option v-for="preset in presets" :key="preset.id" :value="preset.id">
          {{ preset.name }}
        </option>
      </select>
      <UiButton
        size="sm"
        data-testid="preset-apply"
        :disabled="selectedId.length === 0 || !view"
        :loading="applying"
        @click="applyPreset"
      >
        套用
      </UiButton>
    </div>

    <div v-if="saveMode" class="preset-picker__save">
      <UiInput
        v-model="nameDraft"
        size="sm"
        placeholder="预设名称"
        aria-label="预设名称"
        data-testid="preset-name"
        @enter="confirmSave"
      />
      <UiCheckbox
        v-if="canRememberDashboard"
        v-model="rememberDashboard"
        label="同时记住当前仪表盘"
        size="sm"
        data-testid="preset-remember-dashboard"
      />
      <UiButton size="sm" variant="primary" data-testid="preset-save-confirm" @click="confirmSave">
        保存
      </UiButton>
      <UiButton size="sm" variant="ghost" @click="cancelSave">取消</UiButton>
    </div>

    <div class="preset-picker__io">
      <UiButton
        size="sm"
        :variant="saveMode ? 'ghost' : 'primary'"
        data-testid="preset-save"
        :disabled="!view"
        @click="startSave"
      >
        <Save :size="12" aria-hidden="true" />
        另存
      </UiButton>
      <UiButton size="sm" variant="ghost" data-testid="preset-import" @click="fileInput?.click()">
        <Upload :size="12" aria-hidden="true" />
        导入
      </UiButton>
      <UiButton size="sm" variant="ghost" data-testid="preset-export" @click="exportPresets">
        <Download :size="12" aria-hidden="true" />
        导出
      </UiButton>
      <input
        ref="fileInput"
        class="preset-picker__file"
        type="file"
        accept=".json,application/json"
        data-testid="preset-import-file"
        @change="onImportFile"
      />
    </div>
  </section>
</template>

<style scoped>
.preset-picker {
  display: flex;
  flex-direction: column;
  gap: 6px;
  min-width: 0;
}

.preset-picker__head {
  display: none;
}

.preset-picker__row {
  display: flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
}

.preset-picker__select {
  flex: 1 1 auto;
  min-width: 0;
  height: var(--control-h-sm);
  padding: 0 6px;
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  background: var(--bg-sunken);
  color: var(--text);
  font-family: var(--font-ui);
  font-size: 11px;
}

.preset-picker__select:hover {
  border-color: var(--border-strong);
}

.preset-picker__select:focus {
  border-color: var(--accent);
}

.preset-picker__select:focus-visible {
  outline: none;
  box-shadow: var(--focus-ring);
}

.preset-picker__save {
  display: flex;
  flex-direction: column;
  gap: 6px;
  min-width: 0;
}

.preset-picker__save :deep(.ui-input) {
  width: 100%;
}

.preset-picker__save :deep(.ui-button) {
  align-self: flex-start;
}

.preset-picker__save :deep(.ui-button:nth-child(3)) {
  margin-left: 0;
}

.preset-picker__io {
  display: flex;
  align-items: center;
  gap: 2px;
}

.preset-picker__file {
  display: none;
}
</style>
