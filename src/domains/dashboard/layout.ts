/**
 * 24 列网格布局（plan §6.9）。
 *
 * 全部函数都是不可变的纯函数：不修改传入的数组和对象，总是返回新数组。
 * 坐标单位为网格：`x`/`w` 对应列，`y`/`h` 对应行。
 */

import { COLS, MAX_WIDGET_H, MIN_WIDGET_H, MIN_WIDGET_W, MAX_WIDGET_W } from './types'

/** 网格间距，像素（plan §6.9「像素换算」）。 */
export const GRID_GAP = 6

/** 网格矩形；`id` 对应 `WidgetInstance.id`。 */
export interface Rect {
  id: string
  x: number
  y: number
  w: number
  h: number
  minW?: number
  minH?: number
}

/** 放置新组件的结果。 */
export interface PlaceNewResult {
  items: Rect[]
  placed: Rect
}

/** `placeNew` 的落点；`id` 不传时使用确定性的占位 id（w1、w2…）。 */
export interface PlaceNewPosition {
  x: number
  y: number
  id?: string
}

interface PixelGrid {
  /** 单列宽度，见 `calcColumnWidth`。 */
  columnWidth: number
  /** `Dashboard.rowHeight`。 */
  rowHeight: number
}

/** 像素矩形，供 UI 直接写入 CSS。 */
export interface PixelRect {
  left: number
  top: number
  width: number
  height: number
}

/**
 * 单个组件的像素宽度。
 *
 * 列宽 = `(窗格宽 - 6 × 25) / 24`（左右外边距 + 23 个内部间距）。
 */
export function calcColumnWidth(paneWidth: number): number {
  return (paneWidth - GRID_GAP * (COLS + 1)) / COLS
}

/** 网格矩形换算成像素矩形（left/top/width/height）。 */
export function rectToPixels(rect: Rect, grid: PixelGrid): PixelRect {
  const columnWidth = grid.columnWidth
  return {
    left: GRID_GAP + rect.x * (columnWidth + GRID_GAP),
    top: GRID_GAP + rect.y * (grid.rowHeight + GRID_GAP),
    width: rect.w * columnWidth + (rect.w - 1) * GRID_GAP,
    height: rect.h * grid.rowHeight + (rect.h - 1) * GRID_GAP,
  }
}

/** 网格总像素高度（含上下外边距）。 */
export function gridPixelHeight(rows: number, rowHeight: number): number {
  return Math.max(0, rows) * rowHeight + Math.max(0, rows - 1) * GRID_GAP + GRID_GAP * 2
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max)
}

function toInteger(value: number): number {
  return Number.isFinite(value) ? Math.round(value) : 0
}

function clampInt(value: number, min: number, max: number): number {
  return clamp(toInteger(value), min, max)
}

function clone(rect: Rect): Rect {
  return { ...rect }
}

function comparePosition(a: Rect, b: Rect): number {
  if (a.y !== b.y) return a.y - b.y
  if (a.x !== b.x) return a.x - b.x
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0
}

/** 两个矩形是否重叠（几何判断，不比较 id）。 */
export function collides(a: Rect, b: Rect): boolean {
  return a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h
}

/** 把矩形修正到网格范围内，并保证 minW/minH 合法。 */
function sanitize(rect: Rect): Rect {
  const minW = clampInt(rect.minW ?? MIN_WIDGET_W, MIN_WIDGET_W, MAX_WIDGET_W)
  const minH = clampInt(rect.minH ?? MIN_WIDGET_H, MIN_WIDGET_H, MAX_WIDGET_H)
  const w = clampInt(rect.w, minW, MAX_WIDGET_W)
  const h = clampInt(rect.h, minH, MAX_WIDGET_H)
  const x = clampInt(rect.x, 0, COLS - w)
  const y = Math.max(0, toInteger(rect.y))
  const result: Rect = { id: rect.id, x, y, w, h }
  if (rect.minW !== undefined) result.minW = minW
  if (rect.minH !== undefined) result.minH = minH
  return result
}

/**
 * 压紧：按 (y, x) 排序后，逐个尽量上移，直到碰到其他组件或顶部。
 */
export function compact(items: Rect[]): Rect[] {
  const sorted = items.map(clone).sort(comparePosition)
  const placed: Rect[] = []
  for (const item of sorted) {
    let y = Math.max(0, toInteger(item.y))
    while (y > 0) {
      const candidate: Rect = { ...item, y: y - 1 }
      if (placed.some((other) => collides(other, candidate))) break
      y -= 1
    }
    placed.push({ ...item, y })
  }
  return placed
}

/** 递归下推时最多迭代的次数，防止异常输入导致死循环。 */
const MAX_PUSH_ITERATIONS = 10000

/**
 * 把 `moved` 放在目标位置，把与它重叠的组件依次下推（含连锁下推），最后压紧。
 */
