/**
 * 商品封箱条（RinStel 封箱证明）印刷规格、专用字体要求与卡面视觉主题封装。
 */

export const CARD_W = 56.0
export const CARD_H = 34.0
export const A4_W = 210.0
export const A4_H = 297.0
export const A4_COLS = 3
export const A4_ROWS = 7
export const A4_TOTAL = A4_COLS * A4_ROWS

/** 剔除易混淆字符 (0, O, 1, I) 的 32 进制字母表。 */
export const ALPHA = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ'

export interface RequiredFontSpec {
  name: string
  cssFamily: string
  role: string
  keyword: string
  source: string
  sampleText: string
}

/** 严格锁定的三款专用字体（无任何系统回退，与 Python 脚本一致）。 */
export const REQUIRED_FONTS: readonly RequiredFontSpec[] = Object.freeze([
  {
    name: 'Space Grotesk',
    cssFamily: 'Space Grotesk',
    role: '品牌标识（RinStel）',
    keyword: 'spacegrotesk',
    source: 'Google Fonts 搜索 "Space Grotesk" 或 GitHub 仓库 floriankarsten/space-grotesk',
    sampleText: 'RinStel',
  },
  {
    name: 'LXGW WenKai',
    cssFamily: 'LXGW WenKai',
    role: '中文封签标题（封箱证明）',
    keyword: 'lxgwwenkai',
    source: 'GitHub 开源项目 lxgw/LxgwWenKai（Release 下载 LXGW-WenKai-Regular.ttf / Bold.ttf）',
    sampleText: '封箱证明',
  },
  {
    name: 'IBM Plex Mono',
    cssFamily: 'IBM Plex Mono',
    role: '主核验码、校验码与摘要（SEAL ID / CHK / SIG）',
    keyword: 'ibmplexmono',
    source: 'Google Fonts 搜索 "IBM Plex Mono" 或 GitHub 仓库 IBM/plex',
    sampleText: 'M3YC-QDWE-84H',
  },
])

export type SealStyleId = 'laser-black' | 'security-navy' | 'seal-crimson'
export type CardStyleId = SealStyleId

export interface SealStylePreset {
  id: SealStyleId
  label: string
  description: string
  ink: string
  paper: string
  headerBg: string
  headerText: string
}

export type CardStylePreset = SealStylePreset

export const DEFAULT_SEAL_STYLE: SealStyleId = 'laser-black'
export const DEFAULT_CARD_STYLE = DEFAULT_SEAL_STYLE

export const SEAL_STYLE_PRESETS: readonly SealStylePreset[] = Object.freeze([
  {
    id: 'laser-black',
    label: '纯黑激光实色',
    description: '普通黑白激光打印机专用纯黑实色（#000000），避免半调网点',
    ink: '#000000',
    paper: '#ffffff',
    headerBg: '#000000',
    headerText: 'white',
  },
  {
    id: 'security-navy',
    label: '防伪深海蓝',
    description: '高对比深蓝油墨风格（#0f2942），适合彩色激光/喷墨防伪印刷',
    ink: '#0f2942',
    paper: '#ffffff',
    headerBg: '#0f2942',
    headerText: '#ffffff',
  },
  {
    id: 'seal-crimson',
    label: '封签印泥红',
    description: '封条警示红风格（#7f1d1d），强化拆封警示与留证辨识度',
    ink: '#7f1d1d',
    paper: '#ffffff',
    headerBg: '#7f1d1d',
    headerText: '#ffffff',
  },
])

export const CARD_STYLE_PRESETS = SEAL_STYLE_PRESETS

export function isSealStyleId(value: unknown): value is SealStyleId {
  return SEAL_STYLE_PRESETS.some((preset) => preset.id === value)
}

export const isCardStyleId = isSealStyleId

export function getSealStylePreset(id: SealStyleId | undefined): SealStylePreset {
  return SEAL_STYLE_PRESETS.find((preset) => preset.id === id) ?? SEAL_STYLE_PRESETS[0]!
}

export const getCardStylePreset = getSealStylePreset
