/**
 * 波形图数据组装（plan §8.11「图表实现要求」）。
 *
 * - 多个变量共用同一条 x 轴：样本序号模式用 idx，时间模式用「相对最新样本的秒数」
 *   （0 = 最新，向左为负）；
 * - 各变量按 x 对齐，缺失的位置填空（`null`）；
 * - 点数超过绘图区宽度 × 4 时先用 `minMaxDecimate` 抽取到绘图区宽度那么多段。
 */

import { minMaxDecimate } from '@/domains/series/public'

/** 一条未对齐的序列。 */
export interface RawSeries {
  x: ArrayLike<number>
  y: ArrayLike<number>
}

/** 对齐后的多序列数据。 */
export interface AlignedSeries {
  x: number[]
  ys: Array<Array<number | null>>
  /** 对齐后的点数（交给 uPlot 的点数）。 */
  pointCount: number
}

/** 绘图区宽度估算：容器宽度减去左侧 y 轴占位。 */
export function plotWidthOf(width: number): number {
  return Math.max(64, Math.round(width - 56))
}

/** 当前最新样本时间（毫秒）；没有任何样本时返回 `undefined`。 */
export function latestTimeOf(slices: readonly { t: ArrayLike<number> }[]): number | undefined {
  let latest: number | undefined
  for (const slice of slices) {
    const length = slice.t.length
    if (length === 0) continue
    const value = slice.t[length - 1] as number
    if (latest === undefined || value > latest) latest = value
  }
  return latest
}

/** 用最近点二分查找匹配的 x 下标。 */
function indexOfX(x: ArrayLike<number>, target: number): number {
  let low = 0
  let high = x.length - 1
  while (low <= high) {
    const middle = (low + high) >> 1
    const value = x[middle] as number
    if (value === target) return middle
    if (value < target) low = middle + 1
    else high = middle - 1
  }
  return -1
}

/** 检查非空序列是否共享完全一致且严格递增的有限 x 轴。 */
function sharesStrictAscendingX(nonEmpty: readonly RawSeries[]): boolean {
  const first = nonEmpty[0]
  if (!first) return false
  const len = first.x.length
  const firstX = first.x
  let prev = Number.NEGATIVE_INFINITY
  for (let i = 0; i < len; i += 1) {
    const val = firstX[i] as number
    if (!Number.isFinite(val) || val <= prev) return false
    prev = val
  }
  for (let s = 1; s < nonEmpty.length; s += 1) {
    const other = nonEmpty[s]!.x
    if (other.length !== len) return false
    if (other === firstX) continue
    for (let i = 0; i < len; i += 1) {
      if (other[i] !== firstX[i]) return false
    }
  }
  return true
}

/** 把多个序列按 x 合并对齐。 */
export function alignSeries(series: readonly RawSeries[]): AlignedSeries {
  const nonEmpty = series.filter((item) => item.x.length > 0)
  if (nonEmpty.length === 0) {
    return { x: [], ys: series.map(() => []), pointCount: 0 }
  }

  // 同源同窗序列直接线性拷贝，跳过 Set / sort / 二分查找（plan §11.5 @perf）。
  if (sharesStrictAscendingX(nonEmpty)) {
    const firstX = nonEmpty[0]!.x
    const len = firstX.length
    const x = new Array<number>(len)
    for (let i = 0; i < len; i += 1) x[i] = firstX[i] as number
    const ys: Array<Array<number | null>> = series.map((item) => {
      if (item.x.length === 0) return new Array<number | null>(len).fill(null)
      const values = new Array<number | null>(len)
      const y = item.y
      for (let i = 0; i < len; i += 1) {
        const value = y[i] as number
        values[i] = Number.isFinite(value) ? value : null
      }
      return values
    })
    return { x, ys, pointCount: len }
  }

  const seen = new Set<number>()
  const union: number[] = []
  for (const item of nonEmpty) {
    for (let index = 0; index < item.x.length; index += 1) {
      const value = item.x[index] as number
      if (Number.isFinite(value) && !seen.has(value)) {
        seen.add(value)
        union.push(value)
      }
    }
  }
  union.sort((left, right) => left - right)

  const ys: Array<Array<number | null>> = series.map((item) => {
    const values: Array<number | null> = new Array<number | null>(union.length).fill(null)
    if (item.x.length === 0) return values
    for (let index = 0; index < union.length; index += 1) {
      const target = union[index] as number
      const sourceIndex = indexOfX(item.x, target)
      if (sourceIndex < 0) continue
      const value = item.y[sourceIndex] as number
      values[index] = Number.isFinite(value) ? value : null
    }
    return values
  })

  return { x: union, ys, pointCount: union.length }
}

