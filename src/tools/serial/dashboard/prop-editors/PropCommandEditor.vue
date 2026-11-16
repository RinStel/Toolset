<script setup lang="ts">
/**
 * command 属性编辑器（plan §8.10「命令编辑器」）。
 *
 * 支持模板 / 协议表单 / 控制线 / 快捷发送四种命令；选择数据源；模板模式可以设置
 * text / hex、行尾与校验，并实时显示「示例：value = <示例值> → HEX 预览」或错误。
 */
import { computed } from 'vue'

import { renderCommand, type CommandSpec, type CommandValue } from '@/domains/dashboard/public'
import type { ComposeOptions } from '@/domains/link/public'
import type { SendField } from '@/domains/protocol/public'
import UiCheckbox from '@/shared/ui/components/UiCheckbox.vue'
import UiInput from '@/shared/ui/components/UiInput.vue'
import UiSelect from '@/shared/ui/components/UiSelect.vue'

import { serialQuick } from '../../stores/quick'
import type { PropEditorContext, PropEditorEmits, PropFieldOf } from './types'

const props = defineProps<{
  field: PropFieldOf<'command'>
  value: unknown
  context: PropEditorContext
}>()

const emit = defineEmits<PropEditorEmits>()

type SignalSpec = Extract<CommandSpec, { kind: 'signal' }>

const MODE_OPTIONS = [
  { label: '文本模板', value: 'text' },
  { label: 'HEX 模板', value: 'hex' },
]

const KIND_OPTIONS = [
  { label: '模板', value: 'template' },
  { label: '协议表单', value: 'protocol' },
  { label: '控制线', value: 'signal' },
  { label: '快捷发送', value: 'quick' },
]

const EOL_OPTIONS = [
  { label: '无', value: 'none' },
  { label: 'CR', value: 'cr' },
  { label: 'LF', value: 'lf' },
  { label: 'CRLF', value: 'crlf' },
]

const CHECKSUM_OPTIONS = [
  { label: '无', value: 'none' },
  { label: 'sum8', value: 'sum8' },
  { label: 'xor8', value: 'xor8' },
  { label: 'lrc', value: 'lrc' },
  { label: 'crc8', value: 'crc8' },
  { label: 'crc16-modbus', value: 'crc16-modbus' },
  { label: 'crc16-ccitt', value: 'crc16-ccitt' },
]

const ENCODING_OPTIONS = [
  { label: 'UTF-8', value: 'utf-8' },
  { label: 'ASCII', value: 'ascii' },
  { label: 'Latin-1', value: 'latin1' },
  { label: 'GBK', value: 'gbk' },
]

const sources = computed(() =>
  props.context.dashboard.sources.map((source) => ({
    label: `${source.alias} · ${source.label}`,
    value: source.alias,
  })),
)

const sourceAlias = computed(() => props.context.dashboard.sources[0]?.alias ?? 'main')

const spec = computed<CommandSpec | null>(() => normalizeSpec(props.value, sourceAlias.value))

const kind = computed(() => spec.value?.kind ?? '')

const signalTriState = [
  { label: '未设置', value: 'unset' },
  { label: '低', value: 'low' },
  { label: '高', value: 'high' },
]

function normalizeSpec(value: unknown, fallbackSource: string): CommandSpec | null {
  if (typeof value !== 'object' || value === null) return null
  const record = value as Record<string, unknown>
  const source = typeof record.source === 'string' ? record.source : fallbackSource
  if (record.kind === 'template') {
    return {
      kind: 'template',
      source,
      mode: record.mode === 'hex' ? 'hex' : 'text',
      template: typeof record.template === 'string' ? record.template : '',
      options: {
        encoding: 'utf-8',
        eol: 'none',
        checksum: 'none',
        checksumEndian: 'le',
        checksumSkip: 0,
        ...(typeof record.options === 'object' && record.options !== null
          ? (record.options as Omit<ComposeOptions, 'mode'>)
          : {}),
      },
    }
  }
  if (record.kind === 'protocol') {
    return {
      kind: 'protocol',
      source,
      values:
        typeof record.values === 'object' && record.values !== null
          ? (record.values as Record<string, string | number | boolean>)
          : {},
    }
  }
  if (record.kind === 'signal') {
    const result: SignalSpec = { kind: 'signal', source }
    if (typeof record.dtr === 'boolean') result.dtr = record.dtr
    if (typeof record.rts === 'boolean') result.rts = record.rts
    if (typeof record.brk === 'boolean') result.brk = record.brk
    return result
  }
  if (record.kind === 'quick') {
    return {
      kind: 'quick',
      source,
      quickItemId: typeof record.quickItemId === 'string' ? record.quickItemId : '',
    }
  }
  return null
}

