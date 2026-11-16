<script setup lang="ts">
/**
 * 协议管理器（plan §8.6）。
 *
 * 全屏对话框，三栏：左栏列表与操作、中栏 CodeMirror、右栏「说明 / 预览 / 调试输出」。
 * 保存前先在临时 Worker 中编译并校验；成功后写仓库，并让所有使用该协议的会话重建
 * runtime。有未保存修改时关闭对话框需要确认。
 *
 * CodeEditor 通过 `defineAsyncComponent` 动态加载，CodeMirror 因此保持独立分包。
 */

import { computed, defineAsyncComponent, onBeforeUnmount, ref, watch } from 'vue'
import { Copy, Download, FileUp, Plus, Save, Trash2, X } from 'lucide-vue-next'

import { parseHex, toHex } from '@/domains/bytes/public'
import { getLinkManager } from '@/domains/link/public'
import {
  createProtocolRuntime,
  getProtocolRepository,
  TEMPLATES,
  type FramingSpec,
  type ProtocolMeta,
  type ProtocolRuntime,
  type ProtocolSummary,
  type SendField,
  type SendValue,
} from '@/domains/protocol/public'
import { downloadText } from '@/shared/lib/download'
import UiButton from '@/shared/ui/components/UiButton.vue'
import UiCheckbox from '@/shared/ui/components/UiCheckbox.vue'
import UiFormField from '@/shared/ui/components/UiFormField.vue'
import UiIconButton from '@/shared/ui/components/UiIconButton.vue'
import UiInput from '@/shared/ui/components/UiInput.vue'
import UiMenu from '@/shared/ui/components/UiMenu.vue'
import UiNumberInput from '@/shared/ui/components/UiNumberInput.vue'
import UiSelect from '@/shared/ui/components/UiSelect.vue'
import { confirm } from '@/shared/ui/services/confirm'
import { toast } from '@/shared/ui/services/toast'

import {
  createRawSendValues,
  hexPreview,
  toSendValues,
  type RawSendValue,
  type RawSendValues,
} from '../composables/sendForm'
import {
  findProtocolSummary,
  protocolSummaries,
  refreshProtocols,
  watchProtocols,
} from '../stores/protocols'

const CodeEditor = defineAsyncComponent(() => import('./CodeEditor.vue'))

const props = withDefaults(
  defineProps<{
    modelValue?: boolean
    /** 打开管理器时所在的会话；新建并保存协议后自动套用到该会话。 */
    sessionId?: string | null
  }>(),
  { modelValue: false, sessionId: null },
)

const emit = defineEmits<{ 'update:modelValue': [value: boolean] }>()

const repository = getProtocolRepository()

/** 调试输出最多保留的行数（plan §8.6）。 */
const MAX_LOG_LINES = 100

type PreviewTab = 'info' | 'preview' | 'debug'

interface PreviewFrame {
  direction: 'rx' | 'tx'
  hex: string
  summaries: string[]
  fields: string[]
  error?: string
}

const search = ref('')
const selectedId = ref<string | null>(null)
const selectedBuiltin = ref(false)
const selectedName = ref('')
const code = ref('')
const savedCode = ref('')
const meta = ref<ProtocolMeta | null>(null)
const framing = ref<FramingSpec | null>(null)
const sendFields = ref<SendField[] | null>(null)
const error = ref('')
const inspectorError = ref('')
const diagnosticLine = ref<number | null>(null)
const saving = ref(false)
const importing = ref(false)
const fileInput = ref<HTMLInputElement | null>(null)

const tab = ref<PreviewTab>('info')
const previewInput = ref('')
const previewDirection = ref<'rx' | 'tx'>('rx')
const previewRunning = ref(false)
const previewError = ref('')
const previewFrames = ref<PreviewFrame[]>([])
const previewDiscards = ref<string[]>([])
const previewRaw = ref<RawSendValues>({})
const previewEncoded = ref('')
const previewEncodeError = ref('')
const logLines = ref<Array<{ level: string; text: string }>>([])

watchProtocols()

const filteredBuiltins = computed(() =>
  protocolSummaries.value.filter(
    (record) =>
      record.builtin &&
      (search.value.trim().length === 0 ||
        record.name.toLowerCase().includes(search.value.trim().toLowerCase())),
  ),
)

const filteredCustom = computed(() =>
  protocolSummaries.value.filter(
    (record) =>
      !record.builtin &&
      (search.value.trim().length === 0 ||
        record.name.toLowerCase().includes(search.value.trim().toLowerCase())),
  ),
)

const templateItems = TEMPLATES.map((template) => ({ key: template.id, label: template.name }))

