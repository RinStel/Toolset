import { describe, expect, it } from 'vitest'

import {
  compileProtocol,
  createProtocolExecutor,
  MAX_DECODE_FIELDS,
  MAX_DECODE_SUMMARY_LENGTH,
  MAX_LOG_LINE_LENGTH,
} from '@/domains/protocol/runtime/compile'
import { MAX_DECODE_VARIABLES } from '@/domains/protocol/types'
import type { ProtocolDefinition, ProtocolLogSink } from '@/domains/protocol/types'

function compile(code: string, onLog?: ProtocolLogSink): ProtocolDefinition {
  const result = compileProtocol(code, onLog === undefined ? {} : { onLog })
  expect(result.ok, result.ok ? '' : result.errors.map((error) => error.message).join('; ')).toBe(
    true,
  )
  if (!result.ok) throw new Error('编译失败')
  return result.definition
}

const frame = Uint8Array.from([1, 2, 3])

describe('compileProtocol', () => {
  it('编译函数体并返回 ProtocolDefinition', () => {
    const definition = compile(`
      return {
        apiVersion: 1,
        meta: { name: '测试协议' },
        framing: { type: 'line' },
        decode: function () { return { summary: 'ok' } },
      }
    `)
    expect(definition.meta.name).toBe('测试协议')
    expect(definition.apiVersion).toBe(1)
    expect(typeof definition.decode).toBe('function')
  })
})

