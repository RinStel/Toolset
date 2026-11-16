import { describe, expect, it } from 'vitest'

import { compileProtocol } from '@/domains/protocol/runtime/compile'
import {
  formatValidationError,
  validateDefinition,
  type ValidationError,
} from '@/domains/protocol/validate'
import { MAX_PROTOCOL_CODE_LENGTH } from '@/domains/protocol/types'

function baseDefinition(): Record<string, unknown> {
  return {
    apiVersion: 1,
    meta: { name: '测试协议' },
    framing: { type: 'line' },
  }
}

function failurePaths(definition: unknown): string[] {
  const result = validateDefinition(definition)
  expect(result.ok, '期望校验失败，实际成功').toBe(false)
  return result.ok ? [] : result.errors.map((error) => error.path)
}

/** 断言指定路径上至少有一条错误。 */
function expectInvalid(definition: unknown, path: string): ValidationError[] {
  const result = validateDefinition(definition)
  expect(result.ok, `期望路径 ${path} 校验失败，实际成功`).toBe(false)
  if (result.ok) return []
  const error = result.errors.find((item) => item.path === path)
  expect(
    error,
    `期望路径 ${path} 出错，实际错误路径：${result.errors.map((item) => item.path).join(', ')}`,
  ).toBeDefined()
  return result.errors
}

function invalidWithFraming(framing: unknown): Record<string, unknown> {
  const definition = baseDefinition()
  definition.framing = framing
  return definition
}

function lengthFraming(length: unknown): Record<string, unknown> {
  return invalidWithFraming({ type: 'length', length })
}

describe('顶层结构校验', () => {
  it('非对象、null、数组都失败', () => {
    for (const value of [null, undefined, 42, 'text', []]) {
      expect(failurePaths(value)).toContain('definition')
    }
  })

  it('apiVersion 必须为 1', () => {
    const definition = baseDefinition()
    definition.apiVersion = 2
    expectInvalid(definition, 'apiVersion')
    expectInvalid({ ...baseDefinition(), apiVersion: '1' }, 'apiVersion')
  })

  it('meta 缺失或字段类型错误', () => {
    const missing = baseDefinition()
    delete missing.meta
    expectInvalid(missing, 'meta')

    const emptyName = baseDefinition()
    emptyName.meta = { name: '   ' }
    expectInvalid(emptyName, 'meta.name')

    const wrongName = baseDefinition()
    wrongName.meta = { name: 42 }
    expectInvalid(wrongName, 'meta.name')

    const wrongDescription = baseDefinition()
    wrongDescription.meta = { name: 'ok', description: 1 }
    expectInvalid(wrongDescription, 'meta.description')

    const wrongVersion = baseDefinition()
    wrongVersion.meta = { name: 'ok', version: 1 }
    expectInvalid(wrongVersion, 'meta.version')
  })

  it('decode / encode 存在时必须是函数', () => {
    expectInvalid({ ...baseDefinition(), decode: 'nope' }, 'decode')
    expectInvalid({ ...baseDefinition(), encode: false }, 'encode')
  })
})

