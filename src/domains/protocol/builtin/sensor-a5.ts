/**
 * 内置协议「传感器帧（A5 5A）」（plan §8.6），与演示设备行为一致。
 *
 * 帧格式：A5 5A | LEN(1) | CMD(1) | DATA(LEN-1) | CRC16-MODBUS(2, 低字节在前)
 * LEN = CMD 与 DATA 的字节数之和；CRC 覆盖从 A5 到 DATA 末尾的全部字节。
 */

import type { ProtocolRecord } from '../types'

export const SENSOR_A5_PROTOCOL_ID = 'builtin:sensor-a5'

export const SENSOR_A5_PROTOCOL_NAME = '传感器帧（A5 5A）'

/** 插件源码：一个返回 `ProtocolDefinition` 的 JS 函数体。 */
export const SENSOR_A5_CODE = `// 内置协议：传感器帧（A5 5A）。帧尾为 CRC16-MODBUS，低字节在前。
const CRC_LENGTH = 2
const LEN_INDEX = 2
const CMD_INDEX = 3
// A5 5A(2) + LEN(1) + CRC(2)
const FIXED_OVERHEAD = 5

// 把 CRC 数值显示成线上的两个字节（低字节在前）。
function crcText(value) {
  return sdk.hex(sdk.bytes(value & 0xff, (value >> 8) & 0xff))
}

function statusText(status) {
  if (status === 0) return '成功'
  if (status === 1) return '超出范围'
  return '未知(' + status + ')'
}

function crcCheck(frame) {
  const crcStart = frame.length - CRC_LENGTH
  const expected = sdk.checksum.crc16modbus(frame.subarray(0, crcStart))
  const actual = sdk.read.u16le(frame, crcStart)
  return { expected: expected, actual: actual, ok: expected === actual }
}

const definition = {
  apiVersion: 1,
  meta: {
    name: '传感器帧（A5 5A）',
    description:
      '演示设备协议：A5 5A | LEN | CMD | DATA | CRC16-MODBUS（低字节在前）。' +
      '0x01 上报帧的变量：temp（°C）、hum（%RH）、volt（mV）、count（计数）。',
    version: '1.0.0',
  },
  framing: {
    type: 'length',
    header: 'A5 5A',
    length: { offset: 2, size: 1, includes: 'after', adjust: 2 },
  },
  decode: function (frame, ctx) {
    if (frame.length < FIXED_OVERHEAD) {
      return { summary: '帧长度不足', level: 'error', noVariables: true }
    }
    const len = sdk.read.u8(frame, LEN_INDEX)
    if (len + FIXED_OVERHEAD !== frame.length) {
      return {
        summary: 'LEN 与帧长不一致',
        level: 'error',
        fields: [
          { label: 'LEN', value: len, format: 'dec' },
          { label: '帧长', value: frame.length, format: 'dec' },
        ],
        noVariables: true,
      }
    }
    const crc = crcCheck(frame)
    if (!crc.ok) {
      return {
        summary: 'CRC 错误',
        level: 'error',
        fields: [
          { label: '期望 CRC', value: crcText(crc.expected), format: 'hex' },
          { label: '实际 CRC', value: crcText(crc.actual), format: 'hex' },
        ],
        noVariables: true,
      }
    }
    const cmd = sdk.read.u8(frame, CMD_INDEX)
    const dataLength = len - 1
    if (cmd === 0x01) {
      if (dataLength !== 10) {
        return { summary: '上报数据长度错误', level: 'error', noVariables: true }
      }
      const temperature = sdk.read.i16le(frame, 4) * 0.01
      const humidity = sdk.read.u16le(frame, 6) * 0.01
      const voltage = sdk.read.u16le(frame, 8)
      const count = sdk.read.u32le(frame, 10)
      return {
        type: 'report',
        summary:
          '上报 #' + count + ' 温度 ' + temperature.toFixed(2) + '°C 湿度 ' +
          humidity.toFixed(2) + '% 电压 ' + voltage + 'mV',
        fields: [
          { label: '计数', value: count, format: 'dec' },
          { label: '温度', value: temperature.toFixed(2), unit: '°C' },
          { label: '湿度', value: humidity.toFixed(2), unit: '%' },
          { label: '电压', value: voltage, unit: 'mV', format: 'dec' },
        ],
        variables: {
          temp: temperature,
          hum: humidity,
          volt: voltage,
          count: count,
        },
        variableMeta: {
          temp: { unit: '°C', label: '温度' },
          hum: { unit: '%RH', label: '湿度' },
          volt: { unit: 'mV', label: '电压' },
          count: { label: '计数' },
        },
      }
    }
    if (cmd === 0x10) {
      if (dataLength !== 2) {
        return { summary: '设置间隔数据长度错误', level: 'error', noVariables: true }
      }
      const interval = sdk.read.u16le(frame, 4)
      return {
        type: 'set-interval',
        summary: '设置上报间隔 ' + interval + 'ms',
        fields: [{ label: '上报间隔', value: interval, unit: 'ms', format: 'dec' }],
        noVariables: true,
      }
    }
    if (cmd === 0x90) {
      if (dataLength !== 3) {
        return { summary: '应答数据长度错误', level: 'error', noVariables: true }
      }
      const status = sdk.read.u8(frame, 4)
      const interval = sdk.read.u16le(frame, 5)
      return {
        type: 'ack',
        summary: '应答 状态 ' + statusText(status) + ' 间隔 ' + interval + 'ms',
        level: status === 0 ? 'info' : 'warn',
        fields: [
          { label: '状态', value: statusText(status) },
          { label: '间隔', value: interval, unit: 'ms', format: 'dec' },
        ],
        noVariables: true,
      }
    }
    const cmdHex = ('0' + cmd.toString(16).toUpperCase()).slice(-2)
    return { type: 'unknown', summary: '未知命令 0x' + cmdHex, level: 'warn', noVariables: true }
  },
  sendForm: {
    fields: [
      {
        key: 'interval',
        label: '上报间隔',
        type: 'number',
        min: 100,
        max: 10000,
        step: 100,
        default: 1000,
        unit: 'ms',
      },
    ],
  },
  encode: function (values, ctx) {
    const interval = Number(values.interval)
    sdk.assert(
      Number.isInteger(interval) && interval >= 100 && interval <= 10000,
      '上报间隔必须是 100–10000 之间的整数',
    )
    const body = sdk.bytes(
      0xa5,
      0x5a,
      3,
      0x10,
      interval & 0xff,
      (interval >> 8) & 0xff,
    )
    const crc = sdk.checksum.crc16modbus(body)
    return sdk.bytes(body, crc & 0xff, (crc >> 8) & 0xff)
  },
}

return definition
`

/** 只读的内置协议记录。 */
export const SENSOR_A5_PROTOCOL: ProtocolRecord = {
  id: SENSOR_A5_PROTOCOL_ID,
  name: SENSOR_A5_PROTOCOL_NAME,
  code: SENSOR_A5_CODE,
  createdAt: 0,
  updatedAt: 0,
}
