import { describe, expect, it } from 'vitest'

import { ByteWriter, bits, read } from '@/domains/bytes/public'

function bytes(...values: number[]): Uint8Array {
  return Uint8Array.from(values)
}

describe('read 数值读取', () => {
  it('u8 / i8', () => {
    expect(read.u8(bytes(0x00), 0)).toBe(0)
    expect(read.u8(bytes(0xff), 0)).toBe(255)
    expect(read.i8(bytes(0x7f), 0)).toBe(127)
    expect(read.i8(bytes(0x80), 0)).toBe(-128)
    expect(read.i8(bytes(0xff), 0)).toBe(-1)
  })

  it('16 位无符号整数大小端', () => {
    expect(read.u16le(bytes(0x34, 0x12), 0)).toBe(0x1234)
    expect(read.u16be(bytes(0x12, 0x34), 0)).toBe(0x1234)
    expect(read.u16le(bytes(0xff, 0x00), 0)).toBe(0x00ff)
  })

  it('16 位有符号整数大小端', () => {
    expect(read.i16le(bytes(0xfe, 0xff), 0)).toBe(-2)
    expect(read.i16be(bytes(0xff, 0xfe), 0)).toBe(-2)
    expect(read.i16le(bytes(0x00, 0x80), 0)).toBe(-32768)
  })

  it('32 位无符号整数大小端', () => {
    expect(read.u32le(bytes(0x78, 0x56, 0x34, 0x12), 0)).toBe(0x12345678)
    expect(read.u32be(bytes(0x12, 0x34, 0x56, 0x78), 0)).toBe(0x12345678)
  })

  it('32 位有符号整数大小端', () => {
    expect(read.i32le(bytes(0xfe, 0xff, 0xff, 0xff), 0)).toBe(-2)
    expect(read.i32be(bytes(0xff, 0xff, 0xff, 0xfe), 0)).toBe(-2)
    expect(read.i32le(bytes(0x00, 0x00, 0x00, 0x80), 0)).toBe(-2147483648)
  })

  it('单精度与双精度浮点大小端', () => {
    // 1.5 = 0x3FC00000（float32）
    expect(read.f32le(bytes(0x00, 0x00, 0xc0, 0x3f), 0)).toBe(1.5)
    expect(read.f32be(bytes(0x3f, 0xc0, 0x00, 0x00), 0)).toBe(1.5)
    // -2.25 = 0xC002000000000000（float64）
    expect(read.f64le(bytes(0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x02, 0xc0), 0)).toBe(-2.25)
    expect(read.f64be(bytes(0xc0, 0x02, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00), 0)).toBe(-2.25)
  })

  it('支持偏移读取', () => {
    expect(read.u16le(bytes(0xaa, 0x34, 0x12), 1)).toBe(0x1234)
    expect(read.u16be(bytes(0xaa, 0x12, 0x34), 1)).toBe(0x1234)
  })

  it('子数组的 byteOffset 会被正确考虑', () => {
    const backing = Uint8Array.from([0x00, 0xff, 0x34, 0x12])
    const sliced = backing.subarray(2)
    expect(read.u16le(sliced, 0)).toBe(0x1234)
    expect(read.u8(sliced, 0)).toBe(0x34)
  })

  it('越界读取抛出 RangeError', () => {
    expect(() => read.u8(bytes(), 0)).toThrow(RangeError)
    expect(() => read.u16be(bytes(0x01), 0)).toThrow(RangeError)
    expect(() => read.u32le(bytes(0x01, 0x02, 0x03), 0)).toThrow(RangeError)
    expect(() => read.f64le(bytes(0x01), 0)).toThrow(RangeError)
    expect(() => read.u8(bytes(0x01), 1)).toThrow(RangeError)
  })
})

