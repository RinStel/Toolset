/**
 * In-memory log buffer (plan §6.6).
 *
 * Entries are kept in seq order; callers append objects whose `seq` is assigned
 * by the buffer (`1`, `2`, …). Both a count and an estimated byte budget limit
 * the buffer; the oldest entries are evicted first.
 */

import type { DecodeResult } from '../../protocol/public'
import type { Origin } from '../session/state'

/** Decoded protocol information attached to one rx/tx entry. */
export interface LogDecoded {
  protocolId: string
  protocolName: string
  results: DecodeResult[]
  /** Decoding error of that frame; the entry is still kept. */
  error?: string
  /** True for discarded/unframed bytes. */
  unframed?: boolean
}

/** One log line. */
export interface LogEntry {
  /** Monotonic per session, starting at 1. */
  seq: number
  at: number
  dir: 'rx' | 'tx' | 'system'
  level: 'info' | 'warn' | 'error'
  /** Empty for system entries. */
  bytes: Uint8Array
  /** Decoded display text (rx/tx) or the message (system). */
  text: string
  origin?: Origin
  decoded?: LogDecoded
}

/** Payload of the session `entries` event. */
export interface LogEntriesEvent {
  /** Newly appended entries, ascending seq. */
  added: LogEntry[]
  /** Seqs of existing entries whose `decoded` field was backfilled. */
  updated?: number[]
}

/** Limits applied to a log buffer. */
export interface LogBufferOptions {
  maxEntries: number
  maxBytes: number
}

/** See plan §6.6. */
export interface LogBuffer {
  maxEntries: number
  maxBytes: number
  /** Assigns seqs and appends entries; evicts old ones when over budget. */
  append(entries: LogEntry[]): void
  /** Entries with `seq >= fromSeq`, ascending, at most `limit`. */
  range(fromSeq: number, limit: number): LogEntry[]
  /** The newest `limit` entries, ascending by seq. */
  tail(limit: number): LogEntry[]
  /** Scans from newest to oldest, returns matching entries (newest first). */
  search(predicate: (entry: LogEntry) => boolean, limit: number): LogEntry[]
  snapshot(): LogEntry[]
  clear(): void
  readonly size: number
  readonly bytes: number
  readonly firstSeq: number
  readonly lastSeq: number
}

/** Estimated bytes of one entry: payload + text (UTF-16) + fixed overhead. */
export function estimateEntryBytes(entry: Pick<LogEntry, 'bytes' | 'text'>): number {
  return entry.bytes.length + entry.text.length * 2 + 128
}

/** Concrete implementation with a few extras used by the session layer. */
export class LogBufferImpl implements LogBuffer {
  private entriesList: LogEntry[] = []
  private bytesUsed = 0
  private nextSeqValue = 1
  private maxEntriesValue: number
  private maxBytesValue: number

  constructor(options: LogBufferOptions) {
    this.maxEntriesValue = Math.max(1, Math.floor(options.maxEntries))
    this.maxBytesValue = Math.max(1, Math.floor(options.maxBytes))
  }

  get maxEntries(): number {
    return this.maxEntriesValue
  }

  set maxEntries(value: number) {
    this.maxEntriesValue = Math.max(1, Math.floor(value))
    this.trim()
  }

  get maxBytes(): number {
    return this.maxBytesValue
  }

  set maxBytes(value: number) {
    this.maxBytesValue = Math.max(1, Math.floor(value))
    this.trim()
  }

  get size(): number {
    return this.entriesList.length
  }

  get bytes(): number {
    return this.bytesUsed
  }

  get firstSeq(): number {
    return this.entriesList[0]?.seq ?? 0
  }

  get lastSeq(): number {
    return this.entriesList[this.entriesList.length - 1]?.seq ?? 0
  }

  append(items: LogEntry[]): void {
    if (items.length === 0) return
    for (const item of items) {
      const entry: LogEntry = { ...item, seq: this.nextSeqValue }
      this.nextSeqValue += 1
      this.entriesList.push(entry)
      this.bytesUsed += estimateEntryBytes(entry)
    }
    this.trim()
  }

  range(fromSeq: number, limit: number): LogEntry[] {
    if (limit <= 0 || this.entriesList.length === 0) return []
    const first = this.firstSeq
    const start = Math.max(0, fromSeq - first)
    if (start >= this.entriesList.length) return []
    return this.entriesList.slice(start, start + limit)
  }

  tail(limit: number): LogEntry[] {
    if (limit <= 0) return []
    if (limit >= this.entriesList.length) return this.entriesList.slice()
    return this.entriesList.slice(this.entriesList.length - limit)
  }

  search(predicate: (entry: LogEntry) => boolean, limit: number): LogEntry[] {
    const result: LogEntry[] = []
    if (limit <= 0) return result
    for (let index = this.entriesList.length - 1; index >= 0; index -= 1) {
      const entry = this.entriesList[index] as LogEntry
      if (!predicate(entry)) continue
      result.push(entry)
      if (result.length >= limit) break
    }
    return result
  }

  snapshot(): LogEntry[] {
    return this.entriesList.slice()
  }

  clear(): void {
    this.entriesList = []
    this.bytesUsed = 0
    this.nextSeqValue = 1
  }

  /** Returns the entry with `seq`, if it is still buffered. */
  get(seq: number): LogEntry | undefined {
    return this.entriesList[seq - this.firstSeq]
  }

  /**
   * Backfills fields of an existing entry (used for `decoded` after decodeTx).
   * The entry object is mutated in place so subscribers keep their references.
   */
  update(seq: number, patch: Partial<Pick<LogEntry, 'decoded' | 'level' | 'text'>>): boolean {
    const entry = this.get(seq)
    if (entry === undefined) return false
    const previousBytes = estimateEntryBytes(entry)
    Object.assign(entry, patch)
    const nextBytes = estimateEntryBytes(entry)
    this.bytesUsed += nextBytes - previousBytes
    this.trim()
    return true
  }

  private trim(): void {
    while (
      this.entriesList.length > 0 &&
      (this.entriesList.length > this.maxEntriesValue || this.bytesUsed > this.maxBytesValue)
    ) {
      const removedEntry = this.entriesList.shift()
      if (removedEntry === undefined) break
      this.bytesUsed -= estimateEntryBytes(removedEntry)
    }
    if (this.bytesUsed < 0) this.bytesUsed = 0
  }
}

/** Creates a log buffer with the given limits. */
export function createLogBuffer(options: LogBufferOptions): LogBufferImpl {
  return new LogBufferImpl(options)
}
