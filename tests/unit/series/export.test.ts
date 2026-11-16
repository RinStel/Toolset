import { describe, expect, it } from 'vitest'

import { exportSeriesCsv } from '../../../src/domains/series/export'
import { createTestSource, variablesFrame } from './helpers'
import type { SeriesSourceImpl } from '../../../src/domains/series/source'

function seeded(): SeriesSourceImpl {
  const source = createTestSource()
  source.handleFrames([variablesFrame(1, 1000, { a: 1.5, b: 2 })])
  source.handleFrames([variablesFrame(2, 2000, { a: 0.1 + 0.2 })])
  source.handleFrames([variablesFrame(3, 3000, { b: 4 })])
  return source
}

function rows(csv: string): string[] {
  return csv.slice(1).replace(/\r\n$/, '').split('\r\n')
}

describe('series/export', () => {
  it('按 idx 合并、缺失变量留空、带 BOM 与表头', () => {
    const csv = exportSeriesCsv(seeded(), ['a', 'b'])
    expect(csv.startsWith('\uFEFF')).toBe(true)
    const lines = rows(csv)
    expect(lines[0]).toBe('frame,time_iso,time_ms,a,b')
    expect(lines[1]).toBe('1,1970-01-01T00:00:01.000Z,1000,1.5,2')
    expect(lines[2]).toBe('2,1970-01-01T00:00:02.000Z,2000,0.30000000000000004,')
    expect(lines[3]).toBe('3,1970-01-01T00:00:03.000Z,3000,,4')
    expect(lines).toHaveLength(4)
    expect(csv.endsWith('\r\n')).toBe(true)
  })

  it('列顺序跟随 keys 参数', () => {
    const csv = exportSeriesCsv(seeded(), ['b', 'a'])
    const lines = rows(csv)
    expect(lines[0]).toBe('frame,time_iso,time_ms,b,a')
    expect(lines[1]).toBe('1,1970-01-01T00:00:01.000Z,1000,2,1.5')
  })

  it('range 按 fromIdx/toIdx 过滤', () => {
    const source = seeded()
    expect(rows(exportSeriesCsv(source, ['a'], { fromIdx: 2, toIdx: 2 }))).toEqual([
      'frame,time_iso,time_ms,a',
      '2,1970-01-01T00:00:02.000Z,2000,0.30000000000000004',
    ])
    expect(rows(exportSeriesCsv(source, ['a'], { fromIdx: 2 }))).toHaveLength(2)
    expect(rows(exportSeriesCsv(source, ['a'], { toIdx: 1 }))).toHaveLength(2)
  })

  it('未知键输出空列，空数据只有表头', () => {
    const csv = exportSeriesCsv(seeded(), ['missing'])
    const lines = rows(csv)
    expect(lines[0]).toBe('frame,time_iso,time_ms,missing')
    expect(lines.slice(1).every((line) => line.endsWith(','))).toBe(true)

    const empty = exportSeriesCsv(createTestSource(), ['a'])
    expect(rows(empty)).toEqual(['frame,time_iso,time_ms,a'])
  })

  it('数值用 String(v) 输出，不做舍入', () => {
    const source = createTestSource()
    source.handleFrames([variablesFrame(1, 0, { a: 1 / 3 })])
    const csv = exportSeriesCsv(source, ['a'])
    expect(rows(csv)[1]?.split(',').at(-1)).toBe(String(1 / 3))
  })
})
