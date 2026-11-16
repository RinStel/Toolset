<script setup lang="ts">
/**
 * CodeMirror 6 编辑器封装（plan §8.6）。
 *
 * 本组件只由 `ProtocolManager.vue` 通过 `defineAsyncComponent` 动态加载，因此
 * CodeMirror 不会进入入口包。提供 JS 高亮、`sdk.` 成员补全、只读模式与错误行标记。
 */

import { onBeforeUnmount, onMounted, ref, watch } from 'vue'
import {
  autocompletion,
  type CompletionContext,
  type CompletionResult,
} from '@codemirror/autocomplete'
import { javascript } from '@codemirror/lang-javascript'
import { HighlightStyle, syntaxHighlighting } from '@codemirror/language'
import {
  Compartment,
  EditorState,
  StateEffect,
  StateField,
  type Extension,
} from '@codemirror/state'
import { Decoration, EditorView, type DecorationSet, type ViewUpdate } from '@codemirror/view'
import { tags } from '@lezer/highlight'
import { basicSetup } from 'codemirror'

const props = withDefaults(
  defineProps<{
    modelValue: string
    readonly?: boolean
    /** 1 起的行号；保存校验失败时标红该行。 */
    diagnosticLine?: number | null
    /** 补全配置：协议插件（`sdk`）或自定义控件（`ctx` + `sdk`）。 */
    completionProfile?: 'protocol' | 'widget'
  }>(),
  {
    readonly: false,
    diagnosticLine: null,
    completionProfile: 'protocol',
  },
)

const emit = defineEmits<{ 'update:modelValue': [value: string] }>()

const containerRef = ref<HTMLElement | null>(null)
const readonlyCompartment = new Compartment()
const diagnosticEffect = StateEffect.define<number | null>()

const diagnosticField = StateField.define<DecorationSet>({
  create: () => Decoration.none,
  update(decorations, transaction) {
    for (const effect of transaction.effects) {
      if (!effect.is(diagnosticEffect)) continue
      const line = effect.value
      if (line === null || line < 1 || line > transaction.state.doc.lines) {
        return Decoration.none
      }
      const from = transaction.state.doc.line(line).from
      return Decoration.set([Decoration.line({ class: 'cm-diagnostic-line' }).range(from)])
    }
    return decorations.map(transaction.changes)
  },
  provide: (field) => EditorView.decorations.from(field),
})

const SDK_MEMBERS: ReadonlyArray<{ label: string; detail: string }> = [
  { label: 'hex', detail: '(bytes: Uint8Array, sep?: string) => string' },
  { label: 'fromHex', detail: '(text: string) => Uint8Array' },
  { label: 'bytes', detail: '(...items: number | ArrayLike<number>) => Uint8Array' },
  { label: 'read.u8', detail: '(bytes, offset) => number' },
  { label: 'read.i8', detail: '(bytes, offset) => number' },
  { label: 'read.u16le', detail: '(bytes, offset) => number' },
  { label: 'read.u16be', detail: '(bytes, offset) => number' },
  { label: 'read.i16le', detail: '(bytes, offset) => number' },
  { label: 'read.i16be', detail: '(bytes, offset) => number' },
  { label: 'read.u32le', detail: '(bytes, offset) => number' },
  { label: 'read.u32be', detail: '(bytes, offset) => number' },
  { label: 'read.i32le', detail: '(bytes, offset) => number' },
  { label: 'read.i32be', detail: '(bytes, offset) => number' },
  { label: 'read.f32le', detail: '(bytes, offset) => number' },
  { label: 'read.f32be', detail: '(bytes, offset) => number' },
  { label: 'read.f64le', detail: '(bytes, offset) => number' },
  { label: 'read.f64be', detail: '(bytes, offset) => number' },
  { label: 'bits', detail: '(value, start, length) => number' },
  { label: 'writer', detail: '() => ByteWriter' },
  { label: 'checksum.sum8', detail: '(bytes) => number' },
  { label: 'checksum.xor8', detail: '(bytes) => number' },
  { label: 'checksum.lrc', detail: '(bytes) => number' },
  { label: 'checksum.crc8', detail: '(bytes) => number' },
  { label: 'checksum.crc16modbus', detail: '(bytes) => number' },
  { label: 'checksum.crc16ccitt', detail: '(bytes) => number' },
  { label: 'text', detail: '(bytes, encoding?) => string' },
  { label: 'assert', detail: '(condition, message?) => void' },
]

