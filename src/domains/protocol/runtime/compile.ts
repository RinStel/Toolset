/**
 * 插件编译与执行核心（plan §6.5）。
 *
 * 本文件不依赖 Worker：Worker 只是消息外壳。主线程的协议管理器预览、单元测试都
 * 可以直接复用 `compileProtocol` / `createProtocolExecutor`。
 */

import { createProtocolSdk, type PluginSdk } from '../sdk'
import { validateDefinition, type ValidationError } from '../validate'
import {
  MAX_DECODE_VARIABLES,
  MAX_FRAME_LENGTH,
  MAX_PROTOCOL_CODE_LENGTH,
  isValidVariableKey,
  type DecodeContext,
  type DecodeDirection,
  type DecodeField,
  type DecodeLevel,
  type DecodeResult,
  type EncodeContext,
  type ProtocolDefinition,
  type ProtocolLogLevel,
  type ProtocolLogSink,
  type SendValue,
  type VariableMeta,
} from '../types'

export interface CompileOptions {
  /** 收集插件里 console 的输出。 */
  onLog?: ProtocolLogSink
}

export type CompileResult =
  { ok: true; definition: ProtocolDefinition } | { ok: false; errors: ValidationError[] }

/** 插件 console 每行最多 500 字（plan §6.5）。 */
export const MAX_LOG_LINE_LENGTH = 500
export const MAX_DECODE_SUMMARY_LENGTH = 200
export const MAX_DECODE_FIELDS = 64

const DECODE_LEVELS: readonly DecodeLevel[] = ['info', 'warn', 'error']
const FIELD_FORMATS: readonly NonNullable<DecodeField['format']>[] = ['text', 'hex', 'dec']

interface ConsoleLike {
  log(...args: unknown[]): void
  info(...args: unknown[]): void
  warn(...args: unknown[]): void
  error(...args: unknown[]): void
  debug(...args: unknown[]): void
}

/** 编译期创建的 console 代理通过这个可写 holder 找到当前的日志接收端。 */
interface LogHolder {
  sink: ProtocolLogSink | undefined
}

/** 定义对象 → 日志 holder；让 `createProtocolExecutor` 能接上编译期注入的 console。 */
const logHolders = new WeakMap<object, LogHolder>()

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message
  if (typeof error === 'string') return error
  try {
    const json = JSON.stringify(error)
    if (json !== undefined) return json
  } catch {
    // JSON.stringify 对 BigInt / 循环引用会抛错，回退到 String。
  }
  return String(error)
}

function formatLogArgument(value: unknown): string {
  if (typeof value === 'string') return value
  if (value instanceof Error) return value.message
  try {
    const json = JSON.stringify(value)
    if (json !== undefined) return json
  } catch {
    // 同上：不可序列化的值回退到 String。
  }
  return String(value)
}

function createConsoleProxy(holder: LogHolder): ConsoleLike {
  const emit = (level: ProtocolLogLevel, args: unknown[]): void => {
    const sink = holder.sink
    if (!sink) return
    const text = args.map(formatLogArgument).join(' ').slice(0, MAX_LOG_LINE_LENGTH)
    try {
      sink(level, text)
    } catch {
      // 日志接收端出错不能影响插件执行。
    }
  }
  return {
    log: (...args) => emit('log', args),
    info: (...args) => emit('log', args),
    debug: (...args) => emit('log', args),
    warn: (...args) => emit('warn', args),
    error: (...args) => emit('error', args),
  }
}

/**
 * 从编译错误里尽量提取源码行号（V8 对 `new Function` 的语法错误通常没有位置，
 * 因此行号是可选的）。
 */
function extractErrorLine(error: unknown): number | undefined {
  const candidates = [errorMessage(error)]
  if (error instanceof Error && typeof error.stack === 'string') candidates.push(error.stack)
  for (const text of candidates) {
    const match = /:(\d+):(\d+)/.exec(text) ?? /line (\d+)/i.exec(text)
    if (match?.[1] !== undefined) {
      const line = Number(match[1])
      if (Number.isInteger(line) && line > 0) return line
    }
  }
  return undefined
}

