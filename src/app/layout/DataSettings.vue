<script setup lang="ts">
/**
 * Settings drawer → 「数据」 group (plan §6.11 / §7.2).
 *
 * Exports the current machine configuration as a JSON file, restores it from a
 * validated backup and clears every local `toolset/` store. The component is lazy
 * loaded by `SettingsDrawer.vue` so none of the backup code enters the entry chunk.
 *
 * Side effects that must not run in tests (`location.reload`, the download itself)
 * are injectable: `reload` replaces the page reload and the download helper is a
 * module import that component tests mock.
 */

import { computed, onBeforeUnmount, ref, shallowRef } from 'vue'
import { Download, Loader2, Trash2, Upload } from 'lucide-vue-next'

import { formatBytes } from '@/shared/lib/format'
import { downloadText } from '@/shared/lib/download'
import {
  clearAllLocalData,
  exportBackup,
  importBackup,
  listBackupItems,
  parseBackup,
  type BackupFile,
  type BackupItem,
  type BackupItemGroup,
  type BackupSummary,
  type ImportBackupResult,
} from '@/shared/lib/storage/backup'
import UiButton from '@/shared/ui/components/UiButton.vue'
import UiCheckbox from '@/shared/ui/components/UiCheckbox.vue'
import UiDialog from '@/shared/ui/components/UiDialog.vue'
import UiEmpty from '@/shared/ui/components/UiEmpty.vue'
import UiFormField from '@/shared/ui/components/UiFormField.vue'
import UiSegmented from '@/shared/ui/components/UiSegmented.vue'
import { confirm } from '@/shared/ui/services/confirm'
import { toast } from '@/shared/ui/services/toast'

import { getItemLabel, getNamespaceLabel } from '../config/backup-labels'
import { tools } from '../registry'

const props = defineProps<{
  /** Replaces `location.reload()`; tests inject a spy to avoid navigation. */
  reload?: () => void
  /** Delay before the automatic reload, defaults to 1000 ms. */
  reloadDelay?: number
}>()

type ImportMode = 'merge' | 'replace'
type ImportPhase = 'choose' | 'error' | 'failed'

const BACKUP_MIME = 'application/json;charset=utf-8'
const RELOAD_DELAY = 1000

const modeOptions = [
  { label: '合并', value: 'merge' },
  { label: '替换', value: 'replace' },
]