describe('framing 校验', () => {
  it('缺失、非对象或类型未知', () => {
    const missing = baseDefinition()
    delete missing.framing
    expectInvalid(missing, 'framing')
    expectInvalid(invalidWithFraming('line'), 'framing')
    expectInvalid(invalidWithFraming({ type: 'packet' }), 'framing.type')
  })

  it('maxFrameLength 范围为 1–65536 的整数', () => {
    for (const value of [0, 65537, 1.5, '4096']) {
      expectInvalid(
        invalidWithFraming({ type: 'line', maxFrameLength: value }),
        'framing.maxFrameLength',
      )
    }
  })

  it('line：eol 与 includeEol 类型', () => {
    expectInvalid(invalidWithFraming({ type: 'line', eol: 'crlf2' }), 'framing.eol')
    expectInvalid(invalidWithFraming({ type: 'line', includeEol: 'yes' }), 'framing.includeEol')
  })

  it('delimiter：end 必填且可解析；start/include 合法', () => {
    expectInvalid(invalidWithFraming({ type: 'delimiter' }), 'framing.end')
    expectInvalid(invalidWithFraming({ type: 'delimiter', end: '' }), 'framing.end')
    expectInvalid(invalidWithFraming({ type: 'delimiter', end: 'GG' }), 'framing.end')
    expectInvalid(
      invalidWithFraming({ type: 'delimiter', end: '0D 0A', start: 'ZZ' }),
      'framing.start',
    )
    expectInvalid(
      invalidWithFraming({ type: 'delimiter', end: '0D 0A', include: 'all' }),
      'framing.include',
    )
  })

  it('fixed：length 为正整数，header/trailer 可解析', () => {
    expectInvalid(invalidWithFraming({ type: 'fixed', length: 0 }), 'framing.length')
    expectInvalid(invalidWithFraming({ type: 'fixed', length: 65537 }), 'framing.length')
    expectInvalid(invalidWithFraming({ type: 'fixed', length: 2.5 }), 'framing.length')
    expectInvalid(invalidWithFraming({ type: 'fixed', length: 4, header: 'GG' }), 'framing.header')
    expectInvalid(
      invalidWithFraming({ type: 'fixed', length: 4, trailer: '0D ZZ' }),
      'framing.trailer',
    )
  })

  it('length：字段各属性类型与范围', () => {
    expectInvalid(lengthFraming(undefined), 'framing.length')
    expectInvalid(lengthFraming({ size: 1, includes: 'frame' }), 'framing.length.offset')
    expectInvalid(
      lengthFraming({ offset: -1, size: 1, includes: 'frame' }),
      'framing.length.offset',
    )
    expectInvalid(
      lengthFraming({ offset: 1.5, size: 1, includes: 'frame' }),
      'framing.length.offset',
    )
    expectInvalid(lengthFraming({ offset: 0, size: 3, includes: 'frame' }), 'framing.length.size')
    expectInvalid(
      lengthFraming({ offset: 0, size: 1, endian: 'middle', includes: 'frame' }),
      'framing.length.endian',
    )
    expectInvalid(
      lengthFraming({ offset: 0, size: 1, includes: 'total' }),
      'framing.length.includes',
    )
    expectInvalid(
      lengthFraming({ offset: 0, size: 1, includes: 'frame', adjust: 0.5 }),
      'framing.length.adjust',
    )
    expectInvalid(
      invalidWithFraming({
        type: 'length',
        header: 'GG',
        length: { offset: 0, size: 1, includes: 'frame' },
      }),
      'framing.header',
    )
  })

  it('idle：gapMs 为 1–1000 的整数', () => {
    for (const value of [0, 1001, 2.5, '5']) {
      expectInvalid(invalidWithFraming({ type: 'idle', gapMs: value }), 'framing.gapMs')
    }
  })
})

