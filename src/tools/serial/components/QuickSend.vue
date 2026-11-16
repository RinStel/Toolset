<script setup lang="ts">
/**
 * 快捷发送（plan §8.5）。
 *
 * 分组下拉 + 按钮网格；点击按钮立即发送（数据项 `origin = 'quick'`，控制线项按
 * 步骤调用 `setSignals` 并等待 `delayMs`）。编辑模式支持新增、编辑、删除、上移、
 * 下移与分组管理。分组与按钮持久化在 `toolset/tool/serial/quick.v1`。
 */

import { computed, ref } from 'vue'
import { ChevronDown, ChevronUp, Pencil, Plus, Settings, Trash2 } from 'lucide-vue-next'

import { checksumWidth, toHex, type TextEncodingName } from '@/domains/bytes/public'
import { compose, type ComposeOptions, type LinkSession } from '@/domains/link/public'
import UiButton from '@/shared/ui/components/UiButton.vue'
import UiCheckbox from '@/shared/ui/components/UiCheckbox.vue'
import UiDialog from '@/shared/ui/components/UiDialog.vue'
import UiFormField from '@/shared/ui/components/UiFormField.vue'
import UiIconButton from '@/shared/ui/components/UiIconButton.vue'
import UiInput from '@/shared/ui/components/UiInput.vue'
import UiNumberInput from '@/shared/ui/components/UiNumberInput.vue'
import UiSegmented from '@/shared/ui/components/UiSegmented.vue'
import UiSelect from '@/shared/ui/components/UiSelect.vue'
import { toast } from '@/shared/ui/services/toast'

import {
  addQuickGroup,
  addQuickItem,
  moveQuickItem,
  removeQuickGroup,
  removeQuickItem,
  renameQuickGroup,
  serialQuick,
  setQuickActiveGroup,
  updateQuickItem,
  type QuickItemDraft,
  type QuickSignalStep,
} from '../stores/quick'
import { createDefaultComposeOptions } from '../composables/composeOptions'
import { getSessionInstance, getSessionView } from '../stores/sessions'

type LineValue = 'none' | 'high' | 'low'

interface DraftStep {
  dtr: LineValue
  rts: LineValue
  brk: boolean
  delayMs: number | null
}

const props = defineProps<{ sessionId: string | null }>()

const view = computed(() => getSessionView(props.sessionId))
const instance = computed(() => getSessionInstance(props.sessionId))
const isOpen = computed(() => view.value?.state === 'open')

const editing = ref(false)
const runningId = ref<string | null>(null)

interface ReadonlyQuickDataItem {
  readonly id: string
  readonly name: string
  readonly kind: 'data'
  readonly input: string
  readonly options: ComposeOptions
}

interface ReadonlyQuickSignalStep {
  readonly dtr?: boolean
  readonly rts?: boolean
  readonly brk?: boolean
  readonly delayMs?: number
}

interface ReadonlyQuickSignalItem {
  readonly id: string
  readonly name: string
  readonly kind: 'signal'
  readonly steps: readonly ReadonlyQuickSignalStep[]
}

type ReadonlyQuickItem = ReadonlyQuickDataItem | ReadonlyQuickSignalItem

interface ReadonlyGroup {
  readonly id: string
  readonly name: string
  readonly items: readonly ReadonlyQuickItem[]
}

const activeGroup = computed<ReadonlyGroup | undefined>(() => {
  const groups = serialQuick.groups
  return groups.find((group) => group.id === serialQuick.activeGroupId) ?? groups[0]
})

const groupOptions = computed(() =>
  serialQuick.groups.map((group) => ({ label: group.name, value: group.id })),
)

const modeOptions = [
  { label: '文本', value: 'text' },
  { label: 'HEX', value: 'hex' },
]

const eolOptions = [
  { label: '无', value: 'none' },
  { label: 'CR', value: 'cr' },
  { label: 'LF', value: 'lf' },
  { label: 'CRLF', value: 'crlf' },
]

const encodingOptions = [
  { label: 'UTF-8', value: 'utf-8' },
  { label: 'ASCII', value: 'ascii' },
  { label: 'Latin-1', value: 'latin1' },
  { label: 'GBK', value: 'gbk' },
]

