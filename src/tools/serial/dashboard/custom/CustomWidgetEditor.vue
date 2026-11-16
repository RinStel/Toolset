<script setup lang="ts">
/**
 * 自定义控件编辑器（plan §8.12）。
 *
 * 全屏对话框，三栏布局与协议管理器一致：
 * - 左栏：自定义控件列表、新建（4 模板）、导入、复制、删除、导出；
 * - 中栏：CodeMirror（`ctx.` / `sdk.` 补全）+ 首次新建 / 导入时的安全说明；
 * - 右栏：预览（模拟数据或已打开会话）、属性、调试输出。
 *
 * 「运行预览」（Ctrl/Cmd+S）保存并重建预览实例；保存后仓库版本号递增，所有仪表盘中的
 * 实例重新 mount。预览实例同样经过调用保护与安全模式约束。
 */

import {
  computed,
  defineAsyncComponent,
  onBeforeUnmount,
  onMounted,
  ref,
  shallowRef,
  watch,
} from 'vue'
import { Copy, Download, FileUp, Play, Plus, Save, Trash2, X } from 'lucide-vue-next'

import {
  CUSTOM_WIDGET_TEMPLATES,
  compileCustomWidget,
  type CustomWidgetCompileResult,
  type CustomWidgetDefinition,
  type WidgetInstance,
  type WidgetPropField,
} from '@/domains/dashboard/public'
import { downloadText } from '@/shared/lib/download'
import UiButton from '@/shared/ui/components/UiButton.vue'
import UiCheckbox from '@/shared/ui/components/UiCheckbox.vue'
import UiFormField from '@/shared/ui/components/UiFormField.vue'
import UiIconButton from '@/shared/ui/components/UiIconButton.vue'
import UiInput from '@/shared/ui/components/UiInput.vue'
import UiNumberInput from '@/shared/ui/components/UiNumberInput.vue'
import { confirm } from '@/shared/ui/services/confirm'
import { toast } from '@/shared/ui/services/toast'

import PropertyPropEditor from '../prop-editors/PropEditor.vue'
import type { PropEditorContext } from '../prop-editors/types'
import { defaultForField } from '../widget-registry'
import { listBindableSessions } from '../../stores/sessions'
import CustomWidgetHost from './CustomWidgetHost.vue'
import {
  appendCustomWidgetLog,
  clearCustomWidgetLog,
  customWidgetLogVersion,
  customWidgetLogs,
} from './debug-log'
import {
  buildCustomWidgetFileName,
  countDashboardsUsingCustomWidget,
  duplicateCustomWidget,
  exportCustomWidget,
  getCustomWidgetRecord,
  importCustomWidget,
  isCustomWidgetSafetyNoticeDismissed,
  listCustomWidgetIndex,
  refreshCustomWidgets,
  removeCustomWidget,
  saveCustomWidget,
  serialCustomWidgets,
  setCustomWidgetSafetyNoticeDismissed,
  type CustomWidgetRecord,
} from './custom-widget-registry'
import { customWidgetEditorState, closeCustomWidgetEditor } from './editor-state'
import { customWidgetVariablesField } from './custom-widget-definition'
import {
  createPreviewRuntime,
  previewSourceOptions,
  type PreviewRuntimeHandle,
} from './preview-runtime'

const MAX_LOG_LINES = 100

type EditorTab = 'preview' | 'props' | 'debug'

const CodeEditor = defineAsyncComponent(() => import('../../components/CodeEditor.vue'))

/* ------------------------------------------------------------------------- */
/* 状态                                                                        */
/* ------------------------------------------------------------------------- */

const search = ref('')
const selectedId = ref<string | null>(null)
const recordName = ref('')
const code = ref('')
const savedCode = ref('')
const diagnosticLine = ref<number | null>(null)
const error = ref('')
const saving = ref(false)
const importing = ref(false)
const fileInput = ref<HTMLInputElement | null>(null)
const templatePickerOpen = ref(false)
const tab = ref<EditorTab>('preview')

const safetyNoticeVisible = ref(false)
const safetyDoNotAsk = ref(false)

const previewSource = ref('simulated')
const realSend = ref(false)
const previewWidthUnits = ref(6)
const previewHeightUnits = ref(6)
const previewKey = ref(0)
const previewCode = ref('')
const previewDefinition = shallowRef<CustomWidgetDefinition | null>(null)
const previewInstance = shallowRef<WidgetInstance | null>(null)
const previewHandle = shallowRef<PreviewRuntimeHandle | null>(null)
const previewRunning = ref(false)
const previewCompileError = ref('')

const logKey = computed(() => {
  const instance = previewInstance.value
  if (instance !== null && instance.type.startsWith('custom:')) {
    return instance.type.slice('custom:'.length)
  }
  return selectedId.value ?? 'preview'
})
const isDirty = computed(() => code.value !== savedCode.value)
const canSave = computed(() => !saving.value && !importing.value && code.value.trim().length > 0)
const editorOpen = computed(() => customWidgetEditorState.open)

