<script setup lang="ts">
/**
 * 协议结构化发送（plan §8.5）。
 *
 * 仅在当前会话的协议提供 `sendForm` 时由 `SendPanel` 显示。表单字段来自
 * `session.protocol.sendForm`；输入停止 300ms 后调用临时运行时的 `encode`
 * 显示预览，编码失败时禁用发送按钮。发送使用 `session.sendForm(values)`。
 */

import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { Send } from 'lucide-vue-next'

import {
  createProtocolRuntime,
  getProtocolRepository,
  type ProtocolRuntime,
  type SendField,
} from '@/domains/protocol/public'
import UiButton from '@/shared/ui/components/UiButton.vue'
import UiCheckbox from '@/shared/ui/components/UiCheckbox.vue'
import UiFormField from '@/shared/ui/components/UiFormField.vue'
import UiInput from '@/shared/ui/components/UiInput.vue'
import UiNumberInput from '@/shared/ui/components/UiNumberInput.vue'
import UiSelect from '@/shared/ui/components/UiSelect.vue'
import { toast } from '@/shared/ui/services/toast'

import {
  createRawSendValues,
  hexPreview,
  toSendValues,
  type RawSendValue,
  type RawSendValues,
} from '../composables/sendForm'
import { getSessionInstance, getSessionView } from '../stores/sessions'

/** 输入停止后延迟多久调用 encode（plan §8.5）。 */
const PREVIEW_DEBOUNCE_MS = 300

const props = defineProps<{ sessionId: string | null }>()

const view = computed(() => getSessionView(props.sessionId))
const instance = computed(() => getSessionInstance(props.sessionId))
const protocol = computed(() => view.value?.protocol ?? null)
const fields = computed<SendField[]>(() => protocol.value?.sendForm ?? [])
const isOpen = computed(() => view.value?.state === 'open')

const raw = ref<RawSendValues>(createRawSendValues(fields.value))
const previewBytes = ref<Uint8Array | null>(null)
const previewError = ref('')
const encoding = ref(false)
const sending = ref(false)

let runtime: ProtocolRuntime | null = null
let runtimeGeneration = 0
let encodeTimer: ReturnType<typeof setTimeout> | undefined
let encodeToken = 0

function disposeRuntime(): void {
  if (runtime !== null) {
    runtime.dispose()
    runtime = null
  }
  runtimeGeneration += 1
}

function clearEncodeTimer(): void {
  if (encodeTimer === undefined) return
  clearTimeout(encodeTimer)
  encodeTimer = undefined
}

function scheduleEncode(): void {
  clearEncodeTimer()
  if (runtime === null) return
  encodeTimer = setTimeout(() => {
    encodeTimer = undefined
    void encodeNow()
  }, PREVIEW_DEBOUNCE_MS)
}

async function encodeNow(): Promise<void> {
  const current = runtime
  if (current === null) return
  const token = ++encodeToken
  const converted = toSendValues(fields.value, raw.value)
  if (!converted.ok) {
    previewBytes.value = null
    previewError.value = converted.error
    encoding.value = false
    return
  }
  encoding.value = true
  try {
    const bytes = await current.encode(converted.values)
    if (token !== encodeToken || current !== runtime) return
    previewBytes.value = bytes
    previewError.value = ''
  } catch (error) {
    if (token !== encodeToken || current !== runtime) return
    previewBytes.value = null
    previewError.value = errorText(error)
  } finally {
    if (token === encodeToken) encoding.value = false
  }
}

async function loadRuntime(protocolId: string | null): Promise<void> {
  disposeRuntime()
  const generation = runtimeGeneration
  previewBytes.value = null
  previewError.value = ''
  encoding.value = false
  raw.value = createRawSendValues(fields.value)
  if (protocolId === null) return

  try {
    const record = await getProtocolRepository().get(protocolId)
    if (record === undefined) throw new Error(`协议不存在：${protocolId}`)
    const next = await createProtocolRuntime(record.code)
    if (generation !== runtimeGeneration || props.sessionId === null) {
      next.dispose()
      return
    }
    runtime = next
    await encodeNow()
  } catch (error) {
    if (generation !== runtimeGeneration) return
    previewError.value = `协议加载失败：${errorText(error)}`
  }
}

watch(
  protocol,
  (current) => {
    void loadRuntime(current?.id ?? null)
  },
  { immediate: true },
)

watch(
  raw,
  () => {
    scheduleEncode()
  },
  { deep: true },
)

function rawValue(key: string): RawSendValue {
  return raw.value[key] ?? null
}

