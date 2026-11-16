import { describe, expect, it } from 'vitest'

import {
  extractVariables,
  frameHasVariables,
  normalizeVariableKey,
} from '../../../src/domains/series/extract'
import type { DecodeField, DecodeResult } from '../../../src/domains/protocol/public'

function result(patch: Partial<DecodeResult> = {}): DecodeResult {
  return { summary: '', ...patch }
}

describe('series/extract', () => {
  it('有 variables 时只使用 variables，并读取 variableMeta', () => {
    const outcome = extractVariables([
      result({
        variables: { temp: 21.5 },
        variableMeta: { temp: { label: '温度', unit: '℃' } },
        fields: [{ label: 'ignored', value: 99 }],
      }),
    ])
    expect(outcome.variables).toEqual([{ key: 'temp', value: 21.5, label: '温度', unit: '℃' }])
    expect(outcome.invalid).toBe(0)
    expect(outcome.candidates).toBe(1)
  })

  it('variables 为空对象时不回退到 fields', () => {
    const outcome = extractVariables([
      result({ variables: {}, fields: [{ label: 'a', value: 1 }] }),
    ])
    expect(outcome.variables).toEqual([])
    expect(outcome.candidates).toBe(0)
  })

  it('非有限数丢弃并计入 invalidSamples，非法变量名忽略', () => {
    const outcome = extractVariables([
      result({
        variables: { nan: Number.NaN, inf: Number.POSITIVE_INFINITY, good: 2, 'bad key': 3 },
      }),
    ])
    expect(outcome.variables).toEqual([{ key: 'good', value: 2 }])
    expect(outcome.invalid).toBe(2)
    expect(outcome.candidates).toBe(3)
  })

  it('从 fields 自动提取 number 与 boolean，并改写非法 label', () => {
    const fields: DecodeField[] = [
      { label: '温度', value: 21.5, unit: '℃' },
      { label: 'ch-1', value: true },
      { label: '123abc', value: 3 },
      { label: '键值', value: 4, key: 'ch0' },
      { label: 'text', value: 'abc' },
    ]
    const outcome = extractVariables([result({ fields })])
    const byKey = new Map(outcome.variables.map((sample) => [sample.key, sample]))
    expect([...byKey.keys()]).toEqual(['__', 'ch_1', 'v_123abc', 'ch0'])
    expect(byKey.get('__')).toMatchObject({ value: 21.5, unit: '℃', label: '温度' })
    expect(byKey.get('ch_1')).toMatchObject({ value: 1, label: 'ch-1' })
    expect(byKey.get('v_123abc')).toMatchObject({ value: 3 })
    expect(byKey.get('ch0')).toMatchObject({ value: 4, label: '键值' })
    expect(outcome.invalid).toBe(0)
    expect(outcome.candidates).toBe(4)
  })

  it('fields 中的非有限数值也计入 invalidSamples', () => {
    const outcome = extractVariables([result({ fields: [{ label: 'x', value: Number.NaN }] })])
    expect(outcome.variables).toEqual([])
    expect(outcome.invalid).toBe(1)
    expect(outcome.candidates).toBe(1)
  })

  it('noVariables 为 true 时不从 fields 提取', () => {
    const outcome = extractVariables([
      result({ noVariables: true, fields: [{ label: 'a', value: 1 }] }),
    ])
    expect(outcome.variables).toEqual([])
    expect(outcome.candidates).toBe(0)
  })

  it('error 级别的结果被跳过', () => {
    const outcome = extractVariables([
      result({ level: 'error', variables: { a: 1 }, fields: [{ label: 'b', value: 2 }] }),
    ])
    expect(outcome.variables).toEqual([])
    expect(outcome.candidates).toBe(0)
  })

  it('同一帧多个结果合并，重复变量后到值覆盖先到值', () => {
    const outcome = extractVariables([
      result({ variables: { a: 1 } }),
      result({ variables: { b: 2, a: 3 } }),
    ])
    expect(outcome.variables).toEqual([
      { key: 'a', value: 3 },
      { key: 'b', value: 2 },
    ])
  })

  it('variableMeta 后到的值覆盖先到的，未提供的字段保留', () => {
    const outcome = extractVariables([
      result({ variables: { a: 1 }, variableMeta: { a: { label: 'L1', unit: 'u1' } } }),
      result({ variables: { a: 2 }, variableMeta: { a: { label: 'L2' } } }),
    ])
    expect(outcome.variables).toEqual([{ key: 'a', value: 2, label: 'L2', unit: 'u1' }])
  })

  it('normalizeVariableKey 把非法字符替换为下划线并补前缀', () => {
    expect(normalizeVariableKey('ch-1')).toBe('ch_1')
    expect(normalizeVariableKey('1abc')).toBe('v_1abc')
    expect(normalizeVariableKey('a b.c')).toBe('a_b.c')
    expect(normalizeVariableKey('temp.1')).toBe('temp.1')
    expect(normalizeVariableKey('温度')).toBe('__')
    expect(normalizeVariableKey('')).toBe('_')
    expect(normalizeVariableKey('a'.repeat(80))).toHaveLength(64)
  })

  it('frameHasVariables 只认可 RX 方向与可提取的字段', () => {
    const rxVariables = {
      seq: 1,
      at: 0,
      direction: 'rx' as const,
      results: [result({ variables: { a: 1 } })],
    }
    expect(frameHasVariables(rxVariables)).toBe(true)
    expect(frameHasVariables({ ...rxVariables, direction: 'tx' })).toBe(false)
    expect(
      frameHasVariables({
        ...rxVariables,
        results: [result({ level: 'error', variables: { a: 1 } })],
      }),
    ).toBe(false)
    expect(
      frameHasVariables({
        ...rxVariables,
        results: [result({ fields: [{ label: 'a', value: 1 }] })],
      }),
    ).toBe(true)
    expect(
      frameHasVariables({
        ...rxVariables,
        results: [result({ fields: [{ label: 'a', value: 'x' }] })],
      }),
    ).toBe(false)
    expect(
      frameHasVariables({
        ...rxVariables,
        results: [result({ noVariables: true, fields: [{ label: 'a', value: 1 }] })],
      }),
    ).toBe(false)
  })
})
