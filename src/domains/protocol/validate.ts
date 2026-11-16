/**
 * 协议定义校验（plan §6.5）。Worker 与主线程共用，不依赖 Worker 环境。
 *
 * 所有错误都带可定位的 `path`（如 `framing.length.offset`），消息为简体中文；
 * 编译阶段还能确定行号时，会在 `line` 字段中给出。
 */

import { parseHex } from '../bytes/public'
import {
  MAX_FRAME_LENGTH,
  MIN_FRAME_LENGTH,
  PROTOCOL_API_VERSION,
  type ProtocolDefinition,
  type SendFieldType,
} from './types'

export interface ValidationError {
  /** 出错位置的路径，例如 `framing.length.offset`。 */
  path: string
  /** 可直接展示的中文错误消息，包含路径。 */
  message: string
  /** 1 起的源码行号；只有从编译错误中能提取到行号时才存在。 */
  line?: number
}

export type ValidationResult =
  { ok: true; definition: ProtocolDefinition } | { ok: false; errors: ValidationError[] }

export function formatValidationError(error: ValidationError): string {
  return error.line === undefined ? error.message : `第 ${error.line} 行：${error.message}`
}

export function formatValidationErrors(errors: ValidationError[]): string {
  return errors.map(formatValidationError).join('\n')
}

const FRAMING_TYPES = ['line', 'delimiter', 'fixed', 'length', 'idle'] as const
const SEND_FIELD_TYPES: readonly SendFieldType[] = ['number', 'text', 'select', 'checkbox', 'hex']

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

function isIntegerInRange(value: unknown, min: number, max: number): value is number {
  return Number.isInteger(value) && (value as number) >= min && (value as number) <= max
}

/** 校验器内部：收集错误，最后统一返回。 */
class Collector {
  readonly errors: ValidationError[] = []

  add(path: string, description: string, line?: number): void {
    const error: ValidationError = { path, message: `${path} ${description}` }
    if (line !== undefined) error.line = line
    this.errors.push(error)
  }

  addHexProblem(path: string, value: string): void {
    const parsed = parseHex(value)
    if (!parsed.ok) this.add(path, `必须是合法的 HEX 字符串（${parsed.error}）`)
  }

  addMaxFrameLength(record: Record<string, unknown>): void {
    const value = record.maxFrameLength
    if (value === undefined) return
    if (!isIntegerInRange(value, MIN_FRAME_LENGTH, MAX_FRAME_LENGTH)) {
      this.add(
        'framing.maxFrameLength',
        `必须是 ${MIN_FRAME_LENGTH}–${MAX_FRAME_LENGTH} 之间的整数`,
      )
    }
  }
}

function validateLineFraming(framing: Record<string, unknown>, collector: Collector): void {
  const eol = framing.eol
  if (eol !== undefined && eol !== 'lf' && eol !== 'crlf' && eol !== 'cr') {
    collector.add('framing.eol', "必须是 'lf'、'crlf' 或 'cr'")
  }
  if (framing.includeEol !== undefined && typeof framing.includeEol !== 'boolean') {
    collector.add('framing.includeEol', '必须是布尔值')
  }
}

function validateDelimiterFraming(framing: Record<string, unknown>, collector: Collector): void {
  const start = framing.start
  if (start !== undefined) {
    if (!isNonEmptyString(start)) collector.add('framing.start', '必须是非空的 HEX 字符串')
    else collector.addHexProblem('framing.start', start)
  }
  if (!isNonEmptyString(framing.end)) {
    collector.add('framing.end', '必须是非空的 HEX 字符串')
  } else {
    collector.addHexProblem('framing.end', framing.end)
  }
  if (
    framing.include !== undefined &&
    framing.include !== 'content' &&
    framing.include !== 'both'
  ) {
    collector.add('framing.include', "必须是 'content' 或 'both'")
  }
}

function validateFixedFraming(framing: Record<string, unknown>, collector: Collector): void {
  if (!isIntegerInRange(framing.length, MIN_FRAME_LENGTH, MAX_FRAME_LENGTH)) {
    collector.add('framing.length', `必须是 ${MIN_FRAME_LENGTH}–${MAX_FRAME_LENGTH} 之间的整数`)
  }
  for (const key of ['header', 'trailer'] as const) {
    const value = framing[key]
    if (value === undefined) continue
    if (!isNonEmptyString(value)) collector.add(`framing.${key}`, '必须是非空的 HEX 字符串')
    else collector.addHexProblem(`framing.${key}`, value)
  }
}