const filteredItems = computed(() => {
  void serialCustomWidgets.revision
  const keyword = search.value.trim().toLowerCase()
  const items = listCustomWidgetIndex()
  if (keyword.length === 0) return items
  return items.filter((item) => item.name.toLowerCase().includes(keyword))
})

const sessionTick = ref(0)
const sessionTimer = setInterval(() => {
  sessionTick.value += 1
}, 500)

const previewSources = computed(() => {
  void sessionTick.value
  return previewSourceOptions(listBindableSessions().filter((session) => session.state === 'open'))
})

const previewLogs = computed(() => {
  void customWidgetLogVersion.value
  void serialCustomWidgets.revision
  return customWidgetLogs(logKey.value).slice(-MAX_LOG_LINES)
})

const previewBoxStyle = computed(() => ({
  width: `${previewWidthUnits.value * 32 + Math.max(0, previewWidthUnits.value - 1) * 6}px`,
  height: `${previewHeightUnits.value * 28 + Math.max(0, previewHeightUnits.value - 1) * 6}px`,
}))

/* ------------------------------------------------------------------------- */
/* 安全说明                                                                    */
/* ------------------------------------------------------------------------- */

function maybeShowSafetyNotice(): void {
  safetyDoNotAsk.value = isCustomWidgetSafetyNoticeDismissed()
  if (!safetyDoNotAsk.value) safetyNoticeVisible.value = true
}

function dismissSafetyNotice(): void {
  if (safetyDoNotAsk.value) setCustomWidgetSafetyNoticeDismissed(true)
  safetyNoticeVisible.value = false
}

/** 「新建」入口：打开模板选择并（首次）显示安全说明。 */
function onNewRequested(): void {
  templatePickerOpen.value = true
  maybeShowSafetyNotice()
}

/* ------------------------------------------------------------------------- */
/* 加载 / 选择                                                                 */
/* ------------------------------------------------------------------------- */

function defaultCommon(title: string): WidgetInstance['common'] {
  return {
    title,
    showTitle: true,
    titleAlign: 'left',
    background: 'default',
    border: true,
    padding: 8,
    fontScale: 1,
  }
}

function createPreviewInstance(): WidgetInstance | null {
  const definition = previewDefinition.value
  const handle = previewHandle.value
  if (definition === null || handle === null) return null
  const props: Record<string, unknown> = {}
  for (const field of definition.props ?? []) {
    const value = defaultForField(field)
    if (value !== undefined) props[field.key] = value
  }
  const variables = definition.variables
  if (variables !== undefined) {
    const available = handle.runtime.variables('main')
    const count = Math.min(variables.max, Math.max(variables.min, 0))
    props.variables = available.slice(0, count).map((info) => ({
      source: 'main',
      key: info.key,
    }))
  }
  return {
    id: 'custom-widget-preview',
    type: `custom:${selectedId.value ?? 'preview'}`,
    version: 1,
    x: 0,
    y: 0,
    w: previewWidthUnits.value,
    h: previewHeightUnits.value,
    common: defaultCommon(definition.meta.name),
    props,
  }
}

const previewRuntime = shallowRef<PreviewRuntimeHandle['runtime'] | null>(null)

function buildPreview(codeToRun: string, definition: CustomWidgetDefinition): void {
  previewHandle.value?.dispose()
  previewHandle.value = null
  previewRuntime.value = null
  const handle = createPreviewRuntime({
    source: previewSource.value,
    realSend,
    onLog: (line) => appendCustomWidgetLog(logKey.value, line),
  })
  previewHandle.value = handle
  previewRuntime.value = handle.runtime
  previewDefinition.value = definition
  previewCode.value = codeToRun
  previewInstance.value = createPreviewInstance()
  previewKey.value += 1
}

function rebuildPreviewFromCurrentCode(): void {
  previewCompileError.value = ''
  const compiled = compileCustomWidget(code.value)
  if (!compiled.ok) {
    previewCompileError.value = compiled.error
    diagnosticLine.value = compiled.line ?? null
    appendCustomWidgetLog(logKey.value, `[编译] ${compiled.error}`)
    return
  }
  buildPreview(code.value, compiled.definition)
}

async function loadRecord(id: string): Promise<void> {
  error.value = ''
  previewCompileError.value = ''
  diagnosticLine.value = null
  const record = await getCustomWidgetRecord(id)
  if (record === undefined) {
    error.value = `找不到自定义控件（${id}）`
    return
  }
  selectedId.value = record.id
  recordName.value = record.name
  code.value = record.code
  savedCode.value = record.code
  const compiled = compileCustomWidget(record.code)
  if (compiled.ok) {
    previewDefinition.value = compiled.definition
    buildPreview(record.code, compiled.definition)
  } else {
    previewDefinition.value = null
    previewCompileError.value = compiled.error
    diagnosticLine.value = compiled.line ?? null
  }
}

