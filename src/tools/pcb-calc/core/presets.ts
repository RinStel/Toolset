/**
 * PCB 走线计算：单位换算、嘉立创主力层叠预设与常用高速接口协议预设。
 */

export type LengthUnit = 'mil' | 'mm'

export type TransmissionLineMode =
  'microstrip' | 'diff-microstrip' | 'cpwg' | 'diff-cpwg' | 'stripline' | 'diff-stripline'

export const MIL_TO_MM = 0.0254
export const OZ_TO_MIL = 1.378

export function milToMm(mil: number): number {
  return mil * MIL_TO_MM
}

export function mmToMil(mm: number): number {
  return mm / MIL_TO_MM
}

export function ozToMil(oz: number): number {
  return oz * OZ_TO_MIL
}

export function roundTo(value: number, precision: number): number {
  if (!Number.isFinite(value)) return 0
  const factor = 10 ** precision
  return Math.round(value * factor) / factor
}

export function toUnitValue(valMil: number, unit: LengthUnit, precision?: number): number {
  const raw = unit === 'mm' ? milToMm(valMil) : valMil
  const digits = precision ?? (unit === 'mm' ? 3 : 2)
  return roundTo(raw, digits)
}

export function fromUnitValue(value: number, unit: LengthUnit): number {
  return unit === 'mm' ? mmToMil(value) : value
}

export function formatLength(valMil: number, unit: LengthUnit): string {
  if (!Number.isFinite(valMil)) return '—'
  if (unit === 'mm') return `${milToMm(valMil).toFixed(3)} mm`
  return `${valMil.toFixed(2)} mil`
}

export function formatDualLength(valMil: number, primaryUnit: LengthUnit): string {
  if (!Number.isFinite(valMil)) return '—'
  const milText = `${valMil.toFixed(2)} mil`
  const mmText = `${milToMm(valMil).toFixed(3)} mm`
  return primaryUnit === 'mm' ? `${mmText} (${milText})` : `${milText} (${mmText})`
}

export interface TransmissionModeOption {
  value: TransmissionLineMode
  label: string
  shortLabel: string
  isDifferential: boolean
  isInnerLayer: boolean
  usesCoplanarGnd: boolean
}

export const TRANSMISSION_MODE_OPTIONS: readonly TransmissionModeOption[] = [
  {
    value: 'microstrip',
    label: '外层单端微带线',
    shortLabel: '单端微带',
    isDifferential: false,
    isInnerLayer: false,
    usesCoplanarGnd: false,
  },
  {
    value: 'diff-microstrip',
    label: '外层差分微带线',
    shortLabel: '差分微带',
    isDifferential: true,
    isInnerLayer: false,
    usesCoplanarGnd: false,
  },
  {
    value: 'cpwg',
    label: '外层单端共面波导 (包地)',
    shortLabel: '单端包地',
    isDifferential: false,
    isInnerLayer: false,
    usesCoplanarGnd: true,
  },
  {
    value: 'diff-cpwg',
    label: '外层差分共面波导 (包地)',
    shortLabel: '差分包地',
    isDifferential: true,
    isInnerLayer: false,
    usesCoplanarGnd: true,
  },
  {
    value: 'stripline',
    label: '内层单端带状线',
    shortLabel: '单端带状',
    isDifferential: false,
    isInnerLayer: true,
    usesCoplanarGnd: false,
  },
  {
    value: 'diff-stripline',
    label: '内层差分带状线',
    shortLabel: '差分带状',
    isDifferential: true,
    isInnerLayer: true,
    usesCoplanarGnd: false,
  },
]

export function getTransmissionModeMeta(mode: TransmissionLineMode): TransmissionModeOption {
  return (
    TRANSMISSION_MODE_OPTIONS.find((item) => item.value === mode) ?? TRANSMISSION_MODE_OPTIONS[0]!
  )
}

export interface DielectricSpan {
  thicknessMil: number
  er: number
}

export interface StackupPreset {
  id: string
  label: string
  shortTag: string
  layers: 2 | 4 | 6
  boardThicknessMm: number
  outerHMil: number
  outerEr: number
  innerH1Mil: number
  innerH2Mil: number
  innerEr: number
  outerCopperOz: number
  innerCopperOz: number
  minTrackMil: number
  copperOzByLayer: readonly number[]
  dielectrics: readonly DielectricSpan[]
}

