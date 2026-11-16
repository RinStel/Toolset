/**
 * 协议领域的公共类型、Worker 消息契约与分帧基础设施（plan §6.5）。
 *
 * 分帧基类和字节队列也放在本文件，是为了让 `framing/` 下的 5 个模式文件只依赖
 * 本文件而不互相依赖，从而不产生循环依赖（`pnpm check:arch` 的 no-circular）。
 */

/** 插件定义版本号，目前只支持 1。 */
export const PROTOCOL_API_VERSION = 1

/** 插件源码长度上限（字节/UTF-16 码元）：256KB。 */
export const MAX_PROTOCOL_CODE_LENGTH = 256 * 1024

/** `maxFrameLength` 的默认值与取值范围（plan §6.5 分帧语义表）。 */
export const DEFAULT_MAX_FRAME_LENGTH = 4096
export const MIN_FRAME_LENGTH = 1
export const MAX_FRAME_LENGTH = 65536

/** 仪表盘变量名的合法格式（plan §6.5 `DecodeResult.variables` 注释）。 */
export const VARIABLE_KEY_PATTERN = /^[A-Za-z_][A-Za-z0-9_.]{0,63}$/

/** 单个解码结果里变量数量的上限；超出的变量会被截断（plan §6.5 / §8.6）。 */
export const MAX_DECODE_VARIABLES = 256

/** 变量名是否合法（与仪表盘、`domains/series` 的提取规则保持一致）。 */
export function isValidVariableKey(key: string): boolean {
  return VARIABLE_KEY_PATTERN.test(key)
}

export interface ProtocolMeta {
  name: string
  description?: string
  version?: string
}

export type FramingSpec =
  LineFramingSpec | DelimiterFramingSpec | FixedFramingSpec | LengthFramingSpec | IdleFramingSpec

export interface LineFramingSpec {
  type: 'line'
  eol?: 'lf' | 'crlf' | 'cr'
  includeEol?: boolean
  maxFrameLength?: number
}

export interface DelimiterFramingSpec {
  type: 'delimiter'
  start?: string
  end: string
  include?: 'content' | 'both'
  maxFrameLength?: number
}

export interface FixedFramingSpec {
  type: 'fixed'
  length: number
  header?: string
  trailer?: string
  maxFrameLength?: number
}

export interface LengthFramingSpec {
  type: 'length'
  header?: string
  length: LengthField
  maxFrameLength?: number
}

export interface IdleFramingSpec {
  type: 'idle'
  /** 静默间隔，1–1000ms。 */
  gapMs: number
  maxFrameLength?: number
}

export interface LengthField {
  /** 长度字段相对帧起点的字节偏移。 */
  offset: number
  size: 1 | 2 | 4
  endian?: 'le' | 'be'
  /** `'frame'`：字段值即总帧长；`'after'`：字段值表示字段之后的字节数。 */
  includes: 'frame' | 'after'
  /** 总帧长的修正值，默认 0。 */
  adjust?: number
}

export type DecodeDirection = 'rx' | 'tx'

export interface DecodeContext {
  direction: DecodeDirection
  timestamp: number
  /** 会话级持久状态，跨帧可写。 */
  state: Record<string, unknown>
}

export interface EncodeContext {
  /** 会话级持久状态，跨帧可写。 */
  state: Record<string, unknown>
}

export interface DecodeField {
  label: string
  value: string | number | boolean
  unit?: string
  format?: 'text' | 'hex' | 'dec'
  /**
   * 可选变量名；没有 `variables` 时仪表盘按 `key ?? label` 从数字字段自动提取变量
   * （plan §6.5 变量提取规则）。
   */
  key?: string
}

/** `variableMeta` 的单项：帮助仪表盘显示单位与名称。 */
export interface VariableMeta {
  unit?: string
  label?: string
}

export type DecodeLevel = 'info' | 'warn' | 'error'

