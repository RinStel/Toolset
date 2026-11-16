/**
 * 撤销/重做栈（plan §6.9「撤销/重做」）。
 *
 * - `createHistory(initial, { limit: 100 })`；
 * - 500ms 内带相同 `mergeKey` 的连续 `push` 合并为一步（例如连续拖动滑块）；
 * - `undo` 之后 `push` 会清空 redo；
 * - 超过上限时丢弃最早的记录。
 */

/** 默认撤销步数上限。 */
export const DEFAULT_HISTORY_LIMIT = 100

/** 默认合并窗口：500ms。 */
export const DEFAULT_MERGE_WINDOW_MS = 500

export interface HistoryOptions {
  /** 撤销步数上限，默认 100。 */
  limit?: number
  /** 合并窗口，默认 500ms。 */
  mergeWindowMs?: number
  /** 时钟（毫秒）；测试时可注入假时钟，默认 `Date.now()`。 */
  now?: () => number
}

export interface History<T> {
  /** 当前状态。 */
  current(): T
  /** 压入新状态；`mergeKey` 相同且距上次 push 不超过 500ms 时合并。 */
  push(next: T, mergeKey?: string): void
  /** 撤销并返回撤销后的状态；不可撤销时返回当前状态。 */
  undo(): T
  /** 重做并返回重做后的状态；不可重做时返回当前状态。 */
  redo(): T
  canUndo(): boolean
  canRedo(): boolean
  /** 撤销步数上限（构造时传入）。 */
  limit(): number
}

/**
 * 创建撤销/重做栈。
 *
 * @param initial 初始状态
 * @param options 上限、合并窗口与可注入的时钟
 */
export function createHistory<T>(initial: T, options: HistoryOptions = {}): History<T> {
  const limit = Math.max(1, Math.floor(options.limit ?? DEFAULT_HISTORY_LIMIT))
  const mergeWindowMs = Math.max(0, options.mergeWindowMs ?? DEFAULT_MERGE_WINDOW_MS)
  const now = options.now ?? (() => Date.now())

  const past: T[] = []
  const future: T[] = []
  let present = initial
  let lastMergeKey: string | undefined
  let lastPushAt = Number.NEGATIVE_INFINITY

  function resetMergeTracking(): void {
    lastMergeKey = undefined
    lastPushAt = Number.NEGATIVE_INFINITY
  }

  return {
    current(): T {
      return present
    },
    push(next: T, mergeKey?: string): void {
      const at = now()
      const canMerge =
        mergeKey !== undefined &&
        mergeKey === lastMergeKey &&
        past.length > 0 &&
        at - lastPushAt <= mergeWindowMs
      if (canMerge) {
        present = next
        lastPushAt = at
        return
      }
      past.push(present)
      while (past.length > limit) past.shift()
      present = next
      future.length = 0
      lastMergeKey = mergeKey
      lastPushAt = at
    },
    undo(): T {
      if (past.length === 0) return present
      const previous = past.pop() as T
      future.push(present)
      present = previous
      resetMergeTracking()
      return present
    },
    redo(): T {
      if (future.length === 0) return present
      const next = future.pop() as T
      past.push(present)
      while (past.length > limit) past.shift()
      present = next
      resetMergeTracking()
      return present
    },
    canUndo(): boolean {
      return past.length > 0
    },
    canRedo(): boolean {
      return future.length > 0
    },
    limit(): number {
      return limit
    },
  }
}
