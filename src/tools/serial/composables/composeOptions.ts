/**
 * 工具层的组包选项默认值与归一化（plan §6.6 的 `ComposeOptions`）。
 *
 * `domains/link/public` 只导出 `compose` 与类型，不导出 `defaultComposeOptions` /
 * `normalizeComposeOptions`；快捷发送、宏与设备组包记忆需要它们，因此在工具层
 * 维护一份等价实现。
 */

import type { ChecksumKind, TextEncodingName } from '@/domains/bytes/public'
import type { ComposeOptions } from '@/domains/link/public'

const CHEKSUM_VALUES: readonly ComposeOptions['checksum'][] = [
  'none',
  'sum8',
  'xor8',
  'lrc',
  'crc8',
  'crc16-modbus',
  'crc16-ccitt',
]

const EOL_VALUES: readonly ComposeOptions['eol'][] = ['none', 'cr', 'lf', 'crlf']

const ENCODING_VALUES: readonly TextEncodingName[] = ['utf-8', 'ascii', 'latin1', 'gbk']

/** 新建会话 / 快捷项 / 宏步骤时使用的组包默认值。 */
export function createDefaultComposeOptions(): ComposeOptions {
  return {
    mode: 'text',
    encoding: 'utf-8',
    eol: 'none',
    checksum: 'none',
    checksumEndian: 'le',
    checksumSkip: 0,
  }
}

/** 把任意来源的数据收敛为合法的组包选项。 */
export function normalizeComposeOptions(input: Partial<ComposeOptions> = {}): ComposeOptions {
  const checksum: ComposeOptions['checksum'] =
    typeof input.checksum === 'string' &&
    (CHEKSUM_VALUES as readonly string[]).includes(input.checksum)
      ? (input.checksum as ChecksumKind)
      : 'none'
  const checksumSkip =
    typeof input.checksumSkip === 'number' &&
    Number.isInteger(input.checksumSkip) &&
    input.checksumSkip >= 0
      ? input.checksumSkip
      : 0
  return {
    mode: input.mode === 'hex' ? 'hex' : 'text',
    encoding:
      typeof input.encoding === 'string' &&
      (ENCODING_VALUES as readonly string[]).includes(input.encoding)
        ? input.encoding
        : 'utf-8',
    eol:
      typeof input.eol === 'string' && (EOL_VALUES as readonly string[]).includes(input.eol)
        ? input.eol
        : 'none',
    checksum,
    checksumEndian: input.checksumEndian === 'be' ? 'be' : 'le',
    checksumSkip,
  }
}