async function initialize(): Promise<void> {
  error.value = ''
  diagnosticLine.value = null
  await refreshCustomWidgets()
  const wanted = customWidgetEditorState.selectedId
  const candidate =
    wanted !== null && listCustomWidgetIndex().some((item) => item.id === wanted) ? wanted : null
  const first = candidate ?? listCustomWidgetIndex()[0]?.id ?? null
  if (first !== null) {
    await loadRecord(first)
  } else {
    selectedId.value = null
    recordName.value = ''
    code.value = ''
    savedCode.value = ''
    previewDefinition.value = null
    templatePickerOpen.value = !customWidgetEditorState.newRequested
  }
  if (customWidgetEditorState.newRequested) {
    customWidgetEditorState.newRequested = false
    templatePickerOpen.value = true
    maybeShowSafetyNotice()
  }
}

/* ------------------------------------------------------------------------- */
/* 编译                                                                        */
/* ------------------------------------------------------------------------- */

function compileCurrent(): CustomWidgetCompileResult {
  return compileCustomWidget(code.value)
}

/* ------------------------------------------------------------------------- */
/* 保存 / 运行                                                                 */
/* ------------------------------------------------------------------------- */

async function persist(rebuild: boolean): Promise<void> {
  if (!canSave.value) return
  error.value = ''
  diagnosticLine.value = null
  previewCompileError.value = ''
  const compiled = compileCurrent()
  if (!compiled.ok) {
    error.value = compiled.error
    diagnosticLine.value = compiled.line ?? null
    appendCustomWidgetLog(logKey.value, `[编译] ${compiled.error}`)
    return
  }
  saving.value = true
  try {
    const record = await saveCustomWidget({
      id: selectedId.value,
      code: code.value,
      name: compiled.definition.meta.name,
    })
    selectedId.value = record.id
    recordName.value = record.name
    savedCode.value = code.value
    previewDefinition.value = compiled.definition
    appendCustomWidgetLog(record.id, `[保存] ${record.name}`)
    toast.show({ type: 'success', message: `已保存自定义控件「${record.name}」` })
    if (rebuild) buildPreview(code.value, compiled.definition)
  } catch (saveError) {
    error.value = errorText(saveError)
    appendCustomWidgetLog(logKey.value, `[保存] ${error.value}`)
  } finally {
    saving.value = false
  }
}

async function runPreview(): Promise<void> {
  if (previewRunning.value) return
  previewRunning.value = true
  try {
    await persist(true)
  } finally {
    previewRunning.value = false
  }
}

/* ------------------------------------------------------------------------- */
/* 左栏动作                                                                    */
/* ------------------------------------------------------------------------- */

async function confirmDiscard(): Promise<boolean> {
  if (!isDirty.value) return true
  return confirm({
    title: '放弃未保存的修改',
    message: '当前编辑的自定义控件还未保存，继续操作将丢失修改，是否继续？',
    confirmText: '放弃修改',
    danger: true,
  })
}

async function selectRecord(id: string): Promise<void> {
  if (id === selectedId.value) return
  if (!(await confirmDiscard())) return
  templatePickerOpen.value = false
  await loadRecord(id)
}

async function createFromTemplate(templateId: string): Promise<void> {
  if (!(await confirmDiscard())) return
  const template = CUSTOM_WIDGET_TEMPLATES.find((candidate) => candidate.id === templateId)
  if (template === undefined) return
  selectedId.value = null
  recordName.value = template.name
  code.value = template.code
  savedCode.value = ''
  error.value = ''
  diagnosticLine.value = null
  templatePickerOpen.value = false
  tab.value = 'preview'
  maybeShowSafetyNotice()
  rebuildPreviewFromCurrentCode()
}

async function onImportFile(event: Event): Promise<void> {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  input.value = ''
  if (file === undefined) return
  if (!(await confirmDiscard())) return
  importing.value = true
  error.value = ''
  try {
    const text = await file.text()
    const compiled = compileCustomWidget(text)
    if (!compiled.ok) {
      error.value = compiled.error
      diagnosticLine.value = compiled.line ?? null
      return
    }
    // 导入仪表盘时复用同一冲突检测；单文件导入直接写为新控件。
    const record = await importCustomWidget(text, file.name)
    await refreshCustomWidgets()
    await loadRecord(record.id)
    toast.show({ type: 'success', message: `已导入自定义控件「${record.name}」` })
    maybeShowSafetyNotice()
  } catch (importError) {
    error.value = errorText(importError)
  } finally {
    importing.value = false
  }
}

async function copySelected(): Promise<void> {
  const compiled = compileCurrent()
  if (!compiled.ok) {
    error.value = compiled.error
    diagnosticLine.value = compiled.line ?? null
    return
  }
  const baseName = compiled.definition.meta.name || recordName.value || '未命名控件'
  try {
    let record: CustomWidgetRecord
    if (selectedId.value !== null) {
      record = await duplicateCustomWidget(selectedId.value)
    } else {
      record = await saveCustomWidget({
        id: null,
        code: code.value,
        name: `${baseName} 副本`,
      })
    }
    await refreshCustomWidgets()
    await loadRecord(record.id)
    toast.show({ type: 'success', message: `已复制为「${record.name}」` })
  } catch (copyError) {
    error.value = errorText(copyError)
  }
}

