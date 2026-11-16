import { describe, expect, it } from 'vitest'

import { checksum, toHex } from '@/domains/bytes/public'
import {
  BUILTIN_PROTOCOLS,
  FIREWATER_PROTOCOL_ID,
  JUSTFLOAT_PROTOCOL_ID,
  KV_TEXT_PROTOCOL_ID,
  SENSOR_A5_PROTOCOL_ID,
  TEMPLATES,
} from '@/domains/protocol/public'
import { createFramer } from '@/domains/protocol/framing'
import { createProtocolRepository } from '@/domains/protocol/repository'
import { compileProtocol, createProtocolExecutor } from '@/domains/protocol/runtime/compile'
import type { ProtocolDefinition, ProtocolRecord } from '@/domains/protocol/types'

const ascii = (text: string): Uint8Array =>
  Uint8Array.from([...text].map((char) => char.charCodeAt(0)))

function hexOf(value: Uint8Array): string {
  return toHex(value)
}

function builtinRecord(id: string): ProtocolRecord {
  const record = BUILTIN_PROTOCOLS.find((item) => item.id === id)
  expect(record, `找不到内置协议 ${id}`).toBeDefined()
  return record as ProtocolRecord
}

/** 按内置协议格式构造一帧（CRC 错误时破坏低字节）。 */
function sensorFrame(
  cmd: number,
  data: number[],
  options: { corruptCrc?: boolean } = {},
): Uint8Array {
  const length = 1 + data.length
  const body = Uint8Array.from([0xa5, 0x5a, length, cmd, ...data])
  const crc = checksum('crc16-modbus', body)
  let low = crc & 0xff
  const high = (crc >> 8) & 0xff
  if (options.corruptCrc) low ^= 0xff
  return Uint8Array.from([...body, low, high])
}

const REPORT_DATA = [
  0xe3,
  0x09, // 温度 2531 ×0.01 = 25.31°C
  0xd4,
  0x12, // 湿度 4820 ×0.01 = 48.20%
  0xe5,
  0x0c, // 电压 3301mV
  0x2a,
  0x00,
  0x00,
  0x00, // 计数 42
]

function compileDefinition(code: string): ProtocolDefinition {
  const result = compileProtocol(code)
  expect(result.ok, result.ok ? '' : result.errors.map((error) => error.message).join('; ')).toBe(
    true,
  )
  if (!result.ok) throw new Error('编译失败')
  return result.definition
}

function decodeThroughFramer(
  definition: ProtocolDefinition,
  frame: Uint8Array,
  direction: 'rx' | 'tx' = 'rx',
) {
  const framer = createFramer(definition.framing)
  const output = framer.feed(frame, 100)
  expect(output.frames).toHaveLength(1)
  const executor = createProtocolExecutor(definition)
  const frameResult = output.frames[0]
  expect(frameResult).toBeDefined()
  return executor.decodeFrame(frameResult?.bytes as Uint8Array, direction, 100)
}

