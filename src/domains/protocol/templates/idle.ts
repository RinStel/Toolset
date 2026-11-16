/** 模板 `idle`：Modbus RTU 响应的空闲分帧 + CRC 校验（plan §8.6）。 */

import type { ProtocolTemplate } from '../types'

export const IDLE_TEMPLATE: ProtocolTemplate = {
  id: 'idle',
  name: 'Modbus RTU 响应（空闲分帧）',
  description: '按 5ms 空闲间隔分帧，校验 Modbus RTU 的 CRC16。',
  code: `// Modbus RTU response framed by an idle gap (typical for 9600 baud).
// Frame: slave(1) | function(1) | data(N) | CRC16-MODBUS(2, low byte first).
const CRC_LENGTH = 2

function crcText(value) {
  return sdk.hex(sdk.bytes(value & 0xff, (value >> 8) & 0xff))
}

function hex2(value) {
  return ('0' + value.toString(16).toUpperCase()).slice(-2)
}

return {
  apiVersion: 1,
  meta: {
    name: 'Modbus RTU 响应（空闲分帧）',
    description: '按 5ms 空闲间隔分帧，校验 Modbus RTU 的 CRC16。',
    version: '1.0.0',
  },
  framing: { type: 'idle', gapMs: 5 },
  decode: function (frame) {
    if (frame.length < 4) {
      return { summary: '帧长度不足', level: 'error' }
    }
    const crcStart = frame.length - CRC_LENGTH
    const expected = sdk.checksum.crc16modbus(frame.subarray(0, crcStart))
    const actual = sdk.read.u16le(frame, crcStart)
    if (expected !== actual) {
      return {
        summary: 'CRC 错误',
        level: 'error',
        fields: [
          { label: '期望 CRC', value: crcText(expected), format: 'hex' },
          { label: '实际 CRC', value: crcText(actual), format: 'hex' },
        ],
      }
    }
    const slave = sdk.read.u8(frame, 0)
    const func = sdk.read.u8(frame, 1)
    const data = frame.subarray(2, crcStart)
    return {
      type: 'modbus-response',
      summary: '从站 ' + slave + ' 功能码 0x' + hex2(func) + ' 数据 ' + sdk.hex(data),
      fields: [
        { label: '从站地址', value: slave, format: 'dec' },
        { label: '功能码', value: sdk.hex(sdk.bytes(func)), format: 'hex' },
        { label: '数据', value: sdk.hex(data), format: 'hex' },
      ],
    }
  },
}
`,
}