async function removeSelected(): Promise<void> {
  const id = selectedId.value
  if (id === null) return
  const usage = await countDashboardsUsingCustomWidget(id)
  const approved = await confirm({
    title: '删除自定义控件',
    message:
      usage > 0
        ? `「${recordName.value}」正在被 ${usage} 个仪表盘使用。删除后这些实例将显示「找不到自定义控件」。是否继续？`
        : `确定删除自定义控件「${recordName.value}」？删除后无法恢复。`,
    confirmText: '删除',
    danger: true,
  })
  if (!approved) return
  try {
    await removeCustomWidget(id)
    await refreshCustomWidgets()
    selectedId.value = null
    recordName.value = ''
    code.value = ''
    savedCode.value = ''
    previewDefinition.value = null
    previewHandle.value?.dispose()
    previewHandle.value = null
    previewRuntime.value = null
    previewInstance.value = null
    const first = listCustomWidgetIndex()[0]
    if (first !== undefined) await loadRecord(first.id)
    toast.show({ type: 'success', message: '已删除自定义控件' })
  } catch (removeError) {
    error.value = errorText(removeError)
  }
}

async function exportSelected(): Promise<void> {
  try {
    if (selectedId.value !== null) {
      const file = await exportCustomWidget(selectedId.value)
      downloadText(file.code, file.fileName, 'text/javascript;charset=utf-8')
      toast.show({ type: 'success', message: `已导出 ${file.fileName}` })
      return
    }
    const compiled = compileCurrent()
    if (!compiled.ok) {
      error.value = compiled.error
      diagnosticLine.value = compiled.line ?? null
      return
    }
    const name = compiled.definition.meta.name || '自定义控件'
    const fileName = buildCustomWidgetFileName(name)
    downloadText(code.value, fileName, 'text/javascript;charset=utf-8')
    toast.show({ type: 'success', message: `已导出 ${fileName}` })
  } catch (exportError) {
    error.value = errorText(exportError)
  }
}

/* ------------------------------------------------------------------------- */
/* 属性面板                                                                    */
/* ------------------------------------------------------------------------- */

const propsFields = computed<WidgetPropField[]>(() => {
  const definition = previewDefinition.value
  if (definition === null) return []
  const fields = [...(definition.props ?? [])]
  const variablesField = customWidgetVariablesField(definition)
  if (variablesField !== null) fields.push(variablesField)
  return fields
})

const previewEditorContext = computed<PropEditorContext | null>(() => {
  const handle = previewHandle.value
  const instance = previewInstance.value
  if (handle === null || instance === null) return null
  const defaults: Record<string, unknown> = {}
  for (const field of propsFields.value) defaults[field.key] = defaultForField(field)
  return {
    dashboard: handle.dashboard,
    runtime: handle.runtime,
    instanceIds: [instance.id],
    props: instance.props,
    defaults,
  }
})

function previewFieldValue(field: WidgetPropField): unknown {
  const value = previewInstance.value?.props[field.key]
  return value === undefined ? defaultForField(field) : value
}

function updatePreviewProp(field: WidgetPropField, value: unknown): void {
  const instance = previewInstance.value
  if (instance === null) return
  previewInstance.value = {
    ...instance,
    props: { ...instance.props, [field.key]: value },
  }
}

/** 预览实例的 `ctx.saveState()`：只更新本地预览实例，不写仪表盘。 */
function savePreviewState(state: Record<string, unknown>): void {
  const instance = previewInstance.value
  if (instance === null) return
  previewInstance.value = { ...instance, state }
}

function isFieldVisible(field: WidgetPropField): boolean {
  const condition = field.visibleWhen
  if (condition === undefined) return true
  const current = previewInstance.value?.props[condition.key]
  const expected = condition.equals
  if (Array.isArray(expected)) return expected.some((item) => item === current)
  return expected === current
}

const visiblePropsFields = computed(() =>
  propsFields.value.filter((field) => isFieldVisible(field)),
)

/* ------------------------------------------------------------------------- */
/* 预览数据源 / 真实发送                                                       */
/* ------------------------------------------------------------------------- */

function onPreviewSourceChange(value: string | number | null): void {
  if (typeof value !== 'string') return
  previewSource.value = value
  rebuildPreviewFromCurrentCode()
}

function onRealSendChange(value: boolean): void {
  realSend.value = value
  rebuildPreviewFromCurrentCode()
}

/* ------------------------------------------------------------------------- */
/* 关闭 / 快捷键                                                               */
/* ------------------------------------------------------------------------- */

async function requestClose(): Promise<void> {
  if (!(await confirmDiscard())) return
  close()
}

function close(): void {
  previewHandle.value?.dispose()
  previewHandle.value = null
  previewRuntime.value = null
  closeCustomWidgetEditor()
}