export interface DecodeResult {
  type?: string
  summary: string
  fields?: DecodeField[]
  /** 默认 `'info'`。 */
  level?: DecodeLevel
  /**
   * 供仪表盘使用的变量样本；键必须匹配 `/^[A-Za-z_][A-Za-z0-9_.]{0,63}$/`
   * （plan §6.5）。非有限数（NaN/Infinity）会保留到这里，由 `domains/series`
   * 的提取规则丢弃并计入 `invalidSamples`。
   */
  variables?: Record<string, number>
  /** 变量单位/名称提示；只有键合法的项会被保留。 */
  variableMeta?: Record<string, VariableMeta>
  /** 为 `true` 时不从 `fields` 自动提取变量（plan §6.5 变量提取规则 2）。 */
  noVariables?: boolean
}

export type SendField =
  | {
      key: string
      label: string
      type: 'number'
      min?: number
      max?: number
      step?: number
      default?: number
      unit?: string
    }
  | { key: string; label: string; type: 'text'; maxLength?: number; default?: string }
  | {
      key: string
      label: string
      type: 'select'
      options: Array<{ label: string; value: string | number }>
      default?: string | number
    }
  | { key: string; label: string; type: 'checkbox'; default?: boolean }
  | { key: string; label: string; type: 'hex'; default?: string }

export type SendFieldType = SendField['type']

/** `hex` 字段在调用 `encode` 之前已经被上层解析为 `Uint8Array`。 */
export type SendValue = number | string | boolean | Uint8Array

export interface ProtocolSendForm {
  fields: SendField[]
}

export interface ProtocolDefinition {
  apiVersion: 1
  meta: ProtocolMeta
  framing: FramingSpec
  decode?(frame: Uint8Array, ctx: DecodeContext): DecodeResult | DecodeResult[] | null
  sendForm?: ProtocolSendForm
  encode?(values: Record<string, SendValue>, ctx: EncodeContext): Uint8Array | number[]
}

/** `ready` 消息携带的协议信息；也是 `ProtocolRuntime.info` 的形状。 */
export interface ProtocolRuntimeInfo {
  meta: ProtocolMeta
  sendForm?: ProtocolSendForm
  framing: FramingSpec
}

export type ProtocolLogLevel = 'log' | 'warn' | 'error'

/** 插件 console 输出的接收端。`text` 已转成单行并截断到 500 字。 */
export type ProtocolLogSink = (level: ProtocolLogLevel, text: string) => void

/** 一帧的解码结果（Worker 发给主线程，或主线程的 runtime 事件）。 */
export interface ProtocolFrame {
  bytes: Uint8Array
  at: number
  direction: DecodeDirection
  results: DecodeResult[]
  /** 解码错误；该帧仍然会输出。 */
  error?: string
}

export type ProtocolDiscardReason = 'overflow' | 'sync' | 'resync'

/** 被分帧器丢弃的字节（主线程 runtime 的 `discard` 事件）。 */
export interface ProtocolDiscardEvent {
  bytes: Uint8Array
  at: number
  reason: ProtocolDiscardReason
}

/** 插件仓库中的完整记录。 */
export interface ProtocolRecord {
  id: string
  name: string
  code: string
  createdAt: number
  updatedAt: number
}

/** 插件列表项（不需要读取源码）。 */
export interface ProtocolSummary {
  id: string
  name: string
  builtin: boolean
  updatedAt: number
}

/** 新建插件时可选的模板。 */
export interface ProtocolTemplate {
  id: string
  name: string
  description: string
  /** 一个 JS 函数体字符串，与插件代码格式一致。 */
  code: string
}

/* ------------------------------------------------------------------------- */
/* Worker 消息协议（plan §6.5）                                                */
/* ------------------------------------------------------------------------- */

export interface WorkerInitMessage {
  t: 'init'
  code: string
  maxFrameLength?: number
}

export interface WorkerFeedChunk {
  bytes: Uint8Array
  at: number
}

export interface WorkerFeedMessage {
  t: 'feed'
  id: number
  chunks: WorkerFeedChunk[]
}

export interface WorkerFlushMessage {
  t: 'flush'
  id: number
}

export interface WorkerDecodeTxMessage {
  t: 'decodeTx'
  id: number
  bytes: Uint8Array
  at: number
}