describe('内置协议「传感器帧（A5 5A）」', () => {
  const definition = compileDefinition(builtinRecord(SENSOR_A5_PROTOCOL_ID).code)

  it('元信息与分帧配置符合 plan §8.6', () => {
    expect(definition.meta.name).toBe('传感器帧（A5 5A）')
    expect(definition.framing).toEqual({
      type: 'length',
      header: 'A5 5A',
      length: { offset: 2, size: 1, includes: 'after', adjust: 2 },
    })
    expect(BUILTIN_PROTOCOLS).toHaveLength(4)
    expect(BUILTIN_PROTOCOLS.map((record) => record.id)).toEqual([
      FIREWATER_PROTOCOL_ID,
      JUSTFLOAT_PROTOCOL_ID,
      KV_TEXT_PROTOCOL_ID,
      SENSOR_A5_PROTOCOL_ID,
    ])
  })

  it('能解析演示设备的 0x01 上报帧，并输出 variables / variableMeta', () => {
    const frame = sensorFrame(0x01, REPORT_DATA)
    expect(frame).toHaveLength(16)
    const outcome = decodeThroughFramer(definition, frame)

    expect(outcome.error).toBeUndefined()
    const result = outcome.results[0]
    expect(result?.type).toBe('report')
    expect(result?.summary).toBe('上报 #42 温度 25.31°C 湿度 48.20% 电压 3301mV')
    expect(result?.fields?.map((field) => field.label)).toEqual(['计数', '温度', '湿度', '电压'])
    expect(result?.fields?.[0]).toEqual({ label: '计数', value: 42, format: 'dec' })
    expect(result?.fields?.[1]).toEqual({ label: '温度', value: '25.31', unit: '°C' })
    expect(result?.fields?.[2]).toEqual({ label: '湿度', value: '48.20', unit: '%' })
    expect(result?.fields?.[3]).toEqual({ label: '电压', value: 3301, unit: 'mV', format: 'dec' })

    expect(result?.variables?.temp).toBeCloseTo(25.31, 10)
    expect(result?.variables?.hum).toBeCloseTo(48.2, 10)
    expect(result?.variables?.volt).toBe(3301)
    expect(result?.variables?.count).toBe(42)
    expect(result?.variableMeta).toEqual({
      temp: { unit: '°C', label: '温度' },
      hum: { unit: '%RH', label: '湿度' },
      volt: { unit: 'mV', label: '电压' },
      count: { label: '计数' },
    })
  })

  it('坏 CRC 产生 error 级别结果，并带期望/实际字段', () => {
    const frame = sensorFrame(0x01, REPORT_DATA, { corruptCrc: true })
    const outcome = decodeThroughFramer(definition, frame)
    expect(outcome.error).toBeUndefined()
    const result = outcome.results[0]
    expect(result?.summary).toBe('CRC 错误')
    expect(result?.level).toBe('error')
    expect(result?.fields).toHaveLength(2)
    expect(result?.fields?.[0]?.label).toBe('期望 CRC')
    expect(result?.fields?.[1]?.label).toBe('实际 CRC')
    expect(result?.fields?.[0]?.value).not.toBe(result?.fields?.[1]?.value)
    expect(result?.fields?.[0]?.format).toBe('hex')
  })

  it('解析 0x90 应答帧（成功 / 超出范围），非上报结果不产生变量', () => {
    const success = decodeThroughFramer(definition, sensorFrame(0x90, [0x00, 0xe8, 0x03]))
    expect(success.results[0]?.summary).toBe('应答 状态 成功 间隔 1000ms')
    expect(success.results[0]?.level).toBe('info')
    expect(success.results[0]?.noVariables).toBe(true)
    expect(success.results[0]?.variables).toBeUndefined()

    const outOfRange = decodeThroughFramer(definition, sensorFrame(0x90, [0x01, 0xe8, 0x03]))
    expect(outOfRange.results[0]?.summary).toBe('应答 状态 超出范围 间隔 1000ms')
    expect(outOfRange.results[0]?.level).toBe('warn')
  })

  it('解析 0x10 设置间隔帧（tx 方向）', () => {
    const outcome = decodeThroughFramer(definition, sensorFrame(0x10, [0xe8, 0x03]), 'tx')
    expect(outcome.results[0]?.summary).toBe('设置上报间隔 1000ms')
    expect(outcome.results[0]?.fields?.[0]).toEqual({
      label: '上报间隔',
      value: 1000,
      unit: 'ms',
      format: 'dec',
    })
  })

  it('未知命令给出 warn 级别结果', () => {
    const outcome = decodeThroughFramer(definition, sensorFrame(0x7f, [0x01]))
    expect(outcome.results[0]?.summary).toBe('未知命令 0x7F')
    expect(outcome.results[0]?.level).toBe('warn')
  })

  it('encode 生成与设备一致的 0x10 帧', () => {
    const executor = createProtocolExecutor(definition)
    const outcome = executor.encode({ interval: 1000 })
    expect(outcome.ok).toBe(true)
    if (!outcome.ok) return
    expect(hexOf(outcome.bytes)).toBe(hexOf(sensorFrame(0x10, [0xe8, 0x03])))

    const max = executor.encode({ interval: 10000 })
    expect(max.ok).toBe(true)
    expect(hexOf((max as { ok: true; bytes: Uint8Array }).bytes)).toBe(
      hexOf(sensorFrame(0x10, [0x10, 0x27])),
    )
  })

  it('encode 校验间隔范围', () => {
    const executor = createProtocolExecutor(definition)
    for (const interval of [99, 10001, 12.5, 'abc']) {
      const outcome = executor.encode({ interval })
      expect(outcome.ok, `interval=${String(interval)} 应失败`).toBe(false)
      if (!outcome.ok) expect(outcome.error).toContain('100–10000')
    }
  })
})

