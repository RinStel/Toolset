/** `delimiter` 分帧：可选的同步头 + 结束符（plan §6.5）。 */

import { BufferedFramer, type FrameEvent, type FramerDiscard } from '../types'

export class DelimiterFramer extends BufferedFramer {
  private readonly start: number[] | null
  private readonly end: number[]
  private readonly includeBoth: boolean

  constructor(
    start: number[] | null,
    end: number[],
    include: 'content' | 'both',
    maxFrameLength?: number,
  ) {
    super(maxFrameLength)
    this.start = start
    this.end = end
    this.includeBoth = include === 'both'
  }

  protected extract(at: number, frames: FrameEvent[], discards: FramerDiscard[]): void {
    for (;;) {
      if (this.start !== null && !this.syncTo(this.start, at, discards)) return
      const endIndex = this.buffer.indexOf(this.end, this.start?.length ?? 0)
      if (endIndex < 0) return
      const total = endIndex + this.end.length
      if (this.includeBoth) {
        this.emit(total, at, frames)
      } else {
        const contentStart = this.start?.length ?? 0
        const bytes = this.buffer.slice(contentStart, endIndex)
        this.buffer.take(total)
        frames.push({ bytes, at })
      }
    }
  }
}