describe('decode 结果规范化', () => {
  it('默认 level 为 info，summary 原样保留', () => {
    const definition = compile(`
      return {
        apiVersion: 1,
        meta: { name: 't' },
        framing: { type: 'line' },
        decode: function () {
          return { summary: '收到数据', fields: [{ label: '长度', value: 3, format: 'dec' }] }
        },
      }
    `)
    const executor = createProtocolExecutor(definition)
    const outcome = executor.decodeFrame(frame, 'rx', 10)
    expect(outcome.error).toBeUndefined()
    expect(outcome.results).toEqual([
      { summary: '收到数据', fields: [{ label: '长度', value: 3, format: 'dec' }] },
    ])
  })

  it('summary 截断到 200 字，fields 最多 64 个', () => {
    const definition = compile(`
      return {
        apiVersion: 1,
        meta: { name: 't' },
        framing: { type: 'line' },
        decode: function () {
          const fields = [{ label: 'hex', value: 255, format: 'hex' }, { label: 'bad' }]
          for (let index = 0; index < 100; index += 1) {
            fields.push({ label: 'f' + index, value: index })
          }
          return { summary: 'x'.repeat(300), fields: fields }
        },
      }
    `)
    const outcome = createProtocolExecutor(definition).decodeFrame(frame, 'rx', 0)
    expect(outcome.error).toBeUndefined()
    const result = outcome.results[0]
    expect(result?.summary).toHaveLength(MAX_DECODE_SUMMARY_LENGTH)
    expect(result?.fields).toHaveLength(MAX_DECODE_FIELDS)
    expect(result?.fields?.[0]).toEqual({ label: 'hex', value: 255, format: 'hex' })
    expect(result?.fields?.[1]).toEqual({ label: 'f0', value: 0 })
  })

  it('支持返回结果数组；非法项导致整帧解码错误', () => {
    const many = compile(`
      return {
        apiVersion: 1,
        meta: { name: 't' },
        framing: { type: 'line' },
        decode: function () { return [{ summary: 'a' }, { summary: 'b', level: 'warn' }] },
      }
    `)
    expect(createProtocolExecutor(many).decodeFrame(frame, 'rx', 0).results).toEqual([
      { summary: 'a' },
      { summary: 'b', level: 'warn' },
    ])

    const invalidItem = compile(`
      return {
        apiVersion: 1,
        meta: { name: 't' },
        framing: { type: 'line' },
        decode: function () { return [{ summary: 'a' }, { value: 1 }] },
      }
    `)
    const outcome = createProtocolExecutor(invalidItem).decodeFrame(frame, 'rx', 0)
    expect(outcome.results).toEqual([])
    expect(outcome.error).toContain('summary')
  })

  it('返回 null 表示无结果且不算错误；返回空数组同理', () => {
    const nullResult = compile(`
      return {
        apiVersion: 1,
        meta: { name: 't' },
        framing: { type: 'line' },
        decode: function () { return null },
      }
    `)
    expect(createProtocolExecutor(nullResult).decodeFrame(frame, 'rx', 0)).toEqual({ results: [] })

    const emptyArray = compile(`
      return {
        apiVersion: 1,
        meta: { name: 't' },
        framing: { type: 'line' },
        decode: function () { return [] },
      }
    `)
    expect(createProtocolExecutor(emptyArray).decodeFrame(frame, 'rx', 0)).toEqual({ results: [] })
  })

  it('非对象或缺少 summary 视为解码错误', () => {
    const numberResult = compile(`
      return {
        apiVersion: 1,
        meta: { name: 't' },
        framing: { type: 'line' },
        decode: function () { return 42 },
      }
    `)
    const numberOutcome = createProtocolExecutor(numberResult).decodeFrame(frame, 'rx', 0)
    expect(numberOutcome.results).toEqual([])
    expect(numberOutcome.error).toContain('带有 summary 的对象')

    const missing = compile(`
      return {
        apiVersion: 1,
        meta: { name: 't' },
        framing: { type: 'line' },
        decode: function () { return { fields: [] } },
      }
    `)
    const missingOutcome = createProtocolExecutor(missing).decodeFrame(frame, 'rx', 0)
    expect(missingOutcome.results).toEqual([])
    expect(missingOutcome.error).toContain('summary')
  })

  it('decode 抛错时给出 error 而不抛出', () => {
    const definition = compile(`
      return {
        apiVersion: 1,
        meta: { name: 't' },
        framing: { type: 'line' },
        decode: function () { throw new Error('帧格式不对') },
      }
    `)
    const outcome = createProtocolExecutor(definition).decodeFrame(frame, 'rx', 0)
    expect(outcome.results).toEqual([])
    expect(outcome.error).toBe('帧格式不对')
  })

  it('未定义 decode 时返回空结果', () => {
    const definition = compile(`
      return { apiVersion: 1, meta: { name: 't' }, framing: { type: 'line' } }
    `)
    expect(createProtocolExecutor(definition).decodeFrame(frame, 'rx', 0)).toEqual({ results: [] })
  })

  it('非法 level / format / field 值被过滤或回退', () => {
    const definition = compile(`
      return {
        apiVersion: 1,
        meta: { name: 't' },
        framing: { type: 'line' },
        decode: function () {
          return {
            summary: 'ok',
            level: 'fatal',
            fields: [
              { label: 'a', value: 'x', format: 'base64', unit: 1 },
              { label: 'b', value: null },
              'nope',
            ],
          }
        },
      }
    `)
    const outcome = createProtocolExecutor(definition).decodeFrame(frame, 'rx', 0)
    expect(outcome.error).toBeUndefined()
    expect(outcome.results[0]?.level).toBeUndefined()
    expect(outcome.results[0]?.fields).toEqual([{ label: 'a', value: 'x' }])
  })

  it('保留 variables、variableMeta、noVariables 与字段 key', () => {
    const definition = compile(`
      return {
        apiVersion: 1,
        meta: { name: 't' },
        framing: { type: 'line' },
        decode: function () {
          return {
            summary: '变量',
            fields: [
              { label: '温度', value: 25.31, key: 'temp' },
              { label: 'x', value: 'text', key: '   ' },
              { label: 'y', value: 2, key: 42 },
            ],
            variables: { temp: 1.5, hum: 48, flag: 0 },
            variableMeta: {
              temp: { unit: '°C', label: '温度' },
              hum: { unit: 48, label: 48 },
              'bad key': { label: '非法键' },
              flag: { label: '标志' },
            },
            noVariables: true,
          }
        },
      }
    `)
    const outcome = createProtocolExecutor(definition).decodeFrame(frame, 'rx', 0)
    expect(outcome.error).toBeUndefined()
    const result = outcome.results[0]
    expect(result?.variables).toEqual({ temp: 1.5, hum: 48, flag: 0 })
    expect(result?.variableMeta).toEqual({
      temp: { unit: '°C', label: '温度' },
      flag: { label: '标志' },
    })
    expect(result?.noVariables).toBe(true)
    expect(result?.fields).toEqual([
      { label: '温度', value: 25.31, key: 'temp' },
      { label: 'x', value: 'text' },
      { label: 'y', value: 2 },
    ])
  })

  it('variables 中非法变量名视为整帧解码错误', () => {
    const definition = compile(`
      return {
        apiVersion: 1,
        meta: { name: 't' },
        framing: { type: 'line' },
        decode: function () {
          return { summary: 'x', variables: { 'bad key': 1 } }
        },
      }
    `)
    const outcome = createProtocolExecutor(definition).decodeFrame(frame, 'rx', 0)
    expect(outcome.results).toEqual([])
    expect(outcome.error).toContain('变量名不合法')
    expect(outcome.error).toContain('bad key')
  })

  it('variables 不是对象时视为解码错误', () => {
    const definition = compile(`
      return {
        apiVersion: 1,
        meta: { name: 't' },
        framing: { type: 'line' },
        decode: function () { return { summary: 'x', variables: [1, 2] } },
      }
    `)
    const outcome = createProtocolExecutor(definition).decodeFrame(frame, 'rx', 0)
    expect(outcome.results).toEqual([])
    expect(outcome.error).toContain('variables')
  })

  it('非有限数变量原样保留（交给仪表盘数据层丢弃并计入 invalidSamples）', () => {
    const definition = compile(`
      return {
        apiVersion: 1,
        meta: { name: 't' },
        framing: { type: 'line' },
        decode: function () {
          return {
            summary: 'x',
            variables: { nan: NaN, inf: Infinity, ninf: -Infinity, ok: 1.25 },
          }
        },
      }
    `)
    const result = createProtocolExecutor(definition).decodeFrame(frame, 'rx', 0).results[0]
    expect(result?.variables?.ok).toBe(1.25)
    expect(Number.isNaN(result?.variables?.nan)).toBe(true)
    expect(result?.variables?.inf).toBe(Infinity)
    expect(result?.variables?.ninf).toBe(-Infinity)
  })

  it(`每帧最多保留 ${MAX_DECODE_VARIABLES} 个变量，超出的截断并记录告警`, () => {
    const warnings: string[] = []
    const definition = compile(
      `
      return {
        apiVersion: 1,
        meta: { name: 't' },
        framing: { type: 'line' },
        decode: function () {
          const variables = {}
          for (let index = 0; index < 300; index += 1) variables['v' + index] = index
          return { summary: 'x', variables: variables }
        },
      }
    `,
      (level, text) => {
        if (level === 'warn') warnings.push(text)
      },
    )
    const executor = createProtocolExecutor(definition, {
      onLog: (level, text) => {
        if (level === 'warn') warnings.push(text)
      },
    })
    const result = executor.decodeFrame(frame, 'rx', 0).results[0]
    const keys = Object.keys(result?.variables ?? {})
    expect(keys).toHaveLength(MAX_DECODE_VARIABLES)
    expect(result?.variables?.v0).toBe(0)
    expect(result?.variables?.v255).toBe(255)
    expect(result?.variables?.v256).toBeUndefined()
    expect(warnings.some((text) => text.includes('已截断'))).toBe(true)
  })

  it('规范化结果可通过结构化克隆原样传到主线程（Worker frames 消息）', () => {
    const definition = compile(`
      return {
        apiVersion: 1,
        meta: { name: 't' },
        framing: { type: 'line' },
        decode: function () {
          return {
            summary: 'x',
            fields: [{ label: '温度', value: 1, key: 'temp' }],
            variables: { temp: 1.25, nan: NaN, inf: Infinity },
            variableMeta: { temp: { unit: '°C' } },
            noVariables: false,
          }
        },
      }
    `)
    const outcome = createProtocolExecutor(definition).decodeFrame(frame, 'rx', 0)
    const cloned = structuredClone(outcome.results)
    expect(cloned).toHaveLength(1)
    expect(cloned[0]?.summary).toBe('x')
    expect(cloned[0]?.fields?.[0]?.key).toBe('temp')
    expect(cloned[0]?.variables?.temp).toBe(1.25)
    expect(Number.isNaN(cloned[0]?.variables?.nan)).toBe(true)
    expect(cloned[0]?.variables?.inf).toBe(Infinity)
    expect(cloned[0]?.variableMeta?.temp?.unit).toBe('°C')
    expect(cloned[0]?.noVariables).toBeUndefined()
  })
})

