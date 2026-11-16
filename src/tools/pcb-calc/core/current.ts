/**
 * PCB 走线载流、温升、直流电阻与压降计算内核（基于 IPC-2221 / IPC-2152 基准公式）。
 */

import { MIL_TO_MM, ozToMil } from './presets'

export type CurrentSolveMode = 'current-to-width' | 'width-to-current'
export type TraceLayerKind = 'external' | 'internal'

export interface CurrentInput {
  solveMode: CurrentSolveMode
  targetCurrentA: number
  widthMil: number
  layer: TraceLayerKind
  copperOz: number
  tempRiseC: number
  ambientTempC: number
  lengthMm: number
  supplyVoltageV: number
}

export interface TempRiseReferenceRow {
  tempRiseC: number
  recommendedWidthMil: number
  maxCurrentA: number
}

export interface CurrentResult {
  recommendedWidthMil: number
  maxCurrentA: number
  activeCurrentA: number
  activeWidthMil: number
  thicknessMil: number
  crossSectionMil2: number
  crossSectionMm2: number
  operatingTempC: number
  resistanceMOhm: number
  voltageDropMv: number
  voltageDropPct: number
  powerLossMw: number
  tempRiseTable: TempRiseReferenceRow[]
}

export interface PowerRailPreset {
  id: string
  label: string
  voltageV: number
  currentA: number
}

export const POWER_RAIL_PRESETS: readonly PowerRailPreset[] = [
  { id: 'rail-3v3-05', label: '3.3V / 0.5A · MCU', voltageV: 3.3, currentA: 0.5 },
  { id: 'rail-5v-2a', label: '5V / 2A · USB VBUS', voltageV: 5, currentA: 2 },
  { id: 'rail-12v-3a', label: '12V / 3A · DC 母线', voltageV: 12, currentA: 3 },
  { id: 'rail-24v-5a', label: '24V / 5A · 工业电源', voltageV: 24, currentA: 5 },
  { id: 'rail-5v-5a', label: '5V / 5A · 大电流外设', voltageV: 5, currentA: 5 },
]

const COPPER_RESISTIVITY_20C = 1.724e-8
const COPPER_TEMP_COEFF = 0.00393

function layerConstantK(layer: TraceLayerKind): number {
  return layer === 'external' ? 0.048 : 0.024
}

export function solveWidthForCurrentMil(
  currentA: number,
  layer: TraceLayerKind,
  copperOz: number,
  tempRiseC: number,
): number {
  const safeI = Math.max(0.01, currentA)
  const safeDt = Math.max(1, tempRiseC)
  const safeOz = Math.max(0.25, copperOz)
  const k = layerConstantK(layer)
  const areaMil2 = (safeI / (k * safeDt ** 0.44)) ** (1 / 0.725)
  return areaMil2 / ozToMil(safeOz)
}

export function solveCurrentForWidthA(
  widthMil: number,
  layer: TraceLayerKind,
  copperOz: number,
  tempRiseC: number,
): number {
  const safeW = Math.max(0.5, widthMil)
  const safeDt = Math.max(1, tempRiseC)
  const safeOz = Math.max(0.25, copperOz)
  const k = layerConstantK(layer)
  const areaMil2 = safeW * ozToMil(safeOz)
  return k * safeDt ** 0.44 * areaMil2 ** 0.725
}

export function calculateTraceCurrent(input: CurrentInput): CurrentResult {
  const safeOz = Math.max(0.25, Number.isFinite(input.copperOz) ? input.copperOz : 1)
  const safeDt = Math.max(1, Number.isFinite(input.tempRiseC) ? input.tempRiseC : 20)
  const safeAmbient = Number.isFinite(input.ambientTempC) ? input.ambientTempC : 25
  const safeLengthMm = Math.max(0.1, Number.isFinite(input.lengthMm) ? input.lengthMm : 50)
  const safeVoltageV = Math.max(
    0.1,
    Number.isFinite(input.supplyVoltageV) ? input.supplyVoltageV : 5,
  )

  const thicknessMil = ozToMil(safeOz)
  const targetCurrentA = Math.max(
    0.01,
    Number.isFinite(input.targetCurrentA) ? input.targetCurrentA : 1,
  )
  const widthMil = Math.max(1, Number.isFinite(input.widthMil) ? input.widthMil : 10)

  const recommendedWidthMil = solveWidthForCurrentMil(targetCurrentA, input.layer, safeOz, safeDt)
  const maxCurrentA = solveCurrentForWidthA(widthMil, input.layer, safeOz, safeDt)

  const activeCurrentA = input.solveMode === 'current-to-width' ? targetCurrentA : maxCurrentA
  const activeWidthMil = input.solveMode === 'current-to-width' ? recommendedWidthMil : widthMil

  const crossSectionMil2 = activeWidthMil * thicknessMil
  const crossSectionMm2 = crossSectionMil2 * MIL_TO_MM * MIL_TO_MM
  const operatingTempC = safeAmbient + safeDt

  const resistivity = COPPER_RESISTIVITY_20C * (1 + COPPER_TEMP_COEFF * (operatingTempC - 20))
  const resistanceOhm = (resistivity * (safeLengthMm * 1e-3)) / (crossSectionMm2 * 1e-6)
  const resistanceMOhm = resistanceOhm * 1000
  const voltageDropMv = activeCurrentA * resistanceMOhm
  const voltageDropPct = (voltageDropMv / 1000 / safeVoltageV) * 100
  const powerLossMw = activeCurrentA * activeCurrentA * resistanceMOhm

  const tempRiseTable: TempRiseReferenceRow[] = [10, 20, 30].map((dt) => ({
    tempRiseC: dt,
    recommendedWidthMil: solveWidthForCurrentMil(targetCurrentA, input.layer, safeOz, dt),
    maxCurrentA: solveCurrentForWidthA(widthMil, input.layer, safeOz, dt),
  }))

  return {
    recommendedWidthMil,
    maxCurrentA,
    activeCurrentA,
    activeWidthMil,
    thicknessMil,
    crossSectionMil2,
    crossSectionMm2,
    operatingTempC,
    resistanceMOhm,
    voltageDropMv,
    voltageDropPct,
    powerLossMw,
    tempRiseTable,
  }
}
