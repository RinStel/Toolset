import { describe, expect, it } from 'vitest'

import {
  BUILTIN_PROTOCOLS,
  FIREWATER_PROTOCOL_ID,
  JUSTFLOAT_PROTOCOL_ID,
  KV_TEXT_PROTOCOL_ID,
} from '@/domains/protocol/public'
import { createFramer } from '@/domains/protocol/framing'
import { compileProtocol, createProtocolExecutor } from '@/domains/protocol/runtime/compile'
import type { DecodeResult, ProtocolDefinition } from '@/domains/protocol/types'

const ascii = (text: string): Uint8Array =>
  Uint8Array.from([...text].map((char) => char.charCodeAt(0)))

const JUSTFLOAT_TAIL = [0x00, 0x00, 0x80, 0x7f]

function compileBuiltin(id: string): ProtocolDefinition {
  const record = BUILTIN_PROTOCOLS.find((item) => item.id === id)
  expect(record, `找不到内置协议 ${id}`).toBeDefined()
  const result = compileProtocol(record?.code ?? '')
  expect(
    result.ok,
    `${id} 编译失败：${result.ok ? '' : result.errors.map((error) => error.message).join('; ')}`,
  ).toBe(true)
  if (!result.ok) throw new Error('编译失败')
  return result.definition
}

interface DecodedFrame {
  bytes: Uint8Array
  results: DecodeResult[]
  error?: string
}

/** 依次喂入数据块，用同一个执行器解码所有成帧结果。 */
function decodeChunks(definition: ProtocolDefinition, chunks: Uint8Array[]): DecodedFrame[] {
  const framer = createFramer(definition.framing)
  const executor = createProtocolExecutor(definition)
  const decoded: DecodedFrame[] = []
  let at = 0
  for (const chunk of chunks) {
    const output = framer.feed(chunk, at)
    at += 1
    for (const frame of output.frames) {
      const outcome = executor.decodeFrame(frame.bytes, 'rx', frame.at)
      decoded.push(
        outcome.error === undefined
          ? { bytes: frame.bytes, results: outcome.results }
          : { bytes: frame.bytes, results: outcome.results, error: outcome.error },
      )
    }
  }
  return decoded
}

function decodeOne(definition: ProtocolDefinition, frame: Uint8Array): DecodedFrame[] {
  return decodeChunks(definition, [frame])
}

function splitIntoChunks(bytes: Uint8Array, size: number): Uint8Array[] {
  const chunks: Uint8Array[] = []
  for (let offset = 0; offset < bytes.length; offset += size) {
    chunks.push(bytes.slice(offset, offset + size))
  }
  return chunks
}

function concatBytes(parts: Uint8Array[]): Uint8Array {
  const total = parts.reduce((sum, part) => sum + part.length, 0)
  const bytes = new Uint8Array(total)
  let offset = 0
  for (const part of parts) {
    bytes.set(part, offset)
    offset += part.length
  }
  return bytes
}

function justFloatFrame(values: number[]): Uint8Array {
  const bytes = new Uint8Array(values.length * 4 + JUSTFLOAT_TAIL.length)
  const view = new DataView(bytes.buffer)
  for (let index = 0; index < values.length; index += 1) {
    view.setFloat32(index * 4, values[index] ?? 0, true)
  }
  bytes.set(JUSTFLOAT_TAIL, values.length * 4)
  return bytes
}

/** 插件摘要里使用的数字格式：整数原样，其他保留 6 位小数并去掉多余的 0。 */
function summaryNumber(value: number): string {
  if (Number.isInteger(value)) return String(value)
  return String(Number(value.toFixed(6)))
}