const isDirty = computed(() => code.value !== savedCode.value)
const hasSendForm = computed(() => (sendFields.value?.length ?? 0) > 0)
const canSave = computed(
  () => !selectedBuiltin.value && !saving.value && code.value.trim().length > 0,
)

function appendLog(level: string, text: string): void {
  logLines.value = [...logLines.value, { level, text }].slice(-MAX_LOG_LINES)
}

function errorText(value: unknown): string {
  if (value instanceof Error && value.message.length > 0) return value.message
  if (typeof value === 'string') return value
  return String(value)
}

function extractErrorLine(message: string): number | null {
  const formatted = /第\s*(\d+)\s*行/.exec(message)
  if (formatted?.[1] !== undefined) {
    const line = Number(formatted[1])
    if (Number.isInteger(line) && line > 0) return line
  }
  const position = /:(\d+):(\d+)/.exec(message)
  if (position?.[1] !== undefined) {
    const line = Number(position[1])
    if (Number.isInteger(line) && line > 0) return line
  }
  return null
}

function framingSummary(value: FramingSpec | null): string {
  if (value === null) return '尚未读取'
  switch (value.type) {
    case 'line':
      return `按行分帧（EOL：${value.eol ?? 'lf'}${value.includeEol === true ? '，保留行尾' : ''}）`
    case 'delimiter':
      return `分隔符分帧（起始 ${value.start ?? '无'}，结束 ${value.end}${
        value.include === 'both' ? '，保留起止符' : ''
      }）`
    case 'fixed':
      return `定长分帧（${String(value.length)} 字节${
        value.header === undefined ? '' : `，帧头 ${value.header}`
      }${value.trailer === undefined ? '' : `，帧尾 ${value.trailer}`}）`
    case 'length':
      return `长度字段分帧（偏移 ${String(value.length.offset)}，${String(
        value.length.size,
      )} 字节，includes=${value.length.includes}${
        value.header === undefined ? '' : `，帧头 ${value.header}`
      }）`
    case 'idle':
      return `空闲间隔分帧（静默 ${String(value.gapMs)}ms）`
  }
}

function defaultRawValues(fields: SendField[]): RawSendValues {
  return createRawSendValues(fields)
}

