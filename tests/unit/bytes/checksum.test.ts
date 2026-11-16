import { describe, expect, it } from 'vitest'

import { checksum, checksumWidth } from '@/domains/bytes/public'

const ASCII_123456789 = new TextEncoder().encode('123456789')

function bytes(...values: number[]): Uint8Array {
  return Uint8Array.from(values)
}

describe('checksum 标准校验值', () => {
  it('对 "123456789" 返回标准 CRC 结果', () => {
    expect(checksum('crc8', ASCII_123456789)).toBe(0xf4)
    expect(checksum('crc16-modbus', ASCII_123456789)).toBe(0x4b37)
    expect(checksum('crc16-ccitt', ASCII_123456789)).toBe(0x29b1)
  })

  it('checksumWidth 区分 8 位与 16 位校验', () => {
    expect(checksumWidth('sum8')).toBe(1)
    expect(checksumWidth('xor8')).toBe(1)
    expect(checksumWidth('lrc')).toBe(1)
    expect(checksumWidth('crc8')).toBe(1)
    expect(checksumWidth('crc16-modbus')).toBe(2)
    expect(checksumWidth('crc16-ccitt')).toBe(2)
  })
})

describe('checksum 手算样例', () => {
  it('sum8 累加后取低 8 位', () => {
    expect(checksum('sum8', bytes(0x01, 0x02, 0x03, 0x04))).toBe(0x0a)
    expect(checksum('sum8', bytes(0xff, 0xff, 0x02))).toBe(0x00)
    expect(checksum('sum8', bytes(0x00))).toBe(0x00)
  })

  it('xor8 逐字节异或', () => {
    expect(checksum('xor8', bytes(0xf0, 0x0f))).toBe(0xff)
    expect(checksum('xor8', bytes(0x01, 0x02, 0x04))).toBe(0x07)
    expect(checksum('xor8', bytes())).toBe(0x00)
  })

  it('lrc 是 sum8 的二进制补码（Modbus ASCII）', () => {
    // "0103000A" 的和是 0x0E，LRC 为 0xF2。
    expect(checksum('lrc', bytes(0x01, 0x03, 0x00, 0x0a))).toBe(0xf2)
    expect(checksum('lrc', bytes(0xff, 0xff, 0x02))).toBe(0x00)
    expect(checksum('lrc', bytes(0x00, 0x00, 0x01))).toBe(0xff)
  })

  it('空输入返回各算法的初始值', () => {
    expect(checksum('sum8', bytes())).toBe(0)
    expect(checksum('xor8', bytes())).toBe(0)
    expect(checksum('lrc', bytes())).toBe(0)
    expect(checksum('crc8', bytes())).toBe(0)
    expect(checksum('crc16-modbus', bytes())).toBe(0xffff)
    expect(checksum('crc16-ccitt', bytes())).toBe(0xffff)
  })
})
