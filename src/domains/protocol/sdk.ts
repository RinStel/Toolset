/**
 * 插件 SDK（plan §6.5）：作为 `sdk` 参数注入到 `new Function('sdk', 'console', code)`。
 *
 * 全部能力都来自字节领域的 `public.ts`，不直接依赖字节领域内部模块。
 */

import {
  ByteWriter,
  bits,
  checksum,
  createStreamDecoder,
  parseHex,
  read,
  toHex,
} from '../bytes/public'
import type { TextEncodingName } from '../bytes/public'

export type SdkBytesInput = number | ArrayLike<number>

export type SdkChecksum = (bytes: Uint8Array) => number

export interface PluginSdkChecksum {
  sum8: SdkChecksum
  xor8: SdkChecksum
  lrc: SdkChecksum
  crc8: SdkChecksum
  crc16modbus: SdkChecksum
  crc16ccitt: SdkChecksum
}

/**
 * 注入到插件代码里的 SDK 对象（plan §6.5 命名）。
 *
 * 注意它没有类型声明，插件作者靠编辑器的补全。
 */
export interface PluginSdk {
  /** 字节转 HEX；默认空格分隔、大写。 */
  hex(bytes: Uint8Array, sep?: string): string
  /** HEX 转字节；非法时抛错。 */
  fromHex(text: string): Uint8Array
  /** 把数字与数组拼接成 `Uint8Array`。 */
  bytes(...items: SdkBytesInput[]): Uint8Array
  read: typeof read
  bits: typeof bits
  writer(): ByteWriter
  checksum: PluginSdkChecksum
  /** 按指定编码把整段字节解码成文本，默认 utf-8。 */
  text(bytes: Uint8Array, encoding?: TextEncodingName): string
  /** 条件不成立时抛出带中文消息的 `Error`。 */
  assert(condition: unknown, message?: string): asserts condition
}

/**
 * `PluginSdk` 的旧名，保留用于既有导入。
 *
 * @deprecated 新代码请使用 `PluginSdk`（plan §6.5 的类型名）。
 */
export type ProtocolSdk = PluginSdk

/** 断言失败时的默认消息。 */
export const DEFAULT_ASSERT_MESSAGE = '断言失败'

function assemble(items: SdkBytesInput[]): Uint8Array {
  const bytes: number[] = []
  for (const item of items) {
    if (typeof item === 'number') {
      bytes.push(item & 0xff)
      continue
    }
    for (let index = 0; index < item.length; index += 1) {
      bytes.push((item[index] ?? 0) & 0xff)
    }
  }
  return Uint8Array.from(bytes)
}

function wrapChecksum(kind: 'sum8' | 'xor8' | 'lrc' | 'crc8' | 'crc16-modbus' | 'crc16-ccitt') {
  return (bytes: Uint8Array): number => checksum(kind, bytes)
}

function decodeText(bytes: Uint8Array, encoding: TextEncodingName): string {
  const decoder = createStreamDecoder(encoding)
  return decoder.decode(bytes) + decoder.flush()
}

/** 创建注入给插件代码的 SDK 对象。 */
export function createProtocolSdk(): PluginSdk {
  return {
    hex(bytes: Uint8Array, sep = ' '): string {
      return toHex(bytes, sep)
    },
    fromHex(text: string): Uint8Array {
      const parsed = parseHex(text)
      if (!parsed.ok) throw new Error(`HEX 解析失败：${parsed.error}`)
      return parsed.bytes
    },
    bytes(...items: SdkBytesInput[]): Uint8Array {
      return assemble(items)
    },
    read,
    bits,
    writer(): ByteWriter {
      return new ByteWriter()
    },
    checksum: {
      sum8: wrapChecksum('sum8'),
      xor8: wrapChecksum('xor8'),
      lrc: wrapChecksum('lrc'),
      crc8: wrapChecksum('crc8'),
      crc16modbus: wrapChecksum('crc16-modbus'),
      crc16ccitt: wrapChecksum('crc16-ccitt'),
    },
    text(bytes: Uint8Array, encoding: TextEncodingName = 'utf-8'): string {
      return decodeText(bytes, encoding)
    },
    assert(condition: unknown, message = DEFAULT_ASSERT_MESSAGE): asserts condition {
      if (!condition) throw new Error(message)
    },
  }
}