function numberValue(key: string): number | null {
  const value = previewRaw.value[key]
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

function textValue(key: string): string {
  const value = previewRaw.value[key]
  return typeof value === 'string' ? value : ''
}

function selectValue(key: string): string | number | null {
  const value = previewRaw.value[key]
  return typeof value === 'string' || typeof value === 'number' ? value : null
}

function checkboxValue(key: string): boolean {
  return previewRaw.value[key] === true
}

function setRaw(key: string, value: RawSendValue): void {
  previewRaw.value = { ...previewRaw.value, [key]: value }
}

function onDirectionChange(event: Event): void {
  previewDirection.value = (event.target as HTMLSelectElement).value === 'tx' ? 'tx' : 'rx'
}

function selectOptions(field: SendField): Array<{ label: string; value: string | number }> {
  return field.type === 'select' ? field.options : []
}

async function inspect(source: string): Promise<void> {
  inspectorError.value = ''
  meta.value = null
  framing.value = null
  sendFields.value = null
  let runtime: ProtocolRuntime | null = null
  try {
    runtime = await createProtocolRuntime(source)
    meta.value = runtime.info.meta
    framing.value = runtime.info.framing
    sendFields.value = runtime.info.sendForm?.fields ?? null
    previewRaw.value = defaultRawValues(sendFields.value ?? [])
  } catch (inspectionError) {
    inspectorError.value = errorText(inspectionError)
  } finally {
    runtime?.dispose()
  }
}

function resetPreview(): void {
  previewError.value = ''
  previewFrames.value = []
  previewDiscards.value = []
  previewEncoded.value = ''
  previewEncodeError.value = ''
}

async function loadRecord(id: string): Promise<void> {
  error.value = ''
  inspectorError.value = ''
  diagnosticLine.value = null
  resetPreview()
  const summary = findProtocolSummary(id)
  if (summary === undefined) {
    error.value = `协议不存在：${id}`
    return
  }
  selectedId.value = summary.id
  selectedBuiltin.value = summary.builtin
  selectedName.value = summary.name
  const record = await repository.get(id)
  if (record === undefined) {
    error.value = `协议不存在：${id}`
    return
  }
  code.value = record.code
  savedCode.value = record.code
  await inspect(record.code)
}

async function initialize(): Promise<void> {
  error.value = ''
  inspectorError.value = ''
  diagnosticLine.value = null
  resetPreview()
  logLines.value = []
  await refreshProtocols()
  const current = selectedId.value
  if (current !== null && findProtocolSummary(current) !== undefined) {
    await loadRecord(current)
    return
  }
  const first = protocolSummaries.value[0]
  if (first !== undefined) await loadRecord(first.id)
}

function findSelectedSummary(): ProtocolSummary | undefined {
  return findProtocolSummary(selectedId.value)
}

async function confirmDiscard(): Promise<boolean> {
  if (!isDirty.value) return true
  return confirm({
    title: '放弃未保存的修改',
    message: '当前编辑的协议还未保存，继续操作将丢失修改，是否继续？',
    confirmText: '放弃修改',
    danger: true,
  })
}

async function selectRecord(id: string): Promise<void> {
  if (id === selectedId.value) return
  if (!(await confirmDiscard())) return
  await loadRecord(id)
}

async function createFromTemplate(templateId: string): Promise<void> {
  if (!(await confirmDiscard())) return
  const template = TEMPLATES.find((candidate) => candidate.id === templateId)
  if (template === undefined) return
  selectedId.value = null
  selectedBuiltin.value = false
  selectedName.value = template.name
  code.value = template.code
  savedCode.value = ''
  error.value = ''
  inspectorError.value = ''
  diagnosticLine.value = null
  resetPreview()
  await inspect(code.value)
}

async function onImportFile(event: Event): Promise<void> {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  input.value = ''
  if (file === undefined) return
  if (!(await confirmDiscard())) return
  importing.value = true
  try {
    const text = await file.text()
    const record = await repository.importFile(text, file.name)
    await refreshProtocols()
    await loadRecord(record.id)
    toast.show({ type: 'success', message: `已导入协议「${record.name}」` })
  } catch (importError) {
    error.value = `导入失败：${errorText(importError)}`
  } finally {
    importing.value = false
  }
}

async function copySelected(): Promise<void> {
  if (code.value.trim().length === 0) return
  const baseName = meta.value?.name ?? selectedName.value ?? '未命名协议'
  try {
    const record = await repository.save({ name: `${baseName} 副本`, code: code.value })
    await refreshProtocols()
    await loadRecord(record.id)
    toast.show({ type: 'success', message: `已复制为「${record.name}」` })
  } catch (copyError) {
    error.value = `复制失败：${errorText(copyError)}`
  }
}

async function removeSelected(): Promise<void> {
  const summary = findSelectedSummary()
  if (summary === undefined || summary.builtin) return
  const approved = await confirm({
    title: '删除协议',
    message: `确定删除协议「${summary.name}」？正在使用它的会话将回退为无协议。`,
    confirmText: '删除',
    danger: true,
  })
  if (!approved) return
  try {
    await repository.remove(summary.id)
    for (const session of getLinkManager().sessions()) {
      if (session.protocol?.id !== summary.id) continue
      await session.setProtocol(null)
      session.writeSystemLog('info', `协议已删除：${summary.name}`)
    }
    await refreshProtocols()
    selectedId.value = null
    const first = protocolSummaries.value[0]
    if (first !== undefined) await loadRecord(first.id)
    toast.show({ type: 'success', message: `已删除协议「${summary.name}」` })
  } catch (removeError) {
    error.value = `删除失败：${errorText(removeError)}`
  }
}

async function exportSelected(): Promise<void> {
  try {
    if (selectedId.value !== null) {
      const file = await repository.exportFile(selectedId.value)
      downloadText(file.code, file.fileName, 'text/javascript;charset=utf-8')
      toast.show({ type: 'success', message: `已导出 ${file.fileName}` })
      return
    }
    const name = meta.value?.name ?? selectedName.value ?? '未命名协议'
    const fileName = `${name.replace(/[\\/:*?"<>|]/g, '_').trim() || '未命名协议'}.protocol.js`
    downloadText(code.value, fileName, 'text/javascript;charset=utf-8')
    toast.show({ type: 'success', message: `已导出 ${fileName}` })
  } catch (exportError) {
    error.value = `导出失败：${errorText(exportError)}`
  }
}

async function save(): Promise<void> {
  if (!canSave.value) return
  saving.value = true
  error.value = ''
  diagnosticLine.value = null
  let runtime: ProtocolRuntime | null = null
  let createdId: string | null = null
  try {
    runtime = await createProtocolRuntime(code.value)
    const info = runtime.info
    meta.value = info.meta
    framing.value = info.framing
    sendFields.value = info.sendForm?.fields ?? null
    const wasNew = selectedId.value === null
    const record = await repository.save({
      ...(selectedId.value === null ? {} : { id: selectedId.value }),
      name: info.meta.name,
      code: code.value,
    })
    createdId = record.id
    selectedId.value = record.id
    selectedBuiltin.value = false
    selectedName.value = record.name
    savedCode.value = code.value
    previewRaw.value = defaultRawValues(sendFields.value ?? [])
    await refreshProtocols()
    for (const session of getLinkManager().sessions()) {
      if (session.protocol?.id !== record.id) continue
      await session.setProtocol(record.id)
      session.writeSystemLog('info', `协议已更新：${record.name}`)
    }
    // 首次保存的新协议直接套用到打开管理器时的会话（e2e 用例 5 的「立即生效」）。
    if (wasNew && props.sessionId !== null) {
      const current = getLinkManager().get(props.sessionId)
      if (current !== undefined) {
        await current.setProtocol(record.id)
        current.writeSystemLog('info', `协议已更新：${record.name}`)
      }
    }
    toast.show({ type: 'success', message: `已保存协议「${record.name}」` })
  } catch (saveError) {
    const message = errorText(saveError)
    error.value = message
    diagnosticLine.value = extractErrorLine(message)
    appendLog('error', message)
    if (createdId !== null) selectedId.value = createdId
  } finally {
    runtime?.dispose()
    saving.value = false
  }
}

async function runPreview(): Promise<void> {
  resetPreview()
  previewRunning.value = true
  let runtime: ProtocolRuntime | null = null
  try {
    const parsed = parseHex(previewInput.value)
    if (!parsed.ok) throw new Error(`HEX 解析失败：${parsed.error}`)
    runtime = await createProtocolRuntime(code.value)
    const active = runtime
    active.on('frames', (frames) => {
      previewFrames.value = [
        ...previewFrames.value,
        ...frames.map((frame) => ({
          direction: frame.direction,
          hex: toHex(frame.bytes),
          summaries: frame.results.map((result) => result.summary),
          fields: frame.results.flatMap((result) =>
            (result.fields ?? []).map(
              (field) => `${field.label}=${String(field.value)}${field.unit ?? ''}`,
            ),
          ),
          ...(frame.error === undefined ? {} : { error: frame.error }),
        })),
      ]
    })
    active.on('discard', (event) => {
      previewDiscards.value = [...previewDiscards.value, toHex(event.bytes)]
    })
    active.on('log', (event) => {
      appendLog(event.level, event.text)
    })

    if (previewDirection.value === 'tx') {
      active.decodeTx(parsed.bytes, Date.now())
    } else {
      active.feed(parsed.bytes, Date.now())
    }
    // 等待 Worker 批量处理；idle 模式还需要等静默间隔触发 flush。
    await new Promise((resolve) => setTimeout(resolve, 140))
    const activeInfo = active.info
    if (previewDirection.value === 'rx' && activeInfo.framing.type === 'idle') {
      const gapMs = activeInfo.framing.gapMs
      await new Promise((resolve) => setTimeout(resolve, gapMs + 80))
    }

    if (activeInfo.sendForm !== undefined) {
      const converted = toSendValues(activeInfo.sendForm.fields, previewRaw.value)
      if (!converted.ok) {
        previewEncodeError.value = converted.error
      } else {
        try {
          const bytes = await active.encode(converted.values as Record<string, SendValue>)
          previewEncoded.value = hexPreview(bytes)
        } catch (encodeError) {
          previewEncodeError.value = errorText(encodeError)
        }
      }
    }
  } catch (previewFailure) {
    previewError.value = errorText(previewFailure)
    appendLog('error', previewError.value)
  } finally {
    runtime?.dispose()
    previewRunning.value = false
  }
}

async function requestClose(): Promise<void> {
  if (!(await confirmDiscard())) return
  emit('update:modelValue', false)
}

function onDocumentKeydown(event: KeyboardEvent): void {
  if (event.key !== 'Escape') return
  if (!props.modelValue) return
  event.preventDefault()
  void requestClose()
}

watch(
  () => props.modelValue,
  (visible) => {
    if (!visible) return
    void initialize()
  },
  { immediate: true },
)

watch(
  () => props.modelValue,
  (visible) => {
    if (typeof document === 'undefined') return
    if (visible) document.addEventListener('keydown', onDocumentKeydown)
    else document.removeEventListener('keydown', onDocumentKeydown)
  },
)

onBeforeUnmount(() => {
  if (typeof document !== 'undefined') {
    document.removeEventListener('keydown', onDocumentKeydown)
  }
})
</script>

<template>
  <Teleport to="body">
    <div v-if="modelValue" class="protocol-manager" data-testid="protocol-manager">
      <div class="protocol-manager__panel" role="dialog" aria-modal="true" aria-label="协议管理器">
        <header class="protocol-manager__header">
          <h2 class="protocol-manager__title">协议管理器</h2>
          <div class="protocol-manager__header-tools">
            <span class="protocol-manager__name" data-testid="protocol-name">
              {{ meta?.name ?? selectedName ?? '未选择协议' }}
              <span v-if="selectedBuiltin" class="protocol-manager__badge">内置 · 只读</span>
              <span v-if="isDirty" class="protocol-manager__dirty">未保存</span>
            </span>
            <UiIconButton label="关闭" size="sm" data-testid="protocol-close" @click="requestClose">
              <X :size="15" aria-hidden="true" />
            </UiIconButton>
          </div>
        </header>

        <div class="protocol-manager__body">
          <aside class="protocol-manager__sidebar">
            <UiInput
              v-model="search"
              size="md"
              type="search"
              placeholder="搜索协议"
              aria-label="搜索协议"
              data-testid="protocol-search"
            />

            <div class="protocol-manager__actions">
              <UiMenu :items="templateItems" @select="createFromTemplate">
                <template #trigger>
                  <UiButton size="md" data-testid="protocol-manager-new">
                    <Plus :size="15" aria-hidden="true" />
                    新建
                  </UiButton>
                </template>
              </UiMenu>
              <UiButton
                size="md"
                :loading="importing"
                data-testid="protocol-import"
                @click="fileInput?.click()"
              >
                <FileUp :size="15" aria-hidden="true" />
                导入
              </UiButton>
              <UiButton size="md" variant="ghost" data-testid="protocol-copy" @click="copySelected">
                <Copy :size="15" aria-hidden="true" />
                复制
              </UiButton>
              <UiButton
                size="md"
                variant="ghost"
                data-testid="protocol-export"
                @click="exportSelected"
              >
                <Download :size="15" aria-hidden="true" />
                导出
              </UiButton>
              <UiButton
                size="md"
                variant="danger"
                data-testid="protocol-delete"
                :disabled="selectedBuiltin || selectedId === null"
                @click="removeSelected"
              >
                <Trash2 :size="15" aria-hidden="true" />
                删除
              </UiButton>
            </div>
            <input
              ref="fileInput"
              class="protocol-manager__file"
              type="file"
              accept=".js,text/javascript"
              data-testid="protocol-import-file"
              @change="onImportFile"
            />

            <div class="protocol-manager__groups">
              <h3 class="protocol-manager__group-title">内置</h3>
              <button
                v-for="record in filteredBuiltins"
                :key="record.id"
                class="protocol-manager__item"
                :class="{ 'is-active': record.id === selectedId }"
                type="button"
                :data-testid="`protocol-item-${record.id}`"
                @click="selectRecord(record.id)"
              >
                {{ record.name }}
              </button>
              <p v-if="filteredBuiltins.length === 0" class="protocol-manager__hint">无匹配项</p>

              <h3 class="protocol-manager__group-title">自定义</h3>
              <button
                v-for="record in filteredCustom"
                :key="record.id"
                class="protocol-manager__item"
                :class="{ 'is-active': record.id === selectedId }"
                type="button"
                :data-testid="`protocol-item-${record.id}`"
                @click="selectRecord(record.id)"
              >
                {{ record.name }}
              </button>
              <p v-if="filteredCustom.length === 0" class="protocol-manager__hint">
                还没有自定义协议，可新建或导入。
              </p>
            </div>
          </aside>

          <section class="protocol-manager__editor">
            <div class="protocol-manager__editor-bar">
              <span class="protocol-manager__editor-label">JavaScript 函数体</span>
              <span v-if="selectedBuiltin" class="protocol-manager__hint">内置协议只读</span>
            </div>
            <CodeEditor
              v-model="code"
              :readonly="selectedBuiltin"
              :diagnostic-line="diagnosticLine"
              data-testid="protocol-editor"
            />
            <p
              v-if="error"
              class="protocol-manager__error"
              role="alert"
              data-testid="protocol-error"
            >
              {{ error }}
            </p>
            <p v-else-if="inspectorError" class="protocol-manager__error" role="alert">
              {{ inspectorError }}
            </p>
          </section>

          <aside class="protocol-manager__inspector">
            <div class="protocol-manager__tabs" role="tablist" aria-label="协议信息">
              <button
                class="protocol-manager__tab"
                :class="{ 'is-active': tab === 'info' }"
                type="button"
                role="tab"
                data-testid="protocol-tab-info"
                @click="tab = 'info'"
              >
                说明
              </button>
              <button
                class="protocol-manager__tab"
                :class="{ 'is-active': tab === 'preview' }"
                type="button"
                role="tab"
                data-testid="protocol-tab-preview"
                @click="tab = 'preview'"
              >
                预览
              </button>
              <button
                class="protocol-manager__tab"
                :class="{ 'is-active': tab === 'debug' }"
                type="button"
                role="tab"
                data-testid="protocol-tab-debug"
                @click="tab = 'debug'"
              >
                调试输出
              </button>
            </div>

            <div v-if="tab === 'info'" class="protocol-manager__tab-body">
              <dl class="protocol-manager__meta">
                <dt>名称</dt>
                <dd>{{ meta?.name ?? '—' }}</dd>
                <dt>版本</dt>
                <dd>{{ meta?.version ?? '—' }}</dd>
                <dt>说明</dt>
                <dd>{{ meta?.description ?? '—' }}</dd>
                <dt>分帧</dt>
                <dd>{{ framingSummary(framing) }}</dd>
                <dt>发送表单</dt>
                <dd>{{ hasSendForm ? `${String(sendFields?.length)} 个字段` : '无' }}</dd>
              </dl>
              <p v-if="inspectorError" class="protocol-manager__error">{{ inspectorError }}</p>
              <p class="protocol-manager__hint">
                协议代码是一个 JavaScript 函数体，必须 return 一个 ProtocolDefinition。 完整 API 见
                docs/protocol-plugin.md。
              </p>
            </div>

            <div v-else-if="tab === 'preview'" class="protocol-manager__tab-body">
              <UiFormField label="示例 HEX">
                <textarea
                  v-model="previewInput"
                  class="protocol-manager__preview-input"
                  placeholder="如 A5 5A 0B 01 ..."
                  spellcheck="false"
                  aria-label="示例 HEX"
                  data-testid="protocol-preview-input"
                />
              </UiFormField>
              <UiFormField label="方向">
                <select
                  :value="previewDirection"
                  class="protocol-manager__native-select"
                  aria-label="预览方向"
                  data-testid="protocol-preview-direction"
                  @change="onDirectionChange"
                >
                  <option value="rx">接收（rx）</option>
                  <option value="tx">发送（tx）</option>
                </select>
              </UiFormField>
              <UiButton
                size="sm"
                data-testid="protocol-preview-run"
                :loading="previewRunning"
                @click="runPreview"
              >
                运行
              </UiButton>
              <p v-if="previewError" class="protocol-manager__error" role="alert">
                {{ previewError }}
              </p>
              <div class="protocol-manager__preview-output" data-testid="protocol-preview-output">
                <section v-for="(frame, index) in previewFrames" :key="`frame-${index}`">
                  <h4 class="protocol-manager__preview-heading">
                    帧 {{ index + 1 }}（{{ frame.direction.toUpperCase() }}）{{ frame.hex }}
                  </h4>
                  <p v-if="frame.error" class="protocol-manager__preview-error">
                    {{ frame.error }}
                  </p>
                  <p
                    v-for="(summary, summaryIndex) in frame.summaries"
                    :key="`summary-${summaryIndex}`"
                  >
                    {{ summary }}
                  </p>
                  <p
                    v-for="(field, fieldIndex) in frame.fields"
                    :key="`field-${fieldIndex}`"
                    class="protocol-manager__preview-field"
                  >
                    {{ field }}
                  </p>
                </section>
                <p v-if="previewDiscards.length > 0" class="protocol-manager__preview-discard">
                  丢弃 {{ previewDiscards.length }} 段：{{ previewDiscards.join(' / ') }}
                </p>
                <p
                  v-if="previewFrames.length === 0 && previewDiscards.length === 0"
                  class="protocol-manager__hint"
                >
                  点击「运行」查看分帧与解析结果。
                </p>
              </div>

              <section v-if="hasSendForm" class="protocol-manager__preview-form">
                <h4 class="protocol-manager__preview-heading">发送表单</h4>
                <UiFormField
                  v-for="field in sendFields ?? []"
                  :key="field.key"
                  :label="field.label"
                >
                  <UiNumberInput
                    v-if="field.type === 'number'"
                    :model-value="numberValue(field.key)"
                    :min="field.min"
                    :max="field.max"
                    :step="field.step"
                    :unit="field.unit"
                    size="sm"
                    @update:model-value="setRaw(field.key, $event)"
                  />
                  <UiSelect
                    v-else-if="field.type === 'select'"
                    :model-value="selectValue(field.key)"
                    :options="selectOptions(field)"
                    size="sm"
                    @update:model-value="setRaw(field.key, $event)"
                  />
                  <UiCheckbox
                    v-else-if="field.type === 'checkbox'"
                    :model-value="checkboxValue(field.key)"
                    size="sm"
                    @update:model-value="setRaw(field.key, $event)"
                  />
                  <UiInput
                    v-else
                    :model-value="textValue(field.key)"
                    size="sm"
                    :monospace="field.type === 'hex'"
                    @update:model-value="setRaw(field.key, $event)"
                  />
                </UiFormField>
                <p
                  v-if="previewEncodeError"
                  class="protocol-manager__preview-error"
                  data-testid="protocol-preview-encode"
                >
                  {{ previewEncodeError }}
                </p>
                <p v-else-if="previewEncoded" class="protocol-manager__preview-field">
                  编码结果：{{ previewEncoded }}
                </p>
              </section>
            </div>

            <div v-else class="protocol-manager__tab-body">
              <div class="protocol-manager__debug-head">
                <span class="protocol-manager__hint"
                  >最近 {{ logLines.length }} / {{ MAX_LOG_LINES }} 行</span
                >
                <UiButton
                  size="sm"
                  variant="ghost"
                  data-testid="protocol-debug-clear"
                  @click="logLines = []"
                >
                  清空
                </UiButton>
              </div>
              <pre class="protocol-manager__debug">{{
                logLines.length === 0
                  ? '暂无 console 输出'
                  : logLines.map((line) => `[${line.level}] ${line.text}`).join('\n')
              }}</pre>
            </div>
          </aside>
        </div>

        <footer class="protocol-manager__footer">
          <span class="protocol-manager__footer-label">LOCAL STORAGE</span>
          <UiButton
            variant="primary"
            size="md"
            data-testid="protocol-save"
            :disabled="!canSave"
            :loading="saving"
            @click="save"
          >
            <Save :size="14" aria-hidden="true" />
            保存
          </UiButton>
        </footer>
      </div>
    </div>
  </Teleport>
</template>

<style scoped>
.protocol-manager {
  position: fixed;
  inset: 0;
  z-index: var(--z-editor, 1100);
  display: flex;
  align-items: stretch;
  justify-content: center;
  padding: var(--space-3);
  background: var(--overlay);
}

.protocol-manager__panel {
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

.protocol-manager__header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-3);
  flex: none;
  height: 44px;
  padding: 0 8px 0 var(--space-4);
  border-bottom: 1px solid var(--border);
  background: var(--bg-elev-2);
}