function applyAndPush(items: Rect[], moved: Rect): Rect[] {
  const fixed: Rect[] = [moved]
  const others = items.filter((item) => item.id !== moved.id).sort(comparePosition)

  for (const original of others) {
    let candidate: Rect = { ...original }
    let iterations = 0
    for (;;) {
      const collisions = fixed.filter((other) => collides(other, candidate))
      if (collisions.length === 0) break
      let bottom = candidate.y
      for (const other of collisions) bottom = Math.max(bottom, other.y + other.h)
      candidate = { ...candidate, y: bottom }
      iterations += 1
      if (iterations > MAX_PUSH_ITERATIONS) break
    }
    fixed.push(candidate)
  }
  return compact(fixed)
}

/**
 * 移动组件：x 夹在 `[0, 24 - w]`，y ≥ 0；重叠组件依次下推（递归），最后压紧。
 */
export function moveItem(items: Rect[], id: string, x: number, y: number): Rect[] {
  const current = items.find((item) => item.id === id)
  if (!current) return items
  const sanitized = sanitize(current)
  const moved: Rect = {
    ...sanitized,
    x: clampInt(x, 0, COLS - sanitized.w),
    y: Math.max(0, toInteger(y)),
  }
  return applyAndPush(items, moved)
}

/**
 * 缩放组件：宽高夹在 `[minW/minH, 24 - x / 64]` 之间；重叠组件下推，最后压紧。
 */
export function resizeItem(items: Rect[], id: string, w: number, h: number): Rect[] {
  const current = items.find((item) => item.id === id)
  if (!current) return items
  const sanitized = sanitize(current)
  const minW = sanitized.minW ?? MIN_WIDGET_W
  const minH = sanitized.minH ?? MIN_WIDGET_H
  const maxW = COLS - sanitized.x
  const nextW = clampInt(w, Math.min(minW, maxW), maxW)
  const nextH = clampInt(h, Math.min(minH, MAX_WIDGET_H), MAX_WIDGET_H)
  const resized: Rect = { ...sanitized, w: nextW, h: nextH }
  return applyAndPush(items, resized)
}

/** 生成一个不与现有 id 冲突的确定性 id（w1、w2…）。 */
function nextRectId(items: Rect[]): string {
  const used = new Set(items.map((item) => item.id))
  let index = items.length + 1
  while (used.has(`w${index}`)) index += 1
  return `w${index}`
}

/**
 * 放置新组件。
 *
 * - 有 `at` 时等同 `moveItem`（新组件占据该位置，重叠组件被下推）；
 * - 否则从上到下、从左到右找第一个放得下的位置。
 */
export function placeNew(
  items: Rect[],
  w: number,
  h: number,
  at?: PlaceNewPosition,
): PlaceNewResult {
  const width = clampInt(w, MIN_WIDGET_W, MAX_WIDGET_W)
  const height = clampInt(h, MIN_WIDGET_H, MAX_WIDGET_H)

  if (at) {
    const candidate: Rect = {
      id: at.id ?? nextRectId(items),
      x: clampInt(at.x, 0, COLS - width),
      y: Math.max(0, toInteger(at.y)),
      w: width,
      h: height,
    }
    const result = applyAndPush(items, candidate)
    return { items: result, placed: result.find((item) => item.id === candidate.id) ?? candidate }
  }

  const bottom = items.reduce((max, item) => Math.max(max, item.y + item.h), 0)
  for (let y = 0; y <= bottom; y += 1) {
    for (let x = 0; x + width <= COLS; x += 1) {
      const candidate: Rect = { id: nextRectId(items), x, y, w: width, h: height }
      if (items.some((item) => collides(item, candidate))) continue
      const result = compact([...items.map(clone), candidate])
      return {
        items: result,
        placed: result.find((item) => item.id === candidate.id) ?? candidate,
      }
    }
  }

  // 理论上不会到达：最底部一行总能放下。
  const fallback: Rect = { id: nextRectId(items), x: 0, y: bottom, w: width, h: height }
  const result = compact([...items.map(clone), fallback])
  return { items: result, placed: result.find((item) => item.id === fallback.id) ?? fallback }
}

/**
 * 修正越界和重叠（加载时使用）。
 *
 * 先夹取到网格范围，再按 (y, x) 顺序递归下推重叠组件，最后压紧。
 */
export function normalize(items: Rect[]): Rect[] {
  const cleaned = items.map(sanitize).sort(comparePosition)
  const fixed: Rect[] = []
  for (const item of cleaned) {
    let candidate: Rect = { ...item }
    let iterations = 0
    for (;;) {
      const collisions = fixed.filter((other) => collides(other, candidate))
      if (collisions.length === 0) break
      let bottom = candidate.y
      for (const other of collisions) bottom = Math.max(bottom, other.y + other.h)
      candidate = { ...candidate, y: bottom }
      iterations += 1
      if (iterations > MAX_PUSH_ITERATIONS) break
    }
    fixed.push(candidate)
  }
  return compact(fixed)
}
