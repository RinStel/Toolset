/**
 * 变量时间序列测试的共享工具：构造解码帧与数据源。
 */

import type { DecodedFrame } from '../../../src/domains/link/public'
import type { DecodeResult } from '../../../src/domains/protocol/public'
import {
  createSeriesSource,
  type SeriesSourceImpl,
  type SeriesSourceOptions,
} from '../../../src/domains/series/source'

/** 构造一帧；默认是 RX 方向、无解码错误。 */
export function makeFrame(options: {
  seq: number
  at: number
  results?: DecodeResult[]
  direction?: 'rx' | 'tx'
  error?: string
}): DecodedFrame {
  const frame: DecodedFrame = {
    seq: options.seq,
    bytes: new Uint8Array(0),
    at: options.at,
    direction: options.direction ?? 'rx',
    results: options.results ?? [],
  }
  if (options.error !== undefined) frame.error = options.error
  return frame
}

/** 构造一个只带 `variables` 的帧。 */
export function variablesFrame(
  seq: number,
  at: number,
  variables: Record<string, number>,
  extra: Partial<DecodedFrame> = {},
): DecodedFrame {
  return makeFrame({ seq, at, results: [{ summary: '', variables }], ...extra })
}

/** 构造一个只带 `fields` 的帧。 */
export function fieldsFrame(
  seq: number,
  at: number,
  fields: NonNullable<DecodeResult['fields']>,
  extra: Partial<DecodeResult> = {},
): DecodedFrame {
  return makeFrame({ seq, at, results: [{ summary: '', fields, ...extra }] })
}

/** 用较小的默认容量创建数据源，方便测试扩容与覆盖。 */
export function createTestSource(patch: Partial<SeriesSourceOptions> = {}): SeriesSourceImpl {
  return createSeriesSource({
    sessionId: 's1',
    capacity: () => 1000,
    maxVariablesPerSource: 64,
    totalVariableCount: () => 0,
    ...patch,
  })
}

/** 读取某变量的值数组。 */
export function valuesOf(source: SeriesSourceImpl, key: string): number[] {
  return Array.from(source.read(key).v)
}

/** 读取某变量的 idx 数组。 */
export function indexesOf(source: SeriesSourceImpl, key: string): number[] {
  return Array.from(source.read(key).idx)
}

/** 读取某变量的时间数组。 */
export function timesOf(source: SeriesSourceImpl, key: string): number[] {
  return Array.from(source.read(key).t)
}