function pad2(value: number): string {
  return String(value).padStart(2, '0')
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/** `toolset-backup-YYYYMMDD-HHmmss.json` (an optional suffix is used for pre-import backups). */
function backupFileName(suffix = ''): string {
  const now = new Date()
  const date = `${now.getFullYear()}${pad2(now.getMonth() + 1)}${pad2(now.getDate())}`
  const time = `${pad2(now.getHours())}${pad2(now.getMinutes())}${pad2(now.getSeconds())}`
  return `toolset-backup${suffix}-${date}-${time}.json`
}

function saveJson(text: string, filename: string): void {
  downloadText(text, filename, BACKUP_MIME)
}

function formatBackupTime(value: string): string {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value || '未知'
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())} ${pad2(
    date.getHours(),
  )}:${pad2(date.getMinutes())}:${pad2(date.getSeconds())}`
}

let reloadTimer: ReturnType<typeof setTimeout> | null = null

function reloadPage(): void {
  if (props.reload) {
    props.reload()
    return
  }
  if (typeof location !== 'undefined') location.reload()
}

function scheduleReload(): void {
  if (reloadTimer !== null) return
  reloadTimer = setTimeout(() => {
    reloadTimer = null
    reloadPage()
  }, props.reloadDelay ?? RELOAD_DELAY)
}

onBeforeUnmount(() => {
  if (reloadTimer !== null) {
    clearTimeout(reloadTimer)
    reloadTimer = null
  }
})

/* ------------------------------------------------------------------ export */

const exportOpen = ref(false)
const exportLoading = ref(false)
const exportBusy = ref(false)
const exportGroups = ref<BackupItemGroup[]>([])
const exportSelection = ref<Record<string, boolean>>({})

const allExportItems = computed<BackupItem[]>(() =>
  exportGroups.value.flatMap((group) => group.items),
)

const exportSelectedCount = computed(
  () => allExportItems.value.filter((item) => exportSelection.value[item.key]).length,
)

const exportSelectedBytes = computed(() =>
  allExportItems.value
    .filter((item) => exportSelection.value[item.key])
    .reduce((sum, item) => sum + item.bytes, 0),
)

function groupBytes(group: BackupItemGroup): number {
  return group.items.reduce((sum, item) => sum + item.bytes, 0)
}

function isGroupChecked(group: BackupItemGroup): boolean {
  return (
    group.items.length > 0 && group.items.every((item) => exportSelection.value[item.key] === true)
  )
}

function isGroupIndeterminate(group: BackupItemGroup): boolean {
  const checked = group.items.filter((item) => exportSelection.value[item.key] === true).length
  return checked > 0 && checked < group.items.length
}

function setGroup(group: BackupItemGroup, checked: boolean): void {
  const next: Record<string, boolean> = { ...exportSelection.value }
  for (const item of group.items) next[item.key] = checked
  exportSelection.value = next
}

function setItem(item: BackupItem, checked: boolean): void {
  exportSelection.value = { ...exportSelection.value, [item.key]: checked }
}

async function openExport(): Promise<void> {
  exportOpen.value = true
  exportLoading.value = true
  exportGroups.value = []
  exportSelection.value = {}
  try {
    const groups = await listBackupItems()
    exportGroups.value = groups
    const selection: Record<string, boolean> = {}
    for (const group of groups) {
      for (const item of group.items) selection[item.key] = true
    }
    exportSelection.value = selection
  } catch (error) {
    exportOpen.value = false
    toast.show({ type: 'error', message: `读取本机配置失败：${errorMessage(error)}` })
  } finally {
    exportLoading.value = false
  }
}

async function runExport(): Promise<void> {
  const keys = allExportItems.value
    .filter((item) => exportSelection.value[item.key] === true)
    .map((item) => item.key)
  if (keys.length === 0) {
    toast.show({ type: 'warn', message: '请至少选择一项配置' })
    return
  }
  exportBusy.value = true
  try {
    const file = await exportBackup({ keys })
    saveJson(JSON.stringify(file, null, 2), backupFileName())
    exportOpen.value = false
    toast.show({ type: 'success', message: `已导出 ${keys.length} 项配置` })
  } catch (error) {
    toast.show({ type: 'error', message: `导出失败：${errorMessage(error)}` })
  } finally {
    exportBusy.value = false
  }
}

/* ------------------------------------------------------------------ import */

const importOpen = ref(false)
const importPhase = ref<ImportPhase>('choose')
const importBusy = ref(false)
const importError = ref('')
const importFileName = ref('')
// Shallow: the parsed file is handed back to the storage layer untouched; a deep ref
// would wrap kv values in Vue proxies, which structured clone cannot store.
const importFile = shallowRef<BackupFile | null>(null)
const importSummary = ref<BackupSummary[]>([])
const importSelection = ref<Record<string, boolean>>({})
const importMode = ref<ImportMode>('merge')
const importBackupBefore = ref(true)
const importResult = ref<ImportBackupResult | null>(null)
const fileInput = ref<HTMLInputElement | null>(null)

const importSelectedNamespaces = computed(() =>
  importSummary.value
    .filter((section) => importSelection.value[section.namespace] === true)
    .map((section) => section.namespace),
)

const importTotals = computed(() =>
  importSummary.value.reduce(
    (totals, section) => ({
      items: totals.items + section.localCount + section.kvCount,
      bytes: totals.bytes + section.bytes,
    }),
    { items: 0, bytes: 0 },
  ),
)

const importCreatedLabel = computed(() => formatBackupTime(importFile.value?.createdAt ?? ''))

const importModeHint = computed(() =>
  importMode.value === 'merge'
    ? '合并：同名项覆盖，保留其他现有配置。'
    : '替换：先清空所选分区中的现有配置，再写入备份内容。',
)

const importFailed = computed(() => importResult.value?.failed ?? [])

function openImportPicker(): void {
  fileInput.value?.click()
}

function closeImport(): void {
  importOpen.value = false
  importResult.value = null
}

function showImportError(message: string): void {
  importError.value = message
  importPhase.value = 'error'
  importOpen.value = true
}

function setImportNamespace(namespace: string, checked: boolean): void {
  importSelection.value = { ...importSelection.value, [namespace]: checked }
}

function setImportMode(value: string | number): void {
  importMode.value = value === 'replace' ? 'replace' : 'merge'
}

function setImportBackupBefore(checked: boolean): void {
  importBackupBefore.value = checked
}

async function onImportFileChange(event: Event): Promise<void> {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  input.value = ''
  if (!file) return

  importFileName.value = file.name
  let text: string
  try {
    text = await file.text()
  } catch (error) {
    showImportError(`无法读取文件：${errorMessage(error)}`)
    return
  }

  const parsed = parseBackup(text)
  if (!parsed.ok) {
    importFile.value = null
    showImportError(parsed.error)
    return
  }

  importFile.value = parsed.file
  importSummary.value = parsed.summary
  importResult.value = null
  const selection: Record<string, boolean> = {}
  for (const section of parsed.summary) selection[section.namespace] = true
  importSelection.value = selection
  importMode.value = 'merge'
  importBackupBefore.value = true
  importPhase.value = 'choose'
  importOpen.value = true
}

async function confirmImport(): Promise<void> {
  const file = importFile.value
  const namespaces = importSelectedNamespaces.value
  if (!file || namespaces.length === 0) return

  const proceed = await confirm({
    title: '导入本机配置',
    message: '导入后页面将刷新，所有已打开的通道会断开。是否继续？',
    confirmText: '导入并刷新',
  })
  if (!proceed) return

  importBusy.value = true
  try {
    if (importBackupBefore.value) {
      const current = await exportBackup()
      saveJson(JSON.stringify(current, null, 2), backupFileName('-before-import'))
    }
    const result = await importBackup(file, { namespaces, mode: importMode.value })
    if (result.failed.length > 0) {
      importResult.value = result
      importPhase.value = 'failed'
      return
    }
    importOpen.value = false
    toast.show({ type: 'success', message: `导入完成（${result.written} 项），页面即将刷新` })
    scheduleReload()
  } catch (error) {
    toast.show({ type: 'error', message: `导入失败：${errorMessage(error)}` })
  } finally {
    importBusy.value = false
  }
}

function onRefreshNow(): void {
  closeImport()
  reloadPage()
}

/* ------------------------------------------------------------------- clear */

async function onClearAll(): Promise<void> {
  const proceed = await confirm({
    title: '清除全部本地数据',
    message:
      '将删除所有设置、协议、预设、快捷发送、宏、仪表盘和自定义控件，且无法恢复。建议先导出配置。',
    confirmText: '清除全部数据',
    danger: true,
  })
  if (!proceed) return
  try {
    await clearAllLocalData()
    toast.show({ type: 'success', message: '已清除全部本地数据，页面即将刷新' })
    scheduleReload()
  } catch (error) {
    toast.show({ type: 'error', message: `清除失败：${errorMessage(error)}` })
  }
}
</script>

<template>
  <div class="data-settings" data-testid="data-settings">
    <p class="data-settings__hint">
      本机配置保存在当前浏览器中。可以导出为 JSON 文件备份，或从备份文件恢复。
    </p>

    <div class="data-settings__actions">
      <UiButton data-testid="data-export" @click="openExport">
        <Download :size="13" aria-hidden="true" />
        导出本机配置
      </UiButton>
      <UiButton data-testid="data-import" @click="openImportPicker">
        <Upload :size="13" aria-hidden="true" />
        导入本机配置
      </UiButton>
    </div>

    <div class="data-settings__danger">
      <UiButton variant="danger" size="sm" data-testid="data-clear" @click="onClearAll">
        <Trash2 :size="13" aria-hidden="true" />
        清除全部本地数据
      </UiButton>
      <span class="data-settings__hint">删除后无法恢复，建议先导出配置。</span>
    </div>

    <input
      ref="fileInput"
      class="visually-hidden"
      type="file"
      accept=".json,application/json"
      data-testid="data-import-input"
      @change="onImportFileChange"
    />

    <!-- 导出：命名空间 → 条目的树形列表，默认全选 -->
    <UiDialog v-model="exportOpen" title="导出本机配置" width="560px">
      <div class="data-settings__dialog" data-testid="data-export-dialog">
        <p class="data-settings__hint">
          选择要导出的配置项。备份文件包含原始数据，可以在另一台设备上导入。
        </p>

        <div v-if="exportLoading" class="data-settings__loading" data-testid="data-export-loading">
          <Loader2 class="data-settings__spinner" :size="14" aria-hidden="true" />
          正在读取本机配置…
        </div>
        <UiEmpty
          v-else-if="exportGroups.length === 0"
          compact
          title="没有可导出的配置"
          description="当前浏览器中还没有保存任何 Toolset 配置。"
        />
        <div v-else class="data-settings__tree">
          <section
            v-for="group in exportGroups"
            :key="group.namespace"
            class="data-settings__tree-group"
          >
            <div class="data-settings__tree-row data-settings__tree-row--group">
              <UiCheckbox
                :model-value="isGroupChecked(group)"
                :indeterminate="isGroupIndeterminate(group)"
                data-testid="data-export-namespace"
                :data-namespace="group.namespace"
                @update:model-value="(checked) => setGroup(group, checked)"
              >
                {{ getNamespaceLabel(group.namespace, tools) }}
              </UiCheckbox>
              <span class="data-settings__meta">
                {{ group.items.length }} 项 · {{ formatBytes(groupBytes(group)) }}
              </span>
            </div>
            <div
              v-for="item in group.items"
              :key="item.key"
              class="data-settings__tree-row data-settings__tree-row--item"
            >
              <UiCheckbox
                :model-value="exportSelection[item.key] === true"
                data-testid="data-export-item"
                :data-storage-key="item.key"
                @update:model-value="(checked) => setItem(item, checked)"
              >
                {{ getItemLabel(group.namespace, item.name, tools) }}
              </UiCheckbox>
              <code class="data-settings__key">{{ item.key }}</code>
              <span class="data-settings__meta">{{ formatBytes(item.bytes) }}</span>
            </div>
          </section>
        </div>

        <p v-if="!exportLoading && exportGroups.length > 0" class="data-settings__summary">
          已选择 {{ exportSelectedCount }} 项 · {{ formatBytes(exportSelectedBytes) }}
        </p>
      </div>

      <template #footer>
        <UiButton size="md" data-testid="data-export-cancel" @click="exportOpen = false">
          取消
        </UiButton>
        <UiButton
          variant="primary"
          size="md"
          :disabled="exportLoading || exportBusy || exportSelectedCount === 0"
          :loading="exportBusy"
          data-testid="data-export-confirm"
          @click="runExport"
        >
          导出
        </UiButton>
      </template>
    </UiDialog>

    <!-- 导入：错误 / 摘要 / 部分失败三个状态 -->
    <UiDialog v-model="importOpen" title="导入本机配置" width="560px" @cancel="closeImport">
      <div class="data-settings__dialog" data-testid="data-import-dialog">
        <template v-if="importPhase === 'error'">
          <p class="data-settings__error" role="alert" data-testid="data-import-error">
            {{ importError }}
          </p>
          <p class="data-settings__hint">请选择由 Toolset 导出的 .json 配置文件。</p>
        </template>

        <template v-else-if="importPhase === 'failed'">
          <p class="data-settings__error">导入完成，{{ importFailed.length }} 项失败：</p>
          <ul class="data-settings__failed" data-testid="data-import-failed">
            <li v-for="failure in importFailed" :key="failure.key">
              <code>{{ failure.key }}</code
              >：{{ failure.error }}
            </li>
          </ul>
          <p class="data-settings__hint">
            已成功写入 {{ importResult?.written ?? 0 }} 项。请点击「刷新页面」让各模块重新读取配置。
          </p>
        </template>

        <template v-else>
          <dl class="data-settings__summary-grid" data-testid="data-import-summary">
            <div>
              <dt>备份文件</dt>
              <dd>{{ importFileName }}</dd>
            </div>
            <div>
              <dt>备份时间</dt>
              <dd>{{ importCreatedLabel }}</dd>
            </div>
            <div>
              <dt>条目总数</dt>
              <dd>{{ importTotals.items }} 项</dd>
            </div>
            <div>
              <dt>总大小</dt>
              <dd>{{ formatBytes(importTotals.bytes) }}</dd>
            </div>
          </dl>

          <div class="data-settings__namespaces">
            <p class="eyebrow">选择要导入的分区</p>
            <div
              v-for="section in importSummary"
              :key="section.namespace"
              class="data-settings__namespace"
            >
              <UiCheckbox
                :model-value="importSelection[section.namespace] === true"
                data-testid="data-import-namespace"
                :data-namespace="section.namespace"
                @update:model-value="(checked) => setImportNamespace(section.namespace, checked)"
              >
                {{ getNamespaceLabel(section.namespace, tools) }}
              </UiCheckbox>
              <span class="data-settings__meta">
                {{ section.localCount + section.kvCount }} 项 · {{ formatBytes(section.bytes) }}
              </span>
            </div>
          </div>

          <UiFormField label="导入方式" :hint="importModeHint">
            <div data-testid="data-import-mode" :data-mode="importMode">
              <UiSegmented
                :model-value="importMode"
                :options="modeOptions"
                aria-label="导入方式"
                @update:model-value="setImportMode"
              />
            </div>
          </UiFormField>

          <UiCheckbox
            :model-value="importBackupBefore"
            data-testid="data-import-backup-before"
            @update:model-value="setImportBackupBefore"
          >
            导入前下载当前配置备份
          </UiCheckbox>
        </template>
      </div>

      <template #footer>
        <template v-if="importPhase === 'failed'">
          <UiButton
            variant="primary"
            size="md"
            data-testid="data-import-refresh"
            @click="onRefreshNow"
          >
            刷新页面
          </UiButton>
        </template>
        <template v-else-if="importPhase === 'error'">
          <UiButton size="md" data-testid="data-import-close" @click="closeImport">关闭</UiButton>
        </template>
        <template v-else>
          <UiButton size="md" data-testid="data-import-cancel" @click="closeImport">取消</UiButton>
          <UiButton
            variant="primary"
            size="md"
            :disabled="importBusy || importSelectedNamespaces.length === 0"
            :loading="importBusy"
            data-testid="data-import-confirm"
            @click="confirmImport"
          >
            导入
          </UiButton>
        </template>
      </template>
    </UiDialog>
  </div>
</template>

<style scoped>
.data-settings {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.data-settings__hint {
  margin: 0;
  color: var(--text-dim);
  font-size: 11px;
  line-height: 1.6;
}

.data-settings__actions {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.data-settings__danger {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
  padding-top: 10px;
  border-top: 1px solid var(--border);
}

.data-settings__dialog {
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
}

.data-settings__loading {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: var(--space-4);
  color: var(--text-dim);
  font-size: 12px;
  text-align: center;
  justify-content: center;
}

.data-settings__spinner {
  animation: data-settings-spin 800ms linear infinite;
}

.data-settings__tree {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.data-settings__tree-group {
  overflow: hidden;
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  background: var(--bg-sunken);
}

.data-settings__tree-row {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  align-items: center;
  gap: 8px;
  padding: 4px 8px;
}

.data-settings__tree-row--group {
  border-bottom: 1px solid var(--border);
  background: var(--bg-elev);
}

.data-settings__tree-row--item {
  grid-template-columns: minmax(0, 1fr) minmax(0, 1.4fr) auto;
  padding-left: 24px;
}

.data-settings__tree-row--item + .data-settings__tree-row--item {
  border-top: 1px solid var(--border);
}

.data-settings__key {
  overflow: hidden;
  color: var(--text-faint);
  font-size: 10px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.data-settings__meta {
  color: var(--text-faint);
  font-size: 10px;
  white-space: nowrap;
}

.data-settings__summary {
  margin: 0;
  padding-top: 8px;
  border-top: 1px solid var(--border);
  color: var(--text-dim);
  font-size: 11px;
}

.data-settings__summary-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 8px 12px;
  margin: 0;
  padding: 8px 10px;
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  background: var(--bg-sunken);
}

.data-settings__summary-grid dt {
  color: var(--text-faint);
  font-size: 10px;
  letter-spacing: 0.04em;
}

.data-settings__summary-grid dd {
  margin: 0;
  color: var(--text);
  font-size: 11px;
  overflow-wrap: anywhere;
}

.data-settings__namespaces {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.data-settings__namespace {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 4px 8px;
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  background: var(--bg-sunken);
}

.data-settings__error {
  margin: 0;
  color: var(--danger);
  font-size: 12px;
  line-height: 1.6;
}

.data-settings__failed {
  display: flex;
  flex-direction: column;
  gap: 4px;
  margin: 0;
  padding: 8px 10px;
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  background: var(--bg-sunken);
  color: var(--text-dim);
  font-size: 11px;
  line-height: 1.6;
}

.data-settings__failed code {
  color: var(--text);
  font-size: 10px;
}

@keyframes data-settings-spin {
  to {
    transform: rotate(360deg);
  }
}
</style>
