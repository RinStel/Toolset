/**
 * 内置协议「键值文本」（plan §6.5 / §8.6）。
 *
 * 每行由若干 `key:value` / `key=value` 项组成，项之间用 `,`、`;` 或空白分隔。
 */

import type { ProtocolRecord } from '../types'

export const KV_TEXT_PROTOCOL_ID = 'builtin:kv-text'

export const KV_TEXT_PROTOCOL_NAME = '键值文本'

/** 插件源码：把符合变量名规则的有限数项输出为变量，其余作为文本字段。 */
export const KV_TEXT_CODE = `// 内置协议：键值文本。
// 每帧一行，例如「temp:25.5,hum=48.2,volt:3301」；项之间可用逗号、分号或空白分隔。
const MAX_VARIABLES = 256
const MAX_SUMMARY_ITEMS = 8
const KEY_PATTERN = /^[A-Za-z_][A-Za-z0-9_.]{0,63}$/
const SEPARATOR_PATTERN = /[;, \\t]+/

function formatNumber(value) {
  if (Number.isInteger(value)) return String(value)
  return String(Number(value.toFixed(6)))
}

// 每一项是 key:value 或 key=value；key 必须符合变量名规则。
function parseItem(text) {
  let index = text.indexOf(':')
  const equals = text.indexOf('=')
  if (index < 0 || (equals >= 0 && equals < index)) index = equals
  if (index <= 0) return null
  const key = text.slice(0, index).trim()
  if (!KEY_PATTERN.test(key)) return null
  return { key: key, value: text.slice(index + 1).trim() }
}

const definition = {
  apiVersion: 1,
  meta: {
    name: '键值文本',
    description:
      '键值文本：每帧一行，每项为 key:value 或 key=value，项之间用逗号、分号或空白分隔；' +
      '有限数项成为仪表盘变量，其余成为文本字段。' +
      '下位机示例（C）：printf("temp:%.2f,hum:%.2f,volt=%d\\\\n", temp, hum, volt);',
    version: '1.0.0',
  },
  framing: { type: 'line', eol: 'lf', includeEol: false, maxFrameLength: 4096 },
  decode: function (frame) {
    const text = sdk.text(frame)
    const trimmed = text.trim()
    const items = trimmed.length === 0 ? [] : trimmed.split(SEPARATOR_PATTERN)
    const variables = {}
    const fields = []
    const summaryParts = []
    let matched = 0
    let variableCount = 0
    for (let index = 0; index < items.length; index += 1) {
      const item = items[index].trim()
      if (item.length === 0) continue
      const parsed = parseItem(item)
      if (parsed === null) continue
      matched += 1
      const numeric = Number(parsed.value)
      if (Number.isFinite(numeric)) {
        if (variableCount < MAX_VARIABLES) {
          variables[parsed.key] = numeric
          variableCount += 1
        }
        summaryParts.push(parsed.key + '=' + formatNumber(numeric))
      } else {
        fields.push({ label: parsed.key, key: parsed.key, value: parsed.value })
        summaryParts.push(parsed.key + '=' + parsed.value)
      }
    }
    if (matched === 0) {
      // 一项都不匹配时，把整行作为文本消息。
      return { summary: text }
    }
    const limit = Math.min(summaryParts.length, MAX_SUMMARY_ITEMS)
    const shown = summaryParts.slice(0, limit)
    const extra = summaryParts.length - shown.length
    const summary = shown.join(' ') + (extra > 0 ? ' …(+' + extra + ')' : '')
    const result = { type: 'kv', summary: summary }
    if (variableCount > 0) result.variables = variables
    if (fields.length > 0) result.fields = fields
    return result
  },
}

return definition
`

/** 只读的内置协议记录。 */
export const KV_TEXT_PROTOCOL: ProtocolRecord = {
  id: KV_TEXT_PROTOCOL_ID,
  name: KV_TEXT_PROTOCOL_NAME,
  code: KV_TEXT_CODE,
  createdAt: 0,
  updatedAt: 0,
}
