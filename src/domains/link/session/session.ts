/**
 * `LinkSession`: one openable channel with its read loop, write queue, log,
 * protocol runtime and automation tasks (plan §6.6).
 *
 * The class is intentionally free of Vue and browser globals: transports provide
 * the streams, so unit tests can use in-process fake transports.
 */

import {
  createProtocolRuntime,
  getProtocolRepository,
  type DecodeResult,
  type ProtocolDiscardEvent,
  type ProtocolFrame,
  type ProtocolRuntime,
  type SendField,
  type SendValue,
} from '../../protocol/public'
import { createStreamDecoder } from '../../bytes/public'
import { createBatcher, type Batcher } from '../../../shared/lib/batch'
import { createEmitter, type TypedEmitter, type Unsubscribe } from '../../../shared/lib/events'
import {
  createLogBuffer,
  type LogBuffer,
  type LogBufferImpl,
  type LogDecoded,
  type LogEntriesEvent,
  type LogEntry,
} from '../log/buffer'
import {
  AUTO_SAMPLE_SECONDS,
  AUTO_SAMPLE_THRESHOLD_FPS,
  autoSampledText,
  normalizeLogPolicy,
  omittedFramesText,
  type LogPolicy,
} from '../log/policy'
import type { DeviceMemoryStore } from '../presets/devices'
import {
  defaultComposeOptions,
  normalizeComposeOptions,
  type ComposeOptions,
} from '../send/compose'
import {
  createMacroRunner,
  type Macro,
  type MacroRunner,
  type MacroStatus,
  type MacroStopReason,
} from '../send/macro'
import {
  createRepeatRunner,
  type RepeatOptions,
  type RepeatRunner,
  type RepeatStatus,
} from '../send/repeat'
import type { ByteTransport, TransportSignals } from '../transport/types'
import type { DecodedFrame } from './frames'
import {
  DEFAULT_RX_OPTIONS,
  createRxFramer,
  normalizeRxOptions,
  type RxFramer,
  type RxOptions,
} from './rx-framer'
import {
  DEVICE_DISCONNECTED_TEXT,
  IllegalStateError,
  decodeErrorText,
  errorMessage,
  errorName,
  isRecoverableReadError,
  mapOpenError,
  protocolEncodeFailureText,
  protocolLoadFailureText,
  protocolTimeoutText,
  transition,
  writeFailureText,
  type DisplayMode,
  type Origin,
  type SessionEvent,
  type SessionState,
} from './state'

/** Counters shown in the status bar. */
export interface SessionStats {
  rxBytes: number
  txBytes: number
  rxFrames: number
  droppedBytes: number
  decodeErrors: number
}

/** Active protocol of a session. */
export interface SessionProtocol {
  id: string
  name: string
  sendForm?: SendField[]
  status: 'active' | 'disabled'
  error?: string
}

/** DTR/RTS tri-state (`null` = not set). */
export interface LinkSignals {
  dtr: boolean | null
  rts: boolean | null
}

/** Current automation tasks. */
export interface LinkTasks {
  repeat: RepeatStatus | null
  macro: MacroStatus | null
}

/** Payload map of the session event emitter. */
export interface LinkSessionEvents {
  state: SessionState
  entries: LogEntriesEvent
  stats: SessionStats
  protocol: SessionProtocol | null
  tasks: LinkTasks
  signals: LinkSignals
  settings: Readonly<Record<string, unknown>>
  logPolicy: LogPolicy
  /** Complete batch of decoded frames; never sampled and never merged. */
  frames: DecodedFrame[]
  [event: string]: unknown
}

/** See plan §6.6. Extra members are documented extensions used by the UI/bridge. */
export interface LinkSession {
  readonly id: string
  readonly transport: ByteTransport
  readonly providerKind: string
  name: string
  readonly state: SessionState
  readonly lastError: string | null
  readonly settings: Readonly<Record<string, unknown>>
  readonly stats: SessionStats
  readonly log: LogBuffer
  readonly protocol: SessionProtocol | null
  readonly signals: LinkSignals
  rxOptions: RxOptions
  /** Which decoded frames are written to the log buffer (plan §6.6). */
  logPolicy: LogPolicy
  /** Cumulative decoded frames omitted by the sampled policy since the last policy reset. */
  readonly logOmittedFrames: number
  readonly tasks: LinkTasks
  /** UI/preset state kept on the session (extension). */
  displayMode: DisplayMode
  /** Compose options of the session (extension). */
  compose: ComposeOptions
  /** Bytes dropped because the protocol runtime could not keep up (extension). */
  readonly protocolOverflowBytes: number
  /** True after the device was re-plugged; shown as 「设备已重新插入，可重新连接」. */
  readonly deviceAvailable: boolean
  open(): Promise<void>
  close(): Promise<void>
  dispose(): Promise<void>
  updateSettings(patch: Record<string, unknown>): void
  /** Writes settings for the next `open()` without the closed-state guard (extension). */
  stageSettings(patch: Record<string, unknown>): void
  setProtocol(id: string | null): Promise<void>
  send(bytes: Uint8Array, origin: Origin): Promise<void>
  sendForm(values: Record<string, SendValue>): Promise<void>
  setSignals(signals: TransportSignals): Promise<void>
  /**
   * Applies a preset log policy verbatim without treating it as a manual mode
   * change (a manual change keeps `auto` off, a preset restores it).
   */
  applyLogPolicy(policy: LogPolicy): void
  startRepeat(options: RepeatOptions): void
  stopRepeat(): void
  startMacro(macro: Macro): void
  stopMacro(): void
  on<K extends keyof LinkSessionEvents & string>(
    event: K,
    handler: (payload: LinkSessionEvents[K]) => void,
  ): Unsubscribe
  /** Raw RX blocks before framing (used by the bridge service). */
  onRawRx(handler: (bytes: Uint8Array) => void): () => void
  /** Notified when the session is disposed (used by the bridge service). */
  onDispose(handler: () => void): () => void
  /** Appends a system log entry (used by the bridge service and the UI). */
  writeSystemLog(level: 'info' | 'warn' | 'error', text: string): void
  clearLog(): void
  /** Marks that the device was plugged in again while the session is in error. */
  markDeviceAvailable(): void
}