const checksumOptions = [
  { label: '无', value: 'none' },
  { label: 'sum8', value: 'sum8' },
  { label: 'xor8', value: 'xor8' },
  { label: 'lrc', value: 'lrc' },
  { label: 'CRC-8', value: 'crc8' },
  { label: 'CRC-16/MODBUS', value: 'crc16-modbus' },
  { label: 'CRC-16/CCITT', value: 'crc16-ccitt' },
]

const lineOptions = [
  { label: '不设置', value: 'none' },
  { label: '高', value: 'high' },
  { label: '低', value: 'low' },
]

const endianOptions = [
  { label: '小端', value: 'le' },
  { label: '大端', value: 'be' },
]

function errorText(error: unknown): string {
  if (error instanceof Error && error.message.length > 0) return error.message
  return String(error)
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms)
  })
}

async function runDataItem(session: LinkSession, item: ReadonlyQuickDataItem): Promise<void> {
  const composed = compose(item.input, item.options)
  if (!composed.ok) throw new Error(composed.error)
  await session.send(composed.bytes, 'quick')
}

async function runSignalItem(session: LinkSession, item: ReadonlyQuickSignalItem): Promise<void> {
  for (const step of item.steps) {
    const signals: { dtr?: boolean; rts?: boolean; brk?: boolean } = {}
    if (step.dtr !== undefined) signals.dtr = step.dtr
    if (step.rts !== undefined) signals.rts = step.rts
    if (step.brk !== undefined) signals.brk = step.brk
    if (Object.keys(signals).length > 0) await session.setSignals(signals)
    if (step.delayMs !== undefined && step.delayMs > 0) await sleep(step.delayMs)
  }
}

async function execute(item: ReadonlyQuickItem): Promise<void> {
  const session = instance.value
  if (!session || !isOpen.value || runningId.value !== null) return
  runningId.value = item.id
  try {
    if (item.kind === 'data') await runDataItem(session, item)
    else await runSignalItem(session, item)
  } catch (error) {
    toast.show({ type: 'error', message: `快捷发送失败：${errorText(error)}` })
  } finally {
    runningId.value = null
  }
}

function onGroupChange(value: string | number | null): void {
  if (typeof value === 'string') setQuickActiveGroup(value)
}

/* ------------------------------------------------------------------------- */
/* 快捷项编辑器                                                                */
/* ------------------------------------------------------------------------- */

const itemDialogOpen = ref(false)
const editingItemId = ref<string | null>(null)
const draftKind = ref<'data' | 'signal'>('data')
const draftName = ref('')
const draftInput = ref('')
const draftOptions = ref<ComposeOptions>(createDefaultComposeOptions())
const draftSteps = ref<DraftStep[]>([])

const isTwoByteChecksum = computed(
  () => draftOptions.value.checksum !== 'none' && checksumWidth(draftOptions.value.checksum) === 2,
)

function resetDraft(): void {
  editingItemId.value = null
  draftKind.value = 'data'
  draftName.value = ''
  draftInput.value = ''
  draftOptions.value = createDefaultComposeOptions()
  draftSteps.value = []
}

function fillDraft(item: ReadonlyQuickItem): void {
  editingItemId.value = item.id
  draftName.value = item.name
  if (item.kind === 'data') {
    draftKind.value = 'data'
    draftInput.value = item.input
    draftOptions.value = { ...item.options }
    draftSteps.value = []
    return
  }
  draftKind.value = 'signal'
  draftInput.value = ''
  draftOptions.value = createDefaultComposeOptions()
  draftSteps.value = item.steps.map((step) => ({
    dtr: step.dtr === undefined ? 'none' : step.dtr ? 'high' : 'low',
    rts: step.rts === undefined ? 'none' : step.rts ? 'high' : 'low',
    brk: step.brk === true,
    delayMs: step.delayMs ?? null,
  }))
}

function openCreate(): void {
  resetDraft()
  itemDialogOpen.value = true
}

function openEdit(item: ReadonlyQuickItem): void {
  fillDraft(item)
  itemDialogOpen.value = true
}

function lineToValue(value: LineValue): boolean | undefined {
  if (value === 'none') return undefined
  return value === 'high'
}

