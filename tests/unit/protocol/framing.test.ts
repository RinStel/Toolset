import { describe, expect, it } from 'vitest'

import { createFramer, type Framer } from '@/domains/protocol/framing'
import type { FramerDiscard, FramerOutput } from '@/domains/protocol/types'

const bytes = (...values: number[]): Uint8Array => Uint8Array.from(values)

const ascii = (text: string): Uint8Array =>
  Uint8Array.from([...text].map((char) => char.charCodeAt(0)))

const hex = (text: string): Uint8Array =>
  Uint8Array.from(
    text
      .trim()
      .split(/\s+/)
      .map((part) => Number.parseInt(part, 16)),
  )

const hexOf = (value: Uint8Array): string =>
  [...value].map((byte) => byte.toString(16).padStart(2, '0').toUpperCase()).join(' ')

interface Chunk {
  bytes: Uint8Array
  at: number
}

function feed(framer: Framer, chunks: Chunk[]): FramerOutput[] {
  return chunks.map((chunk) => framer.feed(chunk.bytes, chunk.at))
}

function frameHexes(outputs: FramerOutput[]): string[] {
  return outputs.flatMap((output) => output.frames).map((frame) => hexOf(frame.bytes))
}

function frameLengths(outputs: FramerOutput[]): number[] {
  return outputs.flatMap((output) => output.frames).map((frame) => frame.bytes.length)
}

function allDiscards(outputs: FramerOutput[]): FramerDiscard[] {
  return outputs.flatMap((output) => output.discards)
}

function discardedByteCount(outputs: FramerOutput[]): number {
  return allDiscards(outputs).reduce((sum, discard) => sum + discard.bytes.length, 0)
}

function discardReasons(outputs: FramerOutput[]): string[] {
  return allDiscards(outputs).map((discard) => discard.reason)
}

describe('line 分帧', () => {
  it('跨块：行尾被拆到下一块时保留半帧', () => {
    const framer = createFramer({ type: 'line' })
    const outputs = feed(framer, [
      { bytes: ascii('AB'), at: 1 },
      { bytes: ascii('C\n'), at: 2 },
    ])
    expect(frameHexes(outputs)).toEqual(['41 42 43'])
    expect(outputs[0]?.frames).toHaveLength(0)
    expect(outputs.flatMap((output) => output.frames)[0]?.at).toBe(2)
  })

  it('粘包：一块数据里包含多行', () => {
    const framer = createFramer({ type: 'line' })
    expect(frameHexes(feed(framer, [{ bytes: ascii('A\nB\n'), at: 1 }]))).toEqual(['41', '42'])
  })

  it('lf 规则去掉行尾前的 CR，且 CRLF 可跨块', () => {
    const framer = createFramer({ type: 'line' })
    const outputs = feed(framer, [
      { bytes: ascii('AB\r'), at: 1 },
      { bytes: ascii('\nCD\r\n'), at: 2 },
    ])
    expect(frameHexes(outputs)).toEqual(['41 42', '43 44'])
  })

  it('crlf 规则只认 CRLF：单独 LF 属于正文', () => {
    const framer = createFramer({ type: 'line', eol: 'crlf' })
    expect(frameHexes(feed(framer, [{ bytes: ascii('A\nB\r\n'), at: 1 }]))).toEqual(['41 0A 42'])
  })

  it('cr 规则以 0x0D 结尾', () => {
    const framer = createFramer({ type: 'line', eol: 'cr' })
    expect(frameHexes(feed(framer, [{ bytes: ascii('A\rB\r'), at: 1 }]))).toEqual(['41', '42'])
  })

  it('includeEol 保留行尾（lf 规则会连同 CR 一起保留）', () => {
    const lf = createFramer({ type: 'line', includeEol: true })
    expect(frameHexes(feed(lf, [{ bytes: hex('41 0D 0A 42 0A'), at: 1 }]))).toEqual([
      '41 0D 0A',
      '42 0A',
    ])
    const crlf = createFramer({ type: 'line', eol: 'crlf', includeEol: true })
    expect(frameHexes(feed(crlf, [{ bytes: hex('41 0D 0A'), at: 1 }]))).toEqual(['41 0D 0A'])
    const cr = createFramer({ type: 'line', eol: 'cr', includeEol: true })
    expect(frameHexes(feed(cr, [{ bytes: hex('41 0D'), at: 1 }]))).toEqual(['41 0D'])
  })

  it('垃圾/异常内容仍作为一帧；空行被忽略', () => {
    const framer = createFramer({ type: 'line' })
    const outputs = feed(framer, [{ bytes: hex('0A 41 00 42 0A'), at: 1 }])
    expect(frameHexes(outputs)).toEqual(['41 00 42'])
  })

  it('超长：超过 maxFrameLength 丢弃整个缓冲并上报', () => {
    const framer = createFramer({ type: 'line', maxFrameLength: 8 })
    const outputs = feed(framer, [{ bytes: ascii('123456789'), at: 5 }])
    expect(frameHexes(outputs)).toEqual([])
    expect(discardedByteCount(outputs)).toBe(9)
    expect(discardReasons(outputs)).toEqual(['overflow'])
    expect(allDiscards(outputs)[0]?.at).toBe(5)
    expect(framer.discardBytes).toBe(9)

    // 丢弃后重新开始，后续数据仍能正常成帧。
    expect(frameHexes(feed(framer, [{ bytes: ascii('ok\n'), at: 6 }]))).toEqual(['6F 6B'])
  })
})