export interface LinkSessionOptions {
  id: string
  transport: ByteTransport
  providerKind: string
  name?: string
  settings?: Record<string, unknown>
  rxOptions?: Partial<RxOptions>
  displayMode?: DisplayMode
  compose?: Partial<ComposeOptions>
  logPolicy?: Partial<LogPolicy>
  protocolId?: string | null
  log?: { maxEntries?: number; maxBytes?: number }
  /** Device memory store; when set, successful opens update it. */
  memory?: DeviceMemoryStore
  /** Called when the session is disposed (manager removes it). */
  onDispose?: (session: LinkSession) => void
  /** Injectable runtime factory for tests. */
  createRuntime?: (code: string) => Promise<ProtocolRuntime>
  now?: () => number
}

/** Default log limits from plan §8.8. */
export const DEFAULT_LOG_MAX_ENTRIES = 5000
export const DEFAULT_LOG_MAX_BYTES = 32 * 1024 * 1024

const DISPLAY_MODES: readonly DisplayMode[] = ['raw', 'decoded', 'both']

interface PendingDiscard {
  bytes: Uint8Array
  at: number
}

function concatChunks(chunks: Uint8Array[]): Uint8Array {
  const total = chunks.reduce((sum, chunk) => sum + chunk.length, 0)
  const bytes = new Uint8Array(total)
  let offset = 0
  for (const chunk of chunks) {
    bytes.set(chunk, offset)
    offset += chunk.length
  }
  return bytes
}

/** Creates one session. The manager is responsible for id allocation and dedupe. */
export function createLinkSession(options: LinkSessionOptions): LinkSession {
  return new LinkSessionImpl(options)
}

class LinkSessionImpl implements LinkSession {
  readonly id: string
  readonly transport: ByteTransport
  readonly providerKind: string
  name: string
  private readonly logStore: LogBufferImpl

  private stateValue: SessionState = 'idle'
  private lastErrorValue: string | null = null
  private settingsValue: Readonly<Record<string, unknown>>
  private statsValue: SessionStats = {
    rxBytes: 0,
    txBytes: 0,
    rxFrames: 0,
    droppedBytes: 0,
    decodeErrors: 0,
  }

  private protocolValue: SessionProtocol | null = null
  private runtime: ProtocolRuntime | null = null
  private protocolGeneration = 0
  private protocolTask: Promise<void> = Promise.resolve()

  private signalsValue: LinkSignals = { dtr: null, rts: null }
  private rxOptionsValue: RxOptions
  private displayModeValue: DisplayMode
  private composeValue: ComposeOptions
  private logPolicyValue: LogPolicy
  private protocolOverflowBytesValue = 0
  private deviceAvailableValue = false

  /** Session-local decoded frame number; independent of the log seq. */
  private nextFrameSeq = 1
  /** Decoded frames received in the current calendar second (for `auto`). */
  private rateSecond = -1
  private rateFrames = 0
  private highRateSeconds = 0
  /** Current second of the sampled log policy and the slices already used. */
  private sampledSecond = -1
  private readonly sampledSlices = new Set<number>()
  private omittedFrames = 0
  private omittedTimer: ReturnType<typeof setTimeout> | null = null

  private framer: RxFramer
  private rxDecoder = createStreamDecoder(DEFAULT_RX_OPTIONS.encoding)

  private readonly emitter: TypedEmitter<LinkSessionEvents>
  private readonly entryBatcher: Batcher<LogEntry>
  private readonly updateBatcher: Batcher<number>
  private readonly statsBatcher: Batcher<number>
  private readonly discardBatcher: Batcher<PendingDiscard>

  private readonly rawRxHandlers = new Set<(bytes: Uint8Array) => void>()
  private readonly disposeHandlers = new Set<() => void>()
  private readonly memory: DeviceMemoryStore | undefined
  private readonly onDisposeCallback: ((session: LinkSession) => void) | undefined
  private readonly createRuntime: ((code: string) => Promise<ProtocolRuntime>) | undefined
  private readonly now: () => number

  private reader: ReadableStreamDefaultReader<Uint8Array> | null = null
  private writer: WritableStreamDefaultWriter<Uint8Array> | null = null
  private readLoopPromise: Promise<void> | null = null
  private openPromise: Promise<void> | null = null
  private pendingTeardown: Promise<void> = Promise.resolve()
  private closingRequested = false
  private unsubscribeDisconnect: (() => void) | null = null
  private pendingTxSeqs: number[] = []
  private decodeErrorAt = 0
  private decodeErrorSuppressed = 0
  private repeatRunner: RepeatRunner | null = null
  private macroRunner: MacroRunner | null = null

  private disposing = false
  private disposed = false

