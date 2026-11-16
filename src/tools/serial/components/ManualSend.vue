<script lang="ts">
/**
 * 手动发送的输入历史（plan §8.5）：每个会话在内存中保留最近 50 条，不持久化。
 * 放在普通 `<script>` 块中，保证整个工具页共享同一份 Map（多个 Pane / 标签切换）。
 */
const historyBySession = new Map<string, string[]>()
</script>

<script setup lang="ts">
/**
 * 手动发送（plan §8.5）。
 *
 * 组包、校验、编码全部交给 `domains/link` 的 `compose()`，本组件只负责编辑状态、
 * 预览、历史、草稿与定时发送。输入草稿保存在会话 store 的模块级 Map 中，返回首页
 * 再进入工具后仍然存在（e2e 用例 12）。
 */

import { computed, ref, watch } from 'vue'
import { History, Send } from 'lucide-vue-next'

import { checksumWidth, toHex, type TextEncodingName } from '@/domains/bytes/public'
import { compose, type ComposeOptions } from '@/domains/link/public'
import UiButton from '@/shared/ui/components/UiButton.vue'
import UiCheckbox from '@/shared/ui/components/UiCheckbox.vue'
import UiFormField from '@/shared/ui/components/UiFormField.vue'
import UiMenu from '@/shared/ui/components/UiMenu.vue'
import UiNumberInput from '@/shared/ui/components/UiNumberInput.vue'
import UiSegmented from '@/shared/ui/components/UiSegmented.vue'
import UiSelect from '@/shared/ui/components/UiSelect.vue'
import { toast } from '@/shared/ui/services/toast'

import {
  getSessionDraft,
  getSessionInstance,
  getSessionView,
  setSessionDraft,
} from '../stores/sessions'
import { serialSettings } from '../stores/settings'

const HISTORY_LIMIT = 50
/** 定时发送间隔的合法范围（plan §6.6）。 */
const REPEAT_INTERVAL_MIN = 10
const REPEAT_INTERVAL_MAX = 60_000
/** 小于该间隔时显示黄色提示（plan §8.5）。 */
const REPEAT_WARNING_INTERVAL = 50

const props = defineProps<{ sessionId: string | null }>()

const view = computed(() => getSessionView(props.sessionId))
const instance = computed(() => getSessionInstance(props.sessionId))
const isOpen = computed(() => view.value?.state === 'open')

const mode = ref<'text' | 'hex'>('text')
const encoding = ref<TextEncodingName>(serialSettings.defaultEncoding)
const eol = ref<ComposeOptions['eol']>(serialSettings.defaultEol)
const checksum = ref<ComposeOptions['checksum']>('none')
const checksumEndian = ref<'le' | 'be'>('le')
const checksumSkip = ref(0)
const input = ref('')
const showAdvanced = ref(false)
const sending = ref(false)
/** 历史记录保存在模块级 Map 中，用版本号驱动历史菜单刷新。 */
const historyVersion = ref(0)

const repeatEnabled = ref(false)
const repeatInterval = ref<number | null>(1000)
const repeatCount = ref<number | null>(null)
const repeatStarting = ref(false)

const repeatStatus = computed(() => view.value?.tasks.repeat ?? null)
const repeatRunning = computed(() => repeatStatus.value !== null)

const modeOptions = [
  { label: '文本', value: 'text' },
  { label: 'HEX', value: 'hex' },
]

const encodingOptions = [
  { label: 'UTF-8', value: 'utf-8' },
  { label: 'ASCII', value: 'ascii' },
  { label: 'Latin-1', value: 'latin1' },
  { label: 'GBK', value: 'gbk' },
]

const eolOptions = [
  { label: '无', value: 'none' },
  { label: 'CR', value: 'cr' },
  { label: 'LF', value: 'lf' },
  { label: 'CRLF', value: 'crlf' },
]

const checksumOptions = [
  { label: '无', value: 'none' },
  { label: '累加和（sum8）', value: 'sum8' },
  { label: '异或和（xor8）', value: 'xor8' },
  { label: 'LRC', value: 'lrc' },
  { label: 'CRC-8', value: 'crc8' },
  { label: 'CRC-16/MODBUS', value: 'crc16-modbus' },
  { label: 'CRC-16/CCITT', value: 'crc16-ccitt' },
]