function numberValue(key: string): number | null {
  const value = rawValue(key)
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

function textValue(key: string): string {
  const value = rawValue(key)
  return typeof value === 'string' ? value : ''
}

function selectValue(key: string): string | number | null {
  const value = rawValue(key)
  return typeof value === 'string' || typeof value === 'number' ? value : null
}

function checkboxValue(key: string): boolean {
  return rawValue(key) === true
}

function setRaw(key: string, value: RawSendValue): void {
  raw.value = { ...raw.value, [key]: value }
}

function selectOptions(field: SendField): Array<{ label: string; value: string | number }> {
  return field.type === 'select' ? field.options : []
}

const previewText = computed(() => {
  if (previewError.value.length > 0) return previewError.value
  if (encoding.value) return '正在编码…'
  if (previewBytes.value === null) return '输入参数后显示编码预览'
  return `将发送 ${String(previewBytes.value.length)} 字节：${hexPreview(previewBytes.value)}`
})

const canSend = computed(
  () =>
    isOpen.value &&
    previewBytes.value !== null &&
    previewError.value.length === 0 &&
    !encoding.value &&
    !sending.value,
)

async function send(): Promise<void> {
  const session = instance.value
  if (!session || !canSend.value) return
  const converted = toSendValues(fields.value, raw.value)
  if (!converted.ok) {
    previewError.value = converted.error
    return
  }
  sending.value = true
  try {
    await session.sendForm(converted.values)
  } catch (error) {
    toast.show({ type: 'error', message: errorText(error) })
  } finally {
    sending.value = false
  }
}

function errorText(error: unknown): string {
  if (error instanceof Error && error.message.length > 0) return error.message
  return String(error)
}

onBeforeUnmount(() => {
  clearEncodeTimer()
  disposeRuntime()
})
</script>

<template>
  <div class="protocol-send-form" data-testid="protocol-send-form">
    <p v-if="fields.length === 0" class="protocol-send-form__hint">当前协议没有可用的发送表单。</p>

    <template v-else>
      <div class="protocol-send-form__fields">
        <UiFormField
          v-for="field in fields"
          :key="field.key"
          :label="field.label"
          :hint="field.type === 'number' && field.unit ? `单位：${field.unit}` : ''"
          :data-testid="`protocol-field-${field.key}`"
        >
          <UiNumberInput
            v-if="field.type === 'number'"
            :model-value="numberValue(field.key)"
            :min="field.min"
            :max="field.max"
            :step="field.step"
            :unit="field.unit"
            size="sm"
            :aria-label="field.label"
            @update:model-value="setRaw(field.key, $event)"
          />
          <UiSelect
            v-else-if="field.type === 'select'"
            :model-value="selectValue(field.key)"
            :options="selectOptions(field)"
            size="sm"
            :aria-label="field.label"
            @update:model-value="setRaw(field.key, $event)"
          />
          <UiCheckbox
            v-else-if="field.type === 'checkbox'"
            :model-value="checkboxValue(field.key)"
            :aria-label="field.label"
            size="sm"
            @update:model-value="setRaw(field.key, $event)"
          />
          <UiInput
            v-else
            :model-value="textValue(field.key)"
            :maxlength="field.type === 'text' ? field.maxLength : undefined"
            :monospace="field.type === 'hex'"
            size="sm"
            :placeholder="field.type === 'hex' ? '如 01 03 00 00' : ''"
            :aria-label="field.label"
            @update:model-value="setRaw(field.key, $event)"
          />
        </UiFormField>
      </div>

      <div class="protocol-send-form__footer">
        <span class="protocol-send-form__preview" :class="{ 'is-error': previewError.length > 0 }">
          {{ previewText }}
        </span>
        <UiButton
          class="protocol-send-form__send"
          variant="primary"
          size="md"
          data-testid="protocol-send-button"
          :disabled="!canSend"
          :loading="sending"
          @click="send"
        >
          <Send :size="14" aria-hidden="true" />
          发送
        </UiButton>
      </div>
    </template>
  </div>
</template>

<style scoped>
.protocol-send-form {
  display: flex;
  flex-direction: column;
  gap: 8px;
  height: 100%;
  min-height: 0;
  padding: 8px 10px;
  overflow: auto;
  background: var(--bg-elev);
}

.protocol-send-form__hint {
  margin: 0;
  color: var(--text-faint);
  font-size: 11px;
}

.protocol-send-form__fields {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(180px, 1fr));
  gap: 8px;
  min-width: 0;
}

.protocol-send-form__footer {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-top: auto;
}

.protocol-send-form__preview {
  flex: 1 1 auto;
  min-width: 0;
  overflow: hidden;
  color: var(--text-dim);
  font-family: var(--font-mono);
  font-size: 11px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.protocol-send-form__preview.is-error {
  color: var(--danger);
  white-space: normal;
}

.protocol-send-form__send {
  min-width: 84px;
}
</style>