describe('sendForm 校验', () => {
  it('存在 sendForm 时必须定义 encode', () => {
    const definition = baseDefinition()
    definition.sendForm = { fields: [] }
    expectInvalid(definition, 'sendForm')
  })

  it('sendForm / fields 结构', () => {
    const notObject = { ...baseDefinition(), encode: () => [], sendForm: 'x' }
    expectInvalid(notObject, 'sendForm')

    const notArray = { ...baseDefinition(), encode: () => [], sendForm: { fields: 'x' } }
    expectInvalid(notArray, 'sendForm.fields')
  })

  it('字段 key 必须唯一且非空', () => {
    const withFields = (fields: unknown[]): Record<string, unknown> => ({
      ...baseDefinition(),
      encode: () => [],
      sendForm: { fields },
    })
    expectInvalid(withFields([{ label: 'a', type: 'text' }]), 'sendForm.fields[0].key')
    expectInvalid(withFields([{ key: '  ', label: 'a', type: 'text' }]), 'sendForm.fields[0].key')
    expectInvalid(withFields([{ key: 1, label: 'a', type: 'text' }]), 'sendForm.fields[0].key')
    expectInvalid(
      withFields([
        { key: 'a', label: 'A', type: 'text' },
        { key: 'a', label: 'B', type: 'text' },
      ]),
      'sendForm.fields[1].key',
    )
  })

  it('字段 label / type 必填且合法', () => {
    const withField = (field: Record<string, unknown>): Record<string, unknown> => ({
      ...baseDefinition(),
      encode: () => [],
      sendForm: { fields: [field] },
    })
    expectInvalid(withField({ key: 'a', type: 'text' }), 'sendForm.fields[0].label')
    expectInvalid(withField({ key: 'a', label: '', type: 'text' }), 'sendForm.fields[0].label')
    expectInvalid(withField({ key: 'a', label: 'A', type: 'range' }), 'sendForm.fields[0].type')
    expectInvalid(withField({ key: 'a', label: 'A' }), 'sendForm.fields[0].type')
  })

  it('number 字段的数值约束', () => {
    const withField = (field: Record<string, unknown>): Record<string, unknown> => ({
      ...baseDefinition(),
      encode: () => [],
      sendForm: { fields: [field] },
    })
    const number = { key: 'n', label: 'N', type: 'number' }
    expectInvalid(withField({ ...number, min: '1' }), 'sendForm.fields[0].min')
    expectInvalid(withField({ ...number, step: Number.NaN }), 'sendForm.fields[0].step')
    expectInvalid(withField({ ...number, min: 10, max: 5 }), 'sendForm.fields[0].min')
    expectInvalid(withField({ ...number, min: 10, default: 5 }), 'sendForm.fields[0].default')
    expectInvalid(withField({ ...number, max: 10, default: 15 }), 'sendForm.fields[0].default')
    expectInvalid(withField({ ...number, unit: 1 }), 'sendForm.fields[0].unit')
  })

  it('text / hex / checkbox 字段', () => {
    const withField = (field: Record<string, unknown>): Record<string, unknown> => ({
      ...baseDefinition(),
      encode: () => [],
      sendForm: { fields: [field] },
    })
    const text = { key: 't', label: 'T', type: 'text' }
    expectInvalid(withField({ ...text, maxLength: 0 }), 'sendForm.fields[0].maxLength')
    expectInvalid(withField({ ...text, maxLength: 1.5 }), 'sendForm.fields[0].maxLength')
    expectInvalid(withField({ ...text, default: 42 }), 'sendForm.fields[0].default')

    const hexField = { key: 'h', label: 'H', type: 'hex' }
    expectInvalid(withField({ ...hexField, default: 'ZZ' }), 'sendForm.fields[0].default')
    expectInvalid(withField({ ...hexField, default: 1 }), 'sendForm.fields[0].default')

    const checkbox = { key: 'c', label: 'C', type: 'checkbox' }
    expectInvalid(withField({ ...checkbox, default: 'yes' }), 'sendForm.fields[0].default')
  })

  it('select 至少有 1 个合法选项', () => {
    const withField = (field: Record<string, unknown>): Record<string, unknown> => ({
      ...baseDefinition(),
      encode: () => [],
      sendForm: { fields: [field] },
    })
    const select = { key: 's', label: 'S', type: 'select' }
    expectInvalid(withField({ ...select, options: [] }), 'sendForm.fields[0].options')
    expectInvalid(withField({ ...select, options: 'x' }), 'sendForm.fields[0].options')
    expectInvalid(
      withField({ ...select, options: [{ value: 1 }] }),
      'sendForm.fields[0].options[0].label',
    )
    expectInvalid(
      withField({ ...select, options: [{ label: 'A', value: {} }] }),
      'sendForm.fields[0].options[0].value',
    )
    expectInvalid(
      withField({ ...select, options: [{ label: 'A', value: 1 }], default: {} }),
      'sendForm.fields[0].default',
    )
  })
})

