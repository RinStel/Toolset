<script setup lang="ts">
/**
 * 宏面板（plan §8.5）。
 *
 * 列表提供运行 / 停止、编辑、复制、删除；运行中使用会话的
 * `startMacro` / `stopMacro`。编辑器支持发送、延时、控制线步骤，显示一轮的预计
 * 总时长（不计发送耗时）。定义持久化在 `toolset/tool/serial/macros.v1`。
 */

import { computed, ref } from 'vue'
import { ChevronDown, ChevronUp, Copy, Pencil, Play, Plus, Square, Trash2 } from 'lucide-vue-next'

import { compose, type ComposeOptions, type Macro, type MacroStep } from '@/domains/link/public'
import UiButton from '@/shared/ui/components/UiButton.vue'
import UiCheckbox from '@/shared/ui/components/UiCheckbox.vue'
import UiDialog from '@/shared/ui/components/UiDialog.vue'
import UiFormField from '@/shared/ui/components/UiFormField.vue'
import UiIconButton from '@/shared/ui/components/UiIconButton.vue'
import UiInput from '@/shared/ui/components/UiInput.vue'
import UiMenu from '@/shared/ui/components/UiMenu.vue'
import UiNumberInput from '@/shared/ui/components/UiNumberInput.vue'
import UiSegmented from '@/shared/ui/components/UiSegmented.vue'
import UiSelect from '@/shared/ui/components/UiSelect.vue'
import UiSwitch from '@/shared/ui/components/UiSwitch.vue'
import { confirm } from '@/shared/ui/services/confirm'
import { toast } from '@/shared/ui/services/toast'
import { formatDuration } from '@/shared/lib/format'

import {
  addMacro,
  cloneMacro,
  createDefaultMacroStep,
  duplicateMacro,
  MACRO_DELAY_MAX,
  MACRO_DELAY_MIN,
  MAX_MACRO_STEPS,
  removeMacro,
  serialMacros,
  updateMacro,
  type MacroLike,
} from '../stores/macros'
import { createDefaultComposeOptions } from '../composables/composeOptions'
import { getSessionInstance, getSessionView } from '../stores/sessions'

type LineValue = 'none' | 'high' | 'low'
type DraftStep =
  | { type: 'send'; input: string; options: ComposeOptions }
  | { type: 'delay'; ms: number | null }
  | { type: 'signal'; dtr: LineValue; rts: LineValue; brk: boolean }

const props = defineProps<{ sessionId: string | null }>()

const view = computed(() => getSessionView(props.sessionId))
const instance = computed(() => getSessionInstance(props.sessionId))
const isOpen = computed(() => view.value?.state === 'open')
const running = computed(() => view.value?.tasks.macro ?? null)
const runningId = computed(() => running.value?.macroId ?? null)

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

const stepMenuItems = [
  { key: 'send', label: '发送数据' },
  { key: 'delay', label: '延时' },
  { key: 'signal', label: '控制线' },
]

function errorText(error: unknown): string {
  if (error instanceof Error && error.message.length > 0) return error.message
  return String(error)
}

function startMacro(macro: MacroLike): void {
  const session = instance.value
  if (!session) return
  try {
    session.startMacro(cloneMacro(macro))
  } catch (error) {
    toast.show({ type: 'error', message: errorText(error) })
  }
}

function stopMacro(): void {
  instance.value?.stopMacro()
}

async function removeMacroWithConfirm(macro: MacroLike): Promise<void> {
  const approved = await confirm({
    title: '删除宏',
    message: `确定删除宏「${macro.name}」？`,
    confirmText: '删除',
    danger: true,
  })
  if (!approved) return
  removeMacro(macro.id)
}

function totalDelay(steps: ReadonlyArray<MacroStep | DraftStep>): number {
  let total = 0
  for (const step of steps) {
    if (step.type === 'delay' && typeof step.ms === 'number') total += step.ms
  }
  return total
}

/* ------------------------------------------------------------------------- */
/* 编辑器                                                                      */
/* ------------------------------------------------------------------------- */

const editorOpen = ref(false)
const editingId = ref<string | null>(null)
const draftName = ref('')
const draftLoop = ref(false)
const draftSteps = ref<DraftStep[]>([])
const saveError = ref('')