describe('内置数据格式的说明', () => {
  it('meta.description 给出下位机发送示例（plan §6.5）', () => {
    const cases: Array<{ id: string; name: string; example: string }> = [
      { id: FIREWATER_PROTOCOL_ID, name: 'FireWater', example: 'printf("%f,%f\\n", a, b)' },
      { id: JUSTFLOAT_PROTOCOL_ID, name: 'JustFloat', example: '0x00, 0x00, 0x80, 0x7F' },
      { id: KV_TEXT_PROTOCOL_ID, name: '键值文本', example: 'printf(' },
      { id: SENSOR_A5_PROTOCOL_ID, name: '传感器帧', example: 'A5 5A' },
    ]
    for (const item of cases) {
      const definition = compileDefinition(builtinRecord(item.id).code)
      expect(definition.meta.description, item.name).toContain(item.example)
    }
  })
})

describe('内置模板', () => {
  it('5 个模板都能编译且定义合法', () => {
    expect(TEMPLATES).toHaveLength(5)
    expect(TEMPLATES.map((template) => template.id)).toEqual([
      'minimal',
      'line',
      'length-crc',
      'idle',
      'variables',
    ])
    for (const template of TEMPLATES) {
      const result = compileProtocol(template.code)
      expect(
        result.ok,
        `${template.name} 编译失败：${result.ok ? '' : result.errors.map((error) => error.message).join('; ')}`,
      ).toBe(true)
      expect(template.code.trim().length).toBeGreaterThan(0)
    }
  })

  it('minimal 模板按行输出文本摘要', () => {
    const template = TEMPLATES.find((item) => item.id === 'minimal')
    const definition = compileDefinition(template?.code as string)
    const outcome = decodeThroughFramer(definition, ascii('hello\n'))
    expect(outcome.results[0]?.summary).toBe('收到文本：hello')
  })

  it('line 模板解析 KEY=VALUE', () => {
    const template = TEMPLATES.find((item) => item.id === 'line')
    const definition = compileDefinition(template?.code as string)
    const outcome = decodeThroughFramer(definition, ascii('A=1,B=hello\n'))
    expect(outcome.results[0]?.summary).toBe('数据行：2 项')
    expect(outcome.results[0]?.fields).toEqual([
      { label: 'A', value: '1' },
      { label: 'B', value: 'hello' },
    ])
  })

  it('length-crc 模板校验 CRC 并能解码', () => {
    const template = TEMPLATES.find((item) => item.id === 'length-crc')
    const definition = compileDefinition(template?.code as string)
    const body = Uint8Array.from([0xaa, 0x55, 0x02, 0x01, 0xab])
    const crc = checksum('crc16-modbus', body)
    const frame = Uint8Array.from([...body, crc & 0xff, (crc >> 8) & 0xff])
    const outcome = decodeThroughFramer(definition, frame)
    expect(outcome.results[0]?.summary).toBe('命令 0x01 数据 AB')
  })

  it('idle 模板用空闲分帧解析 Modbus RTU 响应', () => {
    const template = TEMPLATES.find((item) => item.id === 'idle')
    const definition = compileDefinition(template?.code as string)
    const framer = createFramer(definition.framing)
    const body = Uint8Array.from([0x01, 0x03, 0x00, 0x0a])
    const crc = checksum('crc16-modbus', body)
    const frame = Uint8Array.from([...body, crc & 0xff, (crc >> 8) & 0xff])
    expect(framer.feed(frame, 10).frames).toHaveLength(0)
    const flushed = framer.flush(20)
    expect(flushed.frames).toHaveLength(1)
    const outcome = createProtocolExecutor(definition).decodeFrame(
      flushed.frames[0]?.bytes as Uint8Array,
      'rx',
      20,
    )
    expect(outcome.results[0]?.summary).toBe('从站 1 功能码 0x03 数据 00 0A')
  })

  it('variables 模板返回 variables 与 variableMeta', () => {
    const template = TEMPLATES.find((item) => item.id === 'variables')
    const definition = compileDefinition(template?.code as string)
    const outcome = decodeThroughFramer(definition, ascii('temp=23.5,hum=48.2,volt=3301\n'))
    expect(outcome.error).toBeUndefined()
    const result = outcome.results[0]
    expect(result?.summary).toBe('temp=23.5 hum=48.2 volt=3301')
    expect(result?.variables).toEqual({ temp: 23.5, hum: 48.2, volt: 3301 })
    expect(result?.variableMeta).toEqual({
      temp: { label: '温度', unit: '°C' },
      hum: { label: '湿度', unit: '%RH' },
      volt: { label: '电压', unit: 'mV' },
    })

    const textOnly = decodeThroughFramer(definition, ascii('hello\n'))
    expect(textOnly.results[0]?.noVariables).toBe(true)
    expect(textOnly.results[0]?.summary).toContain('无法解析')
  })
})