const CTX_MEMBERS: ReadonlyArray<{ label: string; detail: string }> = [
  { label: 'props', detail: 'Readonly<Record<string, unknown>>' },
  { label: 'variables', detail: 'ReadonlyArray<{ source, key, label, unit, color }>' },
  { label: 'size', detail: '{ width: number; height: number }' },
  { label: 'mode', detail: "'edit' | 'run'" },
  { label: 'latest', detail: '(i: number) => number | undefined' },
  { label: 'history', detail: '(i, { last?, fromT? }) => { idx, t, v }' },
  { label: 'send', detail: '(cmd: CommandSpec | string, value?) => Promise<void>' },
  { label: 'sendBytes', detail: '(bytes, source?) => Promise<void>' },
  { label: 'sourceState', detail: "(source?) => 'open' | 'closed' | 'unbound'" },
  { label: 'state', detail: 'Record<string, unknown>' },
  { label: 'saveState', detail: '() => void' },
  { label: 'theme', detail: '(cssVar: string) => string' },
  { label: 'onThemeChange', detail: '(cb: () => void) => () => void' },
  { label: 'requestUpdate', detail: '() => void' },
  { label: 'log', detail: '(...args: unknown[]) => void' },
  { label: 'sdk', detail: 'PluginSdk（协议 SDK）' },
]

function sdkCompletions(context: CompletionContext): CompletionResult | null {
  const match = context.matchBefore(/sdk\.[\w.]*/)
  if (match === null) return null
  return {
    from: match.from + 'sdk.'.length,
    options: SDK_MEMBERS.map((member) => ({
      label: member.label,
      detail: member.detail,
      type: 'function',
    })),
    validFor: /^[\w.]*$/,
  }
}

function ctxCompletions(context: CompletionContext): CompletionResult | null {
  if (props.completionProfile !== 'widget') return null
  const match = context.matchBefore(/ctx\.[\w.]*/)
  if (match === null) return null
  return {
    from: match.from + 'ctx.'.length,
    options: CTX_MEMBERS.map((member) => ({
      label: member.label,
      detail: member.detail,
      type: 'property',
    })),
    validFor: /^[\w.]*$/,
  }
}

function sdkRootCompletions(context: CompletionContext): CompletionResult | null {
  const match = context.matchBefore(/\b[a-z]*/i)
  if (match === null) return null
  if (!context.explicit && match.text.length === 0) return null
  return {
    from: match.from,
    options: [
      { label: 'sdk', detail: '协议 SDK', type: 'variable' },
      ...(props.completionProfile === 'widget'
        ? [{ label: 'ctx', detail: '自定义控件上下文', type: 'variable' }]
        : []),
      {
        label: 'return',
        detail:
          props.completionProfile === 'widget'
            ? '返回 CustomWidgetDefinition'
            : '返回 ProtocolDefinition',
        type: 'keyword',
      },
    ],
    validFor: /^\w*$/,
  }
}

const editorHighlightStyle = HighlightStyle.define([
  { tag: tags.comment, color: 'var(--text-faint)', fontStyle: 'italic' },
  { tag: [tags.keyword, tags.controlKeyword, tags.moduleKeyword], color: 'var(--accent-hover)' },
  { tag: [tags.operator, tags.punctuation, tags.separator], color: 'var(--text-dim)' },
  { tag: [tags.string, tags.special(tags.string)], color: 'var(--log-decoded)' },
  { tag: [tags.number, tags.bool, tags.atom, tags.null], color: 'var(--warn)' },
  {
    tag: [tags.function(tags.variableName), tags.function(tags.propertyName)],
    color: 'var(--log-rx)',
  },
  {
    tag: [tags.definition(tags.variableName), tags.local(tags.variableName)],
    color: 'var(--text)',
  },
  { tag: tags.variableName, color: 'var(--text)' },
  { tag: tags.propertyName, color: 'var(--log-rx)' },
  { tag: [tags.typeName, tags.className, tags.namespace], color: 'var(--accent-hover)' },
  { tag: [tags.regexp, tags.escape], color: 'var(--warn)' },
  { tag: tags.invalid, color: 'var(--danger)', textDecoration: 'underline' },
])

