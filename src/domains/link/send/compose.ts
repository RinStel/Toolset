/**
 * Frame composition for manual/quick/macro sending (plan §6.6).
 *
 * Order: content bytes → checksum over `content[checksumSkip..]` appended at the
 * end → end-of-line bytes.
 */

import {
  checksum,
  checksumWidth,
  encodeText,
  parseHex,
  type ChecksumKind,
  type TextEncodingName,
} from '../../bytes/public'

/** How many leading bytes are excluded from the checksum. */
export const DEFAULT_CHECKSUM_SKIP = 0

/** See plan §6.6. */
export interface ComposeOptions {
  mode: 'text' | 'hex'
  encoding: TextEncodingName
  eol: 'none' | 'cr' | 'lf' | 'crlf'
  checksum: 'none' | ChecksumKind
  /** Only meaningful for 16 bit checksums. */
  checksumEndian: 'le' | 'be'
  checksumSkip: number
}

export type ComposeResult =
  { ok: true; bytes: Uint8Array } | { ok: false; error: string; index?: number }

/** Defaults used by new sessions and quick-send entries. */
export const DEFAULT_COMPOSE_OPTIONS: ComposeOptions = {
  mode: 'text',
  encoding: 'utf-8',
  eol: 'none',
  checksum: 'none',
  checksumEndian: 'le',
  checksumSkip: DEFAULT_CHECKSUM_SKIP,
}

/** Returns a mutable copy of the defaults. */
export function defaultComposeOptions(): ComposeOptions {
  return { ...DEFAULT_COMPOSE_OPTIONS }
}

const EOL_VALUES: readonly ComposeOptions['eol'][] = ['none', 'cr', 'lf', 'crlf']
const CHECKSUM_VALUES: readonly ComposeOptions['checksum'][] = [
  'none',
  'sum8',
  'xor8',
  'lrc',
  'crc8',
  'crc16-modbus',
  'crc16-ccitt',
]
const ENCODING_VALUES: readonly TextEncodingName[] = ['utf-8', 'ascii', 'latin1', 'gbk']

/** Fills missing or invalid compose options with the defaults. */
export function normalizeComposeOptions(input: Partial<ComposeOptions> = {}): ComposeOptions {
  const checksumValue: ComposeOptions['checksum'] =
    typeof input.checksum === 'string' &&
    (CHECKSUM_VALUES as readonly string[]).includes(input.checksum)
      ? input.checksum
      : DEFAULT_COMPOSE_OPTIONS.checksum
  const skip =
    typeof input.checksumSkip === 'number' &&
    Number.isInteger(input.checksumSkip) &&
    input.checksumSkip >= 0
      ? input.checksumSkip
      : DEFAULT_COMPOSE_OPTIONS.checksumSkip
  return {
    mode: input.mode === 'hex' ? 'hex' : 'text',
    encoding:
      typeof input.encoding === 'string' &&
      (ENCODING_VALUES as readonly string[]).includes(input.encoding)
        ? input.encoding
        : DEFAULT_COMPOSE_OPTIONS.encoding,
    eol:
      typeof input.eol === 'string' && (EOL_VALUES as readonly string[]).includes(input.eol)
        ? input.eol
        : DEFAULT_COMPOSE_OPTIONS.eol,
    checksum: checksumValue,
    checksumEndian: input.checksumEndian === 'be' ? 'be' : 'le',
    checksumSkip: skip,
  }
}

const EOL_BYTES: Record<ComposeOptions['eol'], readonly number[]> = {
  none: [],
  cr: [0x0d],
  lf: [0x0a],
  crlf: [0x0d, 0x0a],
}

function appendBytes(base: number[], extra: ArrayLike<number>): number[] {
  for (let index = 0; index < extra.length; index += 1) {
    base.push((extra[index] ?? 0) & 0xff)
  }
  return base
}

/** Encodes the user input into content bytes. */
function encodeContent(
  input: string,
  options: ComposeOptions,
): { ok: true; bytes: Uint8Array } | { ok: false; error: string; index?: number } {
  if (options.mode === 'hex') {
    const parsed = parseHex(input)
    if (!parsed.ok)
      return { ok: false, error: `HEX 解析失败：${parsed.error}`, index: parsed.index }
    return { ok: true, bytes: parsed.bytes }
  }
  const encoded = encodeText(input, options.encoding)
  if (!encoded.ok) return { ok: false, error: encoded.error, index: encoded.index }
  return { ok: true, bytes: encoded.bytes }
}

/**
 * Builds the bytes to send.
 *
 * Returns a Chinese error message instead of throwing so the UI can render it
 * next to the input.
 */
export function compose(
  input: string,
  options: ComposeOptions = defaultComposeOptions(),
): ComposeResult {
  const content = encodeContent(input, options)
  if (!content.ok) return content

  const skip = options.checksumSkip
  if (!Number.isInteger(skip) || skip < 0) {
    return { ok: false, error: '校验跳过字节数必须是大于等于 0 的整数' }
  }
  if (skip > content.bytes.length) {
    return {
      ok: false,
      error: `校验跳过字节数不能大于内容长度（当前内容 ${content.bytes.length} 字节）`,
    }
  }

  const output: number[] = Array.from(content.bytes)
  if (options.checksum !== 'none') {
    const width = checksumWidth(options.checksum)
    const value = checksum(options.checksum, content.bytes.subarray(skip))
    if (width === 1) {
      output.push(value & 0xff)
    } else if (options.checksumEndian === 'be') {
      output.push((value >> 8) & 0xff, value & 0xff)
    } else {
      output.push(value & 0xff, (value >> 8) & 0xff)
    }
  }
  appendBytes(output, EOL_BYTES[options.eol])

  if (output.length === 0) return { ok: false, error: '发送内容为空' }
  return { ok: true, bytes: Uint8Array.from(output) }
}