describe('方向、时间戳与 state', () => {
  it('direction / timestamp 传入 ctx，state 跨帧持久', () => {
    const definition = compile(`
      return {
        apiVersion: 1,
        meta: { name: 't' },
        framing: { type: 'line' },
        decode: function (frame, ctx) {
          ctx.state.calls = (ctx.state.calls || 0) + 1
          return {
            summary: ctx.direction + ':' + ctx.timestamp + ':' + ctx.state.calls,
          }
        },
      }
    `)
    const executor = createProtocolExecutor(definition)
    expect(executor.decodeFrame(frame, 'rx', 100).results[0]?.summary).toBe('rx:100:1')
    expect(executor.decodeFrame(frame, 'tx', 200).results[0]?.summary).toBe('tx:200:2')
    expect(executor.state.calls).toBe(2)
  })

  it('encode 可以读写同一份 state；reset 原地清空', () => {
    const definition = compile(`
      return {
        apiVersion: 1,
        meta: { name: 't' },
        framing: { type: 'line' },
        encode: function (values, ctx) {
          ctx.state.encoded = (ctx.state.encoded || 0) + 1
          return [ctx.state.encoded]
        },
      }
    `)
    const executor = createProtocolExecutor(definition, { state: { seed: true } })
    const stateReference = executor.state
    expect(stateReference.seed).toBe(true)
    expect(executor.encode({})).toEqual({ ok: true, bytes: Uint8Array.from([1]) })
    expect(executor.encode({})).toEqual({ ok: true, bytes: Uint8Array.from([2]) })
    expect(executor.state.encoded).toBe(2)

    executor.reset()
    expect(executor.state).toBe(stateReference)
    expect(Object.keys(executor.state)).toEqual([])
    expect(executor.encode({})).toEqual({ ok: true, bytes: Uint8Array.from([1]) })
  })
})

