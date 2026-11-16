/**
 * 命令模板解析与渲染（plan §6.9「命令」）。
 *
 * `renderCommand` 只产出要执行的动作（bytes/form/signal/quick），不直接访问会话；
 * 纯 TypeScript，可以脱离 UI 单测。
 */

import { compose } from '../link/public'
import type { ComposeOptions } from '../link/public'
import { isValidVariableKey } from '../protocol/public'
import type { SendValue } from '../protocol/public'
import type { CommandSpec, VarRef } from './types'

/** 控件当前值；`undefined` 表示没有当前值。 */
export type CommandValue = number | boolean | string | undefined

/** 查询同一数据源中某个变量的最新显示值。 */
export type CommandVarLookup = (ref: VarRef) => number | undefined

/** 渲染命令的额外上下文；不传时不检查数据源绑定状态。 */
export interface RenderCommandContext {
  /** 数据源是否已绑定会话；返回 false 时命令渲染为「数据源 <alias> 未连接」。 */
  isSourceBound?: (source: string) => boolean
}

export type CommandAction =
  | { kind: 'bytes'; source: string; bytes: Uint8Array }
  | { kind: 'form'; source: string; values: Record<string, SendValue> }
  | { kind: 'signal'; source: string; dtr?: boolean; rts?: boolean; brk?: boolean }
  | { kind: 'quick'; source: string; quickItemId: string }

export type RenderCommandResult = { ok: true; action: CommandAction } | { ok: false; error: string }

/* ------------------------------------------------------------------------- */
/* 模板扫描                                                                    */
/* ------------------------------------------------------------------------- */

type TemplateToken =
  { type: 'text'; value: string } | { type: 'placeholder'; raw: string; name: string; fmt?: string }

type TemplateParseResult = { ok: true; tokens: TemplateToken[] } | { ok: false; error: string }

/**
 * 把模板切成字面量与占位符。
 *
 * 语法：`{name}` / `{name:fmt}`；`{{`、`}}` 表示字面量花括号。
 */
function parseTemplate(template: string): TemplateParseResult {
  const tokens: TemplateToken[] = []
  let text = ''
  let index = 0
  const flushText = (): void => {
    if (text.length > 0) {
      tokens.push({ type: 'text', value: text })
      text = ''
    }
  }

  while (index < template.length) {
    const char = template.charAt(index)
    if (char === '{') {
      if (template.charAt(index + 1) === '{') {
        text += '{'
        index += 2
        continue
      }
      const close = template.indexOf('}', index + 1)
      if (close < 0) return { ok: false, error: '模板占位符未闭合（缺少 }）' }
      const content = template.slice(index + 1, close)
      const colon = content.indexOf(':')
      const name = (colon >= 0 ? content.slice(0, colon) : content).trim()
      const rawFormat = colon >= 0 ? content.slice(colon + 1).trim() : ''
      if (name === '') {
        return { ok: false, error: `占位符「{${content}}」缺少名称` }
      }
      flushText()
      tokens.push({
        type: 'placeholder',
        raw: content,
        name,
        ...(rawFormat === '' ? {} : { fmt: rawFormat }),
      })
      index = close + 1
      continue
    }
    if (char === '}' && template.charAt(index + 1) === '}') {
      text += '}'
      index += 2
      continue
    }
    text += char
    index += 1
  }

  flushText()
  return { ok: true, tokens }
}

/* ------------------------------------------------------------------------- */
/* 占位符求值与格式化                                                          */
/* ------------------------------------------------------------------------- */

type ResolvedValue = number | boolean | string

type PlaceholderResolution = { ok: true; value: ResolvedValue } | { ok: false; error: string }

function resolvePlaceholder(
  token: Extract<TemplateToken, { type: 'placeholder' }>,
  source: string,
  value: CommandValue,
  lookup: CommandVarLookup,
): PlaceholderResolution {
  if (token.name === 'value') {
    if (value === undefined) return { ok: false, error: '控件没有当前值' }
    return { ok: true, value }
  }
  if (token.name.startsWith('var.')) {
    const key = token.name.slice('var.'.length)
    if (key === '' || !isValidVariableKey(key)) {
      return { ok: false, error: `不支持的占位符：{${token.raw}}` }
    }
    const resolved = lookup({ source, key })
    if (resolved === undefined) return { ok: false, error: `变量 ${key} 暂无数据` }
    return { ok: true, value: resolved }
  }
  return { ok: false, error: `不支持的占位符：{${token.raw}}` }
}

/** 四舍五入（0.5 向远离 0 的方向，对应中文「四舍五入」）。 */
function roundHalfAwayFromZero(value: number): number {
  return value < 0 ? -Math.round(-value) : Math.round(value)
}