function toDraftStep(step: MacroStep): DraftStep {
  if (step.type === 'send') return { type: 'send', input: step.input, options: { ...step.options } }
  if (step.type === 'delay') return { type: 'delay', ms: step.ms }
  return {
    type: 'signal',
    dtr: step.dtr === undefined ? 'none' : step.dtr ? 'high' : 'low',
    rts: step.rts === undefined ? 'none' : step.rts ? 'high' : 'low',
    brk: step.brk === true,
  }
}

function openCreate(): void {
  editingId.value = null
  draftName.value = '新宏'
  draftLoop.value = false
  draftSteps.value = [
    { type: 'delay', ms: 1000 },
    { type: 'send', input: 'AT', options: { ...createDefaultComposeOptions(), eol: 'crlf' } },
  ]
  saveError.value = ''
  editorOpen.value = true
}

function openEdit(macro: MacroLike): void {
  editingId.value = macro.id
  draftName.value = macro.name
  draftLoop.value = macro.loop
  draftSteps.value = macro.steps.map(toDraftStep)
  saveError.value = ''
  editorOpen.value = true
}

function addStep(type: string): void {
  if (draftSteps.value.length >= MAX_MACRO_STEPS) return
  const base = createDefaultMacroStep(
    type === 'delay' ? 'delay' : type === 'signal' ? 'signal' : 'send',
  )
  draftSteps.value = [...draftSteps.value, toDraftStep(base)]
}

function removeStep(index: number): void {
  draftSteps.value = draftSteps.value.filter((_, position) => position !== index)
}

function moveStep(index: number, delta: number): void {
  const target = index + delta
  if (target < 0 || target >= draftSteps.value.length) return
  const steps = [...draftSteps.value]
  const [step] = steps.splice(index, 1)
  if (!step) return
  steps.splice(target, 0, step)
  draftSteps.value = steps
}

function copyStep(index: number): void {
  const step = draftSteps.value[index]
  if (!step) return
  const clone: DraftStep =
    step.type === 'send' ? { ...step, options: { ...step.options } } : { ...step }
  const steps = [...draftSteps.value]
  steps.splice(index + 1, 0, clone)
  draftSteps.value = steps
}

function asSendStep(index: number): { input: string; options: ComposeOptions } | null {
  const step = draftSteps.value[index]
  return step !== undefined && step.type === 'send' ? step : null
}

function asDelayStep(index: number): { ms: number | null } | null {
  const step = draftSteps.value[index]
  return step !== undefined && step.type === 'delay' ? step : null
}

function asSignalStep(index: number): { dtr: LineValue; rts: LineValue; brk: boolean } | null {
  const step = draftSteps.value[index]
  return step !== undefined && step.type === 'signal' ? step : null
}

function updateSendInput(index: number, event: Event): void {
  const step = asSendStep(index)
  if (!step) return
  step.input = (event.target as HTMLTextAreaElement).value
}

function updateSendMode(index: number, value: string | number): void {
  const step = asSendStep(index)
  if (!step) return
  step.options = { ...step.options, mode: value === 'hex' ? 'hex' : 'text' }
}

function updateSendEol(index: number, value: string | number | null): void {
  const step = asSendStep(index)
  if (!step) return
  if (value === 'none' || value === 'cr' || value === 'lf' || value === 'crlf') {
    step.options = { ...step.options, eol: value }
  }
}

function updateSendChecksum(index: number, value: string | number | null): void {
  const step = asSendStep(index)
  if (!step || typeof value !== 'string') return
  step.options = { ...step.options, checksum: value as ComposeOptions['checksum'] }
}

function updateDelay(index: number, value: number | null): void {
  const step = asDelayStep(index)
  if (!step) return
  step.ms = value
}

function updateSignalLine(index: number, line: 'dtr' | 'rts', event: Event): void {
  const step = asSignalStep(index)
  if (!step) return
  const value = (event.target as HTMLSelectElement).value
  step[line] = value === 'high' ? 'high' : value === 'low' ? 'low' : 'none'
}

function updateSignalBreak(index: number, value: boolean): void {
  const step = asSignalStep(index)
  if (!step) return
  step.brk = value
}