  constructor(options: LinkSessionOptions) {
    this.id = options.id
    this.transport = options.transport
    this.providerKind = options.providerKind
    this.name = options.name ?? options.transport.label
    this.memory = options.memory
    this.onDisposeCallback = options.onDispose
    this.createRuntime = options.createRuntime
    this.now = options.now ?? (() => Date.now())
    this.settingsValue = Object.freeze({ ...(options.settings ?? {}) })
    this.rxOptionsValue = normalizeRxOptions(options.rxOptions)
    this.displayModeValue =
      options.displayMode !== undefined && DISPLAY_MODES.includes(options.displayMode)
        ? options.displayMode
        : 'both'
    this.composeValue = normalizeComposeOptions(options.compose)
    this.logPolicyValue = normalizeLogPolicy(options.logPolicy)
    this.logStore = createLogBuffer({
      maxEntries: options.log?.maxEntries ?? DEFAULT_LOG_MAX_ENTRIES,
      maxBytes: options.log?.maxBytes ?? DEFAULT_LOG_MAX_BYTES,
    })
    this.emitter = createEmitter<LinkSessionEvents>()

    this.entryBatcher = createBatcher<LogEntry>({
      windowMs: 50,
      maxItems: 500,
      onFlush: (entries) => {
        this.emitter.emit('entries', { added: entries })
      },
    })
    this.updateBatcher = createBatcher<number>({
      windowMs: 50,
      onFlush: (seqs) => {
        if (seqs.length === 0) return
        this.emitter.emit('entries', { added: [], updated: seqs })
      },
    })
    this.statsBatcher = createBatcher<number>({
      windowMs: 100,
      maxItems: 1,
      onFlush: () => {
        this.emitter.emit('stats', this.stats)
      },
    })
    this.discardBatcher = createBatcher<PendingDiscard>({
      windowMs: 100,
      onFlush: (items) => {
        this.flushDiscard(items)
      },
    })
    this.framer = this.createFramer()

    if (options.protocolId !== undefined && options.protocolId !== null) {
      void this.setProtocol(options.protocolId)
    }
  }

  /* ----------------------------------------------------------------------- */
  /* Public state                                                            */
  /* ----------------------------------------------------------------------- */

  get state(): SessionState {
    return this.stateValue
  }

  get lastError(): string | null {
    return this.lastErrorValue
  }

  get log(): LogBuffer {
    return this.logStore
  }

  get settings(): Readonly<Record<string, unknown>> {
    return this.settingsValue
  }

  get stats(): SessionStats {
    return { ...this.statsValue }
  }

  get protocol(): SessionProtocol | null {
    return this.protocolValue
  }

  get signals(): LinkSignals {
    return { ...this.signalsValue }
  }

  get rxOptions(): RxOptions {
    return this.rxOptionsValue
  }

  set rxOptions(value: RxOptions) {
    this.rxOptionsValue = normalizeRxOptions(value)
    this.resetReadPipeline()
    this.emitter.emit('settings', this.settingsValue)
  }

  get displayMode(): DisplayMode {
    return this.displayModeValue
  }

  set displayMode(value: DisplayMode) {
    const next = DISPLAY_MODES.includes(value) ? value : 'both'
    if (next === this.displayModeValue) return
    this.displayModeValue = next
    this.emitter.emit('settings', this.settingsValue)
    this.persistDeviceMemory()
  }

  get compose(): ComposeOptions {
    return this.composeValue
  }

  set compose(value: ComposeOptions) {
    this.composeValue = normalizeComposeOptions(value)
    this.emitter.emit('settings', this.settingsValue)
  }

  get logPolicy(): LogPolicy {
    return { ...this.logPolicyValue }
  }

  /** Cumulative decoded frames omitted by the sampled policy since the last policy reset. */
  get logOmittedFrames(): number {
    return this.omittedFrames
  }

  /**
   * Writes the log policy. A manual mode change turns `auto` off (plan §6.6);
   * automatic switches inside the session keep `auto` untouched.
   */
  set logPolicy(value: LogPolicy) {
    const next = normalizeLogPolicy(value)
    if (next.mode !== this.logPolicyValue.mode) next.auto = false
    this.assignLogPolicy(next)
  }

  applyLogPolicy(policy: LogPolicy): void {
    this.assignLogPolicy(normalizeLogPolicy(policy))
  }

  private assignLogPolicy(next: LogPolicy): void {
    this.logPolicyValue = next
    this.resetLogPolicyRuntime()
    this.emitter.emit('logPolicy', this.logPolicy)
  }

  get tasks(): LinkTasks {
    return {
      repeat: this.repeatRunner?.status ?? null,
      macro: this.macroRunner?.status ?? null,
    }
  }

  get protocolOverflowBytes(): number {
    return this.protocolOverflowBytesValue
  }

  get deviceAvailable(): boolean {
    return this.deviceAvailableValue
  }

  /* ----------------------------------------------------------------------- */
  /* Events                                                                  */
  /* ----------------------------------------------------------------------- */

  on<K extends keyof LinkSessionEvents & string>(
    event: K,
    handler: (payload: LinkSessionEvents[K]) => void,
  ): Unsubscribe {
    return this.emitter.on(event, handler)
  }

  onRawRx(handler: (bytes: Uint8Array) => void): () => void {
    this.rawRxHandlers.add(handler)
    return () => {
      this.rawRxHandlers.delete(handler)
    }
  }

  onDispose(handler: () => void): () => void {
    this.disposeHandlers.add(handler)
    return () => {
      this.disposeHandlers.delete(handler)
    }
  }

  writeSystemLog(level: 'info' | 'warn' | 'error', text: string): void {
    this.appendEntry({
      at: this.now(),
      dir: 'system',
      level,
      bytes: new Uint8Array(0),
      text,
    })
  }

  clearLog(): void {
    this.logStore.clear()
    this.pendingTxSeqs = []
    this.entryBatcher.clear()
    this.updateBatcher.clear()
    this.resetLogPolicyRuntime()
    this.emitter.emit('entries', { added: [] })
  }

