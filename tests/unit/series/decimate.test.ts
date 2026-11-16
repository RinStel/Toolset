import { describe, expect, it } from 'vitest'

import { minMaxDecimate } from '../../../src/domains/series/decimate'

function ramp(length: number): { x: Float64Array; y: Float64Array } {
  const x = new Float64Array(length)
  const y = new Float64Array(length)
  for (let i = 0; i < length; i += 1) {
    x[i] = i
    y[i] = i % 2
  }
  return { x, y }
}

describe('series/decimate', () => {
  it('点数不超过 4×buckets 时原样返回', () => {
    const { x, y } = ramp(40)
    const result = minMaxDecimate(x, y, 10)
    expect(Array.from(result.x)).toEqual(Array.from(x))
    expect(Array.from(result.y)).toEqual(Array.from(y))
    expect(result.x).not.toBe(x)
  })

  it('每段保留最小值与最大值（按 x 顺序）', () => {
    const x = new Float64Array(100)
    const y = new Float64Array(100)
    for (let i = 0; i < 100; i += 1) x[i] = i
    y[10] = 100
    y[30] = -100
    const result = minMaxDecimate(x, y, 5)
    expect(result.x.length).toBeLessThanOrEqual(10)
    expect(Array.from(result.y)).toContain(100)
    expect(Array.from(result.y)).toContain(-100)
    for (let i = 1; i < result.x.length; i += 1) {
      expect(result.x[i] as number).toBeGreaterThan(result.x[i - 1] as number)
    }
  })

  it('输出点数不超过 2×buckets，并覆盖全局极值', () => {
    const length = 500
    const x = new Float64Array(length)
    const y = new Float64Array(length)
    for (let i = 0; i < length; i += 1) {
      x[i] = i
      y[i] = Math.sin(i / 10)
    }
    y[123] = 99
    y[321] = -99
    const result = minMaxDecimate(x, y, 12)
    expect(result.x.length).toBeLessThanOrEqual(24)
    expect(result.x).toHaveLength(result.y.length)
    expect(Array.from(result.y)).toContain(99)
    expect(Array.from(result.y)).toContain(-99)
  })

  it('每个段（bucket）内的极值都被保留', () => {
    const buckets = 3
    const perBucket = 10
    const length = buckets * perBucket + 1
    const x = new Float64Array(length)
    const y = new Float64Array(length)
    for (let i = 0; i < length; i += 1) {
      x[i] = i
      y[i] = 0
    }
    for (let bucket = 0; bucket < buckets; bucket += 1) {
      y[bucket * perBucket + 2] = 100 + bucket
      y[bucket * perBucket + 7] = -100 - bucket
    }
    const result = minMaxDecimate(x, y, buckets)
    for (let bucket = 0; bucket < buckets; bucket += 1) {
      expect(Array.from(result.y)).toContain(100 + bucket)
      expect(Array.from(result.y)).toContain(-100 - bucket)
    }
  })

  it('长度不一致时以较短的长度为准，非法 buckets 按 1 处理', () => {
    const result = minMaxDecimate(new Float64Array([0, 1, 2, 3, 4]), new Float64Array([0, 1]), 5)
    expect(Array.from(result.x)).toEqual([0, 1])
    expect(Array.from(result.y)).toEqual([0, 1])

    const fallback = minMaxDecimate(ramp(10).x, ramp(10).y, Number.NaN)
    expect(fallback.x.length).toBeLessThanOrEqual(2)
  })

  it('空数据返回空数组', () => {
    const result = minMaxDecimate(new Float64Array(0), new Float64Array(0), 4)
    expect(result.x).toHaveLength(0)
    expect(result.y).toHaveLength(0)
  })
})
