import { describe, expect, it } from 'vitest'

import {
  COLS,
  GRID_GAP,
  calcColumnWidth,
  collides,
  compact,
  moveItem,
  normalize,
  placeNew,
  rectToPixels,
  resizeItem,
} from '../../../src/domains/dashboard/public'
import type { Rect } from '../../../src/domains/dashboard/public'

function rect(id: string, x: number, y: number, w: number, h: number): Rect {
  return { id, x, y, w, h }
}

function expectNoOverlap(items: readonly Rect[]): void {
  for (let i = 0; i < items.length; i += 1) {
    for (let j = i + 1; j < items.length; j += 1) {
      const a = items[i]
      const b = items[j]
      if (!a || !b) continue
      expect(collides(a, b), `${a.id} 与 ${b.id} 重叠`).toBe(false)
    }
  }
}

function expectWithinGrid(items: readonly Rect[]): void {
  for (const item of items) {
    expect(item.x).toBeGreaterThanOrEqual(0)
    expect(item.y).toBeGreaterThanOrEqual(0)
    expect(item.w).toBeGreaterThanOrEqual(1)
    expect(item.w).toBeLessThanOrEqual(COLS)
    expect(item.h).toBeGreaterThanOrEqual(1)
    expect(item.h).toBeLessThanOrEqual(64)
    expect(item.x + item.w).toBeLessThanOrEqual(COLS)
  }
}

function expectLayoutValid(items: readonly Rect[]): void {
  expectNoOverlap(items)
  expectWithinGrid(items)
}

/** 线性同余伪随机数，保证性质测试可复现。 */
function seededRandom(seed: number): () => number {
  let state = seed >>> 0
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0
    return state / 0x1_0000_0000
  }
}

describe('collides', () => {
  it('detects geometric overlap', () => {
    expect(collides(rect('a', 0, 0, 2, 2), rect('b', 1, 1, 2, 2))).toBe(true)
    expect(collides(rect('a', 0, 0, 2, 2), rect('b', 2, 0, 2, 2))).toBe(false)
    expect(collides(rect('a', 0, 0, 2, 2), rect('b', 0, 2, 2, 2))).toBe(false)
    expect(collides(rect('a', 0, 0, 4, 4), rect('b', 1, 1, 1, 1))).toBe(true)
    expect(collides(rect('a', 0, 0, 2, 2), rect('b', 2, 2, 2, 2))).toBe(false)
  })
})

describe('compact', () => {
  it('moves items up until they hit the top or another item', () => {
    const items = [rect('a', 0, 5, 12, 2), rect('b', 0, 9, 12, 2), rect('c', 12, 5, 12, 2)]
    const result = compact(items)
    expect(result.map((item) => [item.id, item.x, item.y])).toEqual([
      ['a', 0, 0],
      ['c', 12, 0],
      ['b', 0, 2],
    ])
  })

  it('does not mutate its input', () => {
    const items = [rect('a', 0, 5, 12, 2)]
    const snapshot = JSON.stringify(items)
    compact(items)
    expect(JSON.stringify(items)).toBe(snapshot)
  })
})

describe('moveItem', () => {
  it('clamps x and y into the grid', () => {
    const items = [rect('a', 0, 0, 6, 2)]
    const movedLeft = moveItem(items, 'a', -10, -5)
    expect(movedLeft[0]).toMatchObject({ x: 0, y: 0 })
    const movedRight = moveItem(items, 'a', 1000, 0)
    expect(movedRight[0]).toMatchObject({ x: COLS - 6, y: 0 })
  })

  it('pushes overlapping items down with a recursive cascade', () => {
    // A、B、C 原本在同一条 12 列宽的车道上；把 A 移到 B 的位置后，
    // B 被推到 A 下方，与 B 重叠的 C 又被推到 B 下方。
    const items = [rect('a', 0, 0, 12, 2), rect('b', 12, 0, 12, 2), rect('c', 12, 2, 12, 2)]
    const result = moveItem(items, 'a', 12, 0)
    const byId = new Map(result.map((item) => [item.id, item]))
    expect(byId.get('a')).toMatchObject({ x: 12, y: 0 })
    expect(byId.get('b')).toMatchObject({ x: 12, y: 2 })
    expect(byId.get('c')).toMatchObject({ x: 12, y: 4 })
    expectLayoutValid(result)
  })

  it('keeps the layout valid when the item is dropped onto a stack', () => {
    const items = [rect('a', 0, 0, 12, 2), rect('b', 0, 2, 12, 2), rect('c', 0, 4, 12, 2)]
    const result = moveItem(items, 'c', 0, 1)
    const byId = new Map(result.map((item) => [item.id, item]))
    expect(byId.get('c')?.y).toBe(0)
    expectLayoutValid(result)
  })

  it('returns the items unchanged when the id does not exist', () => {
    const items = [rect('a', 0, 0, 6, 2)]
    expect(moveItem(items, 'missing', 5, 5)).toBe(items)
  })
})

describe('resizeItem', () => {
  it('respects minW/minH and the grid limit', () => {
    const items: Rect[] = [{ id: 'a', x: 2, y: 0, w: 6, h: 3, minW: 4, minH: 3 }]
    const grown = resizeItem(items, 'a', 1, 1)
    expect(grown[0]).toMatchObject({ w: 4, h: 3 })

    const maxed = resizeItem(items, 'a', 100, 100)
    expect(maxed[0]).toMatchObject({ w: COLS - 2, h: 64 })
    expectLayoutValid(maxed)
  })

  it('pushes overlapping items down', () => {
    const items = [rect('a', 0, 0, 6, 2), rect('b', 6, 0, 6, 2)]
    const result = resizeItem(items, 'a', 12, 2)
    const byId = new Map(result.map((item) => [item.id, item]))
    expect(byId.get('a')).toMatchObject({ w: 12, h: 2 })
    expect(byId.get('b')?.y).toBe(2)
    expectLayoutValid(result)
  })
})

