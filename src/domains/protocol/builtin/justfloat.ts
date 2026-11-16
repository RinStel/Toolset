/**
 * 内置协议「JustFloat（VOFA+ 兼容）」（plan §6.5 / §8.6）。
 *
 * 帧格式：若干 f32le 字节 + 尾帧 `00 00 80 7F`（即小端 float 的 +Infinity）。
 */

import type { ProtocolRecord } from '../types'

export const JUSTFLOAT_PROTOCOL_ID = 'builtin:justfloat'

export const JUSTFLOAT_PROTOCOL_NAME = 'JustFloat（VOFA+ 兼容）'

/** 插件源码：按 f32le 依次读取内容，并输出 `ch0…chN-1` 变量。 */
export const JUSTFLOAT_CODE = `// 内置协议：JustFloat（VOFA+ 兼容）。
// 每帧由若干小端 float 组成，帧尾是 00 00 80 7F（+Infinity 的 float 字节）。
const MAX_VARIABLES = 256
const MAX_SUMMARY_ITEMS = 8

function formatNumber(value) {
  if (Number.isInteger(value)) return String(value)
  return String(Number(value.toFixed(6)))
}

function summarize(values) {
  const shown = []
  const limit = Math.min(values.length, MAX_SUMMARY_ITEMS)
  for (let index = 0; index < limit; index += 1) {
    shown.push('ch' + index + '=' + formatNumber(values[index]))
  }
  const extra = values.length - shown.length
  return shown.join(' ') + (extra > 0 ? ' …(+' + extra + ')' : '')
}

const definition = {
  apiVersion: 1,
  meta: {
    name: 'JustFloat（VOFA+ 兼容）',
    description:
      'JustFloat：每帧发送若干 float（小端）字节，并以尾帧 00 00 80 7F 结束。' +
      '下位机示例（C）：float data[] = {1.0f, 2.0f}; 把 data 的字节发出后追加 ' +
      'const unsigned char tail[4] = {0x00, 0x00, 0x80, 0x7F};',
    version: '1.0.0',
  },
  framing: {
    type: 'delimiter',
    end: '00 00 80 7F',
    include: 'content',
    maxFrameLength: 1024,
  },
  decode: function (frame) {
    if (frame.length === 0 || frame.length % 4 !== 0) {
      return { summary: '帧长度不是 4 的倍数', level: 'error', noVariables: true }
    }
    const total = frame.length / 4
    const count = Math.min(total, MAX_VARIABLES)
    const values = []
    const variables = {}
    for (let index = 0; index < count; index += 1) {
      // NaN / Infinity 原样保留：由仪表盘数据层的变量提取规则丢弃并计入无效样本。
      const value = sdk.read.f32le(frame, index * 4)
      values.push(value)
      variables['ch' + index] = value
    }
    return { type: 'justfloat', summary: summarize(values), variables: variables }
  },
}

return definition
`

/** 只读的内置协议记录。 */
export const JUSTFLOAT_PROTOCOL: ProtocolRecord = {
  id: JUSTFLOAT_PROTOCOL_ID,
  name: JUSTFLOAT_PROTOCOL_NAME,
  code: JUSTFLOAT_CODE,
  createdAt: 0,
  updatedAt: 0,
}