  markDeviceAvailable(): void {
    if (this.stateValue !== 'error' || this.deviceAvailableValue) return
    this.deviceAvailableValue = true
    this.emitter.emit('state', this.stateValue)
  }

  /* ----------------------------------------------------------------------- */
  /* Open / close / dispose                                                  */
  /* ----------------------------------------------------------------------- */

  open(): Promise<void> {
    if (this.disposing || this.disposed) {
      return Promise.reject(new Error('会话已释放'))
    }
    const promise = this.openInternal()
    this.openPromise = promise
    return promise
  }

  private async openInternal(): Promise<void> {
    this.transitionTo('open')
    this.closingRequested = false
    this.lastErrorValue = null
    this.deviceAvailableValue = false
    this.emitState()

    let transportOpened = false
    try {
      await this.pendingTeardown
      await this.protocolTask
      if (this.getState() !== 'opening') return
      await this.transport.open({ ...this.settingsValue })
      transportOpened = true
      if (this.getState() === 'closing') return

      const writable = this.transport.writable
      this.writer = writable === null ? null : writable.getWriter()
      this.unsubscribeDisconnect = this.transport.onDisconnect(() => {
        this.handleDisconnect()
      })
      await this.ensureProtocolRuntime()
      if (this.getState() === 'closing') return

      this.transitionTo('opened')
      this.emitState()
      this.readLoopPromise = this.readLoop()
      this.persistDeviceMemory()
    } catch (error) {
      if (transportOpened) {
        this.releaseWriter()
        try {
          await this.transport.close()
        } catch {
          // Best effort: the open failure is what matters.
        }
      }
      this.lastErrorValue = mapOpenError(error)
      if (this.getState() === 'closing') return
      if (this.getState() === 'opening') {
        this.stateValue = 'error'
        this.emitState()
      }
      throw new Error(this.lastErrorValue)
    }
  }

  async close(): Promise<void> {
    if (this.disposed) return
    if (this.stateValue === 'opening') {
      this.transitionTo('close')
      this.closingRequested = true
      this.emitState()
      await this.openPromise?.catch(() => {})
      if (this.getState() === 'closing') await this.finishClose()
      return
    }
    this.transitionTo('close')
    this.closingRequested = true
    this.emitState()
    await this.finishClose()
  }

  private async finishClose(): Promise<void> {
    if (this.stateValue !== 'closing') return
    this.closingRequested = true
    await this.teardownTransport(false)
    if (this.stateValue === 'closing') {
      this.stateValue = 'closed'
      this.emitState()
    }
    this.openPromise = null
  }

  async dispose(): Promise<void> {
    if (this.disposing || this.disposed) return
    this.disposing = true
    this.stopRepeat()
    this.stopMacroWithReason('disposed')
    try {
      if (this.stateValue === 'open' || this.stateValue === 'opening') {
        await this.close().catch(() => {})
      } else if (this.stateValue === 'closing') {
        await this.openPromise?.catch(() => {})
        if (this.stateValue === 'closing') await this.finishClose()
      }
      await this.pendingTeardown.catch(() => {})
    } finally {
      this.disposeRuntime()
      this.resetLogPolicyRuntime()
      this.framer.dispose()
      this.entryBatcher.dispose()
      this.updateBatcher.dispose()
      this.statsBatcher.dispose()
      this.discardBatcher.dispose()
      this.disposed = true
      this.disposing = false
      for (const handler of [...this.disposeHandlers]) {
        try {
          handler()
        } catch {
          // Ignore broken dispose subscribers.
        }
      }
      try {
        this.onDisposeCallback?.(this)
      } catch {
        // The manager must not break disposal.
      }
      this.emitter.clear()
    }
  }

  private transitionTo(event: SessionEvent): void {
    this.stateValue = transition(this.stateValue, event)
  }

  /** Reads the state through a method so TypeScript does not over-narrow it. */
  private getState(): SessionState {
    return this.stateValue
  }

  private emitState(): void {
    this.emitter.emit('state', this.stateValue)
  }

  /* ----------------------------------------------------------------------- */
  /* Read loop                                                               */
  /* ----------------------------------------------------------------------- */

  private async readLoop(): Promise<void> {
    let fatal = false
    outer: while (this.stateValue === 'open' && !this.closingRequested) {
      const readable = this.transport.readable
      if (readable === null) break
      let reader: ReadableStreamDefaultReader<Uint8Array>
      try {
        reader = readable.getReader()
      } catch {
        break
      }
      this.reader = reader
      try {
        for (;;) {
          const result = await reader.read()
          if (result.done) break
          const value = result.value
          if (value !== undefined && value.length > 0) {
            this.handleRxChunk(value, this.now())
          }
        }
      } catch (error) {
        if (!this.closingRequested) {
          if (isRecoverableReadError(error)) {
            this.writeSystemLog('warn', `读取出错（${errorName(error)}），已继续。`)
            continue outer
          }
          fatal = true
          this.handleReadFailure(error)
          break outer
        }
      } finally {
        this.reader = null
        try {
          reader.releaseLock()
        } catch {
          // The reader may already be released.
        }
      }
      break
    }
    if (fatal) {
      this.pendingTeardown = this.cleanupAfterReadFailure()
      await this.pendingTeardown.catch(() => {})
    }
  }

  private handleRxChunk(chunk: Uint8Array, at: number): void {
    const bytes = Uint8Array.from(chunk)
    this.statsValue.rxBytes += bytes.length
    for (const handler of [...this.rawRxHandlers]) {
      try {
        handler(bytes)
      } catch {
        // A bridge consumer must not break the read loop.
      }
    }
    if (this.isProtocolActive()) {
      this.runtime?.feed(bytes, at)
    } else {
      this.framer.feed(bytes, at)
    }
    this.scheduleStats()
  }