function saveItem(): void {
  const groupId = activeGroup.value?.id
  if (!groupId) return
  let payload: QuickItemDraft
  if (draftKind.value === 'data') {
    payload = {
      kind: 'data',
      name: draftName.value.trim() || '未命名',
      input: draftInput.value,
      options: { ...draftOptions.value },
    }
  } else {
    const steps: QuickSignalStep[] = draftSteps.value.map((step) => {
      const converted: QuickSignalStep = {}
      const dtr = lineToValue(step.dtr)
      const rts = lineToValue(step.rts)
      if (dtr !== undefined) converted.dtr = dtr
      if (rts !== undefined) converted.rts = rts
      if (step.brk) converted.brk = true
      if (step.delayMs !== null && step.delayMs >= 0) converted.delayMs = step.delayMs
      return converted
    })
    payload = { kind: 'signal', name: draftName.value.trim() || '未命名', steps }
  }

  if (editingItemId.value === null) {
    addQuickItem(groupId, payload)
  } else {
    updateQuickItem(groupId, { ...payload, id: editingItemId.value })
  }
  itemDialogOpen.value = false
}

function addDraftStep(): void {
  draftSteps.value = [...draftSteps.value, { dtr: 'none', rts: 'none', brk: false, delayMs: null }]
}

function removeDraftStep(index: number): void {
  draftSteps.value = draftSteps.value.filter((_, position) => position !== index)
}

function moveDraftStep(index: number, delta: number): void {
  const target = index + delta
  if (target < 0 || target >= draftSteps.value.length) return
  const steps = [...draftSteps.value]
  const [step] = steps.splice(index, 1)
  if (!step) return
  steps.splice(target, 0, step)
  draftSteps.value = steps
}

function copyDraftStep(index: number): void {
  const step = draftSteps.value[index]
  if (!step) return
  const steps = [...draftSteps.value]
  steps.splice(index + 1, 0, { ...step })
  draftSteps.value = steps
}

function setDraftLine(index: number, line: 'dtr' | 'rts', event: Event): void {
  const value = (event.target as HTMLSelectElement).value
  const next: LineValue = value === 'high' ? 'high' : value === 'low' ? 'low' : 'none'
  draftSteps.value = draftSteps.value.map((step, position) =>
    position === index ? { ...step, [line]: next } : step,
  )
}

function setDraftBreak(index: number, value: boolean): void {
  draftSteps.value = draftSteps.value.map((step, position) =>
    position === index ? { ...step, brk: value } : step,
  )
}

function setDraftDelay(index: number, value: number | null): void {
  draftSteps.value = draftSteps.value.map((step, position) =>
    position === index ? { ...step, delayMs: value } : step,
  )
}

function dataPreview(): string {
  const composed = compose(draftInput.value, draftOptions.value)
  if (!composed.ok) return composed.error
  return `将发送 ${String(composed.bytes.length)} 字节：${toHex(composed.bytes)}`
}

function dataPreviewIsError(): boolean {
  return !compose(draftInput.value, draftOptions.value).ok
}

function setMode(value: string | number): void {
  draftOptions.value = { ...draftOptions.value, mode: value === 'hex' ? 'hex' : 'text' }
}

function setEol(value: string | number | null): void {
  if (value === 'none' || value === 'cr' || value === 'lf' || value === 'crlf') {
    draftOptions.value = { ...draftOptions.value, eol: value }
  }
}

function setEncoding(value: string | number | null): void {
  if (value === 'utf-8' || value === 'ascii' || value === 'latin1' || value === 'gbk') {
    draftOptions.value = { ...draftOptions.value, encoding: value as TextEncodingName }
  }
}

function setChecksum(value: string | number | null): void {
  if (typeof value !== 'string') return
  const allowed = checksumOptions.map((option) => option.value)
  if (!allowed.includes(value)) return
  draftOptions.value = { ...draftOptions.value, checksum: value as ComposeOptions['checksum'] }
}

function setChecksumEndian(value: string | number | null): void {
  draftOptions.value = { ...draftOptions.value, checksumEndian: value === 'be' ? 'be' : 'le' }
}

function setChecksumSkip(value: number | null): void {
  draftOptions.value = {
    ...draftOptions.value,
    checksumSkip: value === null ? 0 : Math.max(0, Math.round(value)),
  }
}

function setDraftKind(value: string | number): void {
  if (editingItemId.value !== null) return
  draftKind.value = value === 'signal' ? 'signal' : 'data'
}

/* ------------------------------------------------------------------------- */
/* 分组管理                                                                    */
/* ------------------------------------------------------------------------- */

