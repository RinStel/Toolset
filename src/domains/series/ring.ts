/**
 * 定长环形缓冲（plan §6.8）。
 *
 * 每个变量有三个 `Float64Array`：`idx`、`t`、`v`。缓冲从 1024 个样本起步，
 * 写满后翻倍扩容，直到变量自身的 `capacity`（创建时从 hub 的当前配置读取）；
 * 达到容量后覆盖最旧的样本。`read()` 只在被调用时复制，并且总是返回新数组。
 */

import {
  DEFAULT_READ_LIMIT,
  INITIAL_RING_CAPACITY,
  type SeriesReadQuery,
  type SeriesSlice,
} from './types'

function normalizeLimit(value: number | undefined): number {
  if (value === undefined) return DEFAULT_READ_LIMIT
  if (!Number.isFinite(value)) return DEFAULT_READ_LIMIT
  const limit = Math.floor(value)
  return limit > 0 ? limit : 0
}

export class SeriesRing {
  readonly capacity: number

  private idx: Float64Array
  private t: Float64Array
  private v: Float64Array
  private alloc: number
  /** 最旧样本在物理数组中的位置。 */
  private start = 0
  /** 下一个写入位置（仅在未写满时有效）。 */
  private pos = 0
  private countValue = 0

  constructor(capacity: number) {
    const normalized = Number.isFinite(capacity) ? Math.floor(capacity) : INITIAL_RING_CAPACITY
    this.capacity = Math.max(1, normalized)
    this.alloc = Math.min(INITIAL_RING_CAPACITY, this.capacity)
    this.idx = new Float64Array(this.alloc)
    this.t = new Float64Array(this.alloc)
    this.v = new Float64Array(this.alloc)
  }

  get count(): number {
    return this.countValue
  }

  /** 第 `logical` 个样本（0 为最旧）在物理数组中的下标。 */
  private physical(logical: number): number {
    return (this.start + logical) % this.alloc
  }

  /**
   * 写入一个样本。
   *
   * 参数由调用方保证 `idx` 单调递增，`t` 单调不减。
   */
  push(idx: number, t: number, value: number): void {
    if (this.countValue === this.alloc) {
      if (this.alloc < this.capacity) {
        this.grow()
      } else {
        // 容量已满：覆盖最旧样本，写入位置即最旧样本的位置。
        this.idx[this.pos] = idx
        this.t[this.pos] = t
        this.v[this.pos] = value
        this.pos = (this.pos + 1) % this.alloc
        this.start = this.pos
        return
      }
    }
    this.idx[this.pos] = idx
    this.t[this.pos] = t
    this.v[this.pos] = value
    this.pos = (this.pos + 1) % this.alloc
    this.countValue += 1
  }

  /** 翻倍扩容，并按逻辑顺序把已有样本搬到新数组的前部。 */
  private grow(): void {
    const next = Math.min(this.capacity, this.alloc * 2)
    const idx = new Float64Array(next)
    const t = new Float64Array(next)
    const v = new Float64Array(next)
    for (let i = 0; i < this.countValue; i += 1) {
      const p = this.physical(i)
      idx[i] = this.idx[p] as number
      t[i] = this.t[p] as number
      v[i] = this.v[p] as number
    }
    this.idx = idx
    this.t = t
    this.v = v
    this.alloc = next
    this.start = 0
    this.pos = this.countValue
  }

  /** 最新样本值；缓冲为空时返回 `undefined`。 */
  get last(): number | undefined {
    if (this.countValue === 0) return undefined
    return this.v[this.physical(this.countValue - 1)]
  }

  /** 最新样本时间；缓冲为空时返回 `undefined`。 */
  get lastT(): number | undefined {
    if (this.countValue === 0) return undefined
    return this.t[this.physical(this.countValue - 1)]
  }

  /** 最新样本的 idx；缓冲为空时返回 `undefined`。 */
  get lastIdx(): number | undefined {
    if (this.countValue === 0) return undefined
    return this.idx[this.physical(this.countValue - 1)]
  }

  /**
   * 读取满足条件的最新 `limit` 个样本，按 idx 升序返回新数组。
   *
   * 利用 `idx` 单调递增、`t` 单调不减的不变式做二分定位，再用 `subarray` 分段拷贝，
   * 将高频小窗口读取从 O(count) 降为 O(log count + matched)。
   */
  read(query: SeriesReadQuery = {}): SeriesSlice {
    const limit = Math.min(normalizeLimit(query.limit), normalizeLimit(query.last))
    if (limit === 0 || this.countValue === 0) return this.emptySlice()

    let lo = 0
    let hi = this.countValue
    if (query.sinceIdx !== undefined) lo = Math.max(lo, this.lowerBound(this.idx, query.sinceIdx))
    if (query.fromT !== undefined) lo = Math.max(lo, this.lowerBound(this.t, query.fromT))
    if (query.toT !== undefined) hi = Math.min(hi, this.upperBound(this.t, query.toT))
    if (hi <= lo) return this.emptySlice()

    const matched = Math.min(hi - lo, limit)
    return this.copyRange(hi - matched, matched)
  }

  private lowerBound(array: Float64Array, target: number): number {
    let lo = 0
    let hi = this.countValue
    while (lo < hi) {
      const mid = (lo + hi) >>> 1
      if ((array[this.physical(mid)] as number) < target) lo = mid + 1
      else hi = mid
    }
    return lo
  }

  private upperBound(array: Float64Array, target: number): number {
    let lo = 0
    let hi = this.countValue
    while (lo < hi) {
      const mid = (lo + hi) >>> 1
      if ((array[this.physical(mid)] as number) <= target) lo = mid + 1
      else hi = mid
    }
    return lo
  }

  clear(): void {
    this.start = 0
    this.pos = 0
    this.countValue = 0
    if (this.alloc > INITIAL_RING_CAPACITY) {
      // 回到初始容量，避免清空后仍长时间占用大数组。
      this.alloc = Math.min(INITIAL_RING_CAPACITY, this.capacity)
      this.idx = new Float64Array(this.alloc)
      this.t = new Float64Array(this.alloc)
      this.v = new Float64Array(this.alloc)
    }
  }

  private emptySlice(): SeriesSlice {
    return { idx: new Float64Array(0), t: new Float64Array(0), v: new Float64Array(0) }
  }

  /** 按逻辑顺序分段复制 `[startLogical, startLogical + length)`。 */
  private copyRange(startLogical: number, length: number): SeriesSlice {
    if (length <= 0) return this.emptySlice()
    const idx = new Float64Array(length)
    const t = new Float64Array(length)
    const v = new Float64Array(length)
    const physStart = this.physical(startLogical)
    const firstChunk = Math.min(length, this.alloc - physStart)
    idx.set(this.idx.subarray(physStart, physStart + firstChunk), 0)
    t.set(this.t.subarray(physStart, physStart + firstChunk), 0)
    v.set(this.v.subarray(physStart, physStart + firstChunk), 0)
    const rest = length - firstChunk
    if (rest > 0) {
      idx.set(this.idx.subarray(0, rest), firstChunk)
      t.set(this.t.subarray(0, rest), firstChunk)
      v.set(this.v.subarray(0, rest), firstChunk)
    }
    return { idx, t, v }
  }
}