.protocol-manager__title {
  display: flex;
  align-items: center;
  gap: 8px;
  margin: 0;
  color: var(--text);
  font-size: 13px;
  font-weight: 600;
}

.protocol-manager__title::before {
  content: '';
  width: 8px;
  height: 8px;
  border: 1px solid var(--accent);
  border-radius: 1px;
  background: var(--accent-soft);
}

.protocol-manager__header-tools {
  display: flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
}

.protocol-manager__name {
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

.protocol-manager__badge {
  padding: 0 5px;
  border: 1px solid var(--border);
  border-radius: 2px;
  background: var(--bg-hover);
  color: var(--text-faint);
  font-family: var(--font-ui);
  font-size: 10px;
  line-height: 15px;
}

.protocol-manager__dirty {
  color: var(--warn);
  font-family: var(--font-ui);
  font-size: 10px;
}

.protocol-manager__body {
  display: flex;
  flex: 1 1 auto;
  min-width: 0;
  min-height: 0;
  overflow: hidden;
}

.protocol-manager__footer {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 10px;
  flex: none;
  height: 46px;
  padding: 0 var(--space-3);
  border-top: 1px solid var(--border);
  background: var(--bg-elev-2);
}

.protocol-manager__footer-label {
  color: var(--text-faint);
  font-family: var(--font-mono);
  font-size: 10px;
  letter-spacing: 0.1em;
}

.protocol-manager__sidebar {
  display: flex;
  flex-direction: column;
  gap: 10px;
  flex: none;
  width: 240px;
  min-height: 0;
  padding: 12px;
  overflow-y: auto;
  border-right: 1px solid var(--border);
  background: var(--bg-elev);
}

.protocol-manager__actions {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 6px;
}

.protocol-manager__actions :deep(.ui-button) {
  width: 100%;
  justify-content: flex-start;
}

.protocol-manager__actions :deep(.ui-button:last-child) {
  grid-column: 1 / -1;
}

.protocol-manager__file {
  display: none;
}

.protocol-manager__groups {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
}

.protocol-manager__group-title {
  display: flex;
  align-items: center;
  gap: 8px;
  margin: 6px 0 2px;
  color: var(--text-faint);
  font-size: 10px;
  font-weight: 500;
  letter-spacing: 0.08em;
  text-transform: uppercase;
}

.protocol-manager__group-title::after {
  content: '';
  flex: 1 1 auto;
  height: 1px;
  background: var(--border);
}

.protocol-manager__item {
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

.protocol-manager__item:hover {
  background: var(--bg-hover);
  color: var(--text);
}

.protocol-manager__item:focus-visible {
  outline: none;
  box-shadow: inset 0 0 0 1px var(--accent);
}

.protocol-manager__item.is-active {
  background: var(--accent-soft);
  box-shadow: inset 2px 0 0 var(--accent);
  color: var(--accent);
}

.protocol-manager__editor {
  display: flex;
  flex-direction: column;
  flex: 1 1 auto;
  min-width: 0;
  min-height: 0;
  overflow: hidden;
  background: var(--bg-sunken);
}

.protocol-manager__editor-bar {
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

.protocol-manager__editor-label {
  color: var(--text-faint);
  font-family: var(--font-mono);
  font-size: 10px;
  letter-spacing: 0.08em;
  text-transform: uppercase;
}

.protocol-manager__editor :deep(.code-editor) {
  flex: 1 1 auto;
  min-height: 0;
}

.protocol-manager__error {
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

.protocol-manager__inspector {
  display: flex;
  flex-direction: column;
  flex: none;
  width: 360px;
  min-height: 0;
  border-left: 1px solid var(--border);
  background: var(--bg-elev);
}

.protocol-manager__tabs {
  display: flex;
  flex: none;
  border-bottom: 1px solid var(--border);
}

.protocol-manager__tab {
  flex: 1 1 0;
  height: 34px;
  border-bottom: 2px solid transparent;
  color: var(--text-dim);
  font-size: 12.5px;
  font-weight: 500;
}

.protocol-manager__tab:hover {
  background: var(--bg-hover);
  color: var(--text);
}

.protocol-manager__tab:focus-visible {
  outline: none;
  box-shadow: inset 0 0 0 2px var(--accent);
}

.protocol-manager__tab.is-active {
  border-bottom-color: var(--accent);
  color: var(--text);
}

.protocol-manager__tab-body {
  display: flex;
  flex-direction: column;
  gap: 8px;
  flex: 1 1 auto;
  min-height: 0;
  padding: 10px;
  overflow-y: auto;
}

.protocol-manager__meta {
  display: grid;
  grid-template-columns: 64px minmax(0, 1fr);
  row-gap: 6px;
  margin: 0;
  font-family: var(--font-mono);
  font-size: 11px;
  line-height: 1.6;
}

.protocol-manager__meta dt {
  color: var(--text-faint);
  font-family: var(--font-ui);
}

.protocol-manager__meta dd {
  margin: 0;
  color: var(--text);
  overflow-wrap: anywhere;
}

.protocol-manager__hint {
  margin: 0;
  color: var(--text-faint);
  font-size: 11px;
  line-height: 1.6;
}

.protocol-manager__preview-input {
  width: 100%;
  min-height: 60px;
  padding: 8px;
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  background: var(--bg-sunken);
  color: var(--text);
  font-family: var(--font-mono);
  font-size: 11px;
  font-style: normal;
  line-height: 1.5;
  resize: vertical;
}

.protocol-manager__preview-input:focus {
  border-color: var(--accent);
}

.protocol-manager__preview-input:focus-visible {
  outline: none;
  box-shadow: var(--focus-ring);
}

.protocol-manager__native-select {
  width: 100%;
  height: var(--control-h-sm);
  padding: 0 6px;
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  background: var(--bg-sunken);
  color: var(--text);
  font-size: 11px;
}

.protocol-manager__native-select:focus {
  border-color: var(--accent);
}

.protocol-manager__native-select:focus-visible {
  outline: none;
  box-shadow: var(--focus-ring);
}

.protocol-manager__preview-output {
  display: flex;
  flex-direction: column;
  gap: 4px;
  min-width: 0;
  font-family: var(--font-mono);
  font-size: 11px;
}

.protocol-manager__preview-heading {
  margin: 0;
  color: var(--log-decoded);
  font-size: 11px;
  font-weight: 600;
  overflow-wrap: anywhere;
}

.protocol-manager__preview-output p {
  margin: 0;
  color: var(--text);
  overflow-wrap: anywhere;
}

.protocol-manager__preview-output .protocol-manager__preview-field {
  color: var(--text-dim);
}

.protocol-manager__preview-error {
  margin: 0;
  color: var(--log-err);
  font-size: 11px;
  overflow-wrap: anywhere;
}

.protocol-manager__preview-discard {
  margin: 0;
  color: var(--warn);
  font-size: 11px;
  overflow-wrap: anywhere;
}

.protocol-manager__preview-form {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding-top: 8px;
  border-top: 1px solid var(--border);
}

.protocol-manager__debug-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}

.protocol-manager__debug {
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

@media (max-width: 1120px) {
  .protocol-manager__sidebar {
    width: 200px;
  }

  .protocol-manager__inspector {
    width: 300px;
  }
}

@media (max-width: 900px) {
  .protocol-manager {
    padding: 0;
  }

  .protocol-manager__panel {
    border-radius: 0;
  }

  .protocol-manager__sidebar {
    width: 185px;
  }

  .protocol-manager__inspector {
    width: 270px;
  }
}
</style>
