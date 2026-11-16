/**
 * 变量 CSV 导出（plan §6.8）。
 *
 * 格式：UTF-8 带 BOM；列为 `frame,time_iso,time_ms,<key1>,<key2>,…`；按 idx 合并，
 * 每个 idx 一行，该帧中没有出现的变量留空；数值用 `String(v)` 输出，不做舍入。
 */

import type { SeriesExportRange, SeriesSlice, SeriesSource } from './types'

const BOM = '\uFEFF'
const EXPORT_LIMIT = Number.MAX_SAFE_INTEGER
const HEADER = ['frame', 'time_iso', 'time_ms']
const LINE_BREAK = '\r\n'

function csvEscape(value: string): string {
  if (/[",\r\n]/.test(value)) return `"${value.replace(/"/g, '""')}"`
  return value
}

function timeIso(t: number): string {
  if (!Number.isFinite(t)) return ''
  return new Date(t).toISOString()
}

/** 按 idx 合并各变量的样本；返回 UTF-8 带 BOM 的 CSV 文本。 */
export function exportSeriesCsv(
  source: SeriesSource,
  keys: readonly string[],
  range: SeriesExportRange = {},
): string {
  const slices: SeriesSlice[] = keys.map((key) => source.read(key, { limit: EXPORT_LIMIT }))
  const heads: number[] = slices.map(() => 0)
  const fromIdx =
    range.fromIdx !== undefined && Number.isFinite(range.fromIdx)
      ? Math.floor(range.fromIdx)
      : undefined
  const toIdx =
    range.toIdx !== undefined && Number.isFinite(range.toIdx) ? Math.floor(range.toIdx) : undefined

  if (fromIdx !== undefined) {
    for (let k = 0; k < slices.length; k += 1) {
      const slice = slices[k] as SeriesSlice
      let head = heads[k] as number
      while (head < slice.idx.length && (slice.idx[head] as number) < fromIdx) head += 1
      heads[k] = head
    }
  }

  const lines: string[] = []
  lines.push([...HEADER, ...keys.map(csvEscape)].join(','))

  for (;;) {
    let minIdx = Number.POSITIVE_INFINITY
    let minTime = 0
    for (let k = 0; k < slices.length; k += 1) {
      const slice = slices[k] as SeriesSlice
      const head = heads[k] as number
      if (head >= slice.idx.length) continue
      const idx = slice.idx[head] as number
      if (idx < minIdx) {
        minIdx = idx
        minTime = slice.t[head] as number
      }
    }
    if (!Number.isFinite(minIdx)) break
    if (toIdx !== undefined && minIdx > toIdx) break

    const cells: string[] = []
    for (let k = 0; k < slices.length; k += 1) {
      const slice = slices[k] as SeriesSlice
      const head = heads[k] as number
      if (head < slice.idx.length && (slice.idx[head] as number) === minIdx) {
        cells.push(String(slice.v[head] as number))
        heads[k] = head + 1
      } else {
        cells.push('')
      }
    }
    lines.push([String(minIdx), timeIso(minTime), String(minTime), ...cells].join(','))
  }

  return `${BOM}${lines.join(LINE_BREAK)}${LINE_BREAK}`
}
