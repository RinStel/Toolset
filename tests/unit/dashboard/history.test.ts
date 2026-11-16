import { describe, expect, it } from 'vitest'

import { createHistory, DEFAULT_HISTORY_LIMIT } from '../../../src/domains/dashboard/public'

interface FakeClock {
  now: () => number
  advance: (milliseconds: number) => void
}

function fakeClock(start = 0): FakeClock {
  let current = start
  return {
    now: () => current,
    advance(milliseconds: number) {
      current += milliseconds
    },
  }
}

describe('createHistory', () => {
  it('exposes the default limit', () => {
    expect(DEFAULT_HISTORY_LIMIT).toBe(100)
  })

  it('pushes, undoes and redoes', () => {
    const history = createHistory(0)
    expect(history.current()).toBe(0)
    expect(history.canUndo()).toBe(false)
    expect(history.canRedo()).toBe(false)

    history.push(1)
    history.push(2)
    history.push(3)
    expect(history.current()).toBe(3)
    expect(history.canUndo()).toBe(true)
    expect(history.canRedo()).toBe(false)

    expect(history.undo()).toBe(2)
    expect(history.undo()).toBe(1)
    expect(history.undo()).toBe(0)
    expect(history.canUndo()).toBe(false)
    expect(history.undo()).toBe(0)

    expect(history.redo()).toBe(1)
    expect(history.redo()).toBe(2)
    expect(history.redo()).toBe(3)
    expect(history.redo()).toBe(3)
    expect(history.canRedo()).toBe(false)
  })

  it('drops the oldest entries beyond the limit', () => {
    const history = createHistory(0, { limit: 2 })
    expect(history.limit()).toBe(2)
    history.push(1)
    history.push(2)
    history.push(3)
    expect(history.undo()).toBe(2)
    expect(history.undo()).toBe(1)
    expect(history.canUndo()).toBe(false)
  })

  it('merges pushes with the same mergeKey inside 500ms', () => {
    const clock = fakeClock()
    const history = createHistory(0, { now: clock.now })
    history.push(1, 'slider')
    clock.advance(100)
    history.push(2, 'slider')
    clock.advance(100)
    history.push(3, 'slider')
    expect(history.current()).toBe(3)
    // 三次 push 合并成一步：撤销回到初始值。
    expect(history.undo()).toBe(0)
    expect(history.canUndo()).toBe(false)
  })

  it('starts a new step when the merge window is exceeded', () => {
    const clock = fakeClock()
    const history = createHistory(0, { now: clock.now })
    history.push(1, 'slider')
    clock.advance(600)
    history.push(2, 'slider')
    expect(history.undo()).toBe(1)
    expect(history.undo()).toBe(0)
  })

  it('does not merge different mergeKeys', () => {
    const clock = fakeClock()
    const history = createHistory(0, { now: clock.now })
    history.push(1, 'a')
    clock.advance(50)
    history.push(2, 'b')
    expect(history.undo()).toBe(1)
  })

  it('does not merge pushes without a mergeKey', () => {
    const clock = fakeClock()
    const history = createHistory(0, { now: clock.now })
    history.push(1)
    clock.advance(50)
    history.push(2)
    expect(history.undo()).toBe(1)
  })

  it('clears redo after a push following an undo', () => {
    const history = createHistory(0)
    history.push(1)
    history.push(2)
    expect(history.undo()).toBe(1)
    expect(history.canRedo()).toBe(true)
    history.push(9)
    expect(history.current()).toBe(9)
    expect(history.canRedo()).toBe(false)
  })

  it('does not merge across an undo', () => {
    const clock = fakeClock()
    const history = createHistory(0, { now: clock.now })
    history.push(1, 'slider')
    clock.advance(10)
    expect(history.undo()).toBe(0)
    clock.advance(10)
    history.push(2, 'slider')
    expect(history.undo()).toBe(0)
    expect(history.canUndo()).toBe(false)
  })

  it('keeps object states by reference', () => {
    const first = { value: 1 }
    const second = { value: 2 }
    const history = createHistory(first)
    history.push(second)
    expect(history.undo()).toBe(first)
    expect(history.redo()).toBe(second)
  })
})
