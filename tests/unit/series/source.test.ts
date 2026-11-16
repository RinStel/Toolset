import { describe, expect, it } from 'vitest'

import {
  createTestSource,
  indexesOf,
  makeFrame,
  timesOf,
  valuesOf,
  variablesFrame,
} from './helpers'

describe('series/source', () => {
  it('frameIdx 递增，同一帧内的变量共享 idx', () => {
    const source = createTestSource()
    source.handleFrames([
      variablesFrame(1, 1000, { a: 1, b: 2 }),
      variablesFrame(2, 1000, { a: 3, b: 4 }),
    ])
    expect(source.frameIdx).toBe(2)
    expect(indexesOf(source, 'a')).toEqual([1, 2])
    expect(indexesOf(source, 'b')).toEqual([1, 2])
    expect(valuesOf(source, 'a')).toEqual([1, 3])
    expect(source.latest('a')).toBe(3)
    expect(source.latest('missing')).toBeUndefined()
  })

  it('只处理 rx 方向的帧', () => {
    const source = createTestSource()
    source.handleFrames([
      variablesFrame(1, 1000, { a: 1 }, { direction: 'tx' }),
      makeFrame({
        seq: 2,
        at: 1000,
        direction: 'tx',
        results: [{ summary: '', variables: { b: 1 } }],
      }),
    ])
    expect(source.frameIdx).toBe(0)
    expect(source.variables()).toEqual([])
  })

  it('时间戳插值：上一帧存在且间隔在 1 秒内时按帧序号均分', () => {
    const source = createTestSource()
    source.handleFrames([variablesFrame(1, 1000, { a: 1 })])
    source.handleFrames([variablesFrame(2, 2000, { a: 2 }), variablesFrame(3, 2000, { a: 3 })])
    expect(timesOf(source, 'a')).toEqual([1000, 1500, 2000])
  })

  it('时间戳插值：间隔为 0 或超过 1 秒时不插值', () => {
    const zero = createTestSource()
    zero.handleFrames([variablesFrame(1, 500, { a: 1 })])
    zero.handleFrames([variablesFrame(2, 500, { a: 2 }), variablesFrame(3, 500, { a: 3 })])
    expect(timesOf(zero, 'a')).toEqual([500, 500, 500])

    const large = createTestSource()
    large.handleFrames([variablesFrame(1, 0, { a: 1 })])
    large.handleFrames([variablesFrame(2, 5000, { a: 2 }), variablesFrame(3, 5000, { a: 3 })])
    expect(timesOf(large, 'a')).toEqual([0, 5000, 5000])
  })

  it('时间戳插值：没有上一帧时全部使用帧时间', () => {
    const source = createTestSource()
    source.handleFrames([
      variablesFrame(1, 100, { a: 1 }),
      variablesFrame(2, 100, { a: 2 }),
      variablesFrame(3, 100, { a: 3 }),
    ])
    expect(timesOf(source, 'a')).toEqual([100, 100, 100])
  })

  it('变量数量达到每源上限时忽略新变量并记录', () => {
    const source = createTestSource({ maxVariablesPerSource: 2 })
    let variablesEvents = 0
    source.on('variables', () => {
      variablesEvents += 1
    })
    source.handleFrames([variablesFrame(1, 0, { a: 1, b: 2, c: 3 })])
    expect(source.variables().map((info) => info.key)).toEqual(['a', 'b'])
    expect(source.ignoredVariables).toEqual(['c'])
    expect(valuesOf(source, 'c')).toEqual([])
    expect(variablesEvents).toBe(1)

    source.handleFrames([variablesFrame(2, 10, { d: 1, a: 9 })])
    expect(source.ignoredVariables).toEqual(['c', 'd'])
    expect(valuesOf(source, 'a')).toEqual([1, 9])
    expect(variablesEvents).toBe(2)
  })

  it('全部数据源的变量总数达到 256 时忽略新变量', () => {
    const source = createTestSource({ totalVariableCount: () => 256 })
    source.handleFrames([variablesFrame(1, 0, { a: 1 })])
    expect(source.variables()).toEqual([])
    expect(source.ignoredVariables).toEqual(['a'])
  })

  it('ignoredVariables 最多记录 32 个', () => {
    const source = createTestSource({ maxVariablesPerSource: 1 })
    source.handleFrames([variablesFrame(1, 0, { base: 1 })])
    for (let i = 0; i < 40; i += 1) {
      source.handleFrames([variablesFrame(i + 2, i + 1, { [`x${i}`]: i })])
    }
    expect(source.ignoredVariables).toHaveLength(32)
    expect(source.ignoredVariables[0]).toBe('x0')
    expect(source.ignoredVariables[31]).toBe('x31')
  })

  it('read 支持 last、sinceIdx、fromT/toT 与 limit', () => {
    const source = createTestSource()
    for (let i = 1; i <= 5; i += 1) {
      source.handleFrames([variablesFrame(i, i * 100, { a: i * 10 })])
    }
    expect(valuesOf(source, 'a')).toEqual([10, 20, 30, 40, 50])

    expect(Array.from(source.read('a', { last: 2 }).v)).toEqual([40, 50])
    expect(Array.from(source.read('a', { sinceIdx: 3 }).idx)).toEqual([3, 4, 5])
    expect(Array.from(source.read('a', { fromT: 300, toT: 400 }).v)).toEqual([30, 40])
    expect(Array.from(source.read('a', { limit: 2 }).idx)).toEqual([4, 5])
    expect(Array.from(source.read('a', { limit: 2, last: 1 }).v)).toEqual([50])
    expect(Array.from(source.read('missing').idx)).toEqual([])

    const slice = source.read('a')
    slice.idx[0] = 99
    expect(Array.from(source.read('a').idx)).toEqual([1, 2, 3, 4, 5])
  })

  it('扩容后覆盖最旧的样本', () => {
    const source = createTestSource({ capacity: () => 4 })
    for (let i = 1; i <= 6; i += 1) {
      source.handleFrames([variablesFrame(i, i, { a: i })])
    }
    expect(indexesOf(source, 'a')).toEqual([3, 4, 5, 6])
    expect(valuesOf(source, 'a')).toEqual([3, 4, 5, 6])
    expect(source.variables()[0]?.count).toBe(4)

    const grown = createTestSource({ capacity: () => 6 })
    for (let i = 1; i <= 7; i += 1) {
      grown.handleFrames([variablesFrame(i, i, { a: i })])
    }
    expect(valuesOf(grown, 'a')).toEqual([2, 3, 4, 5, 6, 7])
  })

  it('容量大于初始值时会继续翻倍扩容', () => {
    const source = createTestSource({ capacity: () => 3000 })
    for (let i = 1; i <= 3010; i += 1) {
      source.handleFrames([variablesFrame(i, i, { a: i })])
    }
    expect(source.variables()[0]?.count).toBe(3000)
    expect(valuesOf(source, 'a').slice(0, 2)).toEqual([11, 12])
    expect(valuesOf(source, 'a').at(-1)).toBe(3010)
  })

  it('非有限数的样本计入 invalidSamples，帧仍会被计数', () => {
    const source = createTestSource()
    source.handleFrames([
      makeFrame({
        seq: 1,
        at: 0,
        results: [{ summary: '', variables: { a: Number.NaN, b: Number.POSITIVE_INFINITY } }],
      }),
    ])
    expect(source.frameIdx).toBe(1)
    expect(source.invalidSamples).toBe(2)
    expect(source.variables()).toEqual([])

    source.handleFrames([
      makeFrame({ seq: 2, at: 10, results: [{ summary: '', variables: { a: 2 } }] }),
    ])
    expect(indexesOf(source, 'a')).toEqual([2])
    expect(source.invalidSamples).toBe(2)
  })

  it('resetStats 只重置统计，保留样本与计数', () => {
    const source = createTestSource()
    source.handleFrames([
      variablesFrame(1, 0, { a: 1 }),
      variablesFrame(2, 10, { a: 3 }),
      variablesFrame(3, 20, { a: 2 }),
    ])
    let info = source.variables()[0]
    expect(info).toMatchObject({ count: 3, min: 1, max: 3, mean: 2, last: 2, lastAt: 20 })

    source.resetStats()
    info = source.variables()[0]
    expect(info).toMatchObject({ count: 3, min: 0, max: 0, mean: 0, last: 2 })
    expect(valuesOf(source, 'a')).toEqual([1, 3, 2])
  })

  it('clear 清空样本与统计，保留变量列表和计算变量定义', () => {
    const source = createTestSource()
    source.handleFrames([variablesFrame(1, 0, { a: 1, b: 2 })])
    source.setComputed([{ key: 'sum', expr: 'v.a + v.b' }])
    source.handleFrames([variablesFrame(2, 10, { a: 3, b: 4 })])
    expect(valuesOf(source, 'fx.sum')).toEqual([7])
    expect(source.invalidSamples).toBe(0)

    source.clear()
    expect(source.frameIdx).toBe(0)
    expect(valuesOf(source, 'a')).toEqual([])
    expect(valuesOf(source, 'fx.sum')).toEqual([])
    expect(source.variables().map((info) => info.key)).toEqual(['a', 'b', 'fx.sum'])
    expect(source.variables().every((info) => info.count === 0)).toBe(true)
    expect(source.latest('a')).toBeUndefined()

    source.handleFrames([variablesFrame(3, 20, { a: 5, b: 6 })])
    expect(indexesOf(source, 'fx.sum')).toEqual([1])
    expect(valuesOf(source, 'fx.sum')).toEqual([11])
  })

  it('变量元信息后到值覆盖先到值并发出 variables 事件', () => {
    const source = createTestSource()
    let variablesEvents = 0
    source.on('variables', () => {
      variablesEvents += 1
    })
    source.handleFrames([
      makeFrame({
        seq: 1,
        at: 0,
        results: [
          { summary: '', variables: { a: 1 }, variableMeta: { a: { label: 'L1', unit: 'u1' } } },
        ],
      }),
    ])
    expect(variablesEvents).toBe(1)
    expect(source.variables()[0]).toMatchObject({ key: 'a', label: 'L1', unit: 'u1' })

    source.handleFrames([
      makeFrame({
        seq: 2,
        at: 10,
        results: [
          { summary: '', variables: { a: 2 }, variableMeta: { a: { label: 'L2', unit: 'V' } } },
        ],
      }),
    ])
    expect(variablesEvents).toBe(2)
    expect(source.variables()[0]).toMatchObject({ label: 'L2', unit: 'V' })
  })

  it('每批帧处理完后发出一次 data 事件', () => {
    const source = createTestSource()
    const payloads: number[] = []
    source.on('data', (event) => {
      payloads.push(event.frameIdx)
    })
    source.handleFrames([variablesFrame(1, 0, { a: 1 }), variablesFrame(2, 0, { a: 2 })])
    expect(payloads).toEqual([2])
    source.handleFrames([variablesFrame(3, 10, { a: 3 })])
    expect(payloads).toEqual([2, 3])
  })

  it('rate 反映最近 1 秒的样本数', () => {
    const source = createTestSource()
    source.handleFrames([
      variablesFrame(1, 0, { a: 1 }),
      variablesFrame(2, 300, { a: 2 }),
      variablesFrame(3, 600, { a: 3 }),
    ])
    expect(source.variables()[0]?.rate).toBe(0)
    source.handleFrames([variablesFrame(4, 1200, { a: 4 })])
    expect(source.variables()[0]?.rate).toBe(3)
    source.handleFrames([variablesFrame(5, 2200, { a: 5 })])
    expect(source.variables()[0]?.rate).toBe(1)
  })
})