function buildMacro(): Macro {
  const steps: MacroStep[] = []
  for (const step of draftSteps.value) {
    if (step.type === 'send') {
      steps.push({ type: 'send', input: step.input, options: { ...step.options } })
      continue
    }
    if (step.type === 'delay') {
      steps.push({ type: 'delay', ms: step.ms ?? MACRO_DELAY_MIN })
      continue
    }
    const signal: MacroStep = { type: 'signal' }
    if (step.dtr !== 'none') signal.dtr = step.dtr === 'high'
    if (step.rts !== 'none') signal.rts = step.rts === 'high'
    if (step.brk) signal.brk = true
    steps.push(signal)
  }
  return {
    id: editingId.value ?? 'draft',
    name: draftName.value.trim() || '未命名宏',
    loop: draftLoop.value,
    steps,
  }
}

function saveMacro(): void {
  saveError.value = ''
  const macro = buildMacro()
  if (macro.steps.length === 0) {
    saveError.value = '宏至少需要 1 个步骤'
    return
  }
  for (let index = 0; index < macro.steps.length; index += 1) {
    const step = macro.steps[index]
    if (step === undefined) continue
    if (step.type === 'send') {
      const composed = compose(step.input, step.options)
      if (!composed.ok) {
        saveError.value = `第 ${index + 1} 步组包失败：${composed.error}`
        return
      }
    }
    if (step.type === 'delay') {
      if (!Number.isInteger(step.ms) || step.ms < MACRO_DELAY_MIN || step.ms > MACRO_DELAY_MAX) {
        saveError.value = `第 ${index + 1} 步的延时必须在 ${MACRO_DELAY_MIN}–${MACRO_DELAY_MAX}ms 之间`
        return
      }
    }
    if (step.type === 'signal') {
      if (step.dtr === undefined && step.rts === undefined && step.brk === undefined) {
        saveError.value = `第 ${index + 1} 步没有可设置的控制线`
        return
      }
    }
  }

  if (editingId.value === null) {
    addMacro({ name: macro.name, loop: macro.loop, steps: macro.steps })
  } else {
    updateMacro(macro)
  }
  editorOpen.value = false
}
</script>