describe('delimiter 分帧', () => {
  it('跨块：结束符被拆到下一块时保留半帧', () => {
    const framer = createFramer({ type: 'delimiter', start: 'AA 55', end: '0D 0A' })
    const outputs = feed(framer, [
      { bytes: hex('AA 55 61'), at: 1 },
      { bytes: hex('62 0D 0A'), at: 2 },
    ])
    expect(frameHexes(outputs)).toEqual(['61 62'])
    expect(outputs[0]?.frames).toHaveLength(0)
  })

  it('粘包：一块数据里包含两帧', () => {
    const framer = createFramer({ type: 'delimiter', start: 'AA 55', end: '0D 0A' })
    expect(
      frameHexes(feed(framer, [{ bytes: hex('AA 55 61 62 0D 0A AA 55 63 0D 0A'), at: 1 }])),
    ).toEqual(['61 62', '63'])
  })

  it('垃圾数据重同步：start 之前的字节被丢弃，并支持 start 跨块', () => {
    const framer = createFramer({ type: 'delimiter', start: 'AA 55', end: '0D 0A' })
    const first = feed(framer, [{ bytes: hex('FF AA'), at: 1 }])
    expect(discardedByteCount(first)).toBe(1)
    expect(discardReasons(first)).toEqual(['sync'])
    const second = feed(framer, [{ bytes: hex('55 61 62 0D 0A'), at: 2 }])
    expect(frameHexes(second)).toEqual(['61 62'])
  })

  it('超长：始终找不到结束符时丢弃整个缓冲', () => {
    const framer = createFramer({
      type: 'delimiter',
      start: 'AA 55',
      end: '0D 0A',
      maxFrameLength: 8,
    })
    const outputs = feed(framer, [{ bytes: hex('AA 55 01 02 03 04 05 06 07 08'), at: 1 }])
    expect(frameHexes(outputs)).toEqual([])
    expect(discardedByteCount(outputs)).toBe(10)
    expect(discardReasons(outputs)).toEqual(['overflow'])
  })

  it('半帧保留：结束符未到时不丢弃任何字节', () => {
    const framer = createFramer({ type: 'delimiter', start: 'AA 55', end: '0D 0A' })
    const outputs = feed(framer, [{ bytes: hex('AA 55 61 62 0D'), at: 1 }])
    expect(frameHexes(outputs)).toEqual([])
    expect(discardedByteCount(outputs)).toBe(0)
    expect(frameHexes(feed(framer, [{ bytes: hex('0A'), at: 2 }]))).toEqual(['61 62'])
  })

  it("include: 'both' 保留起止符", () => {
    const framer = createFramer({
      type: 'delimiter',
      start: 'AA 55',
      end: '0D 0A',
      include: 'both',
    })
    expect(frameHexes(feed(framer, [{ bytes: hex('AA 55 61 0D 0A'), at: 1 }]))).toEqual([
      'AA 55 61 0D 0A',
    ])
  })

  it('没有 start 时从缓冲区开头开始', () => {
    const framer = createFramer({ type: 'delimiter', end: '0D 0A' })
    expect(frameHexes(feed(framer, [{ bytes: hex('61 62 0D 0A'), at: 1 }]))).toEqual(['61 62'])
  })

  it('起止符相邻时输出空内容帧', () => {
    const framer = createFramer({ type: 'delimiter', start: 'AA 55', end: '0D 0A' })
    expect(frameLengths(feed(framer, [{ bytes: hex('AA 55 0D 0A'), at: 1 }]))).toEqual([0])
  })
})

