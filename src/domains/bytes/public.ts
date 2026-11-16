/**
 * 字节领域的公共入口（plan §6.4）。
 *
 * 其他领域、工具只能通过本文件使用字节领域的能力，不得深入内部模块。
 */

export { parseHex, toHex } from './hex'

export { encodeText, createStreamDecoder } from './text'
export type { TextEncodingName } from './text'

export { checksum, checksumWidth } from './checksum'
export type { ChecksumKind } from './checksum'

export { read, bits, ByteWriter } from './numeric'
