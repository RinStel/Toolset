/** 模板 `length-crc`：与内置传感器协议结构相同，带注释（plan §8.6）。 */

import type { ProtocolTemplate } from '../types'

export const LENGTH_CRC_TEMPLATE: ProtocolTemplate = {
  id: 'length-crc',
  name: '长度 + CRC 帧',
  description: 'AA 55 | LEN | CMD | DATA | CRC16-MODBUS，结构同内置传感器协议。',
  code: `// Length + CRC frame: AA 55 | LEN(1) | CMD(1) | DATA | CRC16-MODBUS(2, low byte first).
// LEN is the number of bytes in CMD + DATA, so total frame length = LEN + 5.
// The CRC covers every byte from the header up to (not including) the CRC field.
const CRC_LENGTH = 2
const FIXED_OVERHEAD = 5
const LEN_INDEX = 2
const CMD_INDEX = 3

function crcText(value) {
  return sdk.hex(sdk.bytes(value & 0xff, (value >> 8) & 0xff))
}

function hex2(value) {
  return ('0' + value.toString(16).toUpperCase()).slice(-2)
}

return {
  apiVersion: 1,
  meta: {
    name: '长度 + CRC 帧',
    description: 'AA 55 | LEN | CMD | DATA | CRC16-MODBUS，适合大多数二进制设备协议。',
    version: '1.0.0',
  },
  framing: {
    type: 'length',
    header: 'AA 55',
    length: { offset: 2, size: 1, includes: 'after', adjust: 2 },
  },
  decode: function (frame) {
    if (frame.length < FIXED_OVERHEAD) {
      return { summary: '帧长度不足', level: 'error' }
    }
    const len = sdk.read.u8(frame, LEN_INDEX)
    if (len + FIXED_OVERHEAD !== frame.length) {
      return { summary: 'LEN 与帧长不一致', level: 'error' }
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
    const cmd = sdk.read.u8(frame, CMD_INDEX)
    const data = frame.subarray(4, crcStart)
    return {
      type: 'frame',
      summary: '命令 0x' + hex2(cmd) + ' 数据 ' + (data.length === 0 ? '(无)' : sdk.hex(data)),
      fields: [
        { label: '命令', value: sdk.hex(sdk.bytes(cmd)), format: 'hex' },
        { label: '数据', value: sdk.hex(data), format: 'hex' },
      ],
    }
  },
}
`,
}