const endianOptions = [
  { label: '小端（低字节在前）', value: 'le' },
  { label: '大端（高字节在前）', value: 'be' },
]

const composeOptions = computed<ComposeOptions>(() => ({
  mode: mode.value,
  encoding: encoding.value,
  eol: eol.value,
  checksum: checksum.value,
  checksumEndian: checksumEndian.value,
  checksumSkip: checksumSkip.value,
}))

const isTwoByteChecksum = computed(
  () => checksum.value !== 'none' && checksumWidth(checksum.value) === 2,
)

interface PreviewState {
  empty: boolean
  bytes: Uint8Array | null
  hex: string
  error: string
}

const preview = computed<PreviewState>(() => {
  if (input.value.length === 0) {
    return { empty: true, bytes: null, hex: '', error: '' }
  }
  const result = compose(input.value, composeOptions.value)
  if (!result.ok) {
    return { empty: false, bytes: null, hex: '', error: result.error }
  }
  return { empty: false, bytes: result.bytes, hex: toHex(result.bytes), error: '' }
})

const previewText = computed(() => {
  const state = preview.value
  if (state.empty) return '输入内容后显示预览'
  if (state.error.length > 0) return state.error
  return `将发送 ${String(state.bytes?.length ?? 0)} 字节：${state.hex}`
})

const canSend = computed(() => isOpen.value && preview.value.bytes !== null && !sending.value)

const repeatIntervalValue = computed(() =>
  repeatInterval.value === null ? 1000 : Math.round(repeatInterval.value),
)

const repeatWarning = computed(() => repeatIntervalValue.value < REPEAT_WARNING_INTERVAL)

const repeatCountValue = computed(() =>
  repeatCount.value === null ? null : Math.max(1, Math.round(repeatCount.value)),
)

const canStartRepeat = computed(
  () =>
    isOpen.value && preview.value.bytes !== null && !repeatRunning.value && !repeatStarting.value,
)

const repeatStatusText = computed(() => {
  const status = repeatStatus.value
  if (!status) return ''
  const total = status.count === null ? '∞' : String(status.count)
  return `已发送 ${String(status.sent)} / ${total}`
})

function setMode(value: string | number): void {
  mode.value = value === 'hex' ? 'hex' : 'text'
}

function setEncoding(value: string | number | null): void {
  if (typeof value === 'string') encoding.value = value as TextEncodingName
}

function setEol(value: string | number | null): void {
  if (value === 'none' || value === 'cr' || value === 'lf' || value === 'crlf') eol.value = value
}

function setChecksum(value: string | number | null): void {
  if (typeof value !== 'string') return
  const allowed = checksumOptions.map((option) => option.value)
  if (!allowed.includes(value)) return
  checksum.value = value as ComposeOptions['checksum']
}

function setChecksumEndian(value: string | number | null): void {
  checksumEndian.value = value === 'be' ? 'be' : 'le'
}

function setChecksumSkip(value: number | null): void {
  checksumSkip.value = value === null ? 0 : Math.max(0, Math.round(value))
}

/** 会话 compose 是默认值时，使用工具设置里的默认编码 / 行尾。 */
function isDefaultCompose(options: ComposeOptions): boolean {
  return (
    options.mode === 'text' &&
    options.encoding === 'utf-8' &&
    options.eol === 'none' &&
    options.checksum === 'none' &&
    options.checksumEndian === 'le' &&
    options.checksumSkip === 0
  )
}

function syncFromSession(): void {
  const session = instance.value
  const source =
    session !== undefined && !isDefaultCompose(session.compose)
      ? session.compose
      : {
          mode: 'text' as const,
          encoding: serialSettings.defaultEncoding,
          eol: serialSettings.defaultEol,
          checksum: 'none' as const,
          checksumEndian: 'le' as const,
          checksumSkip: 0,
        }
  mode.value = source.mode
  encoding.value = source.encoding
  eol.value = source.eol
  checksum.value = source.checksum
  checksumEndian.value = source.checksumEndian
  checksumSkip.value = source.checksumSkip
}

watch(
  () => props.sessionId,
  () => {
    syncFromSession()
    input.value = getSessionDraft(props.sessionId)
  },
  { immediate: true },
)

watch(composeOptions, (options) => {
  const session = instance.value
  if (session) session.compose = options
})