describe('合法定义', () => {
  it('最小定义通过', () => {
    const definition = baseDefinition()
    const result = validateDefinition(definition)
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.definition).toBe(definition)
  })

  it('5 种 framing 与全部字段类型通过', () => {
    const framings = [
      { type: 'line', eol: 'lf', includeEol: false, maxFrameLength: 1024 },
      { type: 'delimiter', start: 'AA 55', end: '0D 0A', include: 'both' },
      { type: 'fixed', length: 8, header: 'AA 55', trailer: '0D' },
      {
        type: 'length',
        header: 'A5 5A',
        length: { offset: 2, size: 1, includes: 'after', adjust: 2 },
      },
      { type: 'idle', gapMs: 5 },
    ]
    const fields = [
      { key: 'n', label: 'N', type: 'number', min: 0, max: 10, step: 1, default: 5, unit: 'ms' },
      { key: 't', label: 'T', type: 'text', maxLength: 10, default: 'x' },
      { key: 's', label: 'S', type: 'select', options: [{ label: 'A', value: 1 }], default: 1 },
      { key: 'c', label: 'C', type: 'checkbox', default: true },
      { key: 'h', label: 'H', type: 'hex', default: 'AA 55' },
    ]
    for (const framing of framings) {
      const definition = {
        ...baseDefinition(),
        framing,
        decode: () => null,
        encode: () => [1],
        sendForm: { fields },
      }
      const result = validateDefinition(definition)
      expect(result.ok, `framing ${framing.type} 应通过：${JSON.stringify(result)}`).toBe(true)
    }
  })

  it('decode 的运行时返回值（variables / variableMeta / noVariables）不属于定义校验范围', () => {
    // 这些字段是 DecodeResult 的运行时内容，由 runtime/compile.ts 的结果规范化负责；
    // 定义校验只检查 decode 是否为函数，不能因为返回值形状而拒绝合法定义。
    const definition = {
      ...baseDefinition(),
      decode: () => ({
        summary: 'x',
        variables: { 'bad key': 1 },
        variableMeta: { temp: { unit: '°C' } },
        noVariables: true,
      }),
    }
    const result = validateDefinition(definition)
    expect(result.ok).toBe(true)
  })

  it('formatValidationError 在带 line 时添加行号前缀', () => {
    expect(formatValidationError({ path: 'code', message: 'code 语法错误' })).toBe('code 语法错误')
    expect(formatValidationError({ path: 'code', message: 'code 语法错误', line: 3 })).toBe(
      '第 3 行：code 语法错误',
    )
  })
})

describe('代码长度与编译错误（compile.ts）', () => {
  it('代码超过 256KB 时拒绝', () => {
    const code = 'x'.repeat(MAX_PROTOCOL_CODE_LENGTH + 1)
    const result = compileProtocol(code)
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.errors[0]?.path).toBe('code')
      expect(result.errors[0]?.message).toContain('256KB')
    }
  })

  it('语法错误与运行错误给出中文消息', () => {
    const syntax = compileProtocol('return {')
    expect(syntax.ok).toBe(false)
    if (!syntax.ok) expect(syntax.errors[0]?.message).toContain('插件代码语法错误')

    const runtimeError = compileProtocol("throw new Error('boom')")
    expect(runtimeError.ok).toBe(false)
    if (!runtimeError.ok) {
      expect(runtimeError.errors[0]?.message).toContain('插件代码运行出错')
      expect(runtimeError.errors[0]?.message).toContain('boom')
    }
  })

  it('编译通过但定义非法时返回校验错误', () => {
    const result = compileProtocol('return { apiVersion: 1 }')
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.errors.map((error) => error.path)).toContain('meta')
  })
})