describe('内置协议 FireWater', () => {
  const definition = compileBuiltin(FIREWATER_PROTOCOL_ID)

  it('纯数值行生成 ch0…chN-1 变量与摘要', () => {
    const decoded = decodeOne(definition, ascii('1,2.5,-3\n'))
    expect(decoded).toHaveLength(1)
    const result = decoded[0]?.results[0]
    expect(decoded[0]?.error).toBeUndefined()
    expect(result?.variables).toEqual({ ch0: 1, ch1: 2.5, ch2: -3 })
    expect(result?.summary).toBe('ch0=1 ch1=2.5 ch2=-3')
  })

  it('带「标签:」前缀时，冒号前作为摘要标签且不参与解析', () => {
    const decoded = decodeOne(definition, ascii('TEMP:1.5,2.5\n'))
    const result = decoded[0]?.results[0]
    expect(result?.variables).toEqual({ ch0: 1.5, ch1: 2.5 })
    expect(result?.summary).toBe('TEMP: ch0=1.5 ch1=2.5')

    // 冒号前是数字时不当作标签：整行按逗号分割后无法全部解析成有限数。
    const numericPrefix = decodeOne(definition, ascii('1:2,3\n'))
    expect(numericPrefix[0]?.results[0]?.summary).toBe('1:2,3')
    expect(numericPrefix[0]?.results[0]?.variables).toBeUndefined()
  })

  it('CRLF 行尾自动去掉 CR', () => {
    const decoded = decodeChunks(definition, [ascii('10,20\r\n30,40\r\n')])
    expect(decoded).toHaveLength(2)
    expect(decoded[0]?.results[0]?.variables).toEqual({ ch0: 10, ch1: 20 })
    expect(decoded[1]?.results[0]?.variables).toEqual({ ch0: 30, ch1: 40 })
  })

  it('跨数据块的行可以完整成帧', () => {
    const decoded = decodeChunks(definition, [ascii('1,2'), ascii('.5'), ascii('\n')])
    expect(decoded).toHaveLength(1)
    expect(decoded[0]?.results[0]?.variables).toEqual({ ch0: 1, ch1: 2.5 })
  })

  it('非数值行整行作为文本消息，不生成变量', () => {
    const result = decodeOne(definition, ascii('hello world\n'))[0]?.results[0]
    expect(result?.summary).toBe('hello world')
    expect(result?.variables).toBeUndefined()
    expect(result?.fields).toBeUndefined()
  })

  it('超过 256 项时变量截断，摘要最多 8 项并用 …(+N) 表示', () => {
    const values = Array.from({ length: 300 }, (_item, index) => index)
    const decoded = decodeOne(definition, ascii(`${values.join(',')}\n`))
    const result = decoded[0]?.results[0]
    const variables = result?.variables ?? {}
    expect(Object.keys(variables)).toHaveLength(256)
    expect(variables.ch0).toBe(0)
    expect(variables.ch255).toBe(255)
    expect(variables.ch256).toBeUndefined()

    const summary = result?.summary ?? ''
    expect(summary.match(/ch\d+=/g)).toHaveLength(8)
    expect(summary.endsWith(' …(+292)')).toBe(true)
  })
})

