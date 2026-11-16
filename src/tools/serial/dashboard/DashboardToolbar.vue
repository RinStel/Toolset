<script setup lang="ts">
/**
 * 仪表盘工具栏（plan §8.10「工具栏」）。
 *
 * 仪表盘选择 / 新建 / 复制 / 重命名 / 删除 / 导入 / 导出、数据源与会话绑定、
 * 一键生成、暂停全部、导出数据 CSV、编辑 ↔ 运行、撤销 / 重做、变量列表开关。
 */

import { computed, ref } from 'vue'
import {
  Copy,
  Download,
  ListTree,
  MoreHorizontal,
  Pause,
  Pencil,
  Play,
  Plus,
  Redo2,
  RefreshCw,
  Trash2,
  Undo2,
  Upload,
  Wand2,
  X,
} from 'lucide-vue-next'

import { SOURCE_ALIAS_PATTERN, type Dashboard } from '@/domains/dashboard/public'
import UiButton from '@/shared/ui/components/UiButton.vue'
import UiDialog from '@/shared/ui/components/UiDialog.vue'
import UiIconButton from '@/shared/ui/components/UiIconButton.vue'
import UiInput from '@/shared/ui/components/UiInput.vue'
import UiMenu from '@/shared/ui/components/UiMenu.vue'
import UiTooltip from '@/shared/ui/components/UiTooltip.vue'
import { toast } from '@/shared/ui/services/toast'

import type { DashboardIndexEntry, DashboardSaveStatus } from '../stores/dashboards'
import type { BindableSession } from '../stores/sessions'

const props = defineProps<{
  dashboards: DashboardIndexEntry[]
  dashboard: Dashboard | null
  saveStatus: DashboardSaveStatus
  saveError: string
  mode: 'edit' | 'run'
  paused: boolean
  canUndo: boolean
  canRedo: boolean
  bindings: Record<string, string | null>
  sessions: BindableSession[]
  canGenerate: boolean
  variableSidebar: boolean
}>()

const emit = defineEmits<{
  select: [id: string | null]
  new: [name: string]
  duplicate: []
  rename: [name: string]
  delete: []
  'import-file': [payload: { text: string; fileName: string }]
  export: []
  generate: []
  'toggle-pause': []
  'mode-change': [mode: 'edit' | 'run']
  undo: []
  redo: []
  'toggle-variable-sidebar': []
  'add-source': [payload: { alias: string; label: string }]
  'remove-source': [alias: string]
  'bind-source': [payload: { alias: string; sessionId: string | null }]
  'export-csv': []
}>()

const savingLabel = computed(() => {
  switch (props.saveStatus) {
    case 'saving':
      return '保存中…'
    case 'error':
      return '未保存'
    case 'conflict':
      return '未保存'
    default:
      return ''
  }
})

function stateLabel(state: string): string {
  switch (state) {
    case 'open':
      return '已连接'
    case 'opening':
      return '连接中'
    case 'closing':
      return '断开中'
    case 'closed':
      return '已断开'
    case 'error':
      return '错误'
    default:
      return '未连接'
  }
}

function bindingValue(alias: string): string {
  return props.bindings[alias] ?? ''
}

function onSelectDashboard(event: Event): void {
  const value = (event.target as HTMLSelectElement).value
  emit('select', value.length > 0 ? value : null)
}

/* ------------------------------------------------------------------------- */
/* 命名对话框                                                                  */
/* ------------------------------------------------------------------------- */

const nameDialogOpen = ref(false)
const nameMode = ref<'new' | 'rename'>('new')
const nameDraft = ref('')

const nameDialogTitle = computed(() => (nameMode.value === 'new' ? '新建仪表盘' : '重命名仪表盘'))

function openNewDialog(): void {
  nameMode.value = 'new'
  nameDraft.value = '未命名仪表盘'
  nameDialogOpen.value = true
}

function openRenameDialog(): void {
  if (!props.dashboard) return
  nameMode.value = 'rename'
  nameDraft.value = props.dashboard.name
  nameDialogOpen.value = true
}

function confirmName(): void {
  const name = nameDraft.value.trim()
  if (name.length === 0) {
    toast.show({ type: 'warn', message: '请输入仪表盘名称' })
    return
  }
  nameDialogOpen.value = false
  if (nameMode.value === 'new') emit('new', name)
  else emit('rename', name)
}

/* ------------------------------------------------------------------------- */
/* 新增数据源                                                                  */
/* ------------------------------------------------------------------------- */

const sourceDialogOpen = ref(false)
const sourceAlias = ref('')
const sourceLabel = ref('')