function compileFailure(path: string, message: string, line?: number): CompileResult {
  const error: ValidationError = { path, message }
  if (line !== undefined) error.line = line
  return { ok: false, errors: [error] }
}

/**
 * 编译插件源码并校验返回的定义。
 *
 * 代码必须是函数体字符串，执行结束时 `return` 一个 `ProtocolDefinition`。
 */
export function compileProtocol(code: string, options: CompileOptions = {}): CompileResult {
  if (typeof code !== 'string') {
    return compileFailure('code', 'code 必须是字符串')
  }
  if (code.length > MAX_PROTOCOL_CODE_LENGTH) {
    return compileFailure('code', `code 不能超过 256KB（当前 ${code.length} 个字符）`)
  }

  const holder: LogHolder = { sink: options.onLog }
  const consoleProxy = createConsoleProxy(holder)

  let factory: (sdk: PluginSdk, consoleLike: ConsoleLike) => unknown
  try {
    factory = new Function('sdk', 'console', code) as (
      sdk: PluginSdk,
      consoleLike: ConsoleLike,
    ) => unknown
  } catch (error) {
    return compileFailure(
      'code',
      `插件代码语法错误：${errorMessage(error)}`,
      extractErrorLine(error),
    )
  }

  let value: unknown
  try {
    value = factory(createProtocolSdk(), consoleProxy)
  } catch (error) {
    return compileFailure(
      'code',
      `插件代码运行出错：${errorMessage(error)}`,
      extractErrorLine(error),
    )
  }

  const validation = validateDefinition(value)
  if (!validation.ok) return { ok: false, errors: validation.errors }

  logHolders.set(validation.definition, holder)
  return { ok: true, definition: validation.definition }
}

/* ------------------------------------------------------------------------- */
/* 执行核心                                                                    */
/* ------------------------------------------------------------------------- */

export interface DecodeOutcome {
  results: DecodeResult[]
  error?: string
}

export type EncodeOutcome = { ok: true; bytes: Uint8Array } | { ok: false; error: string }

export interface ProtocolExecutorOptions {
  onLog?: ProtocolLogSink
  /** 初始 state；默认空对象。 */
  state?: Record<string, unknown>
}

export interface ProtocolExecutor {
  readonly definition: ProtocolDefinition
  /** 会话级持久状态，插件可通过 `ctx.state` 读写。 */
  readonly state: Record<string, unknown>
  /** 解码一帧；插件抛错或返回非法结构时给出 `error`，不抛出。 */
  decodeFrame(frame: Uint8Array, direction: DecodeDirection, timestamp: number): DecodeOutcome
  /** 编码；返回非法结果（类型/长度）时给出 `error`，不抛出。 */
  encode(values: Record<string, SendValue>): EncodeOutcome
  /** 清空 state（保持对象引用不变，便于插件持有引用时继续有效）。 */
  reset(): void
}

function normalizeDecodeField(value: unknown): DecodeField | null {
  if (!isRecord(value)) return null
  if (typeof value.label !== 'string') return null
  const rawValue = value.value
  const fieldValue =
    typeof rawValue === 'string' || typeof rawValue === 'number' || typeof rawValue === 'boolean'
      ? rawValue
      : undefined
  if (fieldValue === undefined) return null
  const field: DecodeField = { label: value.label, value: fieldValue }
  if (typeof value.unit === 'string') field.unit = value.unit
  if (
    typeof value.format === 'string' &&
    (FIELD_FORMATS as readonly string[]).includes(value.format)
  ) {
    field.format = value.format as DecodeField['format']
  }
  if (typeof value.key === 'string') {
    const key = value.key.trim()
    if (key.length > 0) field.key = key
  }
  return field
}