export const STACKUP_PRESETS: readonly StackupPreset[] = [
  {
    id: 'jlc-4l-16-3313',
    label: 'JLC 4层 1.6mm · 3313',
    shortTag: '推荐高速 · 细线宽',
    layers: 4,
    boardThicknessMm: 1.6,
    outerHMil: 3.91,
    outerEr: 4.1,
    innerH1Mil: 3.91,
    innerH2Mil: 44.0,
    innerEr: 4.2,
    outerCopperOz: 1,
    innerCopperOz: 0.5,
    minTrackMil: 3.5,
    copperOzByLayer: [1, 0.5, 0.5, 1],
    dielectrics: [
      { thicknessMil: 3.91, er: 4.1 },
      { thicknessMil: 44.0, er: 4.2 },
      { thicknessMil: 3.91, er: 4.1 },
    ],
  },
  {
    id: 'jlc-4l-16-7628',
    label: 'JLC 4层 1.6mm · 7628',
    shortTag: '常规打样 · 宽走线',
    layers: 4,
    boardThicknessMm: 1.6,
    outerHMil: 8.28,
    outerEr: 4.4,
    innerH1Mil: 8.28,
    innerH2Mil: 35.0,
    innerEr: 4.4,
    outerCopperOz: 1,
    innerCopperOz: 0.5,
    minTrackMil: 3.5,
    copperOzByLayer: [1, 0.5, 0.5, 1],
    dielectrics: [
      { thicknessMil: 8.28, er: 4.4 },
      { thicknessMil: 35.0, er: 4.4 },
      { thicknessMil: 8.28, er: 4.4 },
    ],
  },
  {
    id: 'jlc-4l-12-3313',
    label: 'JLC 4层 1.2mm · 3313',
    shortTag: '薄板高速',
    layers: 4,
    boardThicknessMm: 1.2,
    outerHMil: 3.91,
    outerEr: 4.1,
    innerH1Mil: 3.91,
    innerH2Mil: 28.0,
    innerEr: 4.2,
    outerCopperOz: 1,
    innerCopperOz: 0.5,
    minTrackMil: 3.5,
    copperOzByLayer: [1, 0.5, 0.5, 1],
    dielectrics: [
      { thicknessMil: 3.91, er: 4.1 },
      { thicknessMil: 28.0, er: 4.2 },
      { thicknessMil: 3.91, er: 4.1 },
    ],
  },
  {
    id: 'jlc-6l-16-3313',
    label: 'JLC 6层 1.6mm · 3313',
    shortTag: '高速多层 · 含内层带状线',
    layers: 6,
    boardThicknessMm: 1.6,
    outerHMil: 3.91,
    outerEr: 4.1,
    innerH1Mil: 3.91,
    innerH2Mil: 21.65,
    innerEr: 4.1,
    outerCopperOz: 1,
    innerCopperOz: 0.5,
    minTrackMil: 3.5,
    copperOzByLayer: [1, 0.5, 0.5, 0.5, 0.5, 1],
    dielectrics: [
      { thicknessMil: 3.91, er: 4.1 },
      { thicknessMil: 21.65, er: 4.1 },
      { thicknessMil: 7.87, er: 4.1 },
      { thicknessMil: 21.65, er: 4.1 },
      { thicknessMil: 3.91, er: 4.1 },
    ],
  },
  {
    id: 'jlc-6l-16-2116',
    label: 'JLC 6层 1.6mm · 2116',
    shortTag: '常规6层',
    layers: 6,
    boardThicknessMm: 1.6,
    outerHMil: 4.72,
    outerEr: 4.2,
    innerH1Mil: 4.72,
    innerH2Mil: 19.69,
    innerEr: 4.2,
    outerCopperOz: 1,
    innerCopperOz: 0.5,
    minTrackMil: 3.5,
    copperOzByLayer: [1, 0.5, 0.5, 0.5, 0.5, 1],
    dielectrics: [
      { thicknessMil: 4.72, er: 4.2 },
      { thicknessMil: 19.69, er: 4.2 },
      { thicknessMil: 7.87, er: 4.2 },
      { thicknessMil: 19.69, er: 4.2 },
      { thicknessMil: 4.72, er: 4.2 },
    ],
  },
  {
    id: 'jlc-2l-16',
    label: 'JLC 双面板 1.6mm · FR-4',
    shortTag: '建议切换共面波导包地',
    layers: 2,
    boardThicknessMm: 1.6,
    outerHMil: 59.84,
    outerEr: 4.5,
    innerH1Mil: 59.84,
    innerH2Mil: 59.84,
    innerEr: 4.5,
    outerCopperOz: 1,
    innerCopperOz: 1,
    minTrackMil: 5.0,
    copperOzByLayer: [1, 1],
    dielectrics: [{ thicknessMil: 59.84, er: 4.5 }],
  },
]

