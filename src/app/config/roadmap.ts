/**
 * "后续规划" entries rendered as plain, non-clickable text at the bottom of the
 * home page (plan §7.2).
 */

export interface RoadmapItem {
  title: string
  /** One line description of the planned capability. */
  description: string
}

export const ROADMAP: readonly RoadmapItem[] = [
  { title: '数据格式转换', description: 'JSON、YAML、CSV、XML 等格式互转' },
  { title: '阻抗计算', description: '微带线、差分对与过孔参数估算' },
  { title: '网络 / BLE 通道', description: 'TCP、UDP、WebSocket 与 BLE 调试通道' },
]
