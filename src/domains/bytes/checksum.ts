/** 常用校验和与 CRC。 */

/** 支持的校验类型。 */
export type ChecksumKind = 'sum8' | 'xor8' | 'lrc' | 'crc8' | 'crc16-modbus' | 'crc16-ccitt'

function sum8(data: Uint8Array): number {
  let sum = 0
  for (const byte of data) sum = (sum + byte) & 0xff
  return sum
}

function xor8(data: Uint8Array): number {
  let xor = 0
  for (const byte of data) xor ^= byte
  return xor
}

/** CRC-8/SMBUS：poly 0x07，init 0x00，不反射，xorout 0x00。 */
function crc8Smbus(data: Uint8Array): number {
  let crc = 0x00
  for (const byte of data) {
    crc ^= byte
    for (let bit = 0; bit < 8; bit += 1) {
      crc = crc & 0x80 ? ((crc << 1) ^ 0x07) & 0xff : (crc << 1) & 0xff
    }
  }
  return crc
}

/** CRC-16/MODBUS：poly 0x8005（反射实现用 0xA001），init 0xFFFF，反射，xorout 0。 */
function crc16Modbus(data: Uint8Array): number {
  let crc = 0xffff
  for (const byte of data) {
    crc ^= byte
    for (let bit = 0; bit < 8; bit += 1) {
      crc = crc & 0x0001 ? (crc >>> 1) ^ 0xa001 : crc >>> 1
    }
  }
  return crc & 0xffff
}

/** CRC-16/CCITT-FALSE：poly 0x1021，init 0xFFFF，不反射，xorout 0。 */
function crc16CcittFalse(data: Uint8Array): number {
  let crc = 0xffff
  for (const byte of data) {
    crc ^= byte << 8
    for (let bit = 0; bit < 8; bit += 1) {
      crc = crc & 0x8000 ? ((crc << 1) ^ 0x1021) & 0xffff : (crc << 1) & 0xffff
    }
  }
  return crc & 0xffff
}

/**
 * 计算校验值。
 *
 * - `sum8`：所有字节之和 & 0xFF；
 * - `xor8`：所有字节异或；
 * - `lrc`：`(-sum) & 0xFF`（Modbus ASCII 的 LRC）；
 * - `crc8`：CRC-8/SMBUS；
 * - `crc16-modbus`：CRC-16/MODBUS；
 * - `crc16-ccitt`：CRC-16/CCITT-FALSE。
 *
 * 空输入的返回值分别为 0、0、0、0、0xFFFF、0xFFFF。
 */
export function checksum(kind: ChecksumKind, data: Uint8Array): number {
  switch (kind) {
    case 'sum8':
      return sum8(data)
    case 'xor8':
      return xor8(data)
    case 'lrc':
      return -sum8(data) & 0xff
    case 'crc8':
      return crc8Smbus(data)
    case 'crc16-modbus':
      return crc16Modbus(data)
    case 'crc16-ccitt':
      return crc16CcittFalse(data)
    default: {
      const exhaustive: never = kind
      throw new Error(`不支持的校验类型：${String(exhaustive)}`)
    }
  }
}

/** 校验值的字节宽度：8 位校验返回 1，16 位校验返回 2。 */
export function checksumWidth(kind: ChecksumKind): 1 | 2 {
  switch (kind) {
    case 'sum8':
    case 'xor8':
    case 'lrc':
    case 'crc8':
      return 1
    case 'crc16-modbus':
    case 'crc16-ccitt':
      return 2
    default: {
      const exhaustive: never = kind
      throw new Error(`不支持的校验类型：${String(exhaustive)}`)
    }
  }
}
