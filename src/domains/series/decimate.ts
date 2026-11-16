/**
 * 按像素宽度做最小/最大值抽取（plan §6.8）。
 *
 * 把数据分成 `buckets` 段，每段保留最小值与最大值两个点（按 x 顺序），输出最多
 * `2·buckets` 个点。数据点数不超过 `4·buckets` 时原样返回。
 */

import type { DecimatedSeries } from './types'

function copyRange(source: ArrayLike<number>, length: number): Float64Array {
  const copy = new Float64Array(length)
  for (let i = 0; i < length; i += 1) copy[i] = source[i] as number
  return copy
}

/**
 * 把 `(x, y)` 序列抽取到最多 `2 * buckets` 个点。
 *
 * @param x 横轴数据；不足的尾部以较短的数组长度为准。
 * @param y 纵轴数据。
 * @param buckets 目标段数（小于 1 时按 1 处理）。
 */
export function minMaxDecimate(
  x: ArrayLike<number>,
  y: ArrayLike<number>,
  buckets: number,
): DecimatedSeries {
  const length = Math.min(x.length, y.length)
  const segments = Number.isFinite(buckets) ? Math.max(1, Math.floor(buckets)) : 1
  if (length === 0) return { x: new Float64Array(0), y: new Float64Array(0) }
  if (length <= segments * 4) {
    return { x: copyRange(x, length), y: copyRange(y, length) }
  }

  const capacity = segments * 2
  const outX = new Float64Array(capacity)
  const outY = new Float64Array(capacity)
  let count = 0

  for (let bucket = 0; bucket < segments; bucket += 1) {
    const start = Math.floor((bucket * length) / segments)
    const end = Math.floor(((bucket + 1) * length) / segments)
    if (end <= start) continue
    let minIndex = start
    let maxIndex = start
    let minValue = y[start] as number
    let maxValue = minValue
    for (let i = start + 1; i < end; i += 1) {
      const value = y[i] as number
      if (value < minValue) {
        minValue = value
        minIndex = i
      }
      if (value > maxValue) {
        maxValue = value
        maxIndex = i
      }
    }
    if (minIndex === maxIndex) {
      outX[count] = x[minIndex] as number
      outY[count] = minValue
      count += 1
      continue
    }
    const first = minIndex < maxIndex ? minIndex : maxIndex
    const second = minIndex < maxIndex ? maxIndex : minIndex
    outX[count] = x[first] as number
    outY[count] = y[first] as number
    count += 1
    outX[count] = x[second] as number
    outY[count] = y[second] as number
    count += 1
  }

  return { x: outX.slice(0, count), y: outY.slice(0, count) }
}