export interface WorkerEncodeMessage {
  t: 'encode'
  id: number
  values: Record<string, SendValue>
}

export interface WorkerResetMessage {
  t: 'reset'
}

export type ProtocolWorkerInMessage =
  | WorkerInitMessage
  | WorkerFeedMessage
  | WorkerFlushMessage
  | WorkerDecodeTxMessage
  | WorkerEncodeMessage
  | WorkerResetMessage

export interface WorkerReadyMessage {
  t: 'ready'
  meta: ProtocolMeta
  sendForm?: ProtocolSendForm
  framing: FramingSpec
}

export interface WorkerInitErrorMessage {
  t: 'initError'
  error: string
}

export interface WorkerFramesMessage {
  t: 'frames'
  id: number
  frames: ProtocolFrame[]
}

export interface WorkerDiscardMessage {
  t: 'discard'
  id: number
  bytes: Uint8Array
  at: number
  reason: ProtocolDiscardReason
}

export interface WorkerEncodedMessage {
  t: 'encoded'
  id: number
  bytes: Uint8Array
}

export interface WorkerEncodeErrorMessage {
  t: 'encodeError'
  id: number
  error: string
}

export interface WorkerLogMessage {
  t: 'log'
  level: ProtocolLogLevel
  text: string
}

export interface WorkerDoneMessage {
  t: 'done'
  id: number
}

export type ProtocolWorkerOutMessage =
  | WorkerReadyMessage
  | WorkerInitErrorMessage
  | WorkerFramesMessage
  | WorkerDiscardMessage
  | WorkerEncodedMessage
  | WorkerEncodeErrorMessage
  | WorkerLogMessage
  | WorkerDoneMessage

/* ------------------------------------------------------------------------- */
/* 分帧基础设施                                                                */
/* ------------------------------------------------------------------------- */

/** 分帧器输出的一帧；`at` 是完成该帧的数据块时间戳。 */
export interface FrameEvent {
  bytes: Uint8Array
  at: number
}

export type FramerDiscardReason = 'sync' | 'resync' | 'overflow'

/** 分帧器丢弃的字节；所有丢弃都必须上报（plan §6.5）。 */
export interface FramerDiscard {
  bytes: Uint8Array
  at: number
  reason: FramerDiscardReason
}

export interface FramerOutput {
  frames: FrameEvent[]
  discards: FramerDiscard[]
}

export interface Framer {
  /** 已累计丢弃的字节数。 */
  readonly discardBytes: number
  feed(bytes: Uint8Array, at: number): FramerOutput
  /** 仅 `idle` 模式使用；其他模式保留半帧并返回空结果。 */
  flush(at: number): FramerOutput
  reset(): void
}

export function emptyFramerOutput(): FramerOutput {
  return { frames: [], discards: [] }
}

/** 把任意 `maxFrameLength` 归一化到 1–65536；非法值回退到默认值。 */
export function normalizeMaxFrameLength(value: number | undefined): number {
  if (value === undefined) return DEFAULT_MAX_FRAME_LENGTH
  if (!Number.isInteger(value) || value < MIN_FRAME_LENGTH || value > MAX_FRAME_LENGTH) {
    return DEFAULT_MAX_FRAME_LENGTH
  }
  return value
}

/** 分帧器共用的字节队列（数字数组，追加/取出都是 O(n) 且实现简单）。 */
export class ByteQueue {
  private data: number[] = []

  get length(): number {
    return this.data.length
  }

  append(bytes: Uint8Array): void {
    for (const byte of bytes) this.data.push(byte)
  }

  byteAt(index: number): number | undefined {
    return this.data[index]
  }

  slice(start: number, end: number): Uint8Array {
    return Uint8Array.from(this.data.slice(start, end))
  }

  /** 从队首取出 `count` 个字节（不足时取全部）。 */
  take(count: number): Uint8Array {
    return Uint8Array.from(this.data.splice(0, count))
  }

  clear(): void {
    this.data.length = 0
  }