describe('fixed 分帧', () => {
  it('跨块：固定帧长的数据被拆开', () => {
    const framer = createFramer({ type: 'fixed', length: 5, header: 'AA 55', trailer: '0D' })
    const outputs = feed(framer, [
      { bytes: hex('AA 55 01'), at: 1 },
      { bytes: hex('02 0D'), at: 2 },
    ])
    expect(frameHexes(outputs)).toEqual(['AA 55 01 02 0D'])
  })

  it('粘包：一块数据里包含两帧', () => {
    const framer = createFramer({ type: 'fixed', length: 5, header: 'AA 55', trailer: '0D' })
    expect(
      frameHexes(feed(framer, [{ bytes: hex('AA 55 01 02 0D AA 55 03 04 0D'), at: 1 }])),
    ).toEqual(['AA 55 01 02 0D', 'AA 55 03 04 0D'])
  })

  it('垃圾数据重同步：按 header 对齐', () => {
    const framer = createFramer({ type: 'fixed', length: 5, header: 'AA 55' })
    const outputs = feed(framer, [{ bytes: hex('FF FF AA 55 01 02 03'), at: 1 }])
    expect(frameHexes(outputs)).toEqual(['AA 55 01 02 03'])
    expect(discardedByteCount(outputs)).toBe(2)
    expect(discardReasons(outputs)).toEqual(['sync'])
  })

  it('帧尾不匹配时丢 1 字节重新同步', () => {
    const framer = createFramer({ type: 'fixed', length: 5, header: 'AA 55', trailer: '0D' })
    const outputs = feed(framer, [{ bytes: hex('AA 55 01 02 0E AA 55 03 04 0D'), at: 1 }])
    expect(frameHexes(outputs)).toEqual(['AA 55 03 04 0D'])
    // 1 字节（帧尾不匹配） + 4 字节（对下一个 header 的同步丢弃）。
    expect(discardedByteCount(outputs)).toBe(5)
    expect(discardReasons(outputs)).toEqual(['resync', 'sync'])
  })

  it('没有 header 时从任意位置同步；帧尾不匹配时逐字节丢弃', () => {
    const framer = createFramer({ type: 'fixed', length: 2, trailer: 'FF' })
    const outputs = feed(framer, [{ bytes: hex('01 02 03 FF'), at: 1 }])
    expect(frameHexes(outputs)).toEqual(['03 FF'])
    expect(discardedByteCount(outputs)).toBe(2)
    expect(discardReasons(outputs)).toEqual(['resync', 'resync'])
  })

  it('超长：等待 header 时缓冲超过 maxFrameLength 会整体丢弃', () => {
    const framer = createFramer({
      type: 'fixed',
      length: 8,
      header: 'AA 55',
      maxFrameLength: 4,
    })
    const outputs = feed(framer, [{ bytes: hex('AA 55 01 02 03'), at: 1 }])
    expect(frameHexes(outputs)).toEqual([])
    expect(discardedByteCount(outputs)).toBe(5)
    expect(discardReasons(outputs)).toEqual(['overflow'])
  })

  it('半帧保留：数据不足一帧时等待下一块', () => {
    const framer = createFramer({ type: 'fixed', length: 4 })
    const outputs = feed(framer, [{ bytes: hex('01 02'), at: 1 }])
    expect(frameHexes(outputs)).toEqual([])
    expect(discardedByteCount(outputs)).toBe(0)
    expect(frameHexes(feed(framer, [{ bytes: hex('03 04 05 06 07 08'), at: 2 }]))).toEqual([
      '01 02 03 04',
      '05 06 07 08',
    ])
  })
})