// 草稿保存在 sessions store 的模块级 Map 中：组件重建或返回首页再回来都不丢失。
watch(input, (value) => {
  setSessionDraft(props.sessionId, value)
})

function historyList(): string[] {
  const sessionId = props.sessionId
  if (!sessionId) return []
  return historyBySession.get(sessionId) ?? []
}

function rememberInput(text: string): void {
  const sessionId = props.sessionId
  if (!sessionId) return
  const list = historyBySession.get(sessionId) ?? []
  if (list[list.length - 1] === text) return
  list.push(text)
  if (list.length > HISTORY_LIMIT) list.splice(0, list.length - HISTORY_LIMIT)
  historyBySession.set(sessionId, list)
  historyVersion.value += 1
}

const historyItems = computed(() => {
  void historyVersion.value
  void props.sessionId
  const list = historyList()
  const items = list.map((text, index) => ({
    key: String(index),
    label: `${String(index + 1)}. ${text.replace(/\s+/g, ' ').slice(0, 60)}`,
  }))
  return items.reverse()
})

function onHistorySelect(key: string): void {
  const index = Number(key)
  const text = historyList()[index]
  if (text !== undefined) input.value = text
}

async function send(): Promise<void> {
  const session = instance.value
  const bytes = preview.value.bytes
  if (!session || !canSend.value || bytes === null) return
  const text = input.value
  sending.value = true
  try {
    await session.send(bytes, 'manual')
    rememberInput(text)
    input.value = ''
  } catch (error) {
    // 发送失败时保留输入内容（plan §8.5）。
    toast.show({ type: 'error', message: errorText(error) })
  } finally {
    sending.value = false
  }
}

function startRepeat(): void {
  const session = instance.value
  const bytes = preview.value.bytes
  if (!session || !canStartRepeat.value || bytes === null) return
  const intervalMs = Math.min(
    REPEAT_INTERVAL_MAX,
    Math.max(REPEAT_INTERVAL_MIN, repeatIntervalValue.value),
  )
  repeatStarting.value = true
  try {
    session.startRepeat({
      bytes,
      intervalMs,
      count: repeatCountValue.value,
    })
  } catch (error) {
    toast.show({ type: 'error', message: `定时发送启动失败：${errorText(error)}` })
  } finally {
    repeatStarting.value = false
  }
}

function stopRepeat(): void {
  instance.value?.stopRepeat()
}

function setRepeatInterval(value: number | null): void {
  repeatInterval.value = value
}

function onRepeatIntervalInput(event: Event): void {
  const raw = (event.target as HTMLInputElement).value.trim()
  setRepeatInterval(raw.length === 0 ? null : Number(raw))
}

function setRepeatCount(value: number | null): void {
  repeatCount.value = value
}

function onRepeatCountInput(event: Event): void {
  const raw = (event.target as HTMLInputElement).value.trim()
  setRepeatCount(raw.length === 0 ? null : Number(raw))
}

function onKeydown(event: KeyboardEvent): void {
  if (event.isComposing) return
  if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') {
    event.preventDefault()
    void send()
    return
  }
  if (event.key === 'Enter' && serialSettings.enterToSend && !event.shiftKey) {
    event.preventDefault()
    void send()
  }
}

function errorText(error: unknown): string {
  if (error instanceof Error && error.message.length > 0) return error.message
  return String(error)
}
</script>

