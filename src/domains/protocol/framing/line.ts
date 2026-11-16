/** `line` 分帧：按行尾（lf / crlf / cr）切帧（plan §6.5）。 */

import { BufferedFramer, type FrameEvent, type FramerDiscard } from '../types'

const LF = 0x0a
const CR = 0x0d

interface LineEnding {
  /** 行尾之前的正文长度。 */
  contentLength: number
  /** 行尾本身的字节数（不包含被 lf 规则去掉的 CR）。 */
  terminatorLength: number
}

export class LineFramer extends BufferedFramer {
  private readonly eol: 'lf' | 'crlf' | 'cr'
  private readonly includeEol: boolean

  constructor(eol: 'lf' | 'crlf' | 'cr', includeEol: boolean, maxFrameLength?: number) {
    super(maxFrameLength)
    this.eol = eol
    this.includeEol = includeEol
  }

  protected extract(at: number, frames: FrameEvent[], _discards: FramerDiscard[]): void {
    for (;;) {
      const ending = this.findEnding()
      if (ending === null) return
      const total = ending.contentLength + ending.terminatorLength
      if (ending.contentLength === 0) {
        // 空行不是一个有意义的数据帧，直接丢弃行尾。
        this.buffer.take(total)
        continue
      }
      if (this.includeEol) {
        this.emit(total, at, frames)
      } else {
        const bytes = this.buffer.slice(0, ending.contentLength)
        this.buffer.take(total)
        frames.push({ bytes, at })
      }
    }
  }

  private findEnding(): LineEnding | null {
    switch (this.eol) {
      case 'cr':
        return this.findCr()
      case 'crlf':
        return this.findCrlf()
      case 'lf':
        return this.findLf()
      default: {
        const exhaustive: never = this.eol
        throw new Error(`不支持的行尾：${String(exhaustive)}`)
      }
    }
  }

  private findLf(): LineEnding | null {
    const index = this.buffer.indexOf([LF])
    if (index < 0) return null
    // lf 规则：以 0x0A 结尾，且去掉它前面的 0x0D。
    if (index > 0 && this.buffer.byteAt(index - 1) === CR) {
      return { contentLength: index - 1, terminatorLength: 2 }
    }
    return { contentLength: index, terminatorLength: 1 }
  }

  private findCr(): LineEnding | null {
    const index = this.buffer.indexOf([CR])
    if (index < 0) return null
    return { contentLength: index, terminatorLength: 1 }
  }

  private findCrlf(): LineEnding | null {
    let from = 0
    for (;;) {
      const index = this.buffer.indexOf([CR], from)
      if (index < 0) return null
      const next = this.buffer.byteAt(index + 1)
      if (next === undefined) return null // 可能是跨块的 CRLF，等下一块数据。
      if (next === LF) return { contentLength: index, terminatorLength: 2 }
      from = index + 1 // 单独的 CR 属于正文。
    }
  }
}