describe('插件仓库', () => {
  it('内置协议出现在列表中且只读', async () => {
    const repository = createProtocolRepository()
    const list = await repository.list()
    const builtins = list.filter((record) => record.builtin)
    expect(builtins.map((record) => record.id)).toEqual([
      FIREWATER_PROTOCOL_ID,
      JUSTFLOAT_PROTOCOL_ID,
      KV_TEXT_PROTOCOL_ID,
      SENSOR_A5_PROTOCOL_ID,
    ])

    const builtin = await repository.get(SENSOR_A5_PROTOCOL_ID)
    expect(builtin?.name).toBe('传感器帧（A5 5A）')
    expect(builtin?.code).toContain('apiVersion: 1')

    await expect(
      repository.save({ id: SENSOR_A5_PROTOCOL_ID, name: '改内置', code: '' }),
    ).rejects.toThrow('内置协议不可修改')
    await expect(repository.remove(SENSOR_A5_PROTOCOL_ID)).rejects.toThrow('内置协议不可删除')
  })

  it('保存、读取、导出、删除自定义协议并通知订阅者', async () => {
    const repository = createProtocolRepository()
    const notifications: Array<Array<{ id: string; name: string }>> = []
    const unsubscribe = repository.subscribe((records) => {
      notifications.push(records.map((record) => ({ id: record.id, name: record.name })))
    })

    const saved = await repository.save({ name: '自定义协议', code: 'return 1' })
    expect(saved.id).toHaveLength(36)
    expect(saved.createdAt).toBeGreaterThan(0)

    expect(await repository.get(saved.id)).toMatchObject({
      id: saved.id,
      name: '自定义协议',
      code: 'return 1',
    })
    const list = await repository.list()
    expect(list.some((record) => record.id === saved.id && !record.builtin)).toBe(true)
    expect(notifications.at(-1)?.some((record) => record.id === saved.id)).toBe(true)

    const exported = await repository.exportFile(saved.id)
    expect(exported.fileName).toBe('自定义协议.protocol.js')
    expect(exported.code).toBe('return 1')

    const updated = await repository.save({ id: saved.id, name: '改名', code: 'return 2' })
    expect(updated.createdAt).toBe(saved.createdAt)
    expect(updated.updatedAt).toBeGreaterThanOrEqual(saved.updatedAt)

    expect(await repository.remove(saved.id)).toBe(true)
    expect(await repository.get(saved.id)).toBeUndefined()
    expect(await repository.remove(saved.id)).toBe(false)
    unsubscribe()

    await expect(repository.exportFile(saved.id)).rejects.toThrow('协议不存在')
  })

  it('导入时协议名取自编译结果，编译失败时回退到文件名', async () => {
    const repository = createProtocolRepository()
    const minimal = TEMPLATES.find((item) => item.id === 'minimal')
    const valid = await repository.importFile(minimal?.code as string, 'whatever.js')
    expect(valid.name).toBe('最小示例')
    expect(await repository.get(valid.id)).toMatchObject({ name: '最小示例' })
    await repository.remove(valid.id)

    const invalid = await repository.importFile('return { apiVersion: 1 }', '坏协议.js')
    expect(invalid.name).toBe('坏协议')
    expect(invalid.code).toBe('return { apiVersion: 1 }')
    await repository.remove(invalid.id)
  })
})
