/**
 * 同批帧的时间戳插值（plan §6.8）。
 *
 * 同一批 `frames` 中 `at` 相同的 n 个帧共享一个块时间戳。若该源上一个样本的时间
 * `lastT` 存在且 `0 < at - lastT ≤ 1000`，则第 i 帧（从 0 开始）的时间为
 * `lastT + (at - lastT) × (i + 1) / n`；否则 n 帧都使用 `at`。返回值保证单调不减。
 */

/** 只读取 `at` 的最小帧结构，便于单元测试。 */
export interface TimedFrame {
  at: number
}

const MAX_INTERPOLATION_GAP_MS = 1000

/**
 * 计算一批帧的时间戳。
 *
 * @param frames 本批需要写入样本的帧（按处理顺序）。
 * @param lastT 该源上一个样本的时间；不存在时传 `undefined`。
 */
export function interpolateTimestamps(
  frames: readonly TimedFrame[],
  lastT: number | undefined,
): number[] {
  const result: number[] = new Array<number>(frames.length)
  let previous: number | undefined = Number.isFinite(lastT) ? lastT : undefined
  let index = 0
  while (index < frames.length) {
    const first = frames[index] as TimedFrame
    const at = first.at
    let end = index + 1
    while (end < frames.length && (frames[end] as TimedFrame).at === at) end += 1
    const n = end - index
    const start = previous
    const interpolate =
      start !== undefined && at > start && at - start > 0 && at - start <= MAX_INTERPOLATION_GAP_MS
    for (let i = index; i < end; i += 1) {
      const t = interpolate
        ? (start as number) + ((at - (start as number)) * (i - index + 1)) / n
        : at
      // 单调不减：乱序到达的帧也不产生倒退的时间戳。
      previous = previous !== undefined && t < previous ? previous : t
      result[i] = previous
    }
    index = end
  }
  return result
}
