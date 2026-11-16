/** 文本与字节的互转，以及增量（流式）解码。 */

import { encodeGbkCodePoint } from './gbk'

/** 支持的文本编码名。 */
export type TextEncodingName = 'utf-8' | 'ascii' | 'latin1' | 'gbk'

/** `encodeText` 的成功结果。 */
interface EncodeTextSuccess {
  ok: true
  bytes: Uint8Array
}

/**
 * `encodeText` 的失败结果。
 *
 * - `char`：无法编码的字符；
 * - `index`：该字符在输入字符串中的 UTF-16 下标；
 * - `error`：可直接展示的中文错误文案。
 */
interface EncodeTextFailure {
  ok: false
  error: string
  char: string
  index: number
}

type EncodeTextResult = EncodeTextSuccess | EncodeTextFailure

/** 一次解码会话；`decode` 可反复调用，最后必须调用 `flush` 取回残留字符。 */
interface StreamDecoder {
  decode(chunk: Uint8Array): string
  flush(): string
}

const ASCII_LABEL = 'ASCII'
const LATIN1_LABEL = 'Latin-1'
const GBK_LABEL = 'GBK'

function encodeFailure(
  char: string,
  index: number,
  ordinal: number,
  label: string,
): EncodeTextFailure {
  return {
    ok: false,
    error: `字符 '${char}'（第 ${ordinal} 个字符）无法用 ${label} 编码`,
    char,
    index,
  }
}

function encodeAscii(text: string): EncodeTextResult {
  const bytes: number[] = []
  let ordinal = 0
  let index = 0
  while (index < text.length) {
    const codePoint = text.codePointAt(index) as number
    const char = String.fromCodePoint(codePoint)
    ordinal += 1
    if (codePoint > 0x7f) {
      return encodeFailure(char, index, ordinal, ASCII_LABEL)
    }
    bytes.push(codePoint)
    index += char.length
  }
  return { ok: true, bytes: Uint8Array.from(bytes) }
}

function encodeLatin1(text: string): EncodeTextResult {
  const bytes: number[] = []
  let ordinal = 0
  let index = 0
  while (index < text.length) {
    const codePoint = text.codePointAt(index) as number
    const char = String.fromCodePoint(codePoint)
    ordinal += 1
    if (codePoint > 0xff) {
      return encodeFailure(char, index, ordinal, LATIN1_LABEL)
    }
    bytes.push(codePoint)
    index += char.length
  }
  return { ok: true, bytes: Uint8Array.from(bytes) }
}

function encodeGbk(text: string): EncodeTextResult {
  const bytes: number[] = []
  let ordinal = 0
  let index = 0
  while (index < text.length) {
    const codePoint = text.codePointAt(index) as number
    const char = String.fromCodePoint(codePoint)
    ordinal += 1
    if (codePoint <= 0x7f) {
      bytes.push(codePoint)
      index += char.length
      continue
    }
    const mapped = encodeGbkCodePoint(codePoint)
    if (mapped === undefined) {
      return encodeFailure(char, index, ordinal, GBK_LABEL)
    }
    for (const byte of mapped) bytes.push(byte)
    index += char.length
  }
  return { ok: true, bytes: Uint8Array.from(bytes) }
}

/**
 * 把字符串编码为字节。
 *
 * - `utf-8`：标准 UTF-8（孤立代理项会被替换为 U+FFFD）；
 * - `ascii`：码点 > 0x7F 时报错；
 * - `latin1`：码点 > 0xFF 时报错（每个码点直接作为一个字节）；
 * - `gbk`：查 GBK 编码表，查不到时报错。
 */
export function encodeText(text: string, enc: TextEncodingName): EncodeTextResult {
  switch (enc) {
    case 'utf-8':
      return { ok: true, bytes: new TextEncoder().encode(text) }
    case 'ascii':
      return encodeAscii(text)
    case 'latin1':
      return encodeLatin1(text)
    case 'gbk':
      return encodeGbk(text)
    default: {
      const exhaustive: never = enc
      throw new Error(`不支持的文本编码：${String(exhaustive)}`)
    }
  }
}

const NON_ASCII = 0x7f

function replaceNonAscii(text: string): string {
  let result = ''
  for (const char of text) {
    result += (char.codePointAt(0) as number) > NON_ASCII ? '\uFFFD' : char
  }
  return result
}

function decodeLabel(enc: TextEncodingName): string {
  switch (enc) {
    case 'utf-8':
      return 'utf-8'
    case 'latin1':
      return 'latin1'
    case 'gbk':
      return GBK_LABEL
    default:
      return ASCII_LABEL
  }
}

/**
 * 创建增量解码器（使用 `TextDecoder` 的 stream 模式）。
 *
 * `ascii` 先按 `windows-1252` 解码，再把码点 > 0x7F 的字符替换为 U+FFFD，
 * 这样 ASCII 流里的非法高位字节不会被静默当成扩展字符。
 */
export function createStreamDecoder(enc: TextEncodingName): StreamDecoder {
  if (enc === 'ascii') {
    const decoder = new TextDecoder('windows-1252')
    return {
      decode(chunk: Uint8Array): string {
        return replaceNonAscii(decoder.decode(chunk, { stream: true }))
      },
      flush(): string {
        return replaceNonAscii(decoder.decode())
      },
    }
  }

  const decoder = new TextDecoder(decodeLabel(enc))
  return {
    decode(chunk: Uint8Array): string {
      return decoder.decode(chunk, { stream: true })
    },
    flush(): string {
      return decoder.decode()
    },
  }
}
