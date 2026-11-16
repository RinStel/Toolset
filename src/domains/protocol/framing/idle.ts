/** `idle` 分帧：静默超过 `gapMs` 后把缓冲区作为一帧（plan §6.5）。 */

import { BufferedFramer, type FrameEvent, type FramerDiscard, type FramerOutput } from '../types'

export class IdleFramer extends BufferedFramer {
  private readonly gapMs: number
  private lastByteAt: number | null = null

  constructor(gapMs: number, maxFrameLength?: number) {
    super(maxFrameLength)
    this.gapMs = gapMs
  }

  /** idle 模式不使用按帧切分的 `extract`：`feed` 与 `flush` 已完全覆盖其行为。 */
  protected extract(): void {}

  override feed(bytes: Uint8Array, at: number): FramerOutput {
    const frames: FrameEvent[] = []
    const discards: FramerDiscard[] = []
    if (this.buffer.length > 0 && this.lastByteAt !== null && at - this.lastByteAt > this.gapMs) {
      // 相邻两块数据之间的静默超过 gapMs：先结束上一帧。
      this.emitAll(this.lastByteAt, frames)
    }
    this.buffer.append(bytes)
    this.lastByteAt = at
    if (this.buffer.length > this.maxFrameLength) {
      this.discardFront(this.buffer.length, at, 'overflow', discards)
    }
    return { frames, discards }
  }

  override flush(at: number): FramerOutput {
    const frames: FrameEvent[] = []
    this.emitAll(this.lastByteAt ?? at, frames)
    return { frames, discards: [] }
  }

  override reset(): void {
    super.reset()
    this.lastByteAt = null
  }
}