describe('bits 位域提取', () => {
  it('从最低位开始按位提取', () => {
    expect(bits(0b1010_1100, 0, 4)).toBe(0b1100)
    expect(bits(0b1010_1100, 2, 3)).toBe(0b011)
    expect(bits(0b1010_1100, 4, 4)).toBe(0b1010)
    expect(bits(0xdeadbeef, 0, 8)).toBe(0xef)
    expect(bits(0xdeadbeef, 8, 8)).toBe(0xbe)
    expect(bits(0x12345678, 28, 4)).toBe(0x1)
  })

  it('支持 32 位全宽', () => {
    expect(bits(0xffffffff, 0, 32)).toBe(0xffffffff)
    expect(bits(0xdeadbeef, 0, 32)).toBe(0xdeadbeef)
  })

  it('非法参数抛出 RangeError', () => {
    expect(() => bits(0, 0, 0)).toThrow(RangeError)
    expect(() => bits(0, 32, 1)).toThrow(RangeError)
    expect(() => bits(0, 0, 33)).toThrow(RangeError)
    expect(() => bits(0, 28, 5)).toThrow(RangeError)
    expect(() => bits(0, -1, 4)).toThrow(RangeError)
    expect(() => bits(0, 0.5, 4)).toThrow(RangeError)
  })
})

describe('ByteWriter', () => {
  it('写出与 read 对称的字节序列', () => {
    const writer = new ByteWriter()
    writer
      .u8(0x01)
      .i8(-1)
      .u16le(0x1234)
      .u16be(0x1234)
      .i16le(-2)
      .i16be(-2)
      .u32le(0x12345678)
      .u32be(0x12345678)
      .i32le(-2)
      .i32be(-2)
      .f32le(1.5)
      .f32be(1.5)
      .f64le(-2.25)
      .f64be(-2.25)

    const data = writer.toBytes()
    expect(data.length).toBe(1 + 1 + 2 + 2 + 2 + 2 + 4 + 4 + 4 + 4 + 4 + 4 + 8 + 8)

    let offset = 0
    expect(read.u8(data, offset)).toBe(0x01)
    offset += 1
    expect(read.i8(data, offset)).toBe(-1)
    offset += 1
    expect(read.u16le(data, offset)).toBe(0x1234)
    offset += 2
    expect(read.u16be(data, offset)).toBe(0x1234)
    offset += 2
    expect(read.i16le(data, offset)).toBe(-2)
    offset += 2
    expect(read.i16be(data, offset)).toBe(-2)
    offset += 2
    expect(read.u32le(data, offset)).toBe(0x12345678)
    offset += 4
    expect(read.u32be(data, offset)).toBe(0x12345678)
    offset += 4
    expect(read.i32le(data, offset)).toBe(-2)
    offset += 4
    expect(read.i32be(data, offset)).toBe(-2)
    offset += 4
    expect(read.f32le(data, offset)).toBe(1.5)
    offset += 4
    expect(read.f32be(data, offset)).toBe(1.5)
    offset += 4
    expect(read.f64le(data, offset)).toBe(-2.25)
    offset += 8
    expect(read.f64be(data, offset)).toBe(-2.25)
    offset += 8
    expect(offset).toBe(data.length)
  })

  it('按小端写出固定字节', () => {
    const data = new ByteWriter().u16le(0x1234).u16be(0x1234).u32le(0x12345678).toBytes()
    expect(Array.from(data)).toEqual([0x34, 0x12, 0x12, 0x34, 0x78, 0x56, 0x34, 0x12])
  })

  it('写方法返回 this 以支持链式调用', () => {
    const writer = new ByteWriter()
    expect(writer.u8(1)).toBe(writer)
    expect(writer.bytes([2])).toBe(writer)
    expect(writer.ascii('A')).toBe(writer)
  })

  it('bytes() 写入任意字节序列', () => {
    const writer = new ByteWriter()
    writer.bytes(Uint8Array.from([0xde, 0xad]))
    writer.bytes([0xbe, 0xef])
    expect(Array.from(writer.toBytes())).toEqual([0xde, 0xad, 0xbe, 0xef])
  })

  it('ascii() 按 Latin-1 逐码点写入', () => {
    expect(Array.from(new ByteWriter().ascii('Café').toBytes())).toEqual([0x43, 0x61, 0x66, 0xe9])
    expect(Array.from(new ByteWriter().ascii('A\u0000B').toBytes())).toEqual([0x41, 0x00, 0x42])
  })

  it('ascii() 遇到非 Latin-1 字符时抛出 RangeError', () => {
    expect(() => new ByteWriter().ascii('你')).toThrow(RangeError)
    expect(() => new ByteWriter().ascii('A😀')).toThrow(RangeError)
  })
})