  private handleFramedRx(bytes: Uint8Array, at: number): void {
    this.statsValue.rxFrames += 1
    this.appendEntry({
      at,
      dir: 'rx',
      level: 'info',
      bytes,
      text: this.rxDecoder.decode(bytes),
    })
    this.scheduleStats()
  }

  private handleReadFailure(error: unknown): void {
    if (this.stateValue !== 'open') return
    this.lastErrorValue = `读取失败：${errorMessage(error)}`
    this.stateValue = transition(this.stateValue, 'fatal')
    this.writeSystemLog('error', this.lastErrorValue)
    this.stopRepeat()
    this.stopMacroWithReason('not-open')
    this.emitState()
  }

  private async cleanupAfterReadFailure(): Promise<void> {
    this.closingRequested = true
    this.unsubscribeDisconnect?.()
    this.unsubscribeDisconnect = null
    this.disposeRuntime()
    this.releaseWriter()
    try {
      await this.transport.close()
    } catch {
      // Device may already be gone.
    }
    this.resetSignals()
    this.closingRequested = false
  }

  private handleDisconnect(): void {
    if (this.disposed || this.stateValue !== 'open') return
    this.lastErrorValue = DEVICE_DISCONNECTED_TEXT
    this.stateValue = transition(this.stateValue, 'disconnected')
    this.writeSystemLog('error', DEVICE_DISCONNECTED_TEXT)
    this.stopRepeat()
    this.stopMacroWithReason('not-open')
    this.emitState()
    this.closingRequested = true
    const reader = this.reader
    if (reader !== null) {
      void reader.cancel().catch(() => {})
    }
    this.pendingTeardown = this.cleanupAfterDisconnect()
  }

  private async cleanupAfterDisconnect(): Promise<void> {
    this.unsubscribeDisconnect?.()
    this.unsubscribeDisconnect = null
    this.disposeRuntime()
    try {
      await this.readLoopPromise
    } catch {
      // The read loop may have failed because the device vanished.
    }
    this.releaseWriter()
    try {
      await this.transport.close()
    } catch {
      // Already gone.
    }
    this.resetSignals()
    this.closingRequested = false
  }

  private isProtocolActive(): boolean {
    return (
      this.runtime !== null && this.protocolValue !== null && this.protocolValue.status === 'active'
    )
  }

  private resetReadPipeline(): void {
    this.framer.dispose()
    this.framer = this.createFramer()
    this.rxDecoder = createStreamDecoder(this.rxOptionsValue.encoding)
  }

  private createFramer(): RxFramer {
    return createRxFramer(this.rxOptionsValue, (bytes, at) => {
      this.handleFramedRx(bytes, at)
    })
  }

  /* ----------------------------------------------------------------------- */
  /* Write queue                                                             */
  /* ----------------------------------------------------------------------- */

  private writeChain: Promise<void> = Promise.resolve()

  send(bytes: Uint8Array, origin: Origin): Promise<void> {
    if (this.disposed) return Promise.reject(new Error('会话已释放'))
    if (this.stateValue !== 'open' || this.writer === null) {
      return Promise.reject(new IllegalStateError(this.stateValue, 'open', '通道未打开，无法发送'))
    }
    const snapshot = Uint8Array.from(bytes)
    const task = this.writeChain.then(() => this.writeNow(snapshot, origin))
    this.writeChain = task.then(
      () => undefined,
      () => undefined,
    )
    return task
  }

  private async writeNow(bytes: Uint8Array, origin: Origin): Promise<void> {
    const writer = this.writer
    if (writer === null || this.stateValue !== 'open') {
      throw new IllegalStateError(this.stateValue, 'open', '通道未打开，无法发送')
    }
    try {
      await writer.write(bytes)
    } catch (error) {
      const message = writeFailureText(error)
      this.writeSystemLog('error', message)
      this.stopRepeat()
      this.stopMacro()
      throw new Error(message)
    }
    this.statsValue.txBytes += bytes.length
    const entry = this.appendEntry({
      at: this.now(),
      dir: 'tx',
      level: 'info',
      bytes,
      text: this.decodeFreshText(bytes),
      origin,
    })
    if (this.isProtocolActive()) {
      this.pendingTxSeqs.push(entry.seq)
      this.runtime?.decodeTx(bytes, this.now())
    }
    this.scheduleStats()
  }

  async sendForm(values: Record<string, SendValue>): Promise<void> {
    if (!this.isProtocolActive() || this.runtime === null) {
      throw new IllegalStateError(this.stateValue, 'open', '当前会话没有可用的协议')
    }
    let bytes: Uint8Array
    try {
      bytes = await this.runtime.encode(values)
    } catch (error) {
      const message = protocolEncodeFailureText(error)
      this.writeSystemLog('error', message)
      throw new Error(message)
    }
    await this.send(bytes, 'protocol')
  }

  /* ----------------------------------------------------------------------- */
  /* Signals                                                                 */
  /* ----------------------------------------------------------------------- */

  async setSignals(signals: TransportSignals): Promise<void> {
    if (this.stateValue !== 'open') {
      throw new IllegalStateError(this.stateValue, 'open', '通道未打开，无法设置控制线')
    }
    const setter = this.transport.setSignals
    if (!this.transport.capabilities.signals || setter === undefined) {
      throw new Error('该通道不支持控制线')
    }
    if (signals.brk !== undefined && !this.transport.capabilities.break) {
      throw new Error('该通道不支持 Break 控制')
    }
    try {
      await setter.call(this.transport, signals)
    } catch (error) {
      const message = `设置控制线失败：${errorMessage(error)}`
      this.writeSystemLog('error', message)
      throw new Error(message)
    }
    if (signals.dtr !== undefined) this.signalsValue.dtr = signals.dtr
    if (signals.rts !== undefined) this.signalsValue.rts = signals.rts
    this.emitter.emit('signals', this.signals)
  }