describe('placeNew', () => {
  it('places the first widget at the top-left corner', () => {
    const result = placeNew([], 6, 3)
    expect(result.placed).toMatchObject({ x: 0, y: 0, w: 6, h: 3 })
    expect(result.items).toHaveLength(1)
  })

  it('finds the first free position scanning top-down, left-to-right', () => {
    const items = [rect('a', 0, 0, 24, 2)]
    const below = placeNew(items, 6, 2)
    expect(below.placed).toMatchObject({ x: 0, y: 2 })

    const row = [rect('a', 0, 0, 6, 2), rect('b', 12, 0, 6, 2)]
    const between = placeNew(row, 6, 2)
    expect(between.placed).toMatchObject({ x: 6, y: 0 })
  })

  it('honours an explicit position and pushes items below it', () => {
    const items = [rect('a', 0, 0, 12, 2)]
    const result = placeNew(items, 6, 2, { x: 0, y: 0, id: 'new' })
    const byId = new Map(result.items.map((item) => [item.id, item]))
    expect(byId.get('new')).toMatchObject({ x: 0, y: 0, w: 6, h: 2 })
    expect(byId.get('a')?.y).toBe(2)
    expect(result.placed.id).toBe('new')
    expectLayoutValid(result.items)
  })

  it('clamps an explicit position into the grid', () => {
    const result = placeNew([], 8, 2, { x: 100, y: -4 })
    expect(result.placed).toMatchObject({ x: COLS - 8, y: 0 })
  })
})

describe('normalize', () => {
  it('fixes out-of-bounds rectangles', () => {
    const items: Rect[] = [
      { id: 'a', x: -4, y: -2, w: 30, h: 100 },
      { id: 'b', x: 23, y: 0, w: 10, h: 0 },
    ]
    const result = normalize(items)
    expectWithinGrid(result)
    expect(result).toHaveLength(2)
  })

  it('resolves overlaps', () => {
    const items = [rect('a', 0, 0, 24, 4), rect('b', 0, 0, 12, 4), rect('c', 12, 0, 12, 4)]
    const result = normalize(items)
    expectNoOverlap(result)
    expect(result).toHaveLength(3)
  })

  it('does not mutate its input', () => {
    const items = [rect('a', 0, 0, 24, 4), rect('b', 0, 0, 12, 4)]
    const snapshot = JSON.stringify(items)
    normalize(items)
    expect(JSON.stringify(items)).toBe(snapshot)
  })
})

describe('property test (200 random operations)', () => {
  it('keeps the layout non-overlapping and inside the grid', () => {
    const random = seededRandom(20240601)
    let items: Rect[] = []
    for (let index = 0; index < 6; index += 1) {
      items.push(rect(`i${index}`, 0, 0, 4, 2))
    }
    items = normalize(items)
    expectLayoutValid(items)

    for (let round = 0; round < 200; round += 1) {
      const target = items[Math.floor(random() * items.length)]
      const operation = random()
      if (!target) break
      if (operation < 0.25) {
        items = moveItem(
          items,
          target.id,
          Math.floor(random() * 30) - 3,
          Math.floor(random() * 30) - 3,
        )
      } else if (operation < 0.5) {
        items = resizeItem(items, target.id, Math.floor(random() * 30), Math.floor(random() * 20))
      } else if (operation < 0.7) {
        const placed = placeNew(
          items,
          1 + Math.floor(random() * 12),
          1 + Math.floor(random() * 6),
          random() < 0.5
            ? { x: Math.floor(random() * 24), y: Math.floor(random() * 20) }
            : undefined,
        )
        items = placed.items
      } else if (operation < 0.85) {
        items = normalize([
          ...items,
          {
            id: `r${round}`,
            x: Math.floor(random() * 30) - 5,
            y: Math.floor(random() * 30) - 5,
            w: Math.floor(random() * 30),
            h: Math.floor(random() * 30),
          },
        ])
      } else {
        items = compact(items)
      }
      expectLayoutValid(items)
    }

    const ids = items.map((item) => item.id)
    expect(new Set(ids).size).toBe(ids.length)
  })
})

describe('pixel conversion', () => {
  it('computes the column width from 24 columns and 25 gaps', () => {
    const paneWidth = 1000
    const columnWidth = calcColumnWidth(paneWidth)
    expect(columnWidth).toBeCloseTo((paneWidth - GRID_GAP * 25) / 24)
    expect(GRID_GAP).toBe(6)
  })

  it('converts a full-width rect to exactly the pane width', () => {
    const paneWidth = 1000
    const columnWidth = calcColumnWidth(paneWidth)
    const pixels = rectToPixels(rect('a', 0, 0, 24, 4), { columnWidth, rowHeight: 28 })
    expect(pixels.left).toBe(GRID_GAP)
    expect(pixels.left + pixels.width + GRID_GAP).toBeCloseTo(paneWidth)
    expect(pixels.top).toBe(GRID_GAP)
  })

  it('accounts for gaps between columns', () => {
    const columnWidth = 30
    const pixels = rectToPixels(rect('a', 1, 2, 2, 3), { columnWidth, rowHeight: 20 })
    expect(pixels.left).toBe(GRID_GAP + columnWidth + GRID_GAP)
    expect(pixels.top).toBe(GRID_GAP + 2 * (20 + GRID_GAP))
    expect(pixels.width).toBe(2 * columnWidth + GRID_GAP)
    expect(pixels.height).toBe(3 * 20 + 2 * GRID_GAP)
  })
})
