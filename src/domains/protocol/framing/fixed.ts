/** `fixed` 分帧：固定帧长，可选同步头与帧尾校验（plan §6.5）。 */

import { BufferedFramer, type FrameEvent, type FramerDiscard } from '../types'

export class FixedFramer extends BufferedFramer {
  private readonly frameLength: number
  private readonly header: number[] | null
  private readonly trailer: number[] | null

  constructor(
    frameLength: number,
    header: number[] | null,
    trailer: number[] | null,
    maxFrameLength?: number,
  ) {
    super(maxFrameLength)
    this.frameLength = frameLength
    this.header = header
    this.trailer = trailer
  }

  protected extract(at: number, frames: FrameEvent[], discards: FramerDiscard[]): void {
    for (;;) {
      if (this.header !== null && !this.syncTo(this.header, at, discards)) return
      if (this.buffer.length < this.frameLength) return
      if (this.trailer !== null) {
        const trailerStart = this.frameLength - this.trailer.length
        const matches = trailerStart >= 0 && this.matchesTrailer(trailerStart)
        if (!matches) {
          // 帧尾不匹配：丢弃当前帧的第一个字节，重新同步。
          this.discardFront(1, at, 'resync', discards)
          continue
        }
      }
      this.emit(this.frameLength, at, frames)
    }
  }

  private matchesTrailer(trailerStart: number): boolean {
    const trailer = this.trailer as number[]
    for (let offset = 0; offset < trailer.length; offset += 1) {
      if (this.buffer.byteAt(trailerStart + offset) !== trailer[offset]) return false
    }
    return true
  }
}
