import { describe, expect, it } from 'vitest'

import { checksum } from '../../../src/domains/bytes/public'
import {
  compose,
  defaultComposeOptions,
  type ComposeOptions,
} from '../../../src/domains/link/send/compose'

function options(overrides: Partial<ComposeOptions> = {}): ComposeOptions {
  return { ...defaultComposeOptions(), ...overrides }
}

describe('compose', () => {
  it('builds text content, checksum and EOL in protocol order', () => {
    const result = compose('AB', options({ eol: 'crlf', checksum: 'sum8' }))
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect([...result.bytes]).toEqual([0x41, 0x42, 0x41 + 0x42, 0x0d, 0x0a])
  })

  it('parses HEX content and appends LF', () => {
    const result = compose('0A 0B', options({ mode: 'hex', eol: 'lf' }))
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect([...result.bytes]).toEqual([0x0a, 0x0b, 0x0a])
  })

  it('appends CRC16-MODBUS little endian by default', () => {
    const result = compose('01 03 00 00 00 01', options({ mode: 'hex', checksum: 'crc16-modbus' }))
    expect(result.ok).toBe(true)
    if (!result.ok) return
    const value = checksum('crc16-modbus', new Uint8Array([1, 3, 0, 0, 0, 1]))
    expect([...result.bytes]).toEqual([1, 3, 0, 0, 0, 1, value & 0xff, (value >> 8) & 0xff])
  })

  it('respects checksumEndian for 16 bit checksums', () => {
    const input = new Uint8Array([0x01, 0x02])
    const value = checksum('crc16-ccitt', input)
    const little = compose(
      '01 02',
      options({ mode: 'hex', checksum: 'crc16-ccitt', checksumEndian: 'le' }),
    )
    const big = compose(
      '01 02',
      options({ mode: 'hex', checksum: 'crc16-ccitt', checksumEndian: 'be' }),
    )
    expect(little.ok && big.ok).toBe(true)
    if (!little.ok || !big.ok) return
    expect([...little.bytes]).toEqual([0x01, 0x02, value & 0xff, (value >> 8) & 0xff])
    expect([...big.bytes]).toEqual([0x01, 0x02, (value >> 8) & 0xff, value & 0xff])
  })

  it('writes 8 bit checksums as one byte', () => {
    const result = compose(
      '01 02',
      options({ mode: 'hex', checksum: 'xor8', checksumEndian: 'be' }),
    )
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect([...result.bytes]).toEqual([0x01, 0x02, 0x03])
  })

  it('skips leading bytes for the checksum but keeps them in the frame', () => {
    const result = compose('AA 01 02', options({ mode: 'hex', checksum: 'sum8', checksumSkip: 1 }))
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect([...result.bytes]).toEqual([0xaa, 0x01, 0x02, 0x03])
  })

  it('uses the configured text encoding', () => {
    const gbk = compose('中文', options({ encoding: 'gbk' }))
    expect(gbk.ok).toBe(true)
    if (!gbk.ok) return
    expect([...gbk.bytes]).toEqual([0xd6, 0xd0, 0xce, 0xc4])
  })

  it('reports HEX parse errors with the failing index', () => {
    const result = compose('12 zz', options({ mode: 'hex' }))
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error).toContain('HEX 解析失败')
    expect(result.index).toBe(3)
  })

  it('reports odd digit HEX errors', () => {
    const result = compose('A', options({ mode: 'hex' }))
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error).toContain('HEX 位数为奇数')
  })

  it('reports unencodable text characters', () => {
    const result = compose('😀', options({ encoding: 'gbk' }))
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error).toBe("字符 '😀'（第 1 个字符）无法用 GBK 编码")
  })

  it('rejects invalid checksumSkip values', () => {
    const tooLarge = compose('01', options({ mode: 'hex', checksum: 'sum8', checksumSkip: 2 }))
    expect(tooLarge.ok).toBe(false)
    if (tooLarge.ok) return
    expect(tooLarge.error).toContain('校验跳过字节数')

    const negative = compose('01', options({ mode: 'hex', checksum: 'sum8', checksumSkip: -1 }))
    expect(negative.ok).toBe(false)
    if (negative.ok) return
    expect(negative.error).toContain('校验跳过字节数')
  })

  it('rejects empty output but allows an EOL-only message', () => {
    expect(compose('').ok).toBe(false)
    const newline = compose('', options({ eol: 'crlf' }))
    expect(newline.ok).toBe(true)
    if (!newline.ok) return
    expect([...newline.bytes]).toEqual([0x0d, 0x0a])
  })
})