  private resetSignals(): void {
    this.signalsValue = { dtr: null, rts: null }
    this.emitter.emit('signals', this.signals)
  }

  /* ----------------------------------------------------------------------- */
  /* Settings                                                                */
  /* ----------------------------------------------------------------------- */

  updateSettings(patch: Record<string, unknown>): void {
    if (this.stateValue !== 'idle' && this.stateValue !== 'closed' && this.stateValue !== 'error') {
      throw new IllegalStateError(this.stateValue, 'close', '当前状态不允许修改连接参数')
    }
    this.settingsValue = Object.freeze({ ...this.settingsValue, ...patch })
    this.emitter.emit('settings', this.settingsValue)
  }

  stageSettings(patch: Record<string, unknown>): void {
    this.settingsValue = Object.freeze({ ...this.settingsValue, ...patch })
    this.emitter.emit('settings', this.settingsValue)
  }

  private persistDeviceMemory(): void {
    if (this.memory === undefined) return
    if (this.transport.deviceKey.length === 0) return
    this.memory.save({
      deviceKey: this.transport.deviceKey,
      settings: { ...this.settingsValue },
      protocolId: this.protocolValue?.id ?? null,
      rxOptions: { ...this.rxOptionsValue },
      displayMode: this.displayModeValue,
      updatedAt: this.now(),
    })
  }

  /* ----------------------------------------------------------------------- */
  /* Protocol                                                                */
  /* ----------------------------------------------------------------------- */

  async setProtocol(id: string | null): Promise<void> {
    const task = this.loadProtocol(id)
    this.protocolTask = task
    await task
  }

  private async loadProtocol(id: string | null): Promise<void> {
    this.disposeRuntime()
    this.pendingTxSeqs = []
    this.rxDecoder = createStreamDecoder(this.rxOptionsValue.encoding)
    this.discardBatcher.clear()
    this.resetLogPolicyRuntime()
    const generation = (this.protocolGeneration += 1)

    if (id === null) {
      this.protocolValue = null
      this.emitter.emit('protocol', null)
      this.persistDeviceMemory()
      return
    }

    try {
      const record = await getProtocolRepository().get(id)
      if (record === undefined) throw new Error(`协议不存在：${id}`)
      const runtime = await (this.createRuntime
        ? this.createRuntime(record.code)
        : createProtocolRuntime(record.code))
      if (this.disposed || generation !== this.protocolGeneration) {
        runtime.dispose()
        return
      }
      this.runtime = runtime
      const info = runtime.info
      const protocol: SessionProtocol = {
        id,
        name: info.meta.name,
        status: 'active',
      }
      if (info.sendForm !== undefined) protocol.sendForm = info.sendForm.fields
      this.protocolValue = protocol
      this.attachRuntime(runtime)
      this.emitter.emit('protocol', protocol)
      this.persistDeviceMemory()
    } catch (error) {
      if (this.disposed || generation !== this.protocolGeneration) return
      this.runtime = null
      this.protocolValue = null
      this.writeSystemLog('error', protocolLoadFailureText(error))
      this.emitter.emit('protocol', null)
    }
  }

  private attachRuntime(runtime: ProtocolRuntime): void {
    runtime.on('frames', (frames) => {
      if (runtime !== this.runtime) return
      this.handleProtocolFrames(frames)
    })
    runtime.on('discard', (event) => {
      if (runtime !== this.runtime) return
      this.handleDiscard(event)
    })
    runtime.on('fatal', (event) => {
      if (runtime !== this.runtime) return
      this.handleProtocolFatal(event.reason)
    })
    runtime.on('log', (event) => {
      if (runtime !== this.runtime) return
      if (event.level === 'log') return
      this.writeSystemLog(event.level === 'warn' ? 'warn' : 'error', `协议：${event.text}`)
    })
  }

  private async ensureProtocolRuntime(): Promise<void> {
    const protocol = this.protocolValue
    if (protocol === null || this.runtime !== null || protocol.status === 'disabled') return
    await this.loadProtocol(protocol.id)
  }

  private disposeRuntime(): void {
    const runtime = this.runtime
    this.runtime = null
    if (runtime !== null) runtime.dispose()
  }

  private handleProtocolFrames(frames: ProtocolFrame[]): void {
    const protocol = this.protocolValue
    if (protocol === null) return
    const decodedFrames: DecodedFrame[] = []
    for (const frame of frames) {
      decodedFrames.push(this.toDecodedFrame(frame))
      this.trackDecodedFrame()
      if (frame.direction === 'tx') {
        const seq = this.pendingTxSeqs.shift()
        if (seq === undefined) continue
        const decoded: LogDecoded = {
          protocolId: protocol.id,
          protocolName: protocol.name,
          results: frame.results,
        }
        if (frame.error !== undefined) decoded.error = frame.error
        if (this.logStore.update(seq, { decoded })) this.updateBatcher.push(seq)
        if (frame.error !== undefined) this.recordDecodeError(frame.error)
        continue
      }
      this.statsValue.rxFrames += 1
      if (this.shouldLogRxFrame(frame)) {
        this.appendEntry({
          at: frame.at,
          dir: 'rx',
          level: this.isErrorFrame(frame) ? 'error' : 'info',
          bytes: frame.bytes,
          text: this.decodeFreshText(frame.bytes),
          decoded: this.toLogDecoded(protocol, frame),
        })
      }
      if (frame.error !== undefined) this.recordDecodeError(frame.error)
    }
    this.scheduleStats()
    if (decodedFrames.length > 0) this.emitter.emit('frames', decodedFrames)
  }