<template>
  <div class="macro-panel">
    <div class="macro-panel__toolbar">
      <span class="macro-panel__title">宏</span>
      <UiButton size="sm" variant="ghost" data-testid="macro-create" @click="openCreate">
        <Plus :size="13" aria-hidden="true" />
        新建宏
      </UiButton>
      <span v-if="running" class="macro-panel__running" data-testid="macro-status">
        运行中：{{ running.name }} · 第 {{ running.step + 1 }} 步 · 第
        {{ running.loopCount + 1 }} 轮
      </span>
    </div>

    <div class="macro-panel__list">
      <div
        v-for="macro in serialMacros.macros"
        :key="macro.id"
        class="macro-panel__row"
        :class="{ 'is-running': macro.id === runningId }"
        :data-testid="`macro-item-${macro.id}`"
      >
        <div class="macro-panel__info">
          <span class="macro-panel__name">{{ macro.name }}</span>
          <span class="macro-panel__meta">
            {{ macro.steps.length }} 步<template v-if="macro.loop"> · 循环</template>
            <template v-if="totalDelay(macro.steps) > 0">
              · 一轮 {{ formatDuration(totalDelay(macro.steps)) }}
            </template>
          </span>
        </div>
        <div class="macro-panel__actions">
          <UiButton
            size="sm"
            :data-testid="`macro-run-${macro.id}`"
            :disabled="!isOpen || (running !== null && macro.id !== runningId)"
            @click="startMacro(macro)"
          >
            <Play :size="12" aria-hidden="true" />
            运行
          </UiButton>
          <UiButton
            v-if="macro.id === runningId"
            size="sm"
            :data-testid="`macro-stop-${macro.id}`"
            @click="stopMacro"
          >
            <Square :size="12" aria-hidden="true" />
            停止
          </UiButton>
          <UiIconButton label="编辑" size="sm" @click="openEdit(macro)">
            <Pencil :size="12" aria-hidden="true" />
          </UiIconButton>
          <UiIconButton label="复制" size="sm" @click="duplicateMacro(macro.id)">
            <Copy :size="12" aria-hidden="true" />
          </UiIconButton>
          <UiIconButton
            label="删除"
            size="sm"
            variant="danger"
            @click="removeMacroWithConfirm(macro)"
          >
            <Trash2 :size="12" aria-hidden="true" />
          </UiIconButton>
        </div>
      </div>
      <p v-if="serialMacros.macros.length === 0" class="macro-panel__hint">
        还没有宏。点击「新建宏」编排发送、延时和控制线步骤。
      </p>
    </div>

    <UiDialog
      v-model="editorOpen"
      :title="editingId === null ? '新建宏' : '编辑宏'"
      width="min(94vw, 640px)"
      @confirm="saveMacro"
    >
      <div class="macro-panel__editor">
        <div class="macro-panel__editor-row">
          <UiFormField label="名称">
            <UiInput v-model="draftName" size="sm" :maxlength="40" aria-label="宏名称" />
          </UiFormField>
          <UiFormField label="循环">
            <UiSwitch v-model="draftLoop" size="sm" label="循环运行" aria-label="循环" />
          </UiFormField>
          <span class="macro-panel__duration">
            一轮预计 {{ formatDuration(totalDelay(draftSteps)) }}
          </span>
        </div>

        <div class="macro-panel__steps">
          <div
            v-for="(step, index) in draftSteps"
            :key="index"
            class="macro-panel__step"
            :class="`is-${step.type}`"
          >
            <div class="macro-panel__step-head">
              <span class="macro-panel__step-index">{{ index + 1 }}</span>
              <span class="macro-panel__step-type">
                {{ step.type === 'send' ? '发送' : step.type === 'delay' ? '延时' : '控制线' }}
              </span>
              <div class="macro-panel__step-actions">
                <UiIconButton label="上移" size="sm" @click="moveStep(index, -1)">
                  <ChevronUp :size="12" aria-hidden="true" />
                </UiIconButton>
                <UiIconButton label="下移" size="sm" @click="moveStep(index, 1)">
                  <ChevronDown :size="12" aria-hidden="true" />
                </UiIconButton>
                <UiIconButton label="复制" size="sm" @click="copyStep(index)">
                  <Copy :size="12" aria-hidden="true" />
                </UiIconButton>
                <UiIconButton label="删除" size="sm" variant="danger" @click="removeStep(index)">
                  <Trash2 :size="12" aria-hidden="true" />
                </UiIconButton>
              </div>
            </div>

            <template v-if="step.type === 'send' && asSendStep(index)">
              <textarea
                class="macro-panel__textarea"
                :value="asSendStep(index)?.input ?? ''"
                placeholder="要发送的内容"
                spellcheck="false"
                aria-label="发送内容"
                @input="updateSendInput(index, $event)"
              />
              <div class="macro-panel__step-row">
                <UiSegmented
                  :model-value="asSendStep(index)?.options.mode"
                  :options="modeOptions"
                  size="sm"
                  aria-label="发送模式"
                  @update:model-value="updateSendMode(index, $event)"
                />
                <UiSelect
                  :model-value="asSendStep(index)?.options.eol"
                  :options="eolOptions"
                  size="sm"
                  aria-label="行尾"
                  @update:model-value="updateSendEol(index, $event)"
                />
                <UiSelect
                  :model-value="asSendStep(index)?.options.checksum"
                  :options="checksumOptions"
                  size="sm"
                  aria-label="校验"
                  @update:model-value="updateSendChecksum(index, $event)"
                />
              </div>
            </template>

            <template v-else-if="step.type === 'delay'">
              <UiFormField label="延时">
                <UiNumberInput
                  :model-value="asDelayStep(index)?.ms ?? null"
                  :min="MACRO_DELAY_MIN"
                  :max="MACRO_DELAY_MAX"
                  :step="100"
                  unit="ms"
                  size="sm"
                  aria-label="延时"
                  @update:model-value="updateDelay(index, $event)"
                />
              </UiFormField>
            </template>

            <template v-else>
              <div class="macro-panel__step-row">
                <select
                  class="macro-panel__step-select"
                  :value="asSignalStep(index)?.dtr ?? 'none'"
                  aria-label="DTR"
                  @change="updateSignalLine(index, 'dtr', $event)"
                >
                  <option v-for="option in lineOptions" :key="option.value" :value="option.value">
                    DTR {{ option.label }}
                  </option>
                </select>
                <select
                  class="macro-panel__step-select"
                  :value="asSignalStep(index)?.rts ?? 'none'"
                  aria-label="RTS"
                  @change="updateSignalLine(index, 'rts', $event)"
                >
                  <option v-for="option in lineOptions" :key="option.value" :value="option.value">
                    RTS {{ option.label }}
                  </option>
                </select>
                <UiCheckbox
                  :model-value="asSignalStep(index)?.brk ?? false"
                  size="sm"
                  label="Break"
                  @update:model-value="updateSignalBreak(index, $event)"
                />
              </div>
            </template>
          </div>
        </div>

        <UiMenu :items="stepMenuItems" @select="addStep">
          <template #trigger>
            <UiButton size="sm" data-testid="macro-step-add">
              <Plus :size="12" aria-hidden="true" />
              添加步骤
            </UiButton>
          </template>
        </UiMenu>

        <p v-if="saveError" class="macro-panel__error" role="alert">{{ saveError }}</p>
      </div>
      <template #footer>
        <UiButton size="sm" @click="editorOpen = false">取消</UiButton>
        <UiButton size="sm" variant="primary" data-testid="macro-save" @click="saveMacro">
          保存
        </UiButton>
      </template>
    </UiDialog>
  </div>
