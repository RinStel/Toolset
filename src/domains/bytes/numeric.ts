/** 二进制数值读取、位域提取与字节写入。 */

function view(bytes: Uint8Array): DataView {
  return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
}

/**
 * 从字节数组读取数值。越界读取属于调用方错误，会由 `DataView` 抛出 `RangeError`。
 */
export const read = {
  u8: (bytes: Uint8Array, offset: number): number => view(bytes).getUint8(offset),
  i8: (bytes: Uint8Array, offset: number): number => view(bytes).getInt8(offset),
  u16le: (bytes: Uint8Array, offset: number): number => view(bytes).getUint16(offset, true),
  u16be: (bytes: Uint8Array, offset: number): number => view(bytes).getUint16(offset, false),
  i16le: (bytes: Uint8Array, offset: number): number => view(bytes).getInt16(offset, true),
  i16be: (bytes: Uint8Array, offset: number): number => view(bytes).getInt16(offset, false),
  u32le: (bytes: Uint8Array, offset: number): number => view(bytes).getUint32(offset, true),
  u32be: (bytes: Uint8Array, offset: number): number => view(bytes).getUint32(offset, false),
  i32le: (bytes: Uint8Array, offset: number): number => view(bytes).getInt32(offset, true),
  i32be: (bytes: Uint8Array, offset: number): number => view(bytes).getInt32(offset, false),
  f32le: (bytes: Uint8Array, offset: number): number => view(bytes).getFloat32(offset, true),
  f32be: (bytes: Uint8Array, offset: number): number => view(bytes).getFloat32(offset, false),
  f64le: (bytes: Uint8Array, offset: number): number => view(bytes).getFloat64(offset, true),
  f64be: (bytes: Uint8Array, offset: number): number => view(bytes).getFloat64(offset, false),
}

/**
 * 取出 32 位无符号整数中从 `start` 位（最低位为 0）开始、长度为 `length` 的位域。
 *
 * 参数非法（非整数、越界、`length > 32`）时抛出 `RangeError`。
 */
export function bits(value: number, start: number, length: number): number {
  if (!Number.isInteger(start) || !Number.isInteger(length)) {
    throw new RangeError('bits() 的 start 与 length 必须是整数')
  }
  if (start < 0 || start > 31) {
    throw new RangeError('bits() 的 start 必须在 0–31 之间')
  }
  if (length < 1 || length > 32 - start) {
    throw new RangeError('bits() 的 length 必须在 1–(32 - start) 之间')
  }
  const shifted = value >>> start
  if (length === 32) return shifted >>> 0
  return shifted & ((1 << length) - 1)
}

/** 可增长的字节写入器；写方法均返回 `this` 以支持链式调用。 */
export class ByteWriter {
  private readonly data: number[] = []
  private readonly scratch = new DataView(new ArrayBuffer(8))

  private appendScratch(length: number): void {
    for (let index = 0; index < length; index += 1) {
      this.data.push(this.scratch.getUint8(index))
    }
  }

  u8(value: number): this {
    this.data.push(value & 0xff)
    return this
  }

  i8(value: number): this {
    this.data.push(value & 0xff)
    return this
  }

  u16le(value: number): this {
    this.scratch.setUint16(0, value, true)
    this.appendScratch(2)
    return this
  }

  u16be(value: number): this {
    this.scratch.setUint16(0, value, false)
    this.appendScratch(2)
    return this
  }

  i16le(value: number): this {
    this.scratch.setInt16(0, value, true)
    this.appendScratch(2)
    return this
  }

  i16be(value: number): this {
    this.scratch.setInt16(0, value, false)
    this.appendScratch(2)
    return this
  }

  u32le(value: number): this {
    this.scratch.setUint32(0, value, true)
    this.appendScratch(4)
    return this
  }

  u32be(value: number): this {
    this.scratch.setUint32(0, value, false)
    this.appendScratch(4)
    return this
  }

  i32le(value: number): this {
    this.scratch.setInt32(0, value, true)
    this.appendScratch(4)
    return this
  }

  i32be(value: number): this {
    this.scratch.setInt32(0, value, false)
    this.appendScratch(4)
    return this
  }

  f32le(value: number): this {
    this.scratch.setFloat32(0, value, true)
    this.appendScratch(4)
    return this
  }

  f32be(value: number): this {
    this.scratch.setFloat32(0, value, false)
    this.appendScratch(4)
    return this
  }

  f64le(value: number): this {
    this.scratch.setFloat64(0, value, true)
    this.appendScratch(8)
    return this
  }

  f64be(value: number): this {
    this.scratch.setFloat64(0, value, false)
    this.appendScratch(8)
    return this
  }

  /** 写入任意字节序列（每项取低 8 位）。 */
  bytes(values: ArrayLike<number>): this {
    for (let index = 0; index < values.length; index += 1) {
      const value = values[index]
      this.data.push((value ?? 0) & 0xff)
    }
    return this
  }

  /**
   * 按 Latin-1 写入字符串：每个 UTF-16 码元直接作为一个字节。
   * 存在码点 > 0xFF 的字符时抛出 `RangeError`（不做静默截断）。
   */
  ascii(text: string): this {
    let index = 0
    while (index < text.length) {
      const codePoint = text.codePointAt(index) as number
      const char = String.fromCodePoint(codePoint)
      if (codePoint > 0xff) {
        throw new RangeError(`字符 '${char}' 无法用 Latin-1 写入（第 ${index + 1} 个字符）`)
      }
      this.data.push(codePoint)
      index += char.length
    }
    return this
  }

  /** 取出已写入的全部字节。 */
  toBytes(): Uint8Array {
    return Uint8Array.from(this.data)
  }
}