  private toDecodedFrame(frame: ProtocolFrame): DecodedFrame {
    const decoded: DecodedFrame = {
      seq: this.nextFrameSeq,
      bytes: frame.bytes,
      at: frame.at,
      direction: frame.direction,
      results: frame.results,
    }
    if (frame.error !== undefined) decoded.error = frame.error
    this.nextFrameSeq += 1
    return decoded
  }

  private toLogDecoded(protocol: SessionProtocol, frame: ProtocolFrame): LogDecoded {
    const decoded: LogDecoded = {
      protocolId: protocol.id,
      protocolName: protocol.name,
      results: frame.results,
    }
    if (frame.error !== undefined) decoded.error = frame.error
    return decoded
  }

  private isErrorFrame(frame: ProtocolFrame): boolean {
    if (frame.error !== undefined) return true
    return frame.results.some((result) => result.level === 'error')
  }

  /** Error frames bypass the policy; other decoded frames follow it (plan §6.6). */
  private shouldLogRxFrame(frame: ProtocolFrame): boolean {
    if (this.isErrorFrame(frame)) return true
    switch (this.logPolicyValue.mode) {
      case 'all':
        return true
      case 'none':
        return false
      case 'sampled':
      default:
        return this.takeSampleSlot()
    }
  }

  /**
   * One entry per time slice: the second is split into `maxPerSecond` equal
   * slices and only the first frame of each unused slice is logged.
   */
  private takeSampleSlot(): boolean {
    const now = this.now()
    const second = Math.floor(now / 1000)
    if (second !== this.sampledSecond) {
      this.flushOmittedFrames()
      this.sampledSecond = second
      this.sampledSlices.clear()
      this.scheduleOmittedFlush(now)
    }
    const slices = this.logPolicyValue.maxPerSecond
    const raw = Math.floor(((now % 1000) / 1000) * slices)
    const slice = Math.min(slices - 1, Math.max(0, raw))
    if (this.sampledSlices.has(slice)) {
      this.omittedFrames += 1
      return false
    }
    this.sampledSlices.add(slice)
    return true
  }

  private scheduleOmittedFlush(now: number): void {
    this.cancelOmittedFlush()
    const delay = 1000 - (now % 1000)
    this.omittedTimer = setTimeout(() => {
      this.omittedTimer = null
      this.flushOmittedFrames()
    }, delay)
  }

  private cancelOmittedFlush(): void {
    if (this.omittedTimer === null) return
    clearTimeout(this.omittedTimer)
    this.omittedTimer = null
  }

  private flushOmittedFrames(): void {
    const omitted = this.omittedFrames
    this.omittedFrames = 0
    if (omitted <= 0) return
    this.writeSystemLog('info', omittedFramesText(omitted))
  }

  /**
   * Tracks the decoded frame rate for the `auto` policy: two consecutive
   * seconds above the threshold switch `all` to `sampled`.
   */
  private trackDecodedFrame(): void {
    if (!this.logPolicyValue.auto || this.logPolicyValue.mode !== 'all') return
    const second = Math.floor(this.now() / 1000)
    if (second !== this.rateSecond) {
      if (this.rateSecond >= 0 && second === this.rateSecond + 1) {
        if (this.rateFrames > AUTO_SAMPLE_THRESHOLD_FPS) {
          this.highRateSeconds += 1
          if (this.highRateSeconds >= AUTO_SAMPLE_SECONDS) {
            this.switchToSampled(this.rateFrames)
          }
        } else {
          this.highRateSeconds = 0
        }
      } else {
        this.highRateSeconds = 0
      }
      this.rateSecond = second
      this.rateFrames = 0
    }
    this.rateFrames += 1
  }

  private switchToSampled(framesPerSecond: number): void {
    this.logPolicyValue = { ...this.logPolicyValue, mode: 'sampled' }
    this.resetLogPolicyRuntime()
    this.emitter.emit('logPolicy', this.logPolicy)
    this.writeSystemLog('warn', autoSampledText(framesPerSecond))
  }

  /** Clears the per-second counters of the log policy (mode change, close, …). */
  private resetLogPolicyRuntime(): void {
    this.cancelOmittedFlush()
    this.omittedFrames = 0
    this.sampledSecond = -1
    this.sampledSlices.clear()
    this.rateSecond = -1
    this.rateFrames = 0
    this.highRateSeconds = 0
  }

  private handleDiscard(event: ProtocolDiscardEvent): void {
    this.statsValue.droppedBytes += event.bytes.length
    if (event.reason === 'overflow') {
      this.protocolOverflowBytesValue += event.bytes.length
    }
    this.discardBatcher.push({ bytes: Uint8Array.from(event.bytes), at: event.at })
    this.scheduleStats()
  }

  private flushDiscard(items: PendingDiscard[]): void {
    if (items.length === 0) return
    const bytes = concatChunks(items.map((item) => item.bytes))
    const at = items[items.length - 1]?.at ?? this.now()
    const protocol = this.protocolValue
    const decoded: LogDecoded = {
      protocolId: protocol?.id ?? '',
      protocolName: protocol?.name ?? '',
      results: [],
      error: '未成帧数据',
      unframed: true,
    }
    this.appendEntry({
      at,
      dir: 'rx',
      level: 'warn',
      bytes,
      text: this.decodeFreshText(bytes),
      decoded,
    })
    this.scheduleStats()
  }