/** 结果规范化时收集的告警（例如变量数量超限被截断）。 */
export type DecodeWarningSink = (text: string) => void

type NormalizedVariables =
  { ok: true; variables?: Record<string, number> } | { ok: false; error: string }

function defineEnumerable<T>(record: Record<string, T>, key: string, value: T): void {
  // `__proto__` 也符合变量名规则（以下划线开头），直接赋值会改写原型链。
  Object.defineProperty(record, key, {
    value,
    enumerable: true,
    writable: true,
    configurable: true,
  })
}

function invalidVariableKeyError(key: string): string {
  return `变量名不合法：${key}（必须匹配 /^[A-Za-z_][A-Za-z0-9_.]{0,63}$/）`
}

/**
 * 规范化 `variables`：键必须符合变量名规则，值必须是数字。
 *
 * 非有限数（NaN/Infinity）原样保留：plan §6.5 的变量提取规则要求由
 * `domains/series` 丢弃并计入 `invalidSamples`，协议层提前过滤会让这个统计失真。
 * 超出 256 个变量时截断，并通过告警接收端记录。
 */
function normalizeVariables(value: unknown, onWarning?: DecodeWarningSink): NormalizedVariables {
  if (value === undefined) return { ok: true }
  if (!isRecord(value)) return { ok: false, error: 'variables 必须是对象' }
  const variables: Record<string, number> = {}
  let kept = 0
  let dropped = 0
  for (const key of Object.keys(value)) {
    if (!isValidVariableKey(key)) return { ok: false, error: invalidVariableKeyError(key) }
    const raw = value[key]
    if (typeof raw !== 'number') continue
    if (kept >= MAX_DECODE_VARIABLES) {
      dropped += 1
      continue
    }
    defineEnumerable(variables, key, raw)
    kept += 1
  }
  if (dropped > 0 && onWarning !== undefined) {
    onWarning(`变量数量超过 ${MAX_DECODE_VARIABLES} 个，已截断（丢弃 ${dropped} 个）`)
  }
  return kept > 0 ? { ok: true, variables } : { ok: true }
}

function normalizeVariableMeta(value: unknown): Record<string, VariableMeta> | undefined {
  if (!isRecord(value)) return undefined
  const meta: Record<string, VariableMeta> = {}
  let kept = 0
  for (const key of Object.keys(value)) {
    if (!isValidVariableKey(key)) continue
    const raw = value[key]
    if (!isRecord(raw)) continue
    const item: VariableMeta = {}
    if (typeof raw.unit === 'string') item.unit = raw.unit
    if (typeof raw.label === 'string') item.label = raw.label
    if (item.unit === undefined && item.label === undefined) continue
    defineEnumerable(meta, key, item)
    kept += 1
  }
  return kept > 0 ? meta : undefined
}

type NormalizedResult = { ok: true; result: DecodeResult } | { ok: false; error: string }

/**
 * 规范化单个解码结果：summary 必填，截断 200 字，fields 最多 64 个；
 * variables / variableMeta / noVariables 按 plan §6.5 校验并保留。
 */
function normalizeDecodeResult(value: unknown, onWarning?: DecodeWarningSink): NormalizedResult {
  if (!isRecord(value)) {
    return { ok: false, error: '解码结果必须是带有 summary 的对象' }
  }
  if (typeof value.summary !== 'string') {
    return { ok: false, error: '解码结果缺少 summary 字段' }
  }
  const result: DecodeResult = { summary: value.summary.slice(0, MAX_DECODE_SUMMARY_LENGTH) }
  if (typeof value.type === 'string') result.type = value.type
  if (Array.isArray(value.fields)) {
    const fields: DecodeField[] = []
    for (const item of value.fields) {
      if (fields.length >= MAX_DECODE_FIELDS) break
      const field = normalizeDecodeField(item)
      if (field !== null) fields.push(field)
    }
    if (fields.length > 0) result.fields = fields
  }
  if (
    typeof value.level === 'string' &&
    (DECODE_LEVELS as readonly string[]).includes(value.level)
  ) {
    result.level = value.level as DecodeLevel
  }
  const variables = normalizeVariables(value.variables, onWarning)
  if (!variables.ok) return variables
  if (variables.variables !== undefined) result.variables = variables.variables
  const variableMeta = normalizeVariableMeta(value.variableMeta)
  if (variableMeta !== undefined) result.variableMeta = variableMeta
  if (value.noVariables === true) result.noVariables = true
  return { ok: true, result }
}