const groupDialogOpen = ref(false)

function commitGroupName(groupId: string, name: string): void {
  renameQuickGroup(groupId, name)
}

function createGroup(): void {
  addQuickGroup('新分组')
}

function deleteGroup(groupId: string): void {
  if (serialQuick.groups.length <= 1) return
  removeQuickGroup(groupId)
}

function toggleEditing(): void {
  editing.value = !editing.value
}
</script>

<template>
  <div class="quick-send">
    <div class="quick-send__toolbar">
      <UiSelect
        class="quick-send__group"
        :model-value="activeGroup?.id ?? ''"
        :options="groupOptions"
        size="sm"
        aria-label="快捷分组"
        data-testid="quick-group"
        @update:model-value="onGroupChange"
      />
      <UiButton
        size="sm"
        variant="ghost"
        data-testid="quick-edit"
        :class="{ 'is-active': editing }"
        @click="toggleEditing"
      >
        {{ editing ? '完成' : '编辑' }}
      </UiButton>
      <UiButton
        size="sm"
        variant="ghost"
        data-testid="quick-manage-groups"
        @click="groupDialogOpen = true"
      >
        <Settings :size="13" aria-hidden="true" />
        分组
      </UiButton>
      <UiButton v-if="editing" size="sm" data-testid="quick-add" @click="openCreate">
        <Plus :size="13" aria-hidden="true" />
        新增
      </UiButton>
    </div>

    <div class="quick-send__grid">
      <div v-for="item in activeGroup?.items ?? []" :key="item.id" class="quick-send__cell">
        <button
          class="quick-send__item"
          type="button"
          :class="{ 'is-running': runningId === item.id }"
          :disabled="!isOpen || runningId !== null"
          :title="item.kind === 'data' ? '点击立即发送' : '点击执行控制线序列'"
          :data-testid="`quick-item-${item.id}`"
          @click="execute(item)"
        >
          <span class="quick-send__name">{{ item.name }}</span>
          <span class="quick-send__kind">{{ item.kind === 'data' ? '数据' : '控制线' }}</span>
        </button>
        <div v-if="editing" class="quick-send__cell-actions">
          <UiIconButton label="编辑" size="sm" @click="openEdit(item)">
            <Pencil :size="12" aria-hidden="true" />
          </UiIconButton>
          <UiIconButton
            label="上移"
            size="sm"
            @click="moveQuickItem(activeGroup?.id ?? '', item.id, -1)"
          >
            <ChevronUp :size="12" aria-hidden="true" />
          </UiIconButton>
          <UiIconButton
            label="下移"
            size="sm"
            @click="moveQuickItem(activeGroup?.id ?? '', item.id, 1)"
          >
            <ChevronDown :size="12" aria-hidden="true" />
          </UiIconButton>
          <UiIconButton
            label="删除"
            size="sm"
            variant="danger"
            @click="removeQuickItem(activeGroup?.id ?? '', item.id)"
          >
            <Trash2 :size="12" aria-hidden="true" />
          </UiIconButton>
        </div>
      </div>
      <p v-if="(activeGroup?.items.length ?? 0) === 0" class="quick-send__hint">
        该分组还没有快捷按钮。点击「编辑」后可以新增。
      </p>
    </div>

    <UiDialog
      v-model="itemDialogOpen"
      :title="editingItemId === null ? '新增快捷项' : '编辑快捷项'"
      width="min(92vw, 600px)"
      @confirm="saveItem"
    >
      <div class="quick-send__editor">
        <UiFormField label="名称">
          <UiInput v-model="draftName" size="sm" :maxlength="40" aria-label="快捷项名称" />
        </UiFormField>

        <UiFormField label="类型">
          <UiSegmented
            :model-value="draftKind"
            :options="[
              { label: '数据', value: 'data' },
              { label: '控制线', value: 'signal' },
            ]"
            size="sm"
            :disabled="editingItemId !== null"
            aria-label="快捷项类型"
            @update:model-value="setDraftKind"
          />
        </UiFormField>

        <template v-if="draftKind === 'data'">
          <UiFormField label="发送内容">
            <textarea
              v-model="draftInput"
              class="quick-send__textarea"
              :placeholder="
                draftOptions.mode === 'hex' ? '如 01 03 00 00 00 01' : '输入要发送的文本'
              "
              spellcheck="false"
              aria-label="快捷项内容"
            />
          </UiFormField>
          <div class="quick-send__editor-row">
            <UiFormField label="模式">
              <UiSegmented
                :model-value="draftOptions.mode"
                :options="modeOptions"
                size="sm"
                aria-label="快捷项模式"
                @update:model-value="setMode"
              />
            </UiFormField>
            <UiFormField label="编码">
              <UiSelect
                :model-value="draftOptions.encoding"
                :options="encodingOptions"
                size="sm"
                aria-label="快捷项编码"
                @update:model-value="setEncoding"
              />
            </UiFormField>
            <UiFormField label="行尾">
              <UiSelect
                :model-value="draftOptions.eol"
                :options="eolOptions"
                size="sm"
                aria-label="快捷项行尾"
                @update:model-value="setEol"
              />
            </UiFormField>
          </div>
          <div class="quick-send__editor-row">
            <UiFormField label="校验">
              <UiSelect
                :model-value="draftOptions.checksum"
                :options="checksumOptions"
                size="sm"
                aria-label="快捷项校验"
                @update:model-value="setChecksum"
              />
            </UiFormField>
            <UiFormField label="校验字节序">
              <UiSelect
                :model-value="draftOptions.checksumEndian"
                :options="endianOptions"
                size="sm"
                :disabled="!isTwoByteChecksum"
                aria-label="快捷项校验字节序"
                @update:model-value="setChecksumEndian"
              />
            </UiFormField>
            <UiFormField label="跳过前 N 字节">
              <UiNumberInput
                :model-value="draftOptions.checksumSkip"
                :min="0"
                :step="1"
                size="sm"
                aria-label="快捷项校验跳过"
                @update:model-value="setChecksumSkip"
              />
            </UiFormField>
          </div>
          <p class="quick-send__preview" :class="{ 'is-error': dataPreviewIsError() }">
            {{ dataPreview() }}
          </p>
        </template>

        <template v-else>
          <div class="quick-send__steps">
            <div v-for="(step, index) in draftSteps" :key="index" class="quick-send__step">
              <span class="quick-send__step-index">{{ index + 1 }}</span>
              <select
                class="quick-send__step-select"
                :value="step.dtr"
                aria-label="DTR"
                @change="setDraftLine(index, 'dtr', $event)"
              >
                <option v-for="option in lineOptions" :key="option.value" :value="option.value">
                  DTR {{ option.label }}
                </option>
              </select>
              <select
                class="quick-send__step-select"
                :value="step.rts"
                aria-label="RTS"
                @change="setDraftLine(index, 'rts', $event)"
              >
                <option v-for="option in lineOptions" :key="option.value" :value="option.value">
                  RTS {{ option.label }}
                </option>
              </select>
              <UiCheckbox
                :model-value="step.brk"
                size="sm"
                label="Break"
                @update:model-value="setDraftBreak(index, $event)"
              />
              <UiNumberInput
                :model-value="step.delayMs"
                :min="0"
                :step="10"
                unit="ms"
                size="sm"
                aria-label="延时"
                @update:model-value="setDraftDelay(index, $event)"
              />
              <UiIconButton label="复制" size="sm" @click="copyDraftStep(index)">
                <Plus :size="12" aria-hidden="true" />
              </UiIconButton>
              <UiIconButton label="上移" size="sm" @click="moveDraftStep(index, -1)">
                <ChevronUp :size="12" aria-hidden="true" />
              </UiIconButton>
              <UiIconButton label="下移" size="sm" @click="moveDraftStep(index, 1)">
                <ChevronDown :size="12" aria-hidden="true" />
              </UiIconButton>
              <UiIconButton label="删除" size="sm" variant="danger" @click="removeDraftStep(index)">
                <Trash2 :size="12" aria-hidden="true" />
              </UiIconButton>
            </div>
            <UiButton size="sm" data-testid="quick-step-add" @click="addDraftStep">
              <Plus :size="12" aria-hidden="true" />
              添加步骤
            </UiButton>
          </div>
        </template>
      </div>
      <template #footer>
        <UiButton size="sm" @click="itemDialogOpen = false">取消</UiButton>
        <UiButton size="sm" variant="primary" data-testid="quick-item-save" @click="saveItem">
          保存
        </UiButton>
      </template>
    </UiDialog>

    <UiDialog
      v-model="groupDialogOpen"
      title="管理分组"
      width="min(92vw, 420px)"
      :show-footer="false"
    >
      <div class="quick-send__groups">
        <div v-for="group in serialQuick.groups" :key="group.id" class="quick-send__group-row">
          <UiInput
            :model-value="group.name"
            size="sm"
            aria-label="分组名称"
            @change="commitGroupName(group.id, $event)"
          />
          <UiButton
            size="sm"
            variant="ghost"
            :disabled="serialQuick.groups.length <= 1"
            @click="deleteGroup(group.id)"
          >
            删除
          </UiButton>
        </div>
        <UiButton size="sm" data-testid="quick-group-add" @click="createGroup">
          <Plus :size="12" aria-hidden="true" />
          新增分组
        </UiButton>
      </div>
    </UiDialog>
  </div>