export function getStackupPreset(id: string): StackupPreset {
  return STACKUP_PRESETS.find((item) => item.id === id) ?? STACKUP_PRESETS[0]!
}

export function formatCopperLayerName(index: number, totalLayers: number): string {
  if (index === 0) return 'L1 (Top)'
  if (index === totalLayers - 1) return `L${totalLayers} (Bot)`
  return `L${index + 1} (In${index})`
}

export function buildStackupSpansFromUser(preset: UserStackupPreset): {
  layers: number
  copperOzByLayer: number[]
  dielectrics: DielectricSpan[]
} {
  const n = preset.layers
  const copperOzByLayer = Array.from({ length: n }, (_, i) =>
    i === 0 || i === n - 1 ? preset.outerCopperOz : preset.innerCopperOz,
  )
  const dielectrics: DielectricSpan[] = Array.from({ length: n - 1 }, (_, i) => {
    if (i === 0 || i === n - 2) {
      return { thicknessMil: preset.outerHMil, er: preset.outerEr }
    }
    return { thicknessMil: preset.innerH2Mil, er: preset.innerEr }
  })
  return { layers: n, copperOzByLayer, dielectrics }
}

function sumDielectricSpan(
  dielectrics: readonly DielectricSpan[],
  copperOzByLayer: readonly number[],
  fromIdx: number,
  toIdx: number,
): { thicknessMil: number; er: number } {
  const start = Math.min(fromIdx, toIdx)
  const end = Math.max(fromIdx, toIdx)
  let totalThickness = 0
  let invCapSum = 0
  for (let i = start; i < end; i += 1) {
    const span = dielectrics[i] ?? { thicknessMil: 4, er: 4.1 }
    totalThickness += span.thicknessMil
    invCapSum += span.thicknessMil / Math.max(1.0, span.er)
    // 若跨越了中间未作参考层的铜层（如 L1 跨 L2 参考 L3），叠加中间铜厚
    if (i > start) {
      totalThickness += ozToMil(copperOzByLayer[i] ?? 0.5)
    }
  }
  const effEr = invCapSum > 0 ? totalThickness / invCapSum : 4.1
  return {
    thicknessMil: Number(totalThickness.toFixed(3)),
    er: Number(effEr.toFixed(2)),
  }
}

export interface ResolvedLayerGeometry {
  hMil: number
  h2Mil: number
  tMil: number
  er: number
  isInnerSandwich: boolean
}

export function resolveStackupRoutingGeometry(
  copperOzByLayer: readonly number[],
  dielectrics: readonly DielectricSpan[],
  signalLayerIdx: number,
  refAboveIdx: number | null,
  refBelowIdx: number | null,
): ResolvedLayerGeometry {
  const tMil = Number(ozToMil(copperOzByLayer[signalLayerIdx] ?? 1).toFixed(3))
  const hasAbove = refAboveIdx !== null && refAboveIdx < signalLayerIdx
  const hasBelow = refBelowIdx !== null && refBelowIdx > signalLayerIdx

  if (hasAbove && hasBelow) {
    const above = sumDielectricSpan(dielectrics, copperOzByLayer, refAboveIdx, signalLayerIdx)
    const below = sumDielectricSpan(dielectrics, copperOzByLayer, signalLayerIdx, refBelowIdx)
    const avgEr =
      (above.thicknessMil * above.er + below.thicknessMil * below.er) /
      Math.max(0.1, above.thicknessMil + below.thicknessMil)
    return {
      hMil: above.thicknessMil,
      h2Mil: below.thicknessMil,
      tMil,
      er: Number(avgEr.toFixed(2)),
      isInnerSandwich: true,
    }
  }

  if (hasBelow) {
    const below = sumDielectricSpan(dielectrics, copperOzByLayer, signalLayerIdx, refBelowIdx)
    return {
      hMil: below.thicknessMil,
      h2Mil: below.thicknessMil,
      tMil,
      er: below.er,
      isInnerSandwich: false,
    }
  }

  if (hasAbove) {
    const above = sumDielectricSpan(dielectrics, copperOzByLayer, refAboveIdx, signalLayerIdx)
    return {
      hMil: above.thicknessMil,
      h2Mil: above.thicknessMil,
      tMil,
      er: above.er,
      isInnerSandwich: false,
    }
  }

  return { hMil: 4, h2Mil: 20, tMil, er: 4.1, isInnerSandwich: false }
}