/** 把编码返回值规范化为字节；非法时返回错误消息。 */
function normalizeEncodedBytes(value: unknown): Uint8Array | string {
  if (value instanceof Uint8Array) return Uint8Array.from(value)
  if (
    Array.isArray(value) &&
    value.every(
      (item) => typeof item === 'number' && Number.isInteger(item) && item >= 0 && item <= 255,
    )
  ) {
    return Uint8Array.from(value as number[])
  }
  return 'encode 必须返回 Uint8Array 或 0–255 的整数数组'
}

/**
 * 创建不依赖 Worker 的协议执行器。
 *
 * 对同一份 `compileProtocol` 返回的 definition 调用时，会接管编译期注入的
 * console 代理，使 `onLog` 能收到 decode / encode 里的日志。
 */
export function createProtocolExecutor(
  definition: ProtocolDefinition,
  options: ProtocolExecutorOptions = {},
): ProtocolExecutor {
  const holder = logHolders.get(definition)
  if (holder && options.onLog) holder.sink = options.onLog

  const state: Record<string, unknown> = options.state ?? {}

  /** 结果规范化产生的告警走插件日志通道（协议管理器的「调试输出」可见）。 */
  const emitDecodeWarning: DecodeWarningSink = (text) => {
    const sink = options.onLog ?? holder?.sink
    if (sink === undefined) return
    try {
      sink('warn', text)
    } catch {
      // 日志接收端出错不能影响解码。
    }
  }

  return {
    definition,
    get state(): Record<string, unknown> {
      return state
    },
    decodeFrame(frame: Uint8Array, direction: DecodeDirection, timestamp: number): DecodeOutcome {
      const decode = definition.decode
      if (typeof decode !== 'function') return { results: [] }
      const context: DecodeContext = { direction, timestamp, state }
      let raw: unknown
      try {
        raw = decode(frame, context)
      } catch (error) {
        return { results: [], error: errorMessage(error) }
      }
      if (raw === null || raw === undefined) return { results: [] }
      const values = Array.isArray(raw) ? raw : [raw]
      const results: DecodeResult[] = []
      for (const value of values) {
        const normalized = normalizeDecodeResult(value, emitDecodeWarning)
        if (!normalized.ok) return { results: [], error: normalized.error }
        results.push(normalized.result)
      }
      return { results }
    },
    encode(values: Record<string, SendValue>): EncodeOutcome {
      const encode = definition.encode
      if (typeof encode !== 'function') return { ok: false, error: '插件未定义 encode 函数' }
      const context: EncodeContext = { state }
      let raw: unknown
      try {
        raw = encode(values, context)
      } catch (error) {
        return { ok: false, error: errorMessage(error) }
      }
      const normalized = normalizeEncodedBytes(raw)
      if (typeof normalized === 'string') return { ok: false, error: normalized }
      if (normalized.length < 1 || normalized.length > MAX_FRAME_LENGTH) {
        return {
          ok: false,
          error: `encode 返回的字节长度必须在 1–${MAX_FRAME_LENGTH} 之间（当前 ${normalized.length}）`,
        }
      }
      return { ok: true, bytes: normalized }
    },
    reset(): void {
      for (const key of Object.keys(state)) delete state[key]
    },
  }
}