</template>

<style scoped>
.quick-send {
  display: flex;
  flex-direction: column;
  gap: 8px;
  height: 100%;
  min-height: 0;
  padding: 8px 10px;
  overflow: auto;
  background: var(--bg-elev);
}

.quick-send__toolbar {
  display: flex;
  align-items: center;
  gap: 6px;
  flex-wrap: wrap;
  min-width: 0;
}

.quick-send__group {
  flex: 0 1 160px;
  min-width: 120px;
}

.quick-send__grid {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  align-content: flex-start;
}

.quick-send__cell {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
}

.quick-send__item {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 3px;
  min-width: 116px;
  max-width: 190px;
  padding: 8px 10px;
  border: 1px solid var(--border);
  border-radius: var(--radius);
  background: var(--bg-elev-2);
  color: var(--text);
  text-align: left;
  box-shadow: var(--panel-highlight);
  transition:
    border-color 120ms ease,
    background-color 120ms ease;
}

.quick-send__item:hover:not(:disabled) {
  border-color: var(--accent);
  background: var(--bg-hover);
}

.quick-send__item:focus-visible {
  outline: none;
  box-shadow: var(--focus-ring);
}

.quick-send__item:disabled {
  opacity: 0.38;
}

.quick-send__item.is-running {
  border-color: var(--accent);
  background: var(--accent-soft);
}