function formatPlain(value: ResolvedValue): string {
  if (typeof value === 'string') return value
  if (typeof value === 'boolean') return value ? '1' : '0'
  return String(value)
}

type NumericResult = { ok: true; value: number } | { ok: false; error: string }

function toNumber(value: ResolvedValue, fmt: string): NumericResult {
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) return { ok: false, error: `值不是有限数，无法使用格式「${fmt}」` }
    return { ok: true, value }
  }
  if (typeof value === 'boolean') return { ok: true, value: value ? 1 : 0 }
  const parsed = value.trim() === '' ? Number.NaN : Number(value)
  if (!Number.isFinite(parsed)) {
    return { ok: false, error: `值「${value}」不是数字，无法使用格式「${fmt}」` }
  }
  return { ok: true, value: parsed }
}

type FormatResult = { ok: true; text: string } | { ok: false; error: string }

const FIXED_FORMAT = /^\.(\d{1,2})f$/
const PADDED_FORMAT = /^0(\d{1,2})d$/

function formatText(value: ResolvedValue, fmt: string): FormatResult {
  const numeric = toNumber(value, fmt)
  if (!numeric.ok) return numeric
  const number = numeric.value

  const fixed = FIXED_FORMAT.exec(fmt)
  if (fixed) {
    const digits = Number(fixed[1])
    if (digits < 0 || digits > 10) {
      return { ok: false, error: `无效的格式化：「${fmt}」，小数位数必须为 0–10` }
    }
    return { ok: true, text: number.toFixed(digits) }
  }
  if (fmt === 'd') return { ok: true, text: String(roundHalfAwayFromZero(number)) }
  const padded = PADDED_FORMAT.exec(fmt)
  if (padded) {
    const width = Number(padded[1])
    if (width < 1 || width > 20) {
      return { ok: false, error: `无效的格式化：「${fmt}」，补零位数必须为 1–20` }
    }
    const rounded = roundHalfAwayFromZero(number)
    const sign = rounded < 0 ? '-' : ''
    return { ok: true, text: sign + String(Math.abs(rounded)).padStart(width, '0') }
  }
  if (fmt === 'x' || fmt === 'X') {
    const hex = roundHalfAwayFromZero(number).toString(16)
    return { ok: true, text: fmt === 'x' ? hex : hex.toUpperCase() }
  }
  return { ok: false, error: `无效的格式化：「${fmt}」` }
}

/* ------------------------------------------------------------------------- */
/* HEX 字节类型                                                                */
/* ------------------------------------------------------------------------- */

interface ByteFormatSpec {
  /** 有符号/无符号整数的范围；浮点数为空。 */
  min?: number
  max?: number
  /** 字节数。 */
  size: 1 | 2 | 4 | 8
  kind: 'int' | 'float'
  endian?: 'le' | 'be'
}

const BYTE_FORMAT_SPECS: Record<string, ByteFormatSpec> = {
  u8: { min: 0, max: 0xff, size: 1, kind: 'int' },
  i8: { min: -0x80, max: 0x7f, size: 1, kind: 'int' },
  u16le: { min: 0, max: 0xffff, size: 2, kind: 'int', endian: 'le' },
  u16be: { min: 0, max: 0xffff, size: 2, kind: 'int', endian: 'be' },
  i16le: { min: -0x8000, max: 0x7fff, size: 2, kind: 'int', endian: 'le' },
  i16be: { min: -0x8000, max: 0x7fff, size: 2, kind: 'int', endian: 'be' },
  u32le: { min: 0, max: 0xffffffff, size: 4, kind: 'int', endian: 'le' },
  u32be: { min: 0, max: 0xffffffff, size: 4, kind: 'int', endian: 'be' },
  i32le: { min: -0x80000000, max: 0x7fffffff, size: 4, kind: 'int', endian: 'le' },
  i32be: { min: -0x80000000, max: 0x7fffffff, size: 4, kind: 'int', endian: 'be' },
  f32le: { size: 4, kind: 'float', endian: 'le' },
  f32be: { size: 4, kind: 'float', endian: 'be' },
  f64le: { size: 8, kind: 'float', endian: 'le' },
  f64be: { size: 8, kind: 'float', endian: 'be' },
}

function hasByteFormat(fmt: string): boolean {
  return Object.prototype.hasOwnProperty.call(BYTE_FORMAT_SPECS, fmt)
}