<template>
  <div class="manual-send">
    <div class="manual-send__options">
      <UiSegmented
        :model-value="mode"
        :options="modeOptions"
        size="sm"
        aria-label="发送模式"
        data-testid="send-mode"
        @update:model-value="setMode"
      />
      <span class="manual-send__divider" aria-hidden="true" />
      <label class="manual-send__field">
        <span class="manual-send__field-label">编码</span>
        <UiSelect
          :model-value="encoding"
          :options="encodingOptions"
          size="sm"
          aria-label="文本编码"
          @update:model-value="setEncoding"
        />
      </label>
      <label class="manual-send__field">
        <span class="manual-send__field-label">行尾</span>
        <UiSelect
          :model-value="eol"
          :options="eolOptions"
          size="sm"
          aria-label="行尾"
          @update:model-value="setEol"
        />
      </label>
      <label class="manual-send__field">
        <span class="manual-send__field-label">校验</span>
        <UiSelect
          :model-value="checksum"
          :options="checksumOptions"
          size="sm"
          aria-label="校验"
          @update:model-value="setChecksum"
        />
      </label>
      <div class="manual-send__options-right">
        <UiMenu :items="historyItems" @select="onHistorySelect">
          <template #trigger>
            <UiButton
              size="sm"
              variant="ghost"
              data-testid="send-history"
              :disabled="historyItems.length === 0"
            >
              <History :size="13" aria-hidden="true" />
              历史 ▾
            </UiButton>
          </template>
        </UiMenu>
        <UiButton
          class="manual-send__advanced-toggle"
          size="sm"
          variant="ghost"
          :aria-expanded="showAdvanced"
          @click="showAdvanced = !showAdvanced"
        >
          高级 {{ showAdvanced ? '▴' : '▾' }}
        </UiButton>
      </div>
    </div>

    <div v-if="showAdvanced" class="manual-send__advanced">
      <UiFormField label="校验字节序">
        <UiSelect
          :model-value="checksumEndian"
          :options="endianOptions"
          size="sm"
          :disabled="!isTwoByteChecksum"
          aria-label="校验字节序"
          @update:model-value="setChecksumEndian"
        />
      </UiFormField>
      <UiFormField label="跳过前 N 字节">
        <UiNumberInput
          :model-value="checksumSkip"
          :min="0"
          :step="1"
          size="sm"
          unit="字节"
          aria-label="校验跳过前 N 字节"
          @update:model-value="setChecksumSkip"
        />
      </UiFormField>
    </div>

    <div class="manual-send__editor">
      <textarea
        v-model="input"
        class="manual-send__textarea"
        :placeholder="mode === 'hex' ? '输入 HEX，如 01 03 00 00 00 01' : '输入要发送的文本'"
        spellcheck="false"
        aria-label="发送内容"
        data-testid="send-input"
        @keydown="onKeydown"
      />
    </div>

    <div class="manual-send__footer">
      <span class="manual-send__preview" :class="{ 'is-error': preview.error.length > 0 }">
        {{ previewText }}
      </span>
      <UiCheckbox
        class="manual-send__repeat-chip"
        :model-value="repeatEnabled"
        label="定时发送"
        size="sm"
        data-testid="repeat-enable"
        @update:model-value="repeatEnabled = $event"
      />
      <UiButton
        class="manual-send__send"
        variant="primary"
        size="md"
        data-testid="send-button"
        :disabled="!canSend"
        :loading="sending"
        @click="send"
      >
        <Send :size="14" aria-hidden="true" />
        发送
      </UiButton>
    </div>

    <div v-if="repeatEnabled || repeatRunning" class="manual-send__repeat">
      <template v-if="repeatRunning">
        <span class="manual-send__repeat-label">定时发送</span>
        <span class="manual-send__repeat-status" data-testid="repeat-status">
          {{ repeatStatusText }}
        </span>
        <UiButton size="sm" data-testid="repeat-stop" @click="stopRepeat">停止</UiButton>
      </template>
      <template v-else>
        <span class="manual-send__repeat-label">定时发送</span>
        <label class="manual-send__field">
          <span class="manual-send__field-label">间隔</span>
          <input
            class="manual-send__number"
            type="number"
            :min="REPEAT_INTERVAL_MIN"
            :max="REPEAT_INTERVAL_MAX"
            step="50"
            :value="repeatInterval ?? ''"
            aria-label="重复间隔"
            data-testid="repeat-interval"
            @input="onRepeatIntervalInput"
          />
          <span class="manual-send__unit">ms</span>
        </label>
        <label class="manual-send__field">
          <span class="manual-send__field-label">次数</span>
          <input
            class="manual-send__number"
            type="number"
            min="1"
            step="1"
            :value="repeatCount ?? ''"
            placeholder="留空无限"
            aria-label="重复次数"
            data-testid="repeat-count"
            @input="onRepeatCountInput"
          />
        </label>
        <UiButton
          size="sm"
          data-testid="repeat-start"
          :disabled="!canStartRepeat"
          :loading="repeatStarting"
          @click="startRepeat"
        >
          开始
        </UiButton>
      </template>
      <span v-if="repeatWarning" class="manual-send__repeat-warning">
        间隔过小可能导致设备或页面过载
      </span>
    </div>
  </div>
