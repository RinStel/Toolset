import { describe, expect, it } from 'vitest'

import { createTestSource, indexesOf, timesOf, valuesOf, variablesFrame } from './helpers'
import type { SeriesSourceImpl } from '../../../src/domains/series/source'

function write(source: SeriesSourceImpl, seq: number, at: number, x: number): void {
  source.handleFrames([variablesFrame(seq, at, { x })])
}

function infoOf(source: SeriesSourceImpl, key: string) {
  return source.variables().find((info) => info.key === key)
}

describe('series/computed', () => {
  it('基本表达式：写入 fx. 前缀的变量并共享帧的 idx 与时间', () => {
    const source = createTestSource()
    expect(source.setComputed([{ key: 'double', expr: 'v.x * 2' }])).toEqual([])
    write(source, 1, 1000, 2)
    write(source, 2, 2000, 3)
    expect(valuesOf(source, 'fx.double')).toEqual([4, 6])
    expect(indexesOf(source, 'fx.double')).toEqual([1, 2])
    expect(timesOf(source, 'fx.double')).toEqual([1000, 2000])
    expect(infoOf(source, 'fx.double')).toMatchObject({ computed: true, count: 2, last: 6 })
    expect(source.latest('fx.double')).toBe(6)
  })

  it('lib 提供数学函数、常量与 clamp', () => {
    const source = createTestSource()
    source.setComputed([
      {
        key: 'calc',
        expr: 'round(sqrt(abs(v.x)) + pow(v.x, 2)) + clamp(v.x, 0, 1)',
        unit: 'V',
        label: '计算结果',
      },
    ])
    write(source, 1, 0, -9)
    expect(valuesOf(source, 'fx.calc')).toEqual([84])
    expect(infoOf(source, 'fx.calc')).toMatchObject({ unit: 'V', label: '计算结果' })
  })

  it('prev 与 dt 可用于积分', () => {
    const source = createTestSource()
    source.setComputed([{ key: 'acc', expr: 'isNaN(prev) ? 0 : prev + v.x * dt' }])
    write(source, 1, 0, 1)
    write(source, 2, 1000, 1)
    write(source, 3, 2000, 1)
    expect(valuesOf(source, 'fx.acc')).toEqual([0, 1, 2])
  })

  it('prev 可用于滤波', () => {
    const source = createTestSource()
    source.setComputed([{ key: 'f', expr: 'isNaN(prev) ? v.x : prev * 0.9 + v.x * 0.1' }])
    write(source, 1, 0, 0)
    write(source, 2, 10, 10)
    write(source, 3, 20, 10)
    const values = valuesOf(source, 'fx.f')
    expect(values[0]).toBe(0)
    expect(values[1]).toBeCloseTo(1)
    expect(values[2]).toBeCloseTo(1.9)
  })

  it('可以按定义顺序引用前面的计算变量', () => {
    const source = createTestSource()
    source.setComputed([
      { key: 'a', expr: 'v.x + 1' },
      { key: 'b', expr: "v['fx.a'] * 2" },
    ])
    write(source, 1, 0, 1)
    expect(valuesOf(source, 'fx.a')).toEqual([2])
    expect(valuesOf(source, 'fx.b')).toEqual([4])
  })

  it('非有限结果被跳过并计入 invalidSamples', () => {
    const source = createTestSource()
    source.setComputed([{ key: 'root', expr: 'sqrt(v.x)' }])
    write(source, 1, 0, -1)
    expect(valuesOf(source, 'fx.root')).toEqual([])
    expect(source.invalidSamples).toBe(1)
    write(source, 2, 10, 4)
    expect(indexesOf(source, 'fx.root')).toEqual([2])
    expect(valuesOf(source, 'fx.root')).toEqual([2])
  })

  it('表达式抛异常后停用，重新 setComputed 后恢复', () => {
    const source = createTestSource()
    expect(source.setComputed([{ key: 'bad', expr: "v['x'].toUpperCase()" }])).toEqual([])
    let variablesEvents = 0
    source.on('variables', () => {
      variablesEvents += 1
    })
    write(source, 1, 0, 1)
    const failed = infoOf(source, 'fx.bad')
    expect(failed?.error).toBeTruthy()
    expect(valuesOf(source, 'fx.bad')).toEqual([])
    expect(variablesEvents).toBeGreaterThanOrEqual(1)

    write(source, 2, 10, 2)
    expect(infoOf(source, 'fx.bad')?.error).toBe(failed?.error)
    expect(valuesOf(source, 'fx.bad')).toEqual([])

    expect(source.setComputed([{ key: 'bad', expr: 'v.x + 1' }])).toEqual([])
    expect(infoOf(source, 'fx.bad')?.error).toBeUndefined()
    write(source, 3, 20, 2)
    expect(valuesOf(source, 'fx.bad')).toEqual([3])
    expect(variablesEvents).toBeGreaterThanOrEqual(2)
  })

  it('语法错误在 setComputed 返回值中报告，合法定义仍然生效', () => {
    const source = createTestSource()
    const errors = source.setComputed([
      { key: 'ok', expr: 'v.x + 1' },
      { key: 'bad', expr: '1 +' },
    ])
    expect(errors).toHaveLength(1)
    expect(errors[0]?.key).toBe('bad')
    expect(errors[0]?.error).toContain('语法')
    expect(source.variables().map((info) => info.key)).toEqual(['fx.ok'])
    write(source, 1, 0, 1)
    expect(valuesOf(source, 'fx.ok')).toEqual([2])
    expect(valuesOf(source, 'fx.bad')).toEqual([])
    expect(infoOf(source, 'fx.bad')).toBeUndefined()
  })

  it('非法名称、超长表达式与重名都在返回值中报告', () => {
    const source = createTestSource()
    expect(source.setComputed([{ key: '1bad', expr: '1' }])[0]?.error).toContain('变量名不合法')
    expect(source.setComputed([{ key: 'empty', expr: '   ' }])[0]?.error).toContain('不能为空')
    expect(source.setComputed([{ key: 'long', expr: `1${'+1'.repeat(500)}` }])[0]?.error).toContain(
      '不能超过',
    )
    const duplicated = source.setComputed([
      { key: 'dup', expr: '1' },
      { key: 'dup', expr: '2' },
    ])
    expect(duplicated).toHaveLength(1)
    expect(duplicated[0]?.error).toContain('重复')
  })

  it('与已有变量重名时报告编译错误', () => {
    const source = createTestSource()
    source.handleFrames([variablesFrame(1, 0, { 'fx.a': 1 })])
    const errors = source.setComputed([{ key: 'a', expr: '1' }])
    expect(errors).toHaveLength(1)
    expect(errors[0]?.error).toContain('重复')
  })

  it('setComputed 整体替换原有定义', () => {
    const source = createTestSource()
    source.setComputed([
      { key: 'a', expr: 'v.x + 1' },
      { key: 'b', expr: 'v.x + 2' },
    ])
    write(source, 1, 0, 1)
    expect(source.variables().map((info) => info.key)).toEqual(['fx.a', 'fx.b', 'x'])

    expect(source.setComputed([{ key: 'b', expr: 'v.x * 10' }])).toEqual([])
    expect(source.variables().map((info) => info.key)).toEqual(['x', 'fx.b'])
    write(source, 2, 10, 2)
    expect(valuesOf(source, 'fx.b')).toEqual([20])
    expect(valuesOf(source, 'fx.a')).toEqual([])
  })

  it('表达式返回非数字时跳过样本', () => {
    const source = createTestSource()
    source.setComputed([{ key: 'text', expr: "'abc'" }])
    write(source, 1, 0, 1)
    expect(valuesOf(source, 'fx.text')).toEqual([])
    expect(source.invalidSamples).toBe(1)
  })
})