function onDocumentKeydown(event: KeyboardEvent): void {
  if (!editorOpen.value) return
  if (event.key === 'Escape') {
    event.preventDefault()
    void requestClose()
    return
  }
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') {
    event.preventDefault()
    void runPreview()
  }
}

/* ------------------------------------------------------------------------- */
/* 生命周期                                                                    */
/* ------------------------------------------------------------------------- */

watch(
  () => customWidgetEditorState.open,
  (open) => {
    if (open) {
      void initialize()
      return
    }
    previewHandle.value?.dispose()
    previewHandle.value = null
    previewRuntime.value = null
  },
  { immediate: true },
)

watch(
  () => previewWidthUnits.value,
  () => {
    const instance = previewInstance.value
    if (instance !== null) {
      previewInstance.value = { ...instance, w: previewWidthUnits.value }
    }
  },
)

watch(
  () => previewHeightUnits.value,
  () => {
    const instance = previewInstance.value
    if (instance !== null) {
      previewInstance.value = { ...instance, h: previewHeightUnits.value }
    }
  },
)

onMounted(() => {
  if (typeof document !== 'undefined') document.addEventListener('keydown', onDocumentKeydown)
})

onBeforeUnmount(() => {
  if (typeof document !== 'undefined') document.removeEventListener('keydown', onDocumentKeydown)
  clearInterval(sessionTimer)
  previewHandle.value?.dispose()
})

function errorText(value: unknown): string {
  if (value instanceof Error && value.message.length > 0) return value.message
  if (typeof value === 'string') return value
  return String(value)
}
</script>