</template>

<style scoped>
.manual-send {
  display: flex;
  flex-direction: column;
  gap: 8px;
  height: 100%;
  min-height: 0;
  padding: 8px 10px;
  overflow: auto;
  background: var(--bg-elev);
}

.manual-send__options {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 6px;
  flex: none;
}

.manual-send__divider {
  width: 1px;
  height: 16px;
  margin: 0 2px;
  background: var(--border);
}

.manual-send__field {
  display: flex;
  align-items: center;
  gap: 5px;
  min-width: 0;
}

.manual-send__field-label {
  flex: none;
  color: var(--text-faint);
  font-size: 11px;
  white-space: nowrap;
}

.manual-send__field :deep(.ui-select) {
  width: 100px;
}

.manual-send__field :deep(.ui-select__native) {
  height: 24px;
  font-size: 11px;
}

.manual-send__options-right {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  margin-left: auto;
}

.manual-send__advanced {
  display: flex;
  align-items: flex-end;
  flex-wrap: wrap;
  gap: 12px;
  padding: 8px 10px;
  border-left: 2px solid var(--border);
  background: var(--bg-sunken);
}

.manual-send__advanced :deep(.ui-form-field) {
  width: 190px;
}

.manual-send__editor {
  display: flex;
  flex-direction: column;
  flex: 1 1 auto;
  min-height: 88px;
  border: 1px solid var(--border);
  border-radius: var(--radius);
  background: var(--bg-sunken);
  transition:
    border-color 120ms ease,
    box-shadow 120ms ease;
}

.manual-send__editor:focus-within {
  border-color: var(--accent);
  box-shadow: 0 0 0 1px var(--accent-soft);
}

.manual-send__textarea {
  flex: 1 1 auto;
  width: 100%;
  min-height: 64px;
  padding: 8px 10px;
  border: 0;
  border-radius: var(--radius-sm);
  outline: none;
  background: transparent;
  color: var(--text);
  font-family: var(--font-mono);
  font-size: 12.5px;
  line-height: 1.6;
  resize: none;
}

.manual-send__textarea::placeholder {
  color: var(--text-faint);
}

.manual-send__footer {
  display: flex;
  align-items: center;
  gap: 8px;
  flex: none;
}

.manual-send__preview {
  flex: 1 1 auto;
  min-width: 0;
  overflow: hidden;
  color: var(--text-dim);
  font-family: var(--font-mono);
  font-size: 11px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.manual-send__preview.is-error {
  color: var(--danger);
}

.manual-send__repeat-chip {
  flex: none;
  height: var(--control-h-sm);
  padding: 0 7px;
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  background: var(--bg-sunken);
  color: var(--text-dim);
}

.manual-send__repeat-chip:hover {
  border-color: var(--border-strong);
}

.manual-send__repeat-chip:has(:checked) {
  border-color: var(--accent);
  background: var(--accent-soft);
  color: var(--text);
}

.manual-send__repeat-chip :deep(.ui-checkbox__box) {
  width: 12px;
  height: 12px;
}

.manual-send__send {
  flex: none;
  min-width: 84px;
}

.manual-send__repeat {
  display: flex;
  align-items: center;
  flex-wrap: nowrap;
  gap: 8px;
  flex: none;
  min-height: 30px;
  padding: 3px 8px;
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  background: var(--bg-sunken);
  overflow-x: auto;
}

.manual-send__repeat-label {
  flex: none;
  color: var(--text-dim);
  font-size: 11.5px;
  font-weight: 500;
}

.manual-send__number {
  width: 78px;
  height: var(--control-h-sm);
  padding: 0 6px;
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  background: var(--bg-elev-2);
  color: var(--text);
  font-family: var(--font-mono);
  font-size: 11px;
}

.manual-send__number:focus {
  border-color: var(--accent);
}

.manual-send__number:focus-visible {
  outline: none;
  box-shadow: var(--focus-ring);
}

.manual-send__unit {
  color: var(--text-faint);
  font-family: var(--font-mono);
  font-size: 10px;
}

.manual-send__repeat-status {
  color: var(--accent);
  font-family: var(--font-mono);
  font-size: 11px;
}

.manual-send__repeat-warning {
  flex: none;
  color: var(--warn);
  font-size: 11px;
}
</style>