.quick-send__name {
  max-width: 100%;
  overflow: hidden;
  font-size: 12px;
  font-weight: 500;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.quick-send__kind {
  color: var(--text-faint);
  font-family: var(--font-mono);
  font-size: 9px;
  letter-spacing: 0.08em;
}

.quick-send__cell-actions {
  display: flex;
  align-items: center;
}

.quick-send__hint {
  margin: 0;
  color: var(--text-faint);
  font-size: 11px;
}

.quick-send__editor {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.quick-send__editor-row {
  display: flex;
  align-items: flex-end;
  flex-wrap: wrap;
  gap: 8px;
}

.quick-send__editor-row :deep(.ui-form-field) {
  flex: 1 1 120px;
}

.quick-send__textarea {
  width: 100%;
  min-height: 64px;
  padding: 8px;
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  background: var(--bg-sunken);
  color: var(--text);
  font-family: var(--font-mono);
  font-size: 12px;
  resize: vertical;
}

.quick-send__textarea:focus {
  border-color: var(--accent);
}

.quick-send__textarea:focus-visible {
  outline: none;
  box-shadow: var(--focus-ring);
}

.quick-send__preview {
  margin: 0;
  color: var(--text-dim);
  font-family: var(--font-mono);
  font-size: 11px;
  overflow-wrap: anywhere;
}

.quick-send__preview.is-error {
  color: var(--danger);
}

.quick-send__steps {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.quick-send__step {
  display: flex;
  align-items: center;
  gap: 4px;
  flex-wrap: wrap;
  padding: 4px 6px;
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  background: var(--bg-sunken);
}

.quick-send__step-index {
  flex: 0 0 18px;
  color: var(--text-faint);
  font-family: var(--font-mono);
  font-size: 10px;
  text-align: center;
}

.quick-send__step-select {
  height: var(--control-h-sm);
  padding: 0 4px;
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  background: var(--bg-elev-2);
  color: var(--text);
  font-size: 11px;
}

.quick-send__step :deep(.ui-number-input) {
  width: 96px;
}

.quick-send__groups {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.quick-send__group-row {
  display: flex;
  align-items: center;
  gap: 8px;
}
</style>