function validateLengthField(value: unknown, collector: Collector): boolean {
  if (!isRecord(value)) {
    collector.add('framing.length', '必须是对象')
    return false
  }
  const offset = value.offset
  if (
    !Number.isInteger(offset) ||
    (offset as number) < 0 ||
    (offset as number) > MAX_FRAME_LENGTH
  ) {
    collector.add('framing.length.offset', '必须是非负整数（不超过 65536）')
  }
  const size = value.size
  if (size !== 1 && size !== 2 && size !== 4) {
    collector.add('framing.length.size', '必须是 1、2 或 4')
  }
  if (value.endian !== undefined && value.endian !== 'le' && value.endian !== 'be') {
    collector.add('framing.length.endian', "必须是 'le' 或 'be'")
  }
  if (value.includes !== 'frame' && value.includes !== 'after') {
    collector.add('framing.length.includes', "必须是 'frame' 或 'after'")
  }
  if (value.adjust !== undefined && !Number.isInteger(value.adjust)) {
    collector.add('framing.length.adjust', '必须是整数')
  }
  return true
}

function validateLengthFraming(framing: Record<string, unknown>, collector: Collector): void {
  const header = framing.header
  if (header !== undefined) {
    if (!isNonEmptyString(header)) collector.add('framing.header', '必须是非空的 HEX 字符串')
    else collector.addHexProblem('framing.header', header)
  }
  validateLengthField(framing.length, collector)
}

function validateIdleFraming(framing: Record<string, unknown>, collector: Collector): void {
  if (!isIntegerInRange(framing.gapMs, 1, 1000)) {
    collector.add('framing.gapMs', '必须是 1–1000 之间的整数')
  }
}

function validateFraming(value: unknown, collector: Collector): void {
  if (!isRecord(value)) {
    collector.add('framing', '缺失或不是对象')
    return
  }
  const type = value.type
  if (typeof type !== 'string' || !FRAMING_TYPES.includes(type as (typeof FRAMING_TYPES)[number])) {
    collector.add('framing.type', "必须是 'line'、'delimiter'、'fixed'、'length' 或 'idle'")
    return
  }
  switch (type) {
    case 'line':
      validateLineFraming(value, collector)
      break
    case 'delimiter':
      validateDelimiterFraming(value, collector)
      break
    case 'fixed':
      validateFixedFraming(value, collector)
      break
    case 'length':
      validateLengthFraming(value, collector)
      break
    case 'idle':
      validateIdleFraming(value, collector)
      break
  }
  collector.addMaxFrameLength(value)
}

function validateSendField(
  value: unknown,
  index: number,
  keys: Set<string>,
  collector: Collector,
): void {
  const path = `sendForm.fields[${index}]`
  if (!isRecord(value)) {
    collector.add(path, '必须是对象')
    return
  }
  const key = value.key
  if (!isNonEmptyString(key)) {
    collector.add(`${path}.key`, '必须是非空字符串')
  } else if (keys.has(key)) {
    collector.add(`${path}.key`, `与前面的字段重复（${key}）`)
  } else {
    keys.add(key)
  }
  if (!isNonEmptyString(value.label)) collector.add(`${path}.label`, '必须是非空字符串')
  const type = value.type
  if (typeof type !== 'string' || !SEND_FIELD_TYPES.includes(type as SendFieldType)) {
    collector.add(`${path}.type`, "必须是 'number'、'text'、'select'、'checkbox' 或 'hex'")
    return
  }

  switch (type as SendFieldType) {
    case 'number':
      validateNumberField(value, path, collector)
      break
    case 'text':
      validateTextField(value, path, collector)
      break
    case 'select':
      validateSelectField(value, path, collector)
      break
    case 'checkbox':
      if (value.default !== undefined && typeof value.default !== 'boolean') {
        collector.add(`${path}.default`, '必须是布尔值')
      }
      break
    case 'hex':
      if (value.default !== undefined) {
        if (typeof value.default !== 'string') collector.add(`${path}.default`, '必须是 HEX 字符串')
        else collector.addHexProblem(`${path}.default`, value.default)
      }
      break
  }
}

