/**
 * Log export (plan §8.4 / task spec): TXT, CSV and BIN.
 *
 * Pure functions take the log snapshot and options and return
 * `{ fileName, mimeType, data }`; the tool layer performs the actual download.
 */

import { encodeText, toHex, type TextEncodingName } from '../../bytes/public'
import type { DisplayMode } from '../session/state'
import type { LogEntry } from './buffer'

export type ExportFormat = 'txt' | 'csv' | 'bin'

export interface ExportLogOptions {
  format: ExportFormat
  /** Used in the file name. */
  sessionName: string
  /** Default `'both'`. */
  displayMode?: DisplayMode
  /** How raw bytes are rendered in TXT; default `'text'`. */
  viewAs?: 'text' | 'hex'
  /** Encoding used for bytes whose entry has no text; default `'utf-8'`. */
  encoding?: TextEncodingName
  showTimestamp?: boolean
  showTx?: boolean
  showSystem?: boolean
  /** False hides bridge entries (`origin = 'bridge'`). */
  showBridge?: boolean
  /** Injectable clock for deterministic file names; defaults to `Date.now`. */
  now?: () => number
}

export interface ExportLogFile {
  fileName: string
  mimeType: string
  data: Uint8Array
}

const MIME_TYPES: Record<ExportFormat, string> = {
  txt: 'text/plain;charset=utf-8',
  csv: 'text/csv;charset=utf-8',
  bin: 'application/octet-stream',
}

const CSV_COLUMNS = ['time', 'dir', 'origin', 'level', 'hex', 'text', 'summary', 'fields'] as const

function pad(value: number, length = 2): string {
  return String(value).padStart(length, '0')
}

/** `YYYY-MM-DD HH:mm:ss.SSS` in local time. */
export function formatExportTime(at: number): string {
  const date = new Date(at)
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(
    date.getHours(),
  )}:${pad(date.getMinutes())}:${pad(date.getSeconds())}.${pad(date.getMilliseconds(), 3)}`
}

/** `YYYYMMDD-HHmmss` used inside the exported file name. */
export function formatFileNameTime(at: number): string {
  const date = new Date(at)
  return `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}-${pad(
    date.getHours(),
  )}${pad(date.getMinutes())}${pad(date.getSeconds())}`
}

function sanitizeFileName(name: string): string {
  const cleaned = name
    .replace(/[\\/:*?"<>|]/g, '_')
    .replace(/[\u0000-\u001f\u007f]/g, '_')
    .trim()
  return cleaned.length > 0 ? cleaned : '会话'
}

function extensionOf(format: ExportFormat): string {
  return format
}

/** Builds `<会话名>_<YYYYMMDD-HHmmss>.<ext>`. */
export function exportLogFileName(sessionName: string, format: ExportFormat, at: number): string {
  return `${sanitizeFileName(sessionName)}_${formatFileNameTime(at)}.${extensionOf(format)}`
}

function escapeText(text: string): string {
  let result = ''
  for (const char of text) {
    const code = char.codePointAt(0) as number
    if (char === '\r') result += '\\r'
    else if (char === '\n') result += '\\n'
    else if (char === '\t') result += '\\t'
    else if (code < 0x20 || code === 0x7f)
      result += `\\x${code.toString(16).padStart(2, '0').toUpperCase()}`
    else result += char
  }
  return result
}

function decodedSummary(entry: LogEntry): string {
  const decoded = entry.decoded
  if (decoded === undefined) return ''
  if (decoded.results.length > 0) return decoded.results.map((result) => result.summary).join(' | ')
  if (decoded.unframed) return '未成帧数据'
  return decoded.error ?? ''
}

function rawContent(entry: LogEntry, viewAs: 'text' | 'hex'): string {
  if (entry.dir === 'system') return entry.text
  return viewAs === 'hex' ? toHex(entry.bytes) : escapeText(entry.text)
}

function displayContent(entry: LogEntry, options: ExportLogOptions): string {
  const viewAs = options.viewAs ?? 'text'
  const mode = options.displayMode ?? 'both'
  if (entry.dir === 'system' || mode === 'raw') return rawContent(entry, viewAs)
  const summary = decodedSummary(entry)
  if (mode === 'decoded') return summary.length > 0 ? summary : rawContent(entry, viewAs)
  return summary.length > 0
    ? `${rawContent(entry, viewAs)} | ${summary}`
    : rawContent(entry, viewAs)
}

function directionLabel(entry: LogEntry): string {
  if (entry.dir === 'rx') return 'RX'
  if (entry.dir === 'tx') return 'TX'
  return 'SYS'
}

function filterEntries(entries: LogEntry[], options: ExportLogOptions): LogEntry[] {
  const showTx = options.showTx ?? true
  const showSystem = options.showSystem ?? true
  const showBridge = options.showBridge ?? true
  return entries.filter((entry) => {
    if (!showTx && entry.dir === 'tx') return false
    if (!showSystem && entry.dir === 'system') return false
    if (!showBridge && entry.origin === 'bridge') return false
    return true
  })
}

function csvEscape(value: string): string {
  if (/[",\n\r]/.test(value)) return `"${value.replace(/"/g, '""')}"`
  return value
}