describe('内置协议 JustFloat', () => {
  const definition = compileBuiltin(JUSTFLOAT_PROTOCOL_ID)

  it('多帧粘包时一次喂入可解析出多帧', () => {
    const frames = [justFloatFrame([1.5, 2.5]), justFloatFrame([-1, 0]), justFloatFrame([3])]
    const decoded = decodeChunks(definition, [concatBytes(frames)])
    expect(decoded).toHaveLength(3)
    expect(decoded[0]?.results[0]?.variables).toEqual({ ch0: 1.5, ch1: 2.5 })
    expect(decoded[1]?.results[0]?.variables).toEqual({ ch0: -1, ch1: 0 })
    expect(decoded[2]?.results[0]?.variables).toEqual({ ch0: 3 })
  })

  it('跨数据块/半帧保留：尾帧被拆到两个块时也能成帧', () => {
    const frame = justFloatFrame([1, 2, 3])
    const splitInsideTail = [frame.slice(0, frame.length - 2), frame.slice(frame.length - 2)]
    expect(decodeChunks(definition, splitInsideTail)).toHaveLength(1)

    const splitInsideContent = [frame.slice(0, 7), frame.slice(7)]
    const decoded = decodeChunks(definition, splitInsideContent)
    expect(decoded).toHaveLength(1)
    expect(decoded[0]?.results[0]?.variables).toEqual({ ch0: 1, ch1: 2, ch2: 3 })
  })

  it('内容长度不是 4 的倍数时返回 error 结果', () => {
    const content = Uint8Array.from([1, 2, 3])
    const decoded = decodeOne(definition, concatBytes([content, Uint8Array.from(JUSTFLOAT_TAIL)]))
    expect(decoded).toHaveLength(1)
    const result = decoded[0]?.results[0]
    expect(result?.summary).toBe('帧长度不是 4 的倍数')
    expect(result?.level).toBe('error')
    expect(result?.variables).toBeUndefined()
    expect(result?.noVariables).toBe(true)
  })

  it('NaN / Infinity 原样作为变量返回（由仪表盘数据层丢弃并计入 invalidSamples）', () => {
    // 注意：+Infinity 的 f32le 字节恰好等于帧尾 00 00 80 7F，不能出现在内容里；
    // 这里用 NaN 与 -Infinity 验证“非有限数不提前过滤”。
    const decoded = decodeOne(
      definition,
      justFloatFrame([1.5, Number.NaN, Number.NEGATIVE_INFINITY]),
    )
    expect(decoded).toHaveLength(1)
    const result = decoded[0]?.results[0]
    expect(result?.variables?.ch0).toBe(1.5)
    expect(Number.isNaN(result?.variables?.ch1)).toBe(true)
    expect(result?.variables?.ch2).toBe(-Infinity)
    expect(result?.summary).toBe('ch0=1.5 ch1=NaN ch2=-Infinity')
  })
})

describe('内置协议 键值文本', () => {
  const definition = compileBuiltin(KV_TEXT_PROTOCOL_ID)

  it('「:」与「=」混用，且支持逗号/分号/空白三种分隔符', () => {
    const decoded = decodeOne(definition, ascii('temp:25.5,hum=48.2;volt:3301 count=7\n'))
    const result = decoded[0]?.results[0]
    expect(result?.variables).toEqual({ temp: 25.5, hum: 48.2, volt: 3301, count: 7 })
    expect(result?.fields).toBeUndefined()
    expect(result?.summary).toBe('temp=25.5 hum=48.2 volt=3301 count=7')
  })

  it('非法 key 被忽略；全部项都非法时整行作为文本消息', () => {
    const partial = decodeOne(definition, ascii('1bad:2,good=3\n'))[0]?.results[0]
    expect(partial?.variables).toEqual({ good: 3 })
    expect(partial?.summary).toBe('good=3')

    const none = decodeOne(definition, ascii('1bad:2,2bad:3\n'))[0]?.results[0]
    expect(none?.summary).toBe('1bad:2,2bad:3')
    expect(none?.variables).toBeUndefined()
    expect(none?.fields).toBeUndefined()
  })

  it('非数值项成为带 key 的文本字段', () => {
    const result = decodeOne(definition, ascii('temp:25.5,label:hello\n'))[0]?.results[0]
    expect(result?.variables).toEqual({ temp: 25.5 })
    expect(result?.fields).toEqual([{ label: 'label', key: 'label', value: 'hello' }])
    expect(result?.summary).toBe('temp=25.5 label=hello')
  })

  it('合法变量名可以包含点和下划线', () => {
    const result = decodeOne(definition, ascii('motor.rpm:1500,_flag=1\n'))[0]?.results[0]
    expect(result?.variables).toEqual({ 'motor.rpm': 1500, _flag: 1 })
  })
})

/* ------------------------------------------------------------------------- */
/* 演示设备兼容性（plan §8.7）：在测试内按公式生成同样格式的字节，              */
/* 不 import domains/link 的内部文件。                                          */
/* ------------------------------------------------------------------------- */

const DEMO_INTERVAL_MS = 10
const DEMO_SAMPLES = 5

/** plan §8.7 的演示变量公式；ch4 的随机噪声用固定值代替以保持测试确定性。 */
function demoChannels(sample: number, amp = 1): number[] {
  const tau = (sample * DEMO_INTERVAL_MS) / 1000
  const twoPi = Math.PI * 2
  return [
    amp * Math.sin(twoPi * tau),
    amp * Math.cos(twoPi * tau),
    amp * Math.sign(Math.sin(twoPi * 0.5 * tau)),
    amp * ((0.2 * tau) % 1),
    0.55,
    amp * (0.5 * Math.sin(twoPi * 50 * tau) + 0.2 * Math.sin(twoPi * 120 * tau)),
    25 + 5 * Math.sin(twoPi * 0.05 * tau),
    sample,
  ]
}