  /** 查找 `sequence` 首次出现的位置；`-1` 表示未找到。 */
  indexOf(sequence: readonly number[], from = 0): number {
    if (sequence.length === 0) return Math.min(Math.max(from, 0), this.data.length)
    const lastStart = this.data.length - sequence.length
    for (let start = Math.max(from, 0); start <= lastStart; start += 1) {
      let matched = true
      for (let offset = 0; offset < sequence.length; offset += 1) {
        if (this.data[start + offset] !== sequence[offset]) {
          matched = false
          break
        }
      }
      if (matched) return start
    }
    return -1
  }

  /**
   * 返回缓冲区末尾与 `sequence` 前缀匹配的最长长度。
   *
   * 用于“同步头被拆到两个数据块”的情况：把可能是同步头开头的尾部保留下来，
   * 其余字节作为垃圾丢弃。
   */
  trailingPrefixLength(sequence: readonly number[]): number {
    const maxLength = Math.min(sequence.length, this.data.length)
    let best = 0
    for (let length = 1; length <= maxLength; length += 1) {
      let matched = true
      for (let offset = 0; offset < length; offset += 1) {
        if (this.data[this.data.length - length + offset] !== sequence[offset]) {
          matched = false
          break
        }
      }
      if (matched) best = length
    }
    return best
  }
}

/**
 * 分帧器的公共基类：负责缓冲、丢弃统计、`maxFrameLength` 兜底和同步头对齐。
 *
 * 子类只需实现 `extract`，把当前缓冲区里所有能组成的帧取走。
 */
export abstract class BufferedFramer implements Framer {
  protected readonly buffer = new ByteQueue()
  protected readonly maxFrameLength: number
  private discardedBytes = 0

  protected constructor(maxFrameLength?: number) {
    this.maxFrameLength = normalizeMaxFrameLength(maxFrameLength)
  }

  get discardBytes(): number {
    return this.discardedBytes
  }

  feed(bytes: Uint8Array, at: number): FramerOutput {
    const frames: FrameEvent[] = []
    const discards: FramerDiscard[] = []
    this.buffer.append(bytes)
    this.extract(at, frames, discards)
    if (this.buffer.length > this.maxFrameLength) {
      this.discardFront(this.buffer.length, at, 'overflow', discards)
    }
    return { frames, discards }
  }

  flush(at: number): FramerOutput {
    void at
    return emptyFramerOutput()
  }

  reset(): void {
    this.buffer.clear()
  }

  /** 把当前缓冲区里所有完整的帧放进 `frames`。 */
  protected abstract extract(at: number, frames: FrameEvent[], discards: FramerDiscard[]): void

  /** 从队首取走 `count` 字节作为一帧。 */
  protected emit(count: number, at: number, frames: FrameEvent[]): void {
    const bytes = this.buffer.take(count)
    frames.push({ bytes, at })
  }

  /** 把当前整个缓冲区作为一帧输出。 */
  protected emitAll(at: number, frames: FrameEvent[]): void {
    if (this.buffer.length === 0) return
    const bytes = this.buffer.take(this.buffer.length)
    frames.push({ bytes, at })
  }

  /** 丢弃队首 `count` 字节并记录（计入丢弃统计与 `discards`）。 */
  protected discardFront(
    count: number,
    at: number,
    reason: FramerDiscardReason,
    discards: FramerDiscard[],
  ): void {
    const bytes = this.buffer.take(count)
    if (bytes.length === 0) return
    this.discardedBytes += bytes.length
    discards.push({ bytes, at, reason })
  }

  /**
   * 把缓冲区对齐到同步头 `sequence` 的起点。
   *
   * @returns `true` 表示已对齐；`false` 表示数据不足，调用方应等待下一块数据。
   */
  protected syncTo(sequence: readonly number[], at: number, discards: FramerDiscard[]): boolean {
    const index = this.buffer.indexOf(sequence)
    if (index < 0) {
      const keep = this.buffer.trailingPrefixLength(sequence)
      const drop = this.buffer.length - keep
      if (drop > 0) this.discardFront(drop, at, 'sync', discards)
      return false
    }
    if (index > 0) this.discardFront(index, at, 'sync', discards)
    return true
  }
}