describe('length 分帧', () => {
  it("includes: 'frame'：字段值就是总帧长", () => {
    const framer = createFramer({
      type: 'length',
      length: { offset: 0, size: 1, includes: 'frame' },
    })
    expect(frameHexes(feed(framer, [{ bytes: hex('03 AA BB 04 11 22 33'), at: 1 }]))).toEqual([
      '03 AA BB',
      '04 11 22 33',
    ])
  })

  it('跨块：长度字段与正文分块到达', () => {
    const framer = createFramer({
      type: 'length',
      length: { offset: 0, size: 2, endian: 'be', includes: 'frame' },
    })
    const outputs = feed(framer, [
      { bytes: hex('00'), at: 1 },
      { bytes: hex('04 AA BB CC'), at: 2 },
    ])
    expect(outputs[0]?.frames).toHaveLength(0)
    expect(frameHexes(outputs)).toEqual(['00 04 AA BB'])
  })

  it("includes: 'after' + adjust：内置传感器结构", () => {
    const framer = createFramer({
      type: 'length',
      header: 'A5 5A',
      length: { offset: 2, size: 1, includes: 'after', adjust: 2 },
    })
    // LEN = 3（CMD 1 + DATA 2），总帧长 = 3 + 2 + 3 = 8。
    const frame = hex('A5 5A 03 10 E8 03 34 12')
    const outputs = feed(framer, [
      { bytes: frame.slice(0, 5), at: 1 },
      { bytes: frame.slice(5), at: 2 },
    ])
    expect(frameHexes(outputs)).toEqual([hexOf(frame)])
  })

  it('adjust 修正总帧长', () => {
    const framer = createFramer({
      type: 'length',
      length: { offset: 0, size: 1, includes: 'frame', adjust: 1 },
    })
    // 值 2 + adjust 1 = 3 字节。
    expect(frameHexes(feed(framer, [{ bytes: hex('02 AA BB'), at: 1 }]))).toEqual(['02 AA BB'])
    expect(framer.flush(2).frames).toHaveLength(0)
  })

  it("includes: 'after' 且没有 adjust", () => {
    const framer = createFramer({
      type: 'length',
      length: { offset: 1, size: 1, includes: 'after' },
    })
    // 总帧长 = offset+size(2) + 值(2) = 4。
    expect(frameHexes(feed(framer, [{ bytes: hex('AA 02 01 02 03 04'), at: 1 }]))).toEqual([
      'AA 02 01 02',
    ])
  })

  it('支持 4 字节长度字段与大小端', () => {
    const be = createFramer({
      type: 'length',
      length: { offset: 0, size: 4, endian: 'be', includes: 'frame' },
    })
    expect(frameHexes(feed(be, [{ bytes: hex('00 00 00 05 AA BB CC DD'), at: 1 }]))).toEqual([
      '00 00 00 05 AA',
    ])
    const le = createFramer({
      type: 'length',
      length: { offset: 0, size: 4, endian: 'le', includes: 'frame' },
    })
    expect(frameHexes(feed(le, [{ bytes: hex('05 00 00 00 AA BB CC DD'), at: 1 }]))).toEqual([
      '05 00 00 00 AA',
    ])
    const u16le = createFramer({
      type: 'length',
      length: { offset: 0, size: 2, endian: 'le', includes: 'frame' },
    })
    expect(frameHexes(feed(u16le, [{ bytes: hex('04 00 AA BB CC'), at: 1 }]))).toEqual([
      '04 00 AA BB',
    ])
  })

  it('垃圾数据重同步：总帧长非法时丢起点 1 字节', () => {
    const framer = createFramer({
      type: 'length',
      length: { offset: 2, size: 1, includes: 'frame' },
    })
    const outputs = feed(framer, [
      { bytes: hex('AA BB 01'), at: 1 },
      { bytes: hex('02'), at: 2 },
      { bytes: hex('03'), at: 3 },
    ])
    // [AA BB 01] 总帧长 1 < offset+size=3 → 丢 AA；[BB 01 02] 总帧长 2 < 3 → 丢 BB；
    // [01 02 03] 总帧长 3 → 成帧。
    expect(frameHexes(outputs)).toEqual(['01 02 03'])
    expect(discardedByteCount(outputs)).toBe(2)
    expect(discardReasons(outputs)).toEqual(['resync', 'resync'])
  })

  it('总帧长超过 maxFrameLength 时丢 1 字节重新同步', () => {
    const framer = createFramer({
      type: 'length',
      length: { offset: 0, size: 1, includes: 'frame' },
      maxFrameLength: 8,
    })
    const outputs = feed(framer, [{ bytes: hex('09 AA BB CC DD EE FF 11 22'), at: 1 }])
    expect(frameHexes(outputs)).toEqual([])
    // 0x09 > 8，之后每个字节都大于 8：全部按 resync 丢弃。
    expect(discardedByteCount(outputs)).toBe(9)
    expect(discardReasons(outputs).every((reason) => reason === 'resync')).toBe(true)
  })

  it('header 之前的数据被丢弃；半帧保留', () => {
    const framer = createFramer({
      type: 'length',
      header: 'AA 55',
      length: { offset: 2, size: 1, includes: 'after', adjust: 2 },
    })
    const first = feed(framer, [{ bytes: hex('FF AA 55 03 10 E8'), at: 1 }])
    expect(discardedByteCount(first)).toBe(1)
    expect(frameHexes(first)).toEqual([])
    const second = feed(framer, [{ bytes: hex('03 01 02 03'), at: 2 }])
    // LEN=3，总帧长 = 3 + 2 + 3 = 8：AA 55 03 10 E8 03 01 02，剩余 03 留到下一帧。
    expect(frameHexes(second)).toEqual(['AA 55 03 10 E8 03 01 02'])
  })
})