const sourceAliasError = computed(() => {
  if (sourceAlias.value.length === 0) return ''
  if (!SOURCE_ALIAS_PATTERN.test(sourceAlias.value)) {
    return 'alias 只能包含小写字母、数字、下划线，且以字母开头（最长 16 个字符）'
  }
  if (props.dashboard?.sources.some((source) => source.alias === sourceAlias.value)) {
    return '该 alias 已存在'
  }
  return ''
})

function openSourceDialog(): void {
  const used = new Set(props.dashboard?.sources.map((source) => source.alias) ?? [])
  let index = (props.dashboard?.sources.length ?? 0) + 1
  while (used.has(`source${index}`)) index += 1
  sourceAlias.value = `source${index}`
  sourceLabel.value = `数据源 ${index}`
  sourceDialogOpen.value = true
}

function confirmSource(): void {
  if (sourceAliasError.value.length > 0 || sourceAlias.value.length === 0) return
  emit('add-source', {
    alias: sourceAlias.value,
    label: sourceLabel.value.trim().length > 0 ? sourceLabel.value.trim() : sourceAlias.value,
  })
  sourceDialogOpen.value = false
}

function onBindChange(alias: string, event: Event): void {
  const value = (event.target as HTMLSelectElement).value
  emit('bind-source', { alias, sessionId: value.length > 0 ? value : null })
}

/* ------------------------------------------------------------------------- */
/* 导入文件                                                                    */
/* ------------------------------------------------------------------------- */

const fileInput = ref<HTMLInputElement | null>(null)

async function onImportFile(event: Event): Promise<void> {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  input.value = ''
  if (!file) return
  try {
    emit('import-file', { text: await file.text(), fileName: file.name })
  } catch (error) {
    toast.show({ type: 'error', message: `读取文件失败：${String(error)}` })
  }
}

function exportData(): void {
  emit('export')
}

const moreActions = computed(() => [
  {
    key: 'duplicate',
    label: '复制',
    icon: Copy,
    testId: 'dashboard-duplicate',
    disabled: !props.dashboard,
  },
  {
    key: 'rename',
    label: '重命名',
    icon: Pencil,
    testId: 'dashboard-rename',
    disabled: !props.dashboard,
  },
  {
    key: 'delete',
    label: '删除',
    icon: Trash2,
    testId: 'dashboard-delete',
    danger: true,
    separatorBefore: true,
    disabled: !props.dashboard,
  },
  {
    key: 'import',
    label: '导入',
    icon: Upload,
    testId: 'dashboard-import',
  },
  {
    key: 'export',
    label: '导出',
    icon: Download,
    testId: 'dashboard-export',
    disabled: !props.dashboard,
  },
  {
    key: 'pause',
    label: props.paused ? '恢复全部' : '暂停全部',
    icon: props.paused ? Play : Pause,
    testId: 'dashboard-pause',
    separatorBefore: true,
    disabled: !props.dashboard,
  },
  {
    key: 'export-csv',
    label: '导出数据 CSV',
    icon: Download,
    testId: 'dashboard-export-csv',
    disabled: !props.dashboard,
  },
])

function onMoreSelect(key: string): void {
  switch (key) {
    case 'duplicate':
      emit('duplicate')
      break
    case 'rename':
      openRenameDialog()
      break
    case 'delete':
      emit('delete')
      break
    case 'import':
      fileInput.value?.click()
      break
    case 'export':
      exportData()
      break
    case 'pause':
      emit('toggle-pause')
      break
    case 'export-csv':
      emit('export-csv')
      break
  }
}
</script>