function emitSpec(next: CommandSpec | null): void {
  emit('update', next)
}

function onKindChange(value: string | number | null): void {
  const alias = sourceAlias.value
  if (value === 'template') {
    emitSpec({
      kind: 'template',
      source: alias,
      mode: 'text',
      template: '{value}',
      options: {
        encoding: 'utf-8',
        eol: 'lf',
        checksum: 'none',
        checksumEndian: 'le',
        checksumSkip: 0,
      },
    })
  } else if (value === 'protocol') {
    emitSpec({ kind: 'protocol', source: alias, values: {} })
  } else if (value === 'signal') {
    emitSpec({ kind: 'signal', source: alias })
  } else if (value === 'quick') {
    emitSpec({ kind: 'quick', source: alias, quickItemId: '' })
  }
}

function onSourceChange(value: string | number | null): void {
  const current = spec.value
  if (!current || typeof value !== 'string') return
  emitSpec({ ...current, source: value } as CommandSpec)
}

function onModeChange(value: string | number | null): void {
  const current = spec.value
  if (!current || current.kind !== 'template') return
  emitSpec({ ...current, mode: value === 'hex' ? 'hex' : 'text' })
}

function onTemplateChange(value: string): void {
  const current = spec.value
  if (!current || current.kind !== 'template') return
  emitSpec({ ...current, template: value })
}

function onOption(patch: Partial<Omit<ComposeOptions, 'mode'>>): void {
  const current = spec.value
  if (!current || current.kind !== 'template') return
  emitSpec({ ...current, options: { ...current.options, ...patch } })
}

function onSignalChange(key: 'dtr' | 'rts' | 'brk', value: string | number | null): void {
  const current = spec.value
  if (!current || current.kind !== 'signal') return
  const next: SignalSpec = { kind: 'signal', source: current.source }
  if (typeof current.dtr === 'boolean') next.dtr = current.dtr
  if (typeof current.rts === 'boolean') next.rts = current.rts
  if (typeof current.brk === 'boolean') next.brk = current.brk
  if (value === 'high') next[key] = true
  else if (value === 'low') next[key] = false
  else delete next[key]
  emitSpec(next)
}

function triStateValue(value: boolean | undefined): string {
  if (value === true) return 'high'
  if (value === false) return 'low'
  return 'unset'
}

/* ------------------------------------------------------------------------- */
/* 协议表单                                                                    */
/* ------------------------------------------------------------------------- */

const protocolFields = computed<SendField[]>(() => {
  const current = spec.value
  if (!current || current.kind !== 'protocol') return []
  return props.context.runtime.session(current.source)?.protocol?.sendForm ?? []
})

function protocolValue(field: SendField): string | number | boolean {
  const current = spec.value
  if (!current || current.kind !== 'protocol') return ''
  const value = current.values[field.key]
  if (value === undefined) {
    return field.default ?? (field.type === 'checkbox' ? false : '')
  }
  return value
}

function useValueToken(field: SendField): boolean {
  return protocolValue(field) === '{value}'
}

function setProtocolValue(field: SendField, value: string | number | boolean): void {
  const current = spec.value
  if (!current || current.kind !== 'protocol') return
  emitSpec({
    ...current,
    values: { ...current.values, [field.key]: value },
  })
}

/* ------------------------------------------------------------------------- */
/* 快捷发送                                                                    */
/* ------------------------------------------------------------------------- */

const quickItems = computed(() =>
  serialQuick.groups.flatMap((group) =>
    group.items.map((item) => ({ label: `${group.name} / ${item.name}`, value: item.id })),
  ),
)

function onQuickChange(value: string | number | null): void {
  const current = spec.value
  if (!current || current.kind !== 'quick' || typeof value !== 'string') return
  emitSpec({ ...current, quickItemId: value })
}

/* ------------------------------------------------------------------------- */
/* 实时预览                                                                    */
/* ------------------------------------------------------------------------- */