/**
 * 对齐后的多序列再抽取一次：每段保留每条序列的最小值/最大值点。
 *
 * 点数不超过 `buckets * 4` 时原样返回；全部为 `null` 的段不会产生新点。
 */
export function decimateAligned(data: AlignedSeries, buckets: number): AlignedSeries {
  const segments = Math.max(1, Math.floor(buckets))
  const length = data.x.length
  if (length <= segments * 4 || data.ys.length === 0) return data

  const keep = new Uint8Array(length)
  keep[0] = 1
  keep[length - 1] = 1

  for (let bucket = 0; bucket < segments; bucket += 1) {
    const start = Math.floor((bucket * length) / segments)
    const end = Math.floor(((bucket + 1) * length) / segments)
    if (end <= start) continue
    for (const values of data.ys) {
      let minIndex = -1
      let maxIndex = -1
      let minValue = Number.POSITIVE_INFINITY
      let maxValue = Number.NEGATIVE_INFINITY
      for (let index = start; index < end; index += 1) {
        const value = values[index]
        if (value === null || value === undefined || !Number.isFinite(value)) continue
        if (value < minValue) {
          minValue = value
          minIndex = index
        }
        if (value > maxValue) {
          maxValue = value
          maxIndex = index
        }
      }
      if (minIndex >= 0) keep[minIndex] = 1
      if (maxIndex >= 0) keep[maxIndex] = 1
    }
  }

  const x: number[] = []
  const ys: Array<Array<number | null>> = data.ys.map(() => [])
  for (let index = 0; index < length; index += 1) {
    if (keep[index] === 0) continue
    x.push(data.x[index] as number)
    for (let seriesIndex = 0; seriesIndex < data.ys.length; seriesIndex += 1) {
      const target = ys[seriesIndex]
      if (target) target.push(data.ys[seriesIndex]?.[index] ?? null)
    }
  }

  return { x, ys, pointCount: x.length }
}

/** 单序列按绘图区宽度抽取（`minMaxDecimate` 的薄封装）。 */
export function decimateRaw(series: RawSeries, buckets: number): RawSeries {
  const length = Math.min(series.x.length, series.y.length)
  if (length <= buckets * 4) return series
  const decimated = minMaxDecimate(series.x, series.y, buckets)
  return { x: decimated.x, y: decimated.y }
}

/** 把一条 `SeriesSlice` 转成 uPlot 的 x 轴（相对秒或 idx）。 */
export function sliceToRaw(
  slice: { idx: ArrayLike<number>; t: ArrayLike<number>; v: ArrayLike<number> },
  mode: 'idx' | 'time',
  latestT: number | undefined,
): RawSeries {
  if (mode === 'idx') return { x: slice.idx, y: slice.v }
  const base = latestT ?? (slice.t.length > 0 ? (slice.t[slice.t.length - 1] as number) : 0)
  const relative = new Float64Array(slice.t.length)
  for (let index = 0; index < slice.t.length; index += 1) {
    relative[index] = Math.round((slice.t[index] as number) - base) / 1000
  }
  return { x: relative, y: slice.v }
}
