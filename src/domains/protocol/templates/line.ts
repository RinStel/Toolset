/** 模板 `line`：解析 `KEY=VALUE,KEY=VALUE` 格式的行（plan §8.6）。 */

import type { ProtocolTemplate } from '../types'

export const LINE_TEMPLATE: ProtocolTemplate = {
  id: 'line',
  name: '键值对数据行',
  description: '解析 KEY=VALUE,KEY=VALUE 格式的文本行。',
  code: `// Key/value lines: each frame is "KEY=VALUE,KEY=VALUE".
function parsePairs(frame) {
  const fields = []
  const text = sdk.text(frame).trim()
  const parts = text.split(',')
  for (const part of parts) {
    const item = part.trim()
    if (item.length === 0) continue
    const index = item.indexOf('=')
    if (index <= 0) continue
    fields.push({ label: item.slice(0, index), value: item.slice(index + 1) })
  }
  return fields
}

return {
  apiVersion: 1,
  meta: {
    name: '键值对数据行',
    description: '解析 KEY=VALUE,KEY=VALUE 格式的文本行。',
    version: '1.0.0',
  },
  framing: { type: 'line' },
  decode: function (frame) {
    const fields = parsePairs(frame)
    return { type: 'kv', summary: '数据行：' + fields.length + ' 项', fields: fields }
  },
}
`,
}