const editorTheme = EditorView.theme({
  '&': {
    height: '100%',
    fontSize: '12px',
    color: 'var(--text)',
    backgroundColor: 'var(--bg-sunken)',
  },
  '.cm-content': {
    caretColor: 'var(--accent)',
    padding: 'var(--space-2) 0',
  },
  '.cm-scroller': {
    overflow: 'auto',
    fontFamily: 'var(--font-mono)',
    lineHeight: '1.6',
  },
  '.cm-cursor, .cm-dropCursor': {
    borderLeftColor: 'var(--accent)',
  },
  '&.cm-focused .cm-selectionBackground, .cm-selectionBackground, .cm-content ::selection': {
    backgroundColor: 'var(--accent-soft)',
  },
  '.cm-gutters': {
    backgroundColor: 'var(--bg-sunken)',
    color: 'var(--text-faint)',
    borderRight: '1px solid var(--border)',
  },
  '.cm-activeLine': {
    backgroundColor: 'var(--bg-hover)',
  },
  '.cm-activeLineGutter': {
    backgroundColor: 'var(--bg-hover)',
    color: 'var(--text-dim)',
  },
  '.cm-diagnostic-line': {
    backgroundColor: 'var(--danger-soft)',
    boxShadow: 'inset 2px 0 0 var(--danger)',
  },
  '.cm-panels': {
    backgroundColor: 'var(--bg-elev-2)',
    color: 'var(--text)',
  },
  '.cm-tooltip': {
    border: '1px solid var(--border)',
    backgroundColor: 'var(--bg-elev-2)',
    color: 'var(--text)',
  },
  '.cm-tooltip-autocomplete > ul > li[aria-selected]': {
    backgroundColor: 'var(--accent-soft)',
    color: 'var(--accent)',
  },
  '&.cm-focused': {
    outline: 'none',
  },
})

let view: EditorView | null = null

function readonlyExtensions(readonly: boolean): Extension {
  return [EditorState.readOnly.of(readonly), EditorView.editable.of(!readonly)]
}

function onUpdate(update: ViewUpdate): void {
  if (!update.docChanged) return
  const value = update.state.doc.toString()
  if (value !== props.modelValue) emit('update:modelValue', value)
}

function applyDiagnostic(line: number | null | undefined): void {
  const current = view
  if (current === null) return
  const effect = diagnosticEffect.of(line ?? null)
  current.dispatch({ effects: effect })
  if (line !== undefined && line !== null && line >= 1 && line <= current.state.doc.lines) {
    const from = current.state.doc.line(line).from
    current.dispatch({ effects: EditorView.scrollIntoView(from, { y: 'center' }) })
  }
}

onMounted(() => {
  const parent = containerRef.value
  if (parent === null) return
  view = new EditorView({
    parent,
    state: EditorState.create({
      doc: props.modelValue,
      extensions: [
        basicSetup,
        javascript(),
        syntaxHighlighting(editorHighlightStyle),
        diagnosticField,
        editorTheme,
        readonlyCompartment.of(readonlyExtensions(props.readonly)),
        autocompletion({ override: [sdkCompletions, ctxCompletions, sdkRootCompletions] }),
        EditorView.updateListener.of(onUpdate),
      ],
    }),
  })
  applyDiagnostic(props.diagnosticLine)
})

watch(
  () => props.modelValue,
  (value) => {
    const current = view
    if (current === null) return
    if (current.state.doc.toString() === value) return
    current.dispatch({
      changes: { from: 0, to: current.state.doc.length, insert: value },
    })
  },
)

watch(
  () => props.readonly,
  (readonly) => {
    view?.dispatch({
      effects: readonlyCompartment.reconfigure(readonlyExtensions(readonly)),
    })
  },
)

watch(
  () => props.diagnosticLine,
  (line) => {
    applyDiagnostic(line)
  },
)

onBeforeUnmount(() => {
  view?.destroy()
  view = null
})
</script>

<template>
  <div ref="containerRef" class="code-editor" />
</template>

<style scoped>
.code-editor {
  height: 100%;
  min-height: 0;
  overflow: hidden;
  background: var(--bg-sunken);
}

.code-editor :deep(.cm-editor) {
  height: 100%;
}

.code-editor :deep(.cm-editor.cm-focused) {
  outline: none;
}
</style>