function decodedFieldsJson(entry: LogEntry): string {
  const decoded = entry.decoded
  if (decoded === undefined) return ''
  const fields: Array<{ label: string; value: string | number | boolean; unit?: string }> = []
  for (const result of decoded.results) {
    if (result.fields === undefined) continue
    for (const field of result.fields) {
      fields.push({
        label: field.label,
        value: field.value,
        ...(field.unit === undefined ? {} : { unit: field.unit }),
      })
    }
  }
  return fields.length === 0 ? '' : JSON.stringify(fields)
}

function buildTxt(entries: LogEntry[], options: ExportLogOptions): string {
  const showTimestamp = options.showTimestamp ?? true
  const lines = entries.map((entry) => {
    const content = displayContent(entry, options)
    const prefix = showTimestamp ? `${formatExportTime(entry.at)} ` : ''
    return `${prefix}${directionLabel(entry)} ${content}`
  })
  return lines.length === 0 ? '' : `${lines.join('\n')}\n`
}

function buildCsv(entries: LogEntry[], options: ExportLogOptions): string {
  const lines = [CSV_COLUMNS.join(',')]
  for (const entry of entries) {
    const hex = entry.dir === 'system' ? '' : toHex(entry.bytes)
    const text = escapeText(entry.text)
    const summary = decodedSummary(entry)
    const fields = decodedFieldsJson(entry)
    lines.push(
      [
        csvEscape(formatExportTime(entry.at)),
        entry.dir,
        csvEscape(entry.origin ?? ''),
        entry.level,
        csvEscape(hex),
        csvEscape(text),
        csvEscape(summary),
        csvEscape(fields),
      ].join(','),
    )
  }
  return `${lines.join('\r\n')}\r\n`
}

function buildBin(entries: LogEntry[]): Uint8Array {
  const chunks = entries.filter((entry) => entry.dir === 'rx').map((entry) => entry.bytes)
  const total = chunks.reduce((sum, chunk) => sum + chunk.length, 0)
  const data = new Uint8Array(total)
  let offset = 0
  for (const chunk of chunks) {
    data.set(chunk, offset)
    offset += chunk.length
  }
  return data
}

/**
 * Renders one log snapshot into the export file payload.
 *
 * TXT rows are `YYYY-MM-DD HH:mm:ss.SSS DIR content`, CSV starts with a UTF-8 BOM
 * (columns `time,dir,origin,level,hex,text,summary,fields`) and BIN concatenates
 * the raw bytes of all RX entries.
 */
export function exportLog(entries: LogEntry[], options: ExportLogOptions): ExportLogFile {
  const selected = filterEntries(entries, options)
  const at = (options.now ?? Date.now)()
  const fileName = exportLogFileName(options.sessionName, options.format, at)

  if (options.format === 'bin') {
    return { fileName, mimeType: MIME_TYPES.bin, data: buildBin(selected) }
  }
  const text =
    options.format === 'csv' ? `\uFEFF${buildCsv(selected, options)}` : buildTxt(selected, options)
  const encoded = encodeText(text, 'utf-8')
  return {
    fileName,
    mimeType: MIME_TYPES[options.format],
    data: encoded.ok ? encoded.bytes : new Uint8Array(0),
  }
}