/** 示例值优先取控件当前 `value`，其次取 props schema 的默认值。 */
const exampleValue = computed<CommandValue>(() => {
  const current = props.context.props?.value
  if (typeof current === 'number' && Number.isFinite(current)) return current
  if (typeof current === 'string' || typeof current === 'boolean') return current
  const fallback = props.context.defaults?.value
  if (typeof fallback === 'number' && Number.isFinite(fallback)) return fallback
  if (typeof fallback === 'string' || typeof fallback === 'boolean') return fallback
  return 1
})

function exampleValueLabel(value: CommandValue): string {
  if (typeof value === 'string') return `"${value}"`
  if (typeof value === 'boolean') return value ? 'true' : 'false'
  return String(value ?? 1)
}

const preview = computed(() => {
  const current = spec.value
  if (!current) return { ok: false as const, text: '未设置命令' }
  const sample = exampleValue.value
  const result = renderCommand(current, sample, () => undefined, { isSourceBound: () => true })
  if (!result.ok) return { ok: false as const, text: result.error }
  const action = result.action
  if (action.kind === 'bytes') {
    const hex = [...action.bytes]
      .map((byte) => byte.toString(16).padStart(2, '0').toUpperCase())
      .join(' ')
    return {
      ok: true as const,
      text: `示例：value = ${exampleValueLabel(sample)} → ${hex.length > 0 ? hex : '（空）'}`,
    }
  }
  if (action.kind === 'signal') return { ok: true as const, text: '将设置控制线 DTR / RTS / Break' }
  if (action.kind === 'quick') return { ok: true as const, text: '将执行一个快捷发送项' }
  return { ok: true as const, text: '将调用协议的表单编码' }
})
</script>

