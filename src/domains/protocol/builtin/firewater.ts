/**
 * 内置协议「FireWater（VOFA+ 兼容）」（plan §6.5 / §8.6）。
 *
 * 实现方式与用户插件完全相同：一段通过 `new Function('sdk', 'console', code)` 执行的
 * JS 函数体，最终 `return` 一个 `ProtocolDefinition`。
 */

import type { ProtocolRecord } from '../types'

export const FIREWATER_PROTOCOL_ID = 'builtin:firewater'

export const FIREWATER_PROTOCOL_NAME = 'FireWater（VOFA+ 兼容）'

/** 插件源码：按行解析逗号分隔的浮点数，并输出 `ch0…chN-1` 变量。 */
export const FIREWATER_CODE = `// 内置协议：FireWater（VOFA+ 兼容）。
// 每帧一行：「v0,v1,…」，行尾 LF（自动去掉 CR）。行内可用「标签:」前缀标注数据，
// 冒号前的部分不是数字时只作为摘要标签，不参与解析。
const MAX_VARIABLES = 256
const MAX_SUMMARY_ITEMS = 8

// 摘要里保留最多 6 位小数，并去掉多余的 0。
function formatNumber(value) {
  if (Number.isInteger(value)) return String(value)
  return String(Number(value.toFixed(6)))
}

// 摘要格式：ch0=1.23 ch1=4.56 …，最多 8 项，超出部分用 …(+N) 表示。
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
    name: 'FireWater（VOFA+ 兼容）',
    description:
      'FireWater：每帧发送一行逗号分隔的浮点数，行尾为 LF 或 CRLF；也可以用「标签:」前缀标注数据。' +
      '下位机示例（C）：printf("%f,%f\\\\n", a, b);',
    version: '1.0.0',
  },
  framing: { type: 'line', eol: 'lf', includeEol: false, maxFrameLength: 4096 },
  decode: function (frame) {
    const text = sdk.text(frame)
    let label = ''
    let payload = text
    const colon = text.indexOf(':')
    if (colon >= 0) {
      const prefix = text.slice(0, colon).trim()
      if (prefix.length === 0 || !Number.isFinite(Number(prefix))) {
        label = prefix
        payload = text.slice(colon + 1)
      }
    }
    const parts = payload.split(',')
    const values = []
    let allFinite = true
    for (let index = 0; index < parts.length; index += 1) {
      const value = Number(parts[index].trim())
      values.push(value)
      if (!Number.isFinite(value)) allFinite = false
    }
    if (!allFinite) {
      // 非数值行按整行文本消息输出，不生成变量。
      return { summary: text }
    }
    const variables = {}
    const count = Math.min(values.length, MAX_VARIABLES)
    for (let index = 0; index < count; index += 1) {
      variables['ch' + index] = values[index]
    }
    const channelText = summarize(values)
    return {
      type: 'firewater',
      summary: label.length > 0 ? label + ': ' + channelText : channelText,
      variables: variables,
    }
  },
}

return definition
`

/** 只读的内置协议记录。 */
export const FIREWATER_PROTOCOL: ProtocolRecord = {
  id: FIREWATER_PROTOCOL_ID,
  name: FIREWATER_PROTOCOL_NAME,
  code: FIREWATER_CODE,
  createdAt: 0,
  updatedAt: 0,
}
