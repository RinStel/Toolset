/** 模板 `variables`：演示在 `decode` 中返回 `variables` 与 `variableMeta`（plan §6.5 / §8.6）。 */

import type { ProtocolTemplate } from '../types'

export const VARIABLES_TEMPLATE: ProtocolTemplate = {
  id: 'variables',
  name: '输出仪表盘变量',
  description: '解析 temp=23.5,hum=48.2 这样的行，并返回 variables 与 variableMeta。',
  code: `// Variables demo: return \`variables\` so the dashboard can plot them directly.
// \`variableMeta\` is optional and only provides the display unit / name.
const KEY_PATTERN = /^[A-Za-z_][A-Za-z0-9_.]{0,63}$/
const UNITS = { temp: '°C', hum: '%RH', volt: 'mV' }
const LABELS = { temp: '温度', hum: '湿度', volt: '电压' }

function formatNumber(value) {
  if (Number.isInteger(value)) return String(value)
  return String(Number(value.toFixed(6)))
}

return {
  apiVersion: 1,
  meta: {
    name: '输出仪表盘变量',
    description: '解析 key=value 形式的行（例如 temp=23.5,hum=48.2），返回 variables 与 variableMeta。',
    version: '1.0.0',
  },
  framing: { type: 'line' },
  decode: function (frame) {
    const text = sdk.text(frame).trim()
    if (text.length === 0) return null
    const variables = {}
    const variableMeta = {}
    const summaryParts = []
    const parts = text.split(',')
    for (let index = 0; index < parts.length; index += 1) {
      const part = parts[index].trim()
      const separator = part.indexOf('=')
      if (separator <= 0) continue
      const key = part.slice(0, separator).trim()
      const valueText = part.slice(separator + 1).trim()
      if (!KEY_PATTERN.test(key)) continue
      const value = Number(valueText)
      if (!Number.isFinite(value)) continue
      variables[key] = value
      variableMeta[key] = { label: LABELS[key] || key }
      if (UNITS[key]) variableMeta[key].unit = UNITS[key]
      summaryParts.push(key + '=' + formatNumber(value))
    }
    if (summaryParts.length === 0) {
      return { summary: '无法解析：' + text, noVariables: true }
    }
    return {
      type: 'variables',
      summary: summaryParts.join(' '),
      variables: variables,
      variableMeta: variableMeta,
    }
  },
}
`,
}