describe('idle 分帧', () => {
  it('flush 把缓冲区作为一帧输出，并清空缓冲', () => {
    const framer = createFramer({ type: 'idle', gapMs: 5 })
    const feedOutputs = feed(framer, [{ bytes: bytes(1, 2), at: 10 }])
    expect(frameHexes(feedOutputs)).toEqual([])
    const flushed = framer.flush(20)
    expect(frameHexes([flushed])).toEqual(['01 02'])
    expect(flushed.frames[0]?.at).toBe(10)
    expect(framer.flush(30).frames).toHaveLength(0)
  })

  it('相邻数据块间隔大于 gapMs 时先结束上一帧', () => {
    const framer = createFramer({ type: 'idle', gapMs: 5 })
    const outputs = feed(framer, [
      { bytes: bytes(1, 2), at: 0 },
      { bytes: bytes(3), at: 6 },
    ])
    expect(frameHexes(outputs)).toEqual(['01 02'])
    expect(outputs.flatMap((output) => output.frames)[0]?.at).toBe(0)
    expect(frameHexes([framer.flush(10)])).toEqual(['03'])
  })

  it('间隔恰好等于 gapMs 时不分帧', () => {
    const framer = createFramer({ type: 'idle', gapMs: 5 })
    const outputs = feed(framer, [
      { bytes: bytes(1), at: 0 },
      { bytes: bytes(2), at: 5 },
    ])
    expect(frameHexes(outputs)).toEqual([])
    expect(frameHexes([framer.flush(6)])).toEqual(['01 02'])
  })

  it('跨块累积到 flush 才成帧', () => {
    const framer = createFramer({ type: 'idle', gapMs: 3 })
    const outputs = feed(framer, [
      { bytes: bytes(1), at: 0 },
      { bytes: bytes(2), at: 1 },
      { bytes: bytes(3), at: 2 },
    ])
    expect(frameHexes(outputs)).toEqual([])
    expect(frameHexes([framer.flush(5)])).toEqual(['01 02 03'])
  })

  it('超长：超过 maxFrameLength 的缓冲被丢弃并上报', () => {
    const framer = createFramer({ type: 'idle', gapMs: 5, maxFrameLength: 4 })
    const outputs = feed(framer, [{ bytes: bytes(1, 2, 3, 4, 5), at: 1 }])
    expect(frameHexes(outputs)).toEqual([])
    expect(discardedByteCount(outputs)).toBe(5)
    expect(discardReasons(outputs)).toEqual(['overflow'])
    expect(framer.flush(10).frames).toHaveLength(0)
  })

  it('reset 清空缓冲与时间戳', () => {
    const framer = createFramer({ type: 'idle', gapMs: 5 })
    feed(framer, [{ bytes: bytes(1, 2), at: 0 }])
    framer.reset()
    expect(framer.flush(1).frames).toHaveLength(0)
  })
})