<template>
  <Teleport to="body">
    <div v-if="editorOpen" class="custom-editor" data-testid="custom-widget-editor">
      <div class="custom-editor__panel" role="dialog" aria-modal="true" aria-label="自定义控件">
        <header class="custom-editor__header">
          <h2 class="custom-editor__title">自定义控件编辑器</h2>
          <div class="custom-editor__header-tools">
            <span class="custom-editor__name" data-testid="custom-widget-editor-name">
              {{ recordName || '未命名控件' }}
              <span v-if="isDirty" class="custom-editor__dirty">未保存</span>
            </span>
            <UiIconButton
              label="关闭"
              size="sm"
              data-testid="custom-widget-close-icon"
              @click="requestClose"
            >
              <X :size="15" aria-hidden="true" />
            </UiIconButton>
          </div>
        </header>

        <div class="custom-editor__body">
          <aside class="custom-editor__sidebar">
            <UiInput
              v-model="search"
              size="sm"
              type="search"
              placeholder="搜索自定义控件"
              aria-label="搜索自定义控件"
              data-testid="custom-widget-search"
            />

            <div class="custom-editor__actions">
              <UiButton size="md" data-testid="custom-widget-new" @click="onNewRequested">
                <Plus :size="15" aria-hidden="true" />
                新建
              </UiButton>
              <UiButton
                size="md"
                :loading="importing"
                data-testid="custom-widget-import"
                @click="fileInput?.click()"
              >
                <FileUp :size="15" aria-hidden="true" />
                导入
              </UiButton>
              <UiButton
                size="md"
                variant="ghost"
                data-testid="custom-widget-copy"
                @click="copySelected"
              >
                <Copy :size="15" aria-hidden="true" />
                复制
              </UiButton>
              <UiButton
                size="md"
                variant="ghost"
                data-testid="custom-widget-export"
                @click="exportSelected"
              >
                <Download :size="15" aria-hidden="true" />
                导出
              </UiButton>
              <UiButton
                size="md"
                variant="danger"
                :disabled="selectedId === null"
                data-testid="custom-widget-delete"
                @click="removeSelected"
              >
                <Trash2 :size="15" aria-hidden="true" />
                删除
              </UiButton>
            </div>
            <input
              ref="fileInput"
              class="custom-editor__file"
              type="file"
              accept=".js,text/javascript"
              data-testid="custom-widget-import-file"
              @change="onImportFile"
            />

            <div
              v-if="templatePickerOpen"
              class="custom-editor__templates"
              data-testid="custom-widget-templates"
            >
              <p class="custom-editor__hint">选择一个模板开始：</p>
              <button
                v-for="template in CUSTOM_WIDGET_TEMPLATES"
                :key="template.id"
                class="custom-editor__template"
                type="button"
                :title="template.description"
                :data-testid="`custom-widget-template-${template.id}`"
                @click="createFromTemplate(template.id)"
              >
                {{ template.name }}
              </button>
            </div>

            <div class="custom-editor__list">
              <h3 class="custom-editor__group-title">自定义控件</h3>
              <button
                v-for="item in filteredItems"
                :key="item.id"
                class="custom-editor__item"
                :class="{ 'is-active': item.id === selectedId }"
                type="button"
                :data-testid="`custom-widget-item-${item.id}`"
                @click="selectRecord(item.id)"
              >
                {{ item.name }}
              </button>
              <p v-if="filteredItems.length === 0" class="custom-editor__hint">
                还没有自定义控件，可新建或导入。
              </p>
            </div>
          </aside>

          <section class="custom-editor__editor">
            <div class="custom-editor__editor-bar">
              <span class="custom-editor__editor-label">JavaScript 函数体</span>
              <span class="custom-editor__hint">return 一个 CustomWidgetDefinition</span>
            </div>

            <div
              v-if="safetyNoticeVisible"
              class="custom-editor__safety"
              data-testid="custom-widget-safety"
            >
              <p>
                安全说明：自定义控件拥有与页面相同的权限（可以访问 DOM、本地存储和已打开的串口），
                只应运行自己编写或信任的代码。
              </p>
              <div class="custom-editor__safety-actions">
                <UiCheckbox
                  v-model="safetyDoNotAsk"
                  size="sm"
                  label="不再提示"
                  data-testid="custom-widget-safety-do-not-ask"
                />
                <UiButton
                  size="sm"
                  data-testid="custom-widget-safety-dismiss"
                  @click="dismissSafetyNotice"
                >
                  我知道了
                </UiButton>
              </div>
            </div>

            <CodeEditor
              v-model="code"
              completion-profile="widget"
              :diagnostic-line="diagnosticLine"
              data-testid="custom-widget-code"
            />
            <p
              v-if="error"
              class="custom-editor__error"
              role="alert"
              data-testid="custom-widget-error"
            >
              {{ error }}
            </p>
          </section>

          <aside class="custom-editor__inspector">
            <div class="custom-editor__tabs" role="tablist" aria-label="自定义控件信息">
              <button
                class="custom-editor__tab"
                :class="{ 'is-active': tab === 'preview' }"
                type="button"
                role="tab"
                data-testid="custom-widget-tab-preview"
                @click="tab = 'preview'"
              >
                预览
              </button>
              <button
                class="custom-editor__tab"
                :class="{ 'is-active': tab === 'props' }"
                type="button"
                role="tab"
                data-testid="custom-widget-tab-props"
                @click="tab = 'props'"
              >
                属性
              </button>
              <button
                class="custom-editor__tab"
                :class="{ 'is-active': tab === 'debug' }"
                type="button"
                role="tab"
                data-testid="custom-widget-tab-debug"
                @click="tab = 'debug'"
              >
                调试输出
              </button>
            </div>

            <div v-if="tab === 'preview'" class="custom-editor__tab-body">
              <UiFormField label="数据源">
                <select
                  class="custom-editor__native-select"
                  :value="previewSource"
                  aria-label="预览数据源"
                  data-testid="custom-widget-preview-source"
                  @change="onPreviewSourceChange(($event.target as HTMLSelectElement).value)"
                >
                  <option
                    v-for="option in previewSources"
                    :key="option.value"
                    :value="option.value"
                  >
                    {{ option.label }}
                  </option>
                </select>
              </UiFormField>

              <UiCheckbox
                :model-value="realSend"
                size="sm"
                label="真实发送"
                data-testid="custom-widget-preview-real-send"
                @update:model-value="onRealSendChange"
              />

              <div class="custom-editor__preview-sizes">
                <UiFormField label="宽（格）">
                  <UiNumberInput
                    v-model="previewWidthUnits"
                    :min="1"
                    :max="24"
                    size="sm"
                    aria-label="预览宽度"
                    data-testid="custom-widget-preview-width"
                  />
                </UiFormField>
                <UiFormField label="高（格）">
                  <UiNumberInput
                    v-model="previewHeightUnits"
                    :min="1"
                    :max="64"
                    size="sm"
                    aria-label="预览高度"
                    data-testid="custom-widget-preview-height"
                  />
                </UiFormField>
              </div>

              <div class="custom-editor__preview-scroll">
                <div
                  class="custom-editor__preview"
                  :style="previewBoxStyle"
                  data-testid="custom-widget-preview"
                >
                  <CustomWidgetHost
                    v-if="previewInstance !== null && previewRuntime !== null"
                    :key="previewKey"
                    :instance="previewInstance"
                    :runtime="previewRuntime"
                    :code="previewCode"
                    mode="run"
                    :save-state="savePreviewState"
                  />
                  <p v-else class="custom-editor__hint custom-editor__hint--center">
                    点击「运行预览」查看效果
                  </p>
                </div>
              </div>
              <p v-if="previewCompileError" class="custom-editor__error" role="alert">
                {{ previewCompileError }}
              </p>
            </div>

            <div v-else-if="tab === 'props'" class="custom-editor__tab-body">
              <p v-if="visiblePropsFields.length === 0" class="custom-editor__hint">
                当前代码没有属性；在 return 的定义中加入 props 后重新运行预览。
              </p>
              <div
                v-for="field in visiblePropsFields"
                :key="field.key"
                class="custom-editor__prop"
                :data-testid="`prop-${field.key}`"
              >
                <UiFormField :label="field.label" :hint="field.help">
                  <PropertyPropEditor
                    v-if="previewEditorContext"
                    :field="field"
                    :value="previewFieldValue(field)"
                    :context="previewEditorContext"
                    @update="updatePreviewProp(field, $event)"
                  />
                </UiFormField>
              </div>
            </div>

            <div v-else class="custom-editor__tab-body">
              <div class="custom-editor__debug-head">
                <span class="custom-editor__hint"
                  >最近 {{ previewLogs.length }} / {{ MAX_LOG_LINES }} 行</span
                >
                <UiButton
                  size="sm"
                  variant="ghost"
                  data-testid="custom-widget-debug-clear"
                  @click="clearCustomWidgetLog(logKey)"
                >
                  清空
                </UiButton>
              </div>
              <pre class="custom-editor__debug" data-testid="custom-widget-debug">{{
                previewLogs.length === 0
                  ? '暂无输出（ctx.log 与异常会显示在这里）'
                  : previewLogs.join('\n')
              }}</pre>
            </div>
          </aside>
        </div>

        <footer class="custom-editor__footer">
          <span class="custom-editor__footer-label">LOCAL STORAGE</span>
          <UiButton
            size="md"
            data-testid="custom-widget-run"
            :loading="previewRunning"
            @click="runPreview"
          >
            <Play :size="15" aria-hidden="true" />
            运行预览
          </UiButton>
          <UiButton
            size="md"
            variant="primary"
            data-testid="custom-widget-save"
            :disabled="!canSave"
            :loading="saving"
            @click="persist(false)"
          >
            <Save :size="15" aria-hidden="true" />
            保存
          </UiButton>
          <UiButton size="md" data-testid="custom-widget-close" @click="requestClose">
            关闭
          </UiButton>
        </footer>
      </div>
    </div>
  </Teleport>