function firewaterDemoBytes(): Uint8Array {
  const lines: string[] = []
  for (let sample = 0; sample < DEMO_SAMPLES; sample += 1) {
    const channels = demoChannels(sample)
    lines.push(`${channels.map((value) => value.toFixed(6)).join(',')}\n`)
  }
  return ascii(lines.join(''))
}

function justfloatDemoBytes(): Uint8Array {
  return concatBytes(
    Array.from({ length: DEMO_SAMPLES }, (_item, sample) => justFloatFrame(demoChannels(sample))),
  )
}

function kvTextDemoBytes(): Uint8Array {
  const lines: string[] = []
  for (let sample = 0; sample < DEMO_SAMPLES; sample += 1) {
    const channels = demoChannels(sample)
    lines.push(`${channels.map((value, index) => `ch${index}:${value.toFixed(6)}`).join(',')}\n`)
  }
  return ascii(lines.join(''))
}

describe('演示设备在每种 format 下生成的数据都能被内置协议完整解析', () => {
  it('firewater：6 位小数 + LF', () => {
    const decoded = decodeChunks(
      compileBuiltin(FIREWATER_PROTOCOL_ID),
      splitIntoChunks(firewaterDemoBytes(), 7),
    )
    expect(decoded).toHaveLength(DEMO_SAMPLES)
    for (let sample = 0; sample < DEMO_SAMPLES; sample += 1) {
      const channels = demoChannels(sample)
      const variables = decoded[sample]?.results[0]?.variables ?? {}
      for (let index = 0; index < channels.length; index += 1) {
        expect(variables[`ch${index}`]).toBe(Number((channels[index] ?? 0).toFixed(6)))
      }
    }
  })

  it('justfloat：f32le 数组 + 尾帧 00 00 80 7F', () => {
    const decoded = decodeChunks(
      compileBuiltin(JUSTFLOAT_PROTOCOL_ID),
      splitIntoChunks(justfloatDemoBytes(), 7),
    )
    expect(decoded).toHaveLength(DEMO_SAMPLES)
    for (let sample = 0; sample < DEMO_SAMPLES; sample += 1) {
      const channels = demoChannels(sample)
      const variables = decoded[sample]?.results[0]?.variables ?? {}
      for (let index = 0; index < channels.length; index += 1) {
        expect(variables[`ch${index}`]).toBe(Math.fround(channels[index] ?? 0))
      }
    }
  })

  it('kv-text：ch0:…,ch1:… 行', () => {
    const decoded = decodeChunks(
      compileBuiltin(KV_TEXT_PROTOCOL_ID),
      splitIntoChunks(kvTextDemoBytes(), 11),
    )
    expect(decoded).toHaveLength(DEMO_SAMPLES)
    for (let sample = 0; sample < DEMO_SAMPLES; sample += 1) {
      const channels = demoChannels(sample)
      const variables = decoded[sample]?.results[0]?.variables ?? {}
      for (let index = 0; index < channels.length; index += 1) {
        expect(variables[`ch${index}`]).toBe(Number((channels[index] ?? 0).toFixed(6)))
      }
    }
  })

  it('摘要格式为 ch0=…，最多 8 项', () => {
    const channels = demoChannels(0)
    const summary = summaryNumber(channels[0] ?? 0)
    expect(summary).toBe('0')
    const decoded = decodeOne(compileBuiltin(KV_TEXT_PROTOCOL_ID), kvTextDemoBytes())
    const firstSummary = decoded[0]?.results[0]?.summary ?? ''
    expect(firstSummary.startsWith('ch0=0 ch1=1 ch2=0 ch3=0 ch4=0.55')).toBe(true)
    expect(firstSummary.match(/ch\d+=/g)).toHaveLength(8)
  })
})
