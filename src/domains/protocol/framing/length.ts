/** `length` 分帧：同步头 + 长度字段（plan §6.5）。 */

import { BufferedFramer, type FrameEvent, type FramerDiscard, type LengthField } from '../types'

export class LengthFramer extends BufferedFramer {
  private readonly header: number[] | null
  private readonly field: LengthField

  constructor(header: number[] | null, field: LengthField, maxFrameLength?: number) {
    super(maxFrameLength)
    this.header = header
    this.field = field
  }

  protected extract(at: number, frames: FrameEvent[], discards: FramerDiscard[]): void {
    const fieldEnd = this.field.offset + this.field.size
    for (;;) {
      if (this.header !== null && !this.syncTo(this.header, at, discards)) return
      if (this.buffer.length < fieldEnd) return
      const total = this.totalLength(fieldEnd)
      if (total < fieldEnd || total > this.maxFrameLength) {
        // 总帧长非法：丢弃起点的 1 个字节，重新同步。
        this.discardFront(1, at, 'resync', discards)
        continue
      }
      if (this.buffer.length < total) return
      this.emit(total, at, frames)
    }
  }

  private totalLength(fieldEnd: number): number {
    const value = this.readFieldValue()
    const adjust = this.field.adjust ?? 0
    return this.field.includes === 'frame' ? value + adjust : fieldEnd + value + adjust
  }

  private readFieldValue(): number {
    const { offset, size } = this.field
    const endian = this.field.endian ?? 'le'
    if (size === 1) return this.buffer.byteAt(offset) ?? 0
    if (size === 2) {
      const first = this.buffer.byteAt(offset) ?? 0
      const second = this.buffer.byteAt(offset + 1) ?? 0
      return endian === 'le' ? (second << 8) | first : (first << 8) | second
    }
    const b0 = this.buffer.byteAt(offset) ?? 0
    const b1 = this.buffer.byteAt(offset + 1) ?? 0
    const b2 = this.buffer.byteAt(offset + 2) ?? 0
    const b3 = this.buffer.byteAt(offset + 3) ?? 0
    if (endian === 'le') return ((b3 << 24) | (b2 << 16) | (b1 << 8) | b0) >>> 0
    return ((b0 << 24) | (b1 << 16) | (b2 << 8) | b3) >>> 0
  }
}