</template>

<style scoped>
.custom-editor {
  position: fixed;
  inset: 0;
  z-index: var(--z-editor, 1100);
  display: flex;
  align-items: stretch;
  justify-content: center;
  padding: var(--space-3);
  background: var(--overlay);
}

.custom-editor__panel {
  display: flex;
  flex-direction: column;
  width: min(1600px, 100%);
  height: 100%;
  max-height: 100%;
  min-width: 0;
  min-height: 0;
  overflow: hidden;
  border: 1px solid var(--border-strong);
  border-radius: var(--radius);
  background: var(--bg-elev-2);
  box-shadow: var(--shadow-pop);
}

.custom-editor__header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-3);
  flex: none;
  height: 44px;
  padding: 0 8px 0 var(--space-4);
  border-bottom: 1px solid var(--border);
}

.custom-editor__title {
  display: flex;
  align-items: center;
  gap: 8px;
  margin: 0;
  color: var(--text);
  font-size: 13.5px;
  font-weight: 600;
}

.custom-editor__title::before {
  content: '';
  width: 8px;
  height: 8px;
  border: 1px solid var(--accent);
  border-radius: 1px;
  background: var(--accent-soft);
}

.custom-editor__header-tools {
  display: flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
}

.custom-editor__name {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
  overflow: hidden;
  color: var(--text-dim);
  font-family: var(--font-mono);
  font-size: 11px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.custom-editor__dirty {
  color: var(--warn);
  font-family: var(--font-ui);
  font-size: 10px;
}

.custom-editor__body {
  display: flex;
  flex: 1 1 auto;
  min-width: 0;
  min-height: 0;
  overflow: hidden;
}

.custom-editor__sidebar {
  display: flex;
  flex-direction: column;
  gap: 10px;
  flex: none;
  width: 260px;
  min-height: 0;
  padding: 12px;
  overflow-y: auto;
  border-right: 1px solid var(--border);
  background: var(--bg-elev);
}

.custom-editor__actions {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 6px;
}

.custom-editor__actions :deep(.ui-button) {
  width: 100%;
  justify-content: flex-start;
}

.custom-editor__file {
  display: none;
}

.custom-editor__templates {
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: 6px;
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  background: var(--bg-sunken);
}

.custom-editor__template {
  height: var(--control-h);
  padding: 0 10px;
  border-radius: var(--radius-sm);
  background: var(--bg-elev-2);
  color: var(--text);
  font-size: 12px;
  text-align: left;
}

.custom-editor__template:hover {
  background: var(--bg-hover);
  color: var(--accent);
}

.custom-editor__list {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
}

.custom-editor__group-title {
  display: flex;
  align-items: center;
  gap: 8px;
  margin: 6px 0 2px;
  color: var(--text-faint);
  font-size: 10px;
  font-weight: 500;
  letter-spacing: 0.08em;
}

.custom-editor__group-title::after {
  content: '';
  flex: 1 1 auto;
  height: 1px;
  background: var(--border);
}

.custom-editor__item {
  min-width: 0;
  height: 32px;
  padding: 0 10px;
  overflow: hidden;
  border-radius: var(--radius-sm);
  color: var(--text-dim);
  font-size: 12px;
  text-align: left;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.custom-editor__item:hover {
  background: var(--bg-hover);
  color: var(--text);
}

.custom-editor__item.is-active {
  background: var(--accent-soft);
  box-shadow: inset 2px 0 0 var(--accent);
  color: var(--accent);
}

.custom-editor__editor {
  display: flex;
  flex-direction: column;
  flex: 1 1 auto;
  min-width: 0;
  min-height: 0;
  overflow: hidden;
  background: var(--bg-sunken);
}

.custom-editor__editor-bar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-2);
  flex: none;
  height: 30px;
  padding: 0 10px;
  border-bottom: 1px solid var(--border);
  background: var(--bg-elev);
}