<template>
  <div class="dashboard-toolbar" data-testid="dashboard-toolbar">
    <div class="dashboard-toolbar__row dashboard-toolbar__row--primary">
      <div class="dashboard-toolbar__group">
        <select
          class="dashboard-toolbar__select"
          :value="dashboard?.id ?? ''"
          aria-label="仪表盘"
          data-testid="dashboard-select"
          @change="onSelectDashboard"
        >
          <option value="">选择仪表盘…</option>
          <option v-for="entry in dashboards" :key="entry.id" :value="entry.id">
            {{ entry.name }}
          </option>
        </select>

        <UiButton size="md" data-testid="dashboard-new" @click="openNewDialog">
          <Plus :size="15" aria-hidden="true" />
          新建
        </UiButton>

        <UiMenu :items="moreActions" aria-label="更多仪表盘操作" @select="onMoreSelect">
          <template #trigger>
            <UiButton size="md" variant="ghost" data-testid="dashboard-more">
              <MoreHorizontal :size="16" aria-hidden="true" />
              更多
            </UiButton>
          </template>
        </UiMenu>

        <span
          v-if="savingLabel"
          class="dashboard-toolbar__save"
          :class="{ 'is-error': saveStatus !== 'saving' }"
          data-testid="dashboard-unsaved"
          :title="saveError"
        >
          {{ savingLabel }}
        </span>

        <button
          v-if="paused"
          class="dashboard-toolbar__paused"
          type="button"
          data-testid="dashboard-paused-badge"
          title="点击恢复全部组件刷新"
          @click="emit('toggle-pause')"
        >
          <Pause :size="12" aria-hidden="true" />
          已暂停
        </button>

        <input
          ref="fileInput"
          class="dashboard-toolbar__file"
          type="file"
          accept=".json,application/json"
          data-testid="dashboard-import-file"
          @change="onImportFile"
        />
      </div>

      <div class="dashboard-toolbar__group dashboard-toolbar__group--actions">
        <UiTooltip
          :content="canGenerate ? '用当前数据源的变量生成仪表盘' : '需要当前数据源已有变量'"
        >
          <span>
            <UiButton
              size="md"
              :disabled="!canGenerate"
              data-testid="dashboard-generate"
              @click="emit('generate')"
            >
              <Wand2 :size="15" aria-hidden="true" />
              一键生成
            </UiButton>
          </span>
        </UiTooltip>

        <span class="dashboard-toolbar__divider" aria-hidden="true" />

        <UiButton
          size="md"
          :variant="mode === 'edit' ? 'primary' : 'secondary'"
          :data-mode="mode"
          data-testid="dashboard-mode"
          title="切换编辑 / 运行模式"
          @click="emit('mode-change', mode === 'edit' ? 'run' : 'edit')"
        >
          <RefreshCw :size="15" aria-hidden="true" />
          {{ mode === 'edit' ? '运行' : '编辑' }}
        </UiButton>

        <UiIconButton
          label="撤销（Ctrl/Cmd+Z）"
          :disabled="!canUndo"
          data-testid="dashboard-undo"
          @click="emit('undo')"
        >
          <Undo2 :size="16" aria-hidden="true" />
        </UiIconButton>
        <UiIconButton
          label="重做（Ctrl/Cmd+Shift+Z 或 Ctrl+Y）"
          :disabled="!canRedo"
          data-testid="dashboard-redo"
          @click="emit('redo')"
        >
          <Redo2 :size="16" aria-hidden="true" />
        </UiIconButton>

        <span class="dashboard-toolbar__divider" aria-hidden="true" />

        <UiButton
          size="md"
          variant="ghost"
          :class="{ 'is-active': variableSidebar }"
          :disabled="!dashboard"
          data-testid="dashboard-variable-toggle"
          title="显示 / 隐藏变量列表"
          @click="emit('toggle-variable-sidebar')"
        >
          <ListTree :size="15" aria-hidden="true" />
          变量列表
        </UiButton>
      </div>
    </div>

    <div v-if="dashboard" class="dashboard-toolbar__row dashboard-toolbar__row--sources">
      <span class="dashboard-toolbar__label">数据源</span>
      <div
        v-for="source in dashboard.sources"
        :key="source.alias"
        class="dashboard-toolbar__source"
      >
        <span class="dashboard-toolbar__alias">{{ source.alias }} →</span>
        <select
          class="dashboard-toolbar__session"
          :value="bindingValue(source.alias)"
          :aria-label="`数据源 ${source.alias} 的会话`"
          :data-testid="`dashboard-source-${source.alias}`"
          @change="onBindChange(source.alias, $event)"
        >
          <option value="">未绑定</option>
          <option v-for="session in sessions" :key="session.id" :value="session.id">
            {{ session.name }}（{{ stateLabel(session.state) }}）
          </option>
        </select>
        <UiIconButton
          v-if="dashboard.sources.length > 1"
          label="删除数据源"
          size="sm"
          variant="danger"
          @click="emit('remove-source', source.alias)"
        >
          <X :size="14" aria-hidden="true" />
        </UiIconButton>
      </div>
      <UiButton
        size="md"
        variant="ghost"
        data-testid="dashboard-source-add"
        @click="openSourceDialog"
      >
        <Plus :size="15" aria-hidden="true" />
        数据源
      </UiButton>
    </div>

    <UiDialog
      v-model="nameDialogOpen"
      :title="nameDialogTitle"
      width="min(92vw, 380px)"
      confirm-text="确定"
      @confirm="confirmName"
    >
      <div data-testid="dashboard-name-dialog" class="dashboard-toolbar__dialog">
        <label class="dashboard-toolbar__dialog-label" for="dashboard-name-input">名称</label>
        <UiInput
          id="dashboard-name-input"
          v-model="nameDraft"
          size="sm"
          aria-label="仪表盘名称"
          data-testid="dashboard-name-input"
          @enter="confirmName"
        />
      </div>
      <template #footer>
        <UiButton size="md" @click="nameDialogOpen = false">取消</UiButton>
        <UiButton
          size="md"
          variant="primary"
          data-testid="dashboard-name-confirm"
          @click="confirmName"
        >
          确定
        </UiButton>
      </template>
    </UiDialog>

    <UiDialog
      v-model="sourceDialogOpen"
      title="新增数据源"
      width="min(92vw, 400px)"
      confirm-text="添加"
      :confirm-disabled="sourceAliasError.length > 0 || sourceAlias.length === 0"
      @confirm="confirmSource"
    >
      <div data-testid="dashboard-source-dialog" class="dashboard-toolbar__dialog">
        <label class="dashboard-toolbar__dialog-label" for="dashboard-source-alias">alias</label>
        <UiInput
          id="dashboard-source-alias"
          v-model="sourceAlias"
          size="sm"
          monospace
          placeholder="例如 device_a"
          aria-label="数据源 alias"
          data-testid="dashboard-source-alias"
          :invalid="sourceAliasError.length > 0"
        />
        <p v-if="sourceAliasError" class="dashboard-toolbar__error">{{ sourceAliasError }}</p>
        <label class="dashboard-toolbar__dialog-label" for="dashboard-source-label">名称</label>
        <UiInput
          id="dashboard-source-label"
          v-model="sourceLabel"
          size="sm"
          placeholder="例如 主设备"
          aria-label="数据源名称"
          data-testid="dashboard-source-label"
        />
      </div>
      <template #footer>
        <UiButton size="md" @click="sourceDialogOpen = false">取消</UiButton>
        <UiButton
          size="md"
          variant="primary"
          :disabled="sourceAliasError.length > 0 || sourceAlias.length === 0"
          data-testid="dashboard-source-confirm"
          @click="confirmSource"
        >
          添加
        </UiButton>
      </template>
    </UiDialog>
  </div>
