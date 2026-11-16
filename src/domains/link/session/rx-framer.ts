/**
 * Main-thread framing for sessions without a protocol (plan §6.6).
 *
 * Three modes share a 4096 byte maximum: `line` splits on LF and flushes a
 * partial line after `idleMs`, `idle` only flushes after silence, `chunk` emits
 * every read block.
 */

import type { TextEncodingName } from '../../bytes/public'

/** Maximum size of one emitted frame. */
export const RX_MAX_FRAME_BYTES = 4096

/** How received bytes are split into log entries when no protocol is active. */
export interface RxOptions {
  framing: 'line' | 'idle' | 'chunk'
  idleMs: number
  encoding: TextEncodingName
}

/** Defaults from plan §6.6. */
export const DEFAULT_RX_OPTIONS: RxOptions = {
  framing: 'line',
  idleMs: 20,
  encoding: 'utf-8',
}

const ENCODINGS: readonly TextEncodingName[] = ['utf-8', 'ascii', 'latin1', 'gbk']
const FRAMINGS: readonly RxOptions['framing'][] = ['line', 'idle', 'chunk']
const LF = 0x0a

export type RxFrameHandler = (bytes: Uint8Array, at: number) => void

export interface RxFramer {
  feed(chunk: Uint8Array, at: number): void
  /** Emits buffered bytes immediately (used when closing). */
  flush(at?: number): void
  reset(): void
  dispose(): void
}

function isEncoding(value: unknown): value is TextEncodingName {
  return typeof value === 'string' && (ENCODINGS as readonly string[]).includes(value)
}

function isFraming(value: unknown): value is RxOptions['framing'] {
  return typeof value === 'string' && (FRAMINGS as readonly string[]).includes(value)
}

/** Fills missing/invalid fields with the defaults. */
export function normalizeRxOptions(input: Partial<RxOptions> = {}): RxOptions {
  const idleMs =
    typeof input.idleMs === 'number' && Number.isFinite(input.idleMs)
      ? Math.min(1000, Math.max(1, Math.round(input.idleMs)))
      : DEFAULT_RX_OPTIONS.idleMs
  return {
    framing: isFraming(input.framing) ? input.framing : DEFAULT_RX_OPTIONS.framing,
    idleMs,
    encoding: isEncoding(input.encoding) ? input.encoding : DEFAULT_RX_OPTIONS.encoding,
  }
}

/**
 * Creates the framer. `onFrame` is called synchronously from `feed`/`flush`, or
 * from the idle timer for buffered modes.
 */
export function createRxFramer(options: RxOptions, onFrame: RxFrameHandler): RxFramer {
  const settings = normalizeRxOptions(options)
  let buffer: number[] = []
  let timer: ReturnType<typeof setTimeout> | null = null

  function cancelTimer(): void {
    if (timer === null) return
    clearTimeout(timer)
    timer = null
  }

  function emitAll(at: number): void {
    if (buffer.length === 0) return
    const bytes = Uint8Array.from(buffer)
    buffer = []
    onFrame(bytes, at)
  }

  function emitFront(count: number, at: number): void {
    if (count <= 0) return
    const bytes = Uint8Array.from(buffer.slice(0, count))
    buffer = buffer.slice(count)
    onFrame(bytes, at)
  }

  function enforceMax(at: number): void {
    while (buffer.length > RX_MAX_FRAME_BYTES) emitFront(RX_MAX_FRAME_BYTES, at)
  }

  function scheduleIdle(): void {
    cancelTimer()
    timer = setTimeout(() => {
      timer = null
      emitAll(Date.now())
    }, settings.idleMs)
  }

  function feedBuffered(chunk: Uint8Array, at: number): void {
    for (const byte of chunk) buffer.push(byte)
    if (settings.framing === 'line') {
      for (;;) {
        const index = buffer.indexOf(LF)
        if (index < 0) break
        emitFront(index, at)
        // `emitFront` already removed the content; now drop the LF itself.
        buffer = buffer.slice(1)
      }
    }
    enforceMax(at)
    scheduleIdle()
  }

  return {
    feed(chunk, at) {
      if (chunk.length === 0) return
      if (settings.framing === 'chunk') {
        let offset = 0
        while (offset < chunk.length) {
          const end = Math.min(offset + RX_MAX_FRAME_BYTES, chunk.length)
          onFrame(Uint8Array.from(chunk.subarray(offset, end)), at)
          offset = end
        }
        return
      }
      feedBuffered(chunk, at)
    },
    flush(at = Date.now()) {
      cancelTimer()
      enforceMax(at)
      emitAll(at)
    },
    reset() {
      cancelTimer()
      buffer = []
    },
    dispose() {
      cancelTimer()
      buffer = []
    },
  }
}