describe('encode 结果校验', () => {
  const definition = (body: string): ProtocolDefinition => {
    const member = body.trim()
    const extra = member.length > 0 ? `, ${member}` : ''
    return compile(`
      return {
        apiVersion: 1,
        meta: { name: 't' },
        framing: { type: 'line' }${extra}
      }
    `)
  }

  it('接受 Uint8Array 与 0–255 整数数组', () => {
    const array = definition('encode: function () { return [0, 255, 16] }')
    expect(createProtocolExecutor(array).encode({})).toEqual({
      ok: true,
      bytes: Uint8Array.from([0, 255, 16]),
    })

    const typed = definition('encode: function () { return new Uint8Array([9, 8]) }')
    expect(createProtocolExecutor(typed).encode({})).toEqual({
      ok: true,
      bytes: Uint8Array.from([9, 8]),
    })
  })

  it('接受 hex 字段传入的 Uint8Array', () => {
    const binary = definition('encode: function (values) { return values.payload }')
    const outcome = createProtocolExecutor(binary).encode({
      payload: Uint8Array.from([0xaa, 0x55]),
    })
    expect(outcome).toEqual({ ok: true, bytes: Uint8Array.from([0xaa, 0x55]) })
  })

  it('拒绝非字节数组、越界值、空数组', () => {
    expect(
      createProtocolExecutor(definition("encode: function () { return 'abc' }")).encode({}),
    ).toEqual({ ok: false, error: 'encode 必须返回 Uint8Array 或 0–255 的整数数组' })
    expect(
      createProtocolExecutor(definition('encode: function () { return [256] }')).encode({}),
    ).toEqual({ ok: false, error: 'encode 必须返回 Uint8Array 或 0–255 的整数数组' })
    expect(
      createProtocolExecutor(definition('encode: function () { return [1.5] }')).encode({}),
    ).toEqual({ ok: false, error: 'encode 必须返回 Uint8Array 或 0–255 的整数数组' })
    const empty = createProtocolExecutor(definition('encode: function () { return [] }')).encode({})
    expect(empty.ok).toBe(false)
    if (!empty.ok) expect(empty.error).toContain('1–65536')
  })

  it('编码结果长度必须在 1–65536 之间', () => {
    const tooLong = definition('encode: function () { return new Array(65537).fill(0) }')
    const outcome = createProtocolExecutor(tooLong).encode({})
    expect(outcome.ok).toBe(false)
    if (!outcome.ok) expect(outcome.error).toContain('65536')
  })

  it('没有 encode 或 encode 抛错时给出错误', () => {
    const noEncode = definition('')
    expect(createProtocolExecutor(noEncode).encode({})).toEqual({
      ok: false,
      error: '插件未定义 encode 函数',
    })

    const throwing = definition(`
      encode: function () {
        sdk.assert(false, '间隔超出范围')
        return [1]
      }
    `)
    expect(createProtocolExecutor(throwing).encode({})).toEqual({
      ok: false,
      error: '间隔超出范围',
    })
  })

  it('非法返回值的错误消息是中文且可定位', () => {
    const outcome = createProtocolExecutor(definition('encode: function () { return {} }')).encode(
      {},
    )
    expect(outcome.ok).toBe(false)
    if (!outcome.ok) expect(outcome.error).toBe('encode 必须返回 Uint8Array 或 0–255 的整数数组')
  })
})