function validateNumberField(
  value: Record<string, unknown>,
  path: string,
  collector: Collector,
): void {
  const min = value.min
  const max = value.max
  for (const key of ['min', 'max', 'step', 'default'] as const) {
    if (value[key] !== undefined && !isFiniteNumber(value[key])) {
      collector.add(`${path}.${key}`, '必须是有限数字')
    }
  }
  if (isFiniteNumber(min) && isFiniteNumber(max) && min > max) {
    collector.add(`${path}.min`, '不能大于 max')
  }
  if (isFiniteNumber(min) && isFiniteNumber(value.default) && value.default < min) {
    collector.add(`${path}.default`, '不能小于 min')
  }
  if (isFiniteNumber(max) && isFiniteNumber(value.default) && value.default > max) {
    collector.add(`${path}.default`, '不能大于 max')
  }
  if (value.unit !== undefined && typeof value.unit !== 'string') {
    collector.add(`${path}.unit`, '必须是字符串')
  }
}

function validateTextField(
  value: Record<string, unknown>,
  path: string,
  collector: Collector,
): void {
  if (value.maxLength !== undefined && !isIntegerInRange(value.maxLength, 1, MAX_FRAME_LENGTH)) {
    collector.add(`${path}.maxLength`, `必须是 1–${MAX_FRAME_LENGTH} 之间的整数`)
  }
  if (value.default !== undefined && typeof value.default !== 'string') {
    collector.add(`${path}.default`, '必须是字符串')
  }
}

function validateSelectField(
  value: Record<string, unknown>,
  path: string,
  collector: Collector,
): void {
  const options = value.options
  if (!Array.isArray(options) || options.length === 0) {
    collector.add(`${path}.options`, '必须至少包含 1 个选项')
    return
  }
  for (let index = 0; index < options.length; index += 1) {
    const option = options[index]
    const optionPath = `${path}.options[${index}]`
    if (!isRecord(option)) {
      collector.add(optionPath, '必须是对象')
      continue
    }
    if (!isNonEmptyString(option.label)) collector.add(`${optionPath}.label`, '必须是非空字符串')
    if (typeof option.value !== 'string' && !isFiniteNumber(option.value)) {
      collector.add(`${optionPath}.value`, '必须是字符串或数字')
    }
  }
  if (
    value.default !== undefined &&
    typeof value.default !== 'string' &&
    !isFiniteNumber(value.default)
  ) {
    collector.add(`${path}.default`, '必须是字符串或数字')
  }
}

function validateSendForm(value: unknown, hasEncode: boolean, collector: Collector): void {
  if (value === undefined) return
  if (!isRecord(value)) {
    collector.add('sendForm', '必须是对象')
    return
  }
  if (!hasEncode) {
    collector.add('sendForm', '存在 sendForm 时必须定义 encode 函数')
  }
  const fields = value.fields
  if (!Array.isArray(fields)) {
    collector.add('sendForm.fields', '必须是数组')
    return
  }
  const keys = new Set<string>()
  for (let index = 0; index < fields.length; index += 1) {
    validateSendField(fields[index], index, keys, collector)
  }
}

function validateMeta(value: unknown, collector: Collector): void {
  if (!isRecord(value)) {
    collector.add('meta', '缺失或不是对象')
    return
  }
  if (!isNonEmptyString(value.name)) collector.add('meta.name', '必须是非空字符串')
  if (value.description !== undefined && typeof value.description !== 'string') {
    collector.add('meta.description', '必须是字符串')
  }
  if (value.version !== undefined && typeof value.version !== 'string') {
    collector.add('meta.version', '必须是字符串')
  }
}

/**
 * 校验一个已经编译出来的定义对象。
 *
 * 成功时返回的原对象即为 `ProtocolDefinition`（调用方保证不会被外部并发改写）。
 */
export function validateDefinition(input: unknown): ValidationResult {
  const collector = new Collector()
  if (!isRecord(input)) {
    return {
      ok: false,
      errors: [{ path: 'definition', message: 'definition 必须是对象' }],
    }
  }
  if (input.apiVersion !== PROTOCOL_API_VERSION) {
    collector.add('apiVersion', `必须为 ${PROTOCOL_API_VERSION}`)
  }
  validateMeta(input.meta, collector)
  validateFraming(input.framing, collector)

  const decode = input.decode
  if (decode !== undefined && typeof decode !== 'function') {
    collector.add('decode', '必须是函数')
  }
  const encode = input.encode
  if (encode !== undefined && typeof encode !== 'function') {
    collector.add('encode', '必须是函数')
  }
  validateSendForm(input.sendForm, typeof encode === 'function', collector)

  if (collector.errors.length > 0) return { ok: false, errors: collector.errors }
  return { ok: true, definition: input as unknown as ProtocolDefinition }
}