function writeBytes(fmt: string, value: number): Uint8Array {
  const spec = BYTE_FORMAT_SPECS[fmt]
  const little = spec?.endian !== 'be'
  switch (fmt) {
    case 'u8':
    case 'i8':
      return Uint8Array.of(value & 0xff)
    case 'u16le':
    case 'u16be':
    case 'i16le':
    case 'i16be': {
      const low = value & 0xff
      const high = (value >> 8) & 0xff
      return Uint8Array.of(little ? low : high, little ? high : low)
    }
    case 'u32le':
    case 'u32be':
    case 'i32le':
    case 'i32be': {
      const raw = value >>> 0
      const b0 = raw & 0xff
      const b1 = (raw >>> 8) & 0xff
      const b2 = (raw >>> 16) & 0xff
      const b3 = (raw >>> 24) & 0xff
      return Uint8Array.of(little ? b0 : b3, little ? b1 : b2, little ? b2 : b1, little ? b3 : b0)
    }
    case 'f32le':
    case 'f32be': {
      const view = new DataView(new ArrayBuffer(4))
      view.setFloat32(0, value, little)
      return new Uint8Array(view.buffer)
    }
    case 'f64le':
    case 'f64be': {
      const view = new DataView(new ArrayBuffer(8))
      view.setFloat64(0, value, little)
      return new Uint8Array(view.buffer)
    }
    default:
      return new Uint8Array(0)
  }
}

function bytesToHex(bytes: Uint8Array): string {
  const parts: string[] = []
  for (const byte of bytes) parts.push(byte.toString(16).padStart(2, '0'))
  return parts.join(' ')
}

/** 把占位符值转换成指定字节类型的字节；越界时给出中文错误。 */
function resolveByteValue(
  value: ResolvedValue,
  fmt: string,
  raw: string,
): { ok: true; bytes: Uint8Array } | { ok: false; error: string } {
  if (!hasByteFormat(fmt)) {
    return { ok: false, error: `不支持的字节类型：「${fmt}」（占位符 {${raw}}）` }
  }
  const spec = BYTE_FORMAT_SPECS[fmt]
  if (!spec) return { ok: false, error: `不支持的字节类型：「${fmt}」（占位符 {${raw}}）` }
  const numeric = toNumber(value, fmt)
  if (!numeric.ok) return numeric
  const number = numeric.value
  if (!Number.isFinite(number)) {
    return { ok: false, error: `值不是有限数，无法写入 ${fmt}（占位符 {${raw}}）` }
  }
  if (spec.kind === 'int') {
    const rounded = roundHalfAwayFromZero(number)
    const min = spec.min ?? 0
    const max = spec.max ?? 0
    if (rounded < min || rounded > max) {
      return {
        ok: false,
        error: `值 ${rounded} 超出 ${fmt} 范围（${min}–${max}）`,
      }
    }
    return { ok: true, bytes: writeBytes(fmt, rounded) }
  }
  return { ok: true, bytes: writeBytes(fmt, number) }
}

/* ------------------------------------------------------------------------- */
/* 模板渲染                                                                    */
/* ------------------------------------------------------------------------- */

type TextRenderResult = { ok: true; text: string } | { ok: false; error: string }

function renderTextTemplate(
  template: string,
  source: string,
  value: CommandValue,
  lookup: CommandVarLookup,
): TextRenderResult {
  const parsed = parseTemplate(template)
  if (!parsed.ok) return parsed
  let output = ''
  for (const token of parsed.tokens) {
    if (token.type === 'text') {
      output += token.value
      continue
    }
    const resolution = resolvePlaceholder(token, source, value, lookup)
    if (!resolution.ok) return resolution
    if (token.fmt === undefined) {
      output += formatPlain(resolution.value)
      continue
    }
    const formatted = formatText(resolution.value, token.fmt)
    if (!formatted.ok) return formatted
    output += formatted.text
  }
  return { ok: true, text: output }
}

type HexRenderResult = { ok: true; hex: string } | { ok: false; error: string }

function renderHexTemplate(
  template: string,
  source: string,
  value: CommandValue,
  lookup: CommandVarLookup,
): HexRenderResult {
  const parsed = parseTemplate(template)
  if (!parsed.ok) return parsed
  const chunks: string[] = []
  for (const token of parsed.tokens) {
    if (token.type === 'text') {
      chunks.push(token.value)
      continue
    }
    const resolution = resolvePlaceholder(token, source, value, lookup)
    if (!resolution.ok) return resolution
    if (token.fmt === undefined) {
      return {
        ok: false,
        error: `HEX 模板中的占位符必须指定字节类型：{${token.raw}}`,
      }
    }
    const bytes = resolveByteValue(resolution.value, token.fmt, token.raw)
    if (!bytes.ok) return bytes
    chunks.push(bytesToHex(bytes.bytes))
  }
  return { ok: true, hex: chunks.join(' ') }
}

