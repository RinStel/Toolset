/** 分帧统一入口：按 `FramingSpec` 创建分帧器（plan §6.5）。 */

import { parseHex } from '../../bytes/public'
import {
  normalizeMaxFrameLength,
  type Framer,
  type FramingSpec,
  type LengthFramingSpec,
} from '../types'
import { DelimiterFramer } from './delimiter'
import { FixedFramer } from './fixed'
import { IdleFramer } from './idle'
import { LengthFramer } from './length'
import { LineFramer } from './line'

export type { FrameEvent, Framer, FramerDiscard, FramerDiscardReason, FramerOutput } from '../types'

export interface FramerOptions {
  /** 覆盖协议定义里的 `maxFrameLength`。 */
  maxFrameLength?: number
}

function requireHex(text: string, field: string): number[] {
  const result = parseHex(text)
  if (!result.ok) throw new Error(`${field} 不是合法的 HEX 字符串：${result.error}`)
  return Array.from(result.bytes)
}

function createLengthFramer(spec: LengthFramingSpec, maxFrameLength: number): Framer {
  return new LengthFramer(
    spec.header === undefined ? null : requireHex(spec.header, 'framing.length.header'),
    spec.length,
    maxFrameLength,
  )
}

/**
 * 创建分帧器。
 *
 * 配置来自已校验的 `FramingSpec`；HEX 字符串非法时抛错（`validate.ts` 会先拦截）。
 */
export function createFramer(spec: FramingSpec, options: FramerOptions = {}): Framer {
  const maxFrameLength = normalizeMaxFrameLength(options.maxFrameLength ?? spec.maxFrameLength)
  switch (spec.type) {
    case 'line':
      return new LineFramer(spec.eol ?? 'lf', spec.includeEol ?? false, maxFrameLength)
    case 'delimiter':
      return new DelimiterFramer(
        spec.start === undefined ? null : requireHex(spec.start, 'framing.delimiter.start'),
        requireHex(spec.end, 'framing.delimiter.end'),
        spec.include ?? 'content',
        maxFrameLength,
      )
    case 'fixed':
      return new FixedFramer(
        spec.length,
        spec.header === undefined ? null : requireHex(spec.header, 'framing.fixed.header'),
        spec.trailer === undefined ? null : requireHex(spec.trailer, 'framing.fixed.trailer'),
        maxFrameLength,
      )
    case 'length':
      return createLengthFramer(spec, maxFrameLength)
    case 'idle':
      return new IdleFramer(spec.gapMs, maxFrameLength)
    default: {
      const exhaustive: never = spec
      throw new Error(`不支持的分帧模式：${String(exhaustive)}`)
    }
  }
}