export interface HighSpeedPreset {
  id: string
  label: string
  badge: string
  mode: TransmissionLineMode
  targetZ: number
  maxIntraPairSkewMil: number | null
  crosstalkRule: '3W' | '5W'
  pairToPairFactor: number
  noteTag: string
}

export const HIGH_SPEED_PRESETS: readonly HighSpeedPreset[] = [
  {
    id: 'usb2-hs',
    label: 'USB 2.0 HS',
    badge: '90Ω 差分',
    mode: 'diff-microstrip',
    targetZ: 90,
    maxIntraPairSkewMil: 50,
    crosstalkRule: '5W',
    pairToPairFactor: 4,
    noteTag: 'D+/D- 差分 · 对内 ≤50mil',
  },
  {
    id: 'usb3-pcie',
    label: 'USB 3.x / PCIe',
    badge: '85Ω 差分',
    mode: 'diff-microstrip',
    targetZ: 85,
    maxIntraPairSkewMil: 5,
    crosstalkRule: '5W',
    pairToPairFactor: 4,
    noteTag: 'TX/RX 高速差分 · 对内 ≤5mil',
  },
  {
    id: 'sata-usb90',
    label: 'SATA / USB3',
    badge: '90Ω 差分',
    mode: 'diff-microstrip',
    targetZ: 90,
    maxIntraPairSkewMil: 5,
    crosstalkRule: '5W',
    pairToPairFactor: 4,
    noteTag: '高速串行差分 · 对内 ≤5mil',
  },
  {
    id: 'eth-mdi',
    label: '千兆网口 MDI',
    badge: '100Ω 差分',
    mode: 'diff-microstrip',
    targetZ: 100,
    maxIntraPairSkewMil: 20,
    crosstalkRule: '5W',
    pairToPairFactor: 4,
    noteTag: 'MDI± 四对差分 · 对内 ≤20mil',
  },
  {
    id: 'hdmi-lvds',
    label: 'HDMI / LVDS / MIPI',
    badge: '100Ω 差分',
    mode: 'diff-microstrip',
    targetZ: 100,
    maxIntraPairSkewMil: 5,
    crosstalkRule: '5W',
    pairToPairFactor: 4,
    noteTag: '高速显示差分 · 对内 ≤5mil',
  },
  {
    id: 'rf-50',
    label: 'RF / SPI / SDIO',
    badge: '50Ω 单端',
    mode: 'microstrip',
    targetZ: 50,
    maxIntraPairSkewMil: null,
    crosstalkRule: '3W',
    pairToPairFactor: 2,
    noteTag: '天线馈线 / 时钟 / 单端高速',
  },
  {
    id: 'rf-cpwg-50',
    label: 'RF 共面波导包地',
    badge: '50Ω 包地',
    mode: 'cpwg',
    targetZ: 50,
    maxIntraPairSkewMil: null,
    crosstalkRule: '3W',
    pairToPairFactor: 2,
    noteTag: '表层包地 + 过孔 · 双面板可用',
  },
  {
    id: 'ddr-dq',
    label: 'DDR 单端 DQ/ADDR',
    badge: '40Ω 单端',
    mode: 'microstrip',
    targetZ: 40,
    maxIntraPairSkewMil: 20,
    crosstalkRule: '3W',
    pairToPairFactor: 2,
    noteTag: 'DDR 数据/地址 · 组内 ≤20mil',
  },
  {
    id: 'can-rs485',
    label: 'CAN / RS-485',
    badge: '120Ω 差分',
    mode: 'diff-microstrip',
    targetZ: 120,
    maxIntraPairSkewMil: 100,
    crosstalkRule: '3W',
    pairToPairFactor: 2,
    noteTag: '工业差分总线',
  },
]

export interface UserTracePreset {
  id: string
  name: string
  mode: TransmissionLineMode
  stackupId: string
  targetZ: number
  wMil: number
  sMil: number
  sGndMil: number
  hMil: number
  h2Mil: number
  tMil: number
  er: number
  createdAt: number
}

export interface UserStackupPreset {
  id: string
  name: string
  layers: 2 | 4 | 6 | 8
  outerHMil: number
  outerEr: number
  innerH1Mil: number
  innerH2Mil: number
  innerEr: number
  outerCopperOz: number
  innerCopperOz: number
  minTrackMil: number
  createdAt: number
}