function normalizeOptions(
  mode: 'text' | 'hex',
  options: Partial<Omit<ComposeOptions, 'mode'>> | undefined,
): ComposeOptions {
  return {
    mode,
    encoding: options?.encoding ?? 'utf-8',
    eol: options?.eol ?? 'none',
    checksum: options?.checksum ?? 'none',
    checksumEndian: options?.checksumEndian === 'be' ? 'be' : 'le',
    checksumSkip:
      typeof options?.checksumSkip === 'number' &&
      Number.isInteger(options.checksumSkip) &&
      options.checksumSkip >= 0
        ? options.checksumSkip
        : 0,
  }
}

/* ------------------------------------------------------------------------- */
/* protocol 值                                                                 */
/* ------------------------------------------------------------------------- */

const EXACT_VAR_VALUE = /^\{var\.([A-Za-z_][A-Za-z0-9_.]{0,63})\}$/

type ProtocolRenderResult =
  { ok: true; values: Record<string, SendValue> } | { ok: false; error: string }

function renderProtocolValues(
  values: Record<string, string | number | boolean>,
  source: string,
  value: CommandValue,
  lookup: CommandVarLookup,
): ProtocolRenderResult {
  const result: Record<string, SendValue> = {}
  for (const [key, raw] of Object.entries(values)) {
    if (typeof raw !== 'string') {
      result[key] = raw
      continue
    }
    if (raw === '{value}') {
      if (value === undefined) return { ok: false, error: '控件没有当前值' }
      result[key] = value
      continue
    }
    const exact = EXACT_VAR_VALUE.exec(raw)
    if (exact) {
      const variableKey = exact[1] ?? ''
      const resolved = lookup({ source, key: variableKey })
      if (resolved === undefined) {
        return { ok: false, error: `变量 ${variableKey} 暂无数据` }
      }
      result[key] = resolved
      continue
    }
    if (raw.includes('{')) {
      const rendered = renderTextTemplate(raw, source, value, lookup)
      if (!rendered.ok) return rendered
      result[key] = rendered.text
      continue
    }
    result[key] = raw
  }
  return { ok: true, values: result }
}

/* ------------------------------------------------------------------------- */
/* 命令渲染                                                                    */
/* ------------------------------------------------------------------------- */

/**
 * 渲染一条命令。
 *
 * @param spec 命令规格
 * @param value 控件当前值（模板里的 `{value}`）
 * @param lookup 查询同一数据源变量的最新显示值
 * @param context 可选；提供后检查数据源是否已绑定会话
 */
export function renderCommand(
  spec: CommandSpec,
  value: CommandValue,
  lookup: CommandVarLookup,
  context?: RenderCommandContext,
): RenderCommandResult {
  if (context?.isSourceBound && !context.isSourceBound(spec.source)) {
    return { ok: false, error: `数据源 ${spec.source} 未连接` }
  }

  switch (spec.kind) {
    case 'template': {
      const options = normalizeOptions(spec.mode, spec.options)
      if (spec.mode === 'hex') {
        const rendered = renderHexTemplate(spec.template, spec.source, value, lookup)
        if (!rendered.ok) return rendered
        const composed = compose(rendered.hex, options)
        if (!composed.ok) return { ok: false, error: composed.error }
        return { ok: true, action: { kind: 'bytes', source: spec.source, bytes: composed.bytes } }
      }
      const rendered = renderTextTemplate(spec.template, spec.source, value, lookup)
      if (!rendered.ok) return rendered
      const composed = compose(rendered.text, options)
      if (!composed.ok) return { ok: false, error: composed.error }
      return { ok: true, action: { kind: 'bytes', source: spec.source, bytes: composed.bytes } }
    }
    case 'protocol': {
      const rendered = renderProtocolValues(spec.values, spec.source, value, lookup)
      if (!rendered.ok) return rendered
      return { ok: true, action: { kind: 'form', source: spec.source, values: rendered.values } }
    }
    case 'signal': {
      const action: Extract<CommandAction, { kind: 'signal' }> = {
        kind: 'signal',
        source: spec.source,
      }
      if (spec.dtr !== undefined) action.dtr = spec.dtr
      if (spec.rts !== undefined) action.rts = spec.rts
      if (spec.brk !== undefined) action.brk = spec.brk
      return { ok: true, action }
    }
    case 'quick':
      return {
        ok: true,
        action: { kind: 'quick', source: spec.source, quickItemId: spec.quickItemId },
      }
    default:
      return { ok: false, error: `未知的命令类型：${String((spec as { kind?: unknown }).kind)}` }
  }
}
