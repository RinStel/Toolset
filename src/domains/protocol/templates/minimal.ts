/** 模板 `minimal`：line 分帧 + 文本摘要（plan §8.6）。 */

import type { ProtocolTemplate } from '../types'

export const MINIMAL_TEMPLATE: ProtocolTemplate = {
  id: 'minimal',
  name: '最小示例',
  description: '按行分帧，把收到的内容作为文本显示。',
  code: `// Minimal protocol: split on LF and show the frame as text.
return {
  apiVersion: 1,
  meta: {
    name: '最小示例',
    description: '按行分帧，decode 返回文本摘要。',
    version: '1.0.0',
  },
  framing: { type: 'line' },
  decode: function (frame) {
    return { summary: '收到文本：' + sdk.text(frame) }
  },
}
`,
}