  private recordDecodeError(message: string): void {
    this.statsValue.decodeErrors += 1
    const now = this.now()
    if (now - this.decodeErrorAt >= 1000) {
      this.decodeErrorAt = now
      const suffix =
        this.decodeErrorSuppressed > 0 ? `（另有 ${this.decodeErrorSuppressed} 条同类错误）` : ''
      this.decodeErrorSuppressed = 0
      this.writeSystemLog('error', `${decodeErrorText(message)}${suffix}`)
      return
    }
    this.decodeErrorSuppressed += 1
  }

  private handleProtocolFatal(reason: string): void {
    const protocol = this.protocolValue
    if (protocol !== null) {
      this.protocolValue = { ...protocol, status: 'disabled', error: reason }
      this.emitter.emit('protocol', this.protocolValue)
    }
    this.runtime?.dispose()
    this.runtime = null
    this.pendingTxSeqs = []
    this.writeSystemLog('error', protocolTimeoutText())
  }

  /* ----------------------------------------------------------------------- */
  /* Repeat and macro tasks                                                  */
  /* ----------------------------------------------------------------------- */

  startRepeat(options: RepeatOptions): void {
    this.stopRepeat()
    const runner = createRepeatRunner({
      send: (bytes) => this.send(bytes, 'repeat'),
      isActive: () => this.stateValue === 'open',
      onStatus: () => {
        this.emitTasks()
      },
      onStop: () => {
        this.repeatRunner = null
        this.emitTasks()
      },
    })
    try {
      runner.start(options)
    } catch (error) {
      this.emitTasks()
      throw error
    }
    this.repeatRunner = runner
    this.emitTasks()
  }

  stopRepeat(): void {
    const runner = this.repeatRunner
    if (runner === null) return
    this.repeatRunner = null
    runner.stop()
    this.emitTasks()
  }

  startMacro(macro: Macro): void {
    this.stopMacro()
    const runner = createMacroRunner({
      send: (bytes) => this.send(bytes, 'macro'),
      setSignals: (signals) => this.setSignals(signals),
      signalsSupported: () =>
        this.transport.capabilities.signals && typeof this.transport.setSignals === 'function',
      isActive: () => this.stateValue === 'open',
      onStatus: () => {
        this.emitTasks()
      },
      onStop: (reason) => {
        this.macroRunner = null
        this.writeMacroStopLog(macro.name, reason)
        this.emitTasks()
      },
    })
    try {
      runner.start(macro)
    } catch (error) {
      const message = `宏「${macro.name}」启动失败：${errorMessage(error)}`
      this.writeSystemLog('error', message)
      this.emitTasks()
      throw new Error(message)
    }
    this.macroRunner = runner
    this.writeSystemLog('info', `宏「${macro.name}」开始运行`)
    this.emitTasks()
  }

  stopMacro(): void {
    this.stopMacroWithReason('user')
  }

  private stopMacroWithReason(reason: MacroStopReason): void {
    const runner = this.macroRunner
    if (runner === null) return
    this.macroRunner = null
    runner.stop(reason)
    this.emitTasks()
  }

  private writeMacroStopLog(name: string, reason: MacroStopReason): void {
    switch (reason) {
      case 'finished':
        this.writeSystemLog('info', `宏「${name}」运行结束`)
        return
      case 'user':
        this.writeSystemLog('info', `宏「${name}」已停止`)
        return
      case 'write-error':
        this.writeSystemLog('error', `宏「${name}」已停止：发送失败`)
        return
      case 'not-open':
        this.writeSystemLog('error', `宏「${name}」已停止：通道已断开`)
        return
      case 'signal-unsupported':
        this.writeSystemLog('error', `宏「${name}」已停止：该通道不支持控制线`)
        return
      case 'disposed':
        return
      default:
        return
    }
  }

  private emitTasks(): void {
    this.emitter.emit('tasks', this.tasks)
  }

  /* ----------------------------------------------------------------------- */
  /* Log helpers                                                             */
  /* ----------------------------------------------------------------------- */

  private appendEntry(partial: Omit<LogEntry, 'seq'>): LogEntry {
    const draft: LogEntry = { ...partial, seq: 0 }
    this.logStore.append([draft])
    const stored = this.logStore.get(this.logStore.lastSeq)
    const entry = stored ?? draft
    this.entryBatcher.push(entry)
    return entry
  }

  private decodeFreshText(bytes: Uint8Array): string {
    const decoder = createStreamDecoder(this.rxOptionsValue.encoding)
    return decoder.decode(bytes) + decoder.flush()
  }

  private scheduleStats(): void {
    this.statsBatcher.push(1)
  }

  private releaseWriter(): void {
    const writer = this.writer
    this.writer = null
    if (writer === null) return
    try {
      writer.releaseLock()
    } catch {
      // The stream may already be errored; nothing else to do.
    }
    this.writeChain = Promise.resolve()
  }

  private async teardownTransport(skipReadLoop: boolean): Promise<void> {
    this.closingRequested = true
    this.unsubscribeDisconnect?.()
    this.unsubscribeDisconnect = null
    this.stopRepeat()
    this.stopMacro()
    this.disposeRuntime()
    this.resetLogPolicyRuntime()
    this.discardBatcher.clear()
    this.framer.reset()
    this.rxDecoder = createStreamDecoder(this.rxOptionsValue.encoding)
    if (!skipReadLoop) {
      const reader = this.reader
      if (reader !== null) {
        try {
          await reader.cancel()
        } catch {
          // Cancel is best effort.
        }
      }
      try {
        await this.readLoopPromise
      } catch {
        // Read failures are already reported.
      }
    }
    this.releaseWriter()
    this.readLoopPromise = null
    try {
      await this.transport.close()
    } catch {
      // Closing an already closed transport is fine.
    }
    this.resetSignals()
    this.closingRequested = false
  }
}