<template>
  <div class="prop-command" :data-testid="`prop-command-${field.key}`">
    <div class="prop-command__row">
      <UiSelect
        :model-value="kind"
        :options="KIND_OPTIONS"
        size="sm"
        aria-label="命令类型"
        :data-testid="`prop-command-kind-${field.key}`"
        @update:model-value="onKindChange"
      />
      <UiSelect
        :model-value="spec?.source ?? sourceAlias"
        :options="sources"
        size="sm"
        aria-label="数据源"
        :data-testid="`prop-command-source-${field.key}`"
        @update:model-value="onSourceChange"
      />
    </div>

    <template v-if="spec?.kind === 'template'">
      <div class="prop-command__row">
        <UiSelect
          :model-value="spec.mode"
          :options="MODE_OPTIONS"
          size="sm"
          aria-label="模式"
          :data-testid="`prop-command-mode-${field.key}`"
          @update:model-value="onModeChange"
        />
        <UiSelect
          :model-value="spec.options.eol"
          :options="EOL_OPTIONS"
          size="sm"
          aria-label="行尾"
          :data-testid="`prop-command-eol-${field.key}`"
          @update:model-value="onOption({ eol: $event as ComposeOptions['eol'] })"
        />
      </div>
      <textarea
        class="prop-command__template"
        :rows="spec.mode === 'hex' ? 2 : 2"
        :value="spec.template"
        spellcheck="false"
        aria-label="命令模板"
        :data-testid="`prop-command-template-${field.key}`"
        @input="onTemplateChange(($event.target as HTMLTextAreaElement).value)"
      />
      <div class="prop-command__row">
        <UiSelect
          :model-value="spec.options.encoding"
          :options="ENCODING_OPTIONS"
          size="sm"
          aria-label="编码"
          @update:model-value="onOption({ encoding: $event as ComposeOptions['encoding'] })"
        />
        <UiSelect
          :model-value="spec.options.checksum"
          :options="CHECKSUM_OPTIONS"
          size="sm"
          aria-label="校验"
          :data-testid="`prop-command-checksum-${field.key}`"
          @update:model-value="onOption({ checksum: $event as ComposeOptions['checksum'] })"
        />
      </div>
    </template>

    <template v-else-if="spec?.kind === 'protocol'">
      <p v-if="protocolFields.length === 0" class="prop-command__hint">
        当前数据源的会话没有协议表单，请先在侧栏选择带 sendForm 的协议。
      </p>
      <div v-for="sendField in protocolFields" :key="sendField.key" class="prop-command__field">
        <div class="prop-command__field-head">
          <span class="prop-command__field-label">{{ sendField.label }}</span>
          <UiCheckbox
            :model-value="useValueToken(sendField)"
            label="使用 {value}"
            size="sm"
            @update:model-value="
              setProtocolValue(sendField, $event ? '{value}' : (sendField.default ?? ''))
            "
          />
        </div>
        <UiSelect
          v-if="sendField.type === 'select'"
          :model-value="
            typeof protocolValue(sendField) === 'string' ||
            typeof protocolValue(sendField) === 'number'
              ? (protocolValue(sendField) as string | number)
              : null
          "
          :options="sendField.options"
          size="sm"
          :aria-label="sendField.label"
          :data-testid="`prop-command-form-${sendField.key}-${field.key}`"
          @update:model-value="setProtocolValue(sendField, $event ?? '')"
        />
        <UiCheckbox
          v-else-if="sendField.type === 'checkbox'"
          :model-value="Boolean(protocolValue(sendField))"
          label="开启"
          size="sm"
          :aria-label="sendField.label"
          :data-testid="`prop-command-form-${sendField.key}-${field.key}`"
          @update:model-value="setProtocolValue(sendField, $event)"
        />
        <UiInput
          v-else
          :model-value="String(protocolValue(sendField))"
          size="sm"
          :aria-label="sendField.label"
          :data-testid="`prop-command-form-${sendField.key}-${field.key}`"
          @update:model-value="setProtocolValue(sendField, $event)"
        />
      </div>
    </template>

    <template v-else-if="spec?.kind === 'signal'">
      <div class="prop-command__row">
        <UiSelect
          :model-value="triStateValue(spec.dtr)"
          :options="signalTriState"
          size="sm"
          aria-label="DTR"
          :data-testid="`prop-command-dtr-${field.key}`"
          @update:model-value="onSignalChange('dtr', $event)"
        />
        <UiSelect
          :model-value="triStateValue(spec.rts)"
          :options="signalTriState"
          size="sm"
          aria-label="RTS"
          :data-testid="`prop-command-rts-${field.key}`"
          @update:model-value="onSignalChange('rts', $event)"
        />
        <UiSelect
          :model-value="triStateValue(spec.brk)"
          :options="signalTriState"
          size="sm"
          aria-label="Break"
          :data-testid="`prop-command-brk-${field.key}`"
          @update:model-value="onSignalChange('brk', $event)"
        />
      </div>
    </template>

    <template v-else-if="spec?.kind === 'quick'">
      <UiSelect
        :model-value="spec.quickItemId"
        :options="quickItems"
        size="sm"
        aria-label="快捷发送项"
        :data-testid="`prop-command-quick-${field.key}`"
        @update:model-value="onQuickChange"
      />
    </template>

    <p
      class="prop-command__preview"
      :class="{ 'is-error': !preview.ok }"
      :data-testid="`prop-command-preview-${field.key}`"
    >
      {{ preview.text }}
    </p>
  </div>
</template>

<style scoped>
.prop-command {
  display: flex;
  flex-direction: column;
  gap: 8px;
  min-width: 0;
}

.prop-command__row {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 6px;
  min-width: 0;
}

.prop-command__row > :deep(*) {
  min-width: 0;
}

.prop-command__template {
  width: 100%;
  min-width: 0;
  min-height: 64px;
  padding: 8px 10px;
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  background: var(--bg-sunken);
  color: var(--text);
  font-family: var(--font-mono);
  font-size: 12.5px;
  line-height: 1.6;
  resize: vertical;
}

.prop-command__template:focus-visible {
  outline: none;
  box-shadow: var(--focus-ring);
}

.prop-command__field {
  display: flex;
  flex-direction: column;
  gap: 4px;
  min-width: 0;
}

.prop-command__field-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 6px;
  min-width: 0;
}

.prop-command__field-label {
  color: var(--text-faint);
  font-size: 11px;
}

.prop-command__hint {
  margin: 0;
  color: var(--text-faint);
  font-size: 11px;
  line-height: 1.5;
}

.prop-command__preview {
  margin: 0;
  padding-top: 2px;
  color: var(--log-decoded);
  font-family: var(--font-mono);
  font-size: 11px;
  line-height: 1.5;
  overflow-wrap: anywhere;
}

.prop-command__preview.is-error {
  color: var(--danger);
}
</style>