describe('console 收集', () => {
  it('收集定义构建期与 decode/encode 期的 log/warn/error', () => {
    const logs: Array<{ level: string; text: string }> = []
    const sink: ProtocolLogSink = (level, text) => {
      logs.push({ level, text })
    }
    const definition = compile(
      `
      console.log('build', 1, { a: 2 })
      console.warn('warn-build')
      console.error('error-build')
      return {
        apiVersion: 1,
        meta: { name: 't' },
        framing: { type: 'line' },
        decode: function () {
          console.log('decode-log')
          return { summary: 'ok' }
        },
        encode: function () {
          console.warn('encode-warn')
          return [1]
        },
      }
    `,
      sink,
    )
    const executor = createProtocolExecutor(definition, { onLog: sink })
    executor.decodeFrame(frame, 'rx', 0)
    executor.encode({})

    expect(logs).toEqual([
      { level: 'log', text: 'build 1 {"a":2}' },
      { level: 'warn', text: 'warn-build' },
      { level: 'error', text: 'error-build' },
      { level: 'log', text: 'decode-log' },
      { level: 'warn', text: 'encode-warn' },
    ])
  })

  it('每行最多 500 字', () => {
    const lines: string[] = []
    const definition = compile(`
      return {
        apiVersion: 1,
        meta: { name: 't' },
        framing: { type: 'line' },
        decode: function () {
          console.log('y'.repeat(700))
          return { summary: 'ok' }
        },
      }
    `)
    createProtocolExecutor(definition, {
      onLog: (_level, text) => lines.push(text),
    }).decodeFrame(frame, 'rx', 0)
    expect(lines[0]).toHaveLength(MAX_LOG_LINE_LENGTH)
  })
})