.custom-editor__editor-label {
  color: var(--text-faint);
  font-family: var(--font-mono);
  font-size: 10px;
  letter-spacing: 0.08em;
  text-transform: uppercase;
}

.custom-editor__editor :deep(.code-editor) {
  flex: 1 1 auto;
  min-height: 0;
}

.custom-editor__safety {
  flex: none;
  display: flex;
  flex-direction: column;
  gap: 6px;
  margin: 8px;
  padding: 8px;
  border: 1px solid var(--warn);
  border-radius: var(--radius-sm);
  background: var(--warn-soft);
  color: var(--warn);
  font-size: 11px;
  line-height: 1.6;
}

.custom-editor__safety p {
  margin: 0;
}

.custom-editor__safety-actions {
  display: flex;
  align-items: center;
  gap: var(--space-2);
}

.custom-editor__error {
  flex: none;
  margin: 0;
  padding: 6px 8px;
  border-top: 1px solid var(--danger);
  background: var(--danger-soft);
  color: var(--danger);
  font-family: var(--font-mono);
  font-size: 11px;
  line-height: 1.5;
  white-space: pre-wrap;
}

.custom-editor__inspector {
  display: flex;
  flex-direction: column;
  flex: none;
  width: 360px;
  min-height: 0;
  border-left: 1px solid var(--border);
  background: var(--bg-elev);
}

.custom-editor__tabs {
  display: flex;
  flex: none;
  border-bottom: 1px solid var(--border);
}

.custom-editor__tab {
  flex: 1 1 0;
  height: 34px;
  border-bottom: 2px solid transparent;
  color: var(--text-dim);
  font-size: 12.5px;
  font-weight: 500;
}

.custom-editor__tab:hover {
  background: var(--bg-hover);
  color: var(--text);
}

.custom-editor__tab.is-active {
  border-bottom-color: var(--accent);
  color: var(--text);
}

.custom-editor__tab-body {
  display: flex;
  flex-direction: column;
  gap: 8px;
  flex: 1 1 auto;
  min-height: 0;
  padding: 10px;
  overflow-y: auto;
}

.custom-editor__native-select {
  width: 100%;
  height: var(--control-h-sm);
  padding: 0 6px;
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  background: var(--bg-sunken);
  color: var(--text);
  font-size: 11px;
}

.custom-editor__native-select:focus-visible {
  outline: none;
  box-shadow: var(--focus-ring);
}

.custom-editor__preview-sizes {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 6px;
}

.custom-editor__preview-scroll {
  flex: none;
  overflow: auto;
  padding: 6px;
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  background: var(--bg-sunken);
}

.custom-editor__preview {
  position: relative;
  display: flex;
  min-width: 60px;
  min-height: 60px;
  overflow: hidden;
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  background: var(--bg-sunken);
}

.custom-editor__preview > :deep(.custom-widget-host) {
  flex: 1 1 auto;
  min-width: 0;
  min-height: 0;
}

.custom-editor__prop {
  min-width: 0;
}

.custom-editor__debug-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}

.custom-editor__debug {
  margin: 0;
  padding: 8px;
  overflow: auto;
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  background: var(--bg-sunken);
  color: var(--text);
  font-family: var(--font-mono);
  font-size: 10px;
  line-height: 1.5;
  white-space: pre-wrap;
}

.custom-editor__hint {
  margin: 0;
  color: var(--text-faint);
  font-size: 11px;
  line-height: 1.5;
}

.custom-editor__hint--center {
  align-self: center;
  margin: auto;
  text-align: center;
}

.custom-editor__footer {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 10px;
  flex: none;
  height: 46px;
  padding: 0 var(--space-3);
  border-top: 1px solid var(--border);
}

.custom-editor__footer-label {
  margin-right: auto;
  color: var(--text-faint);
  font-family: var(--font-mono);
  font-size: 10px;
  letter-spacing: 0.1em;
}

@media (max-width: 1120px) {
  .custom-editor__sidebar {
    width: 210px;
  }

  .custom-editor__inspector {
    width: 300px;
  }
}

@media (max-width: 900px) {
  .custom-editor {
    padding: 0;
  }

  .custom-editor__panel {
    border-radius: 0;
  }

  .custom-editor__sidebar {
    width: 190px;
  }

  .custom-editor__inspector {
    width: 270px;
  }
}
</style>