</template>

<style scoped>
.dashboard-toolbar {
  display: flex;
  flex-direction: column;
  gap: 6px;
  flex: none;
  padding: 7px 10px;
  border-bottom: 1px solid var(--border);
  background: var(--bg-elev);
}

.dashboard-toolbar__row {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 6px;
  min-width: 0;
}

.dashboard-toolbar__row--primary {
  justify-content: space-between;
  min-height: var(--control-h);
}

.dashboard-toolbar__group {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 6px;
  min-width: 0;
}

.dashboard-toolbar__group--actions {
  margin-left: auto;
}

.dashboard-toolbar__row--sources {
  gap: 8px;
  padding: 4px 8px;
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  background: var(--bg-sunken);
}

.dashboard-toolbar__paused {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  height: 24px;
  padding: 0 8px;
  border: 1px solid var(--warn);
  border-radius: var(--radius-sm);
  background: var(--warn-soft);
  color: var(--warn);
  font-size: 11px;
  font-weight: 600;
  cursor: pointer;
}

.dashboard-toolbar__paused:hover {
  filter: brightness(1.1);
}

.dashboard-toolbar__select,
.dashboard-toolbar__session {
  height: var(--control-h);
  padding: 0 10px;
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  background: var(--bg-sunken);
  color: var(--text);
  font-size: 12.5px;
}

.dashboard-toolbar__select {
  min-width: 180px;
  max-width: 280px;
}

.dashboard-toolbar__session {
  min-width: 190px;
}

.dashboard-toolbar__select:focus-visible,
.dashboard-toolbar__session:focus-visible {
  outline: none;
  box-shadow: var(--focus-ring);
}

.dashboard-toolbar__save {
  margin-left: auto;
  color: var(--text-faint);
  font-family: var(--font-mono);
  font-size: 11px;
}

.dashboard-toolbar__save.is-error {
  color: var(--warn);
}

.dashboard-toolbar__label {
  color: var(--text-faint);
  font-size: 11px;
  letter-spacing: 0.06em;
}

.dashboard-toolbar__source {
  display: flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
  padding: 2px 4px 2px 8px;
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  background: var(--bg-elev-2);
}

.dashboard-toolbar__alias {
  color: var(--accent);
  font-family: var(--font-mono);
  font-size: 11px;
}

.dashboard-toolbar__divider {
  flex: none;
  width: 1px;
  height: 20px;
  margin: 0 4px;
  background: var(--border);
}

.dashboard-toolbar :deep(.ui-button.is-active) {
  border-color: var(--accent);
  background: var(--accent-soft);
  color: var(--accent);
}

.dashboard-toolbar__file {
  display: none;
}

.dashboard-toolbar__dialog {
  display: flex;
  flex-direction: column;
  gap: 10px;
  min-width: 0;
}

.dashboard-toolbar__dialog-label {
  color: var(--text-dim);
  font-size: 12px;
}

.dashboard-toolbar__error {
  margin: 0;
  color: var(--danger);
  font-size: 11px;
  line-height: 1.5;
}
</style>