</template>

<style scoped>
.macro-panel {
  display: flex;
  flex-direction: column;
  gap: 8px;
  height: 100%;
  min-height: 0;
  padding: 8px 10px;
  overflow: auto;
  background: var(--bg-elev);
}

.macro-panel__toolbar {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}

.macro-panel__title {
  color: var(--text-faint);
  font-family: var(--font-mono);
  font-size: 10px;
  font-weight: 500;
  letter-spacing: 0.1em;
}

.macro-panel__running {
  color: var(--accent);
  font-family: var(--font-mono);
  font-size: 11px;
}

.macro-panel__list {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.macro-panel__row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  min-height: 36px;
  padding: 4px 8px;
  border: 1px solid var(--border);
  border-left: 2px solid var(--border-strong);
  border-radius: var(--radius-sm);
  background: var(--bg-elev-2);
}

.macro-panel__row.is-running {
  border-left-color: var(--accent);
  background: var(--accent-soft);
}

.macro-panel__info {
  display: flex;
  flex-direction: column;
  gap: 1px;
  min-width: 0;
}

.macro-panel__name {
  overflow: hidden;
  color: var(--text);
  font-size: 12px;
  font-weight: 500;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.macro-panel__meta {
  color: var(--text-faint);
  font-family: var(--font-mono);
  font-size: 10px;
}

.macro-panel__actions {
  display: flex;
  align-items: center;
  gap: 2px;
  flex: none;
}

.macro-panel__hint {
  margin: 0;
  color: var(--text-faint);
  font-size: 11px;
}

.macro-panel__editor {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.macro-panel__editor-row {
  display: flex;
  align-items: flex-end;
  flex-wrap: wrap;
  gap: 8px;
}

.macro-panel__editor-row :deep(.ui-form-field) {
  flex: 1 1 180px;
}

.macro-panel__duration {
  color: var(--text-faint);
  font-family: var(--font-mono);
  font-size: 11px;
}

.macro-panel__steps {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.macro-panel__step {
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: 6px 8px;
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  background: var(--bg-sunken);
}

.macro-panel__step-head {
  display: flex;
  align-items: center;
  gap: 8px;
}

.macro-panel__step-index {
  color: var(--text-faint);
  font-family: var(--font-mono);
  font-size: 10px;
}

.macro-panel__step-type {
  color: var(--text-dim);
  font-size: 10px;
  font-weight: 500;
  letter-spacing: 0.06em;
}

.macro-panel__step-actions {
  display: flex;
  align-items: center;
  gap: 2px;
  margin-left: auto;
}

.macro-panel__step-row {
  display: flex;
  align-items: center;
  gap: 6px;
  flex-wrap: wrap;
}

.macro-panel__textarea {
  width: 100%;
  min-height: 48px;
  padding: 6px 8px;
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  background: var(--bg-elev-2);
  color: var(--text);
  font-family: var(--font-mono);
  font-size: 11px;
  resize: vertical;
}

.macro-panel__textarea:focus {
  border-color: var(--accent);
}

.macro-panel__textarea:focus-visible {
  outline: none;
  box-shadow: var(--focus-ring);
}

.macro-panel__step-select {
  height: var(--control-h-sm);
  padding: 0 4px;
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  background: var(--bg-elev-2);
  color: var(--text);
  font-size: 11px;
}

.macro-panel__error {
  margin: 0;
  color: var(--danger);
  font-size: 11px;
}
</style>
