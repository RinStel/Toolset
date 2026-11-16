/**
 * PCB 走线计算工具设置、个人接口预设与个人层叠预设存储：
 * - `toolset/tool/pcb-calc/settings.v1`
 * - `toolset/tool/pcb-calc/presets.v1`
 * - `toolset/tool/pcb-calc/stackups.v1`
 */

import { reactive, readonly } from 'vue'

import type { SettingField } from '@/shared/contracts/settings'
import { uuid } from '@/shared/lib/id'
import { createToolStorage } from '@/shared/lib/storage/namespace'

import {
  STACKUP_PRESETS,
  type LengthUnit,
  type TransmissionLineMode,
  type UserStackupPreset,
  type UserTracePreset,
} from '../core/presets'

export interface PcbCalcSettings {
  defaultUnit: LengthUnit
  defaultStackupId: string
  tolerancePct: number
  ambientTempC: number
  defaultTempRiseC: number
}

export const DEFAULT_PCB_CALC_SETTINGS: Readonly<PcbCalcSettings> = Object.freeze({
  defaultUnit: 'mil',
  defaultStackupId: 'jlc-4l-16-3313',
  tolerancePct: 10,
  ambientTempC: 25,
  defaultTempRiseC: 20,
})

const VALID_MODES = new Set<TransmissionLineMode>([
  'microstrip',
  'diff-microstrip',
  'cpwg',
  'diff-cpwg',
  'stripline',
  'diff-stripline',
])

function clampNumber(value: unknown, fallback: number, min: number, max: number): number {
  const num = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(num)) return fallback
  return Math.max(min, Math.min(max, num))
}

export function normalizePcbCalcSettings(raw: unknown): PcbCalcSettings {
  const source = (typeof raw === 'object' && raw !== null ? raw : {}) as Record<string, unknown>
  const defaults = DEFAULT_PCB_CALC_SETTINGS
  const stackupId =
    typeof source.defaultStackupId === 'string' &&
    STACKUP_PRESETS.some((item) => item.id === source.defaultStackupId)
      ? source.defaultStackupId
      : defaults.defaultStackupId
  return {
    defaultUnit: source.defaultUnit === 'mm' ? 'mm' : 'mil',
    defaultStackupId: stackupId,
    tolerancePct: clampNumber(source.tolerancePct, defaults.tolerancePct, 1, 30),
    ambientTempC: clampNumber(source.ambientTempC, defaults.ambientTempC, -40, 85),
    defaultTempRiseC: clampNumber(source.defaultTempRiseC, defaults.defaultTempRiseC, 5, 80),
  }
}

function normalizePreset(raw: unknown): UserTracePreset | null {
  if (typeof raw !== 'object' || raw === null) return null
  const item = raw as Record<string, unknown>
  if (typeof item.name !== 'string' || item.name.trim().length === 0) return null
  const mode = VALID_MODES.has(item.mode as TransmissionLineMode)
    ? (item.mode as TransmissionLineMode)
    : 'diff-microstrip'
  const stackupId =
    typeof item.stackupId === 'string' && item.stackupId.trim().length > 0
      ? item.stackupId
      : DEFAULT_PCB_CALC_SETTINGS.defaultStackupId
  return {
    id: typeof item.id === 'string' && item.id.trim() ? item.id : uuid(),
    name: item.name.trim().slice(0, 28),
    mode,
    stackupId,
    targetZ: clampNumber(item.targetZ, 90, 10, 300),
    wMil: clampNumber(item.wMil, 5, 1, 500),
    sMil: clampNumber(item.sMil, 6, 1, 500),
    sGndMil: clampNumber(item.sGndMil, 8, 1, 500),
    hMil: clampNumber(item.hMil, 3.94, 0.5, 200),
    h2Mil: clampNumber(item.h2Mil, 20, 0.5, 200),
    tMil: clampNumber(item.tMil, 1.378, 0.2, 20),
    er: clampNumber(item.er, 4.05, 1, 20),
    createdAt:
      typeof item.createdAt === 'number' && Number.isFinite(item.createdAt)
        ? item.createdAt
        : Date.now(),
  }
}

export function normalizePresetList(raw: unknown): UserTracePreset[] {
  if (!Array.isArray(raw)) return []
  const result: UserTracePreset[] = []
  for (const candidate of raw) {
    const normalized = normalizePreset(candidate)
    if (normalized) result.push(normalized)
    if (result.length >= 24) break
  }
  return result
}

function normalizeStackupLayers(layers: unknown): 2 | 4 | 6 | 8 {
  if (layers === 2 || layers === 4 || layers === 6 || layers === 8) return layers
  return 4
}

function normalizeStackupPreset(raw: unknown): UserStackupPreset | null {
  if (typeof raw !== 'object' || raw === null) return null
  const item = raw as Record<string, unknown>
  if (typeof item.name !== 'string' || item.name.trim().length === 0) return null
  return {
    id: typeof item.id === 'string' && item.id.trim() ? item.id : uuid(),
    name: item.name.trim().slice(0, 28),
    layers: normalizeStackupLayers(item.layers),
    outerHMil: clampNumber(item.outerHMil, 3.94, 0.5, 200),
    outerEr: clampNumber(item.outerEr, 4.05, 1, 20),
    innerH1Mil: clampNumber(item.innerH1Mil, 3.94, 0.5, 200),
    innerH2Mil: clampNumber(item.innerH2Mil, 20, 0.5, 200),
    innerEr: clampNumber(item.innerEr, 4.1, 1, 20),
    outerCopperOz: clampNumber(item.outerCopperOz, 1, 0.25, 10),
    innerCopperOz: clampNumber(item.innerCopperOz, 0.5, 0.25, 10),
    minTrackMil: clampNumber(item.minTrackMil, 3.5, 1, 50),
    createdAt:
      typeof item.createdAt === 'number' && Number.isFinite(item.createdAt)
        ? item.createdAt
        : Date.now(),
  }
}

export function normalizeStackupList(raw: unknown): UserStackupPreset[] {
  if (!Array.isArray(raw)) return []
  const result: UserStackupPreset[] = []
  for (const candidate of raw) {
    const normalized = normalizeStackupPreset(candidate)
    if (normalized) result.push(normalized)
    if (result.length >= 24) break
  }
  return result
}

const toolStorage = createToolStorage('pcb-calc')

const settingsStore = toolStorage.local<PcbCalcSettings>('settings', {
  version: 1,
  defaults: () => ({ ...DEFAULT_PCB_CALC_SETTINGS }),
  migrate: (raw) => normalizePcbCalcSettings(raw),
})

const presetsStore = toolStorage.local<UserTracePreset[]>('presets', {
  version: 1,
  defaults: () => [],
  migrate: (raw) => normalizePresetList(raw),
})

const stackupsStore = toolStorage.local<UserStackupPreset[]>('stackups', {
  version: 1,
  defaults: () => [],
  migrate: (raw) => normalizeStackupList(raw),
})

const settingsState = reactive<PcbCalcSettings>(normalizePcbCalcSettings(settingsStore.get()))
const presetsState = reactive<{ list: UserTracePreset[] }>({
  list: normalizePresetList(presetsStore.get()),
})
const stackupsState = reactive<{ list: UserStackupPreset[] }>({
  list: normalizeStackupList(stackupsStore.get()),
})

settingsStore.subscribe((value) => {
  Object.assign(settingsState, normalizePcbCalcSettings(value))
})

presetsStore.subscribe((value) => {
  presetsState.list = normalizePresetList(value)
})

stackupsStore.subscribe((value) => {
  stackupsState.list = normalizeStackupList(value)
})

export const pcbCalcSettings = readonly(settingsState)
export const userTracePresets = readonly(presetsState)
export const userStackupPresets = readonly(stackupsState)

export function updatePcbCalcSettings(patch: Partial<PcbCalcSettings>): void {
  const next = normalizePcbCalcSettings({ ...settingsState, ...patch })
  Object.assign(settingsState, next)
  settingsStore.set(next)
}

export function resetPcbCalcSettings(): void {
  const next = normalizePcbCalcSettings(DEFAULT_PCB_CALC_SETTINGS)
  Object.assign(settingsState, next)
  settingsStore.reset()
}

export function saveUserTracePreset(
  preset: Omit<UserTracePreset, 'id' | 'createdAt'>,
): UserTracePreset {
  const created: UserTracePreset = {
    ...preset,
    id: uuid(),
    name: preset.name.trim().slice(0, 28) || '自定义预设',
    createdAt: Date.now(),
  }
  const next = [created, ...presetsState.list].slice(0, 24)
  presetsState.list = next
  presetsStore.set(next)
  return created
}

export function removeUserTracePreset(id: string): void {
  const next = presetsState.list.filter((item) => item.id !== id)
  presetsState.list = next
  presetsStore.set(next)
}

export function saveUserStackupPreset(
  preset: Omit<UserStackupPreset, 'id' | 'createdAt'>,
): UserStackupPreset {
  const created: UserStackupPreset = {
    ...preset,
    id: uuid(),
    name: preset.name.trim().slice(0, 28) || '自定义层叠',
    createdAt: Date.now(),
  }
  const next = [created, ...stackupsState.list].slice(0, 24)
  stackupsState.list = next
  stackupsStore.set(next)
  return created
}

export function removeUserStackupPreset(id: string): void {
  const next = stackupsState.list.filter((item) => item.id !== id)
  stackupsState.list = next
  stackupsStore.set(next)
}

export const SETTINGS_FIELDS: SettingField[] = [
  {
    key: 'defaultUnit',
    label: '默认长度单位',
    type: 'select',
    options: [
      { label: 'mil（密耳）', value: 'mil' },
      { label: 'mm（毫米）', value: 'mm' },
    ],
    default: DEFAULT_PCB_CALC_SETTINGS.defaultUnit,
  },
  {
    key: 'defaultStackupId',
    label: '默认嘉立创层叠',
    type: 'select',
    options: STACKUP_PRESETS.map((item) => ({ label: item.label, value: item.id })),
    default: DEFAULT_PCB_CALC_SETTINGS.defaultStackupId,
  },
  {
    key: 'tolerancePct',
    label: '阻抗合格容差 (±%)',
    type: 'number',
    min: 1,
    max: 30,
    step: 1,
    default: DEFAULT_PCB_CALC_SETTINGS.tolerancePct,
  },
  {
    key: 'defaultTempRiseC',
    label: '载流默认允许温升 (°C)',
    type: 'number',
    min: 5,
    max: 80,
    step: 5,
    default: DEFAULT_PCB_CALC_SETTINGS.defaultTempRiseC,
    advanced: true,
  },
  {
    key: 'ambientTempC',
    label: '默认环境温度 (°C)',
    type: 'number',
    min: -40,
    max: 85,
    step: 5,
    default: DEFAULT_PCB_CALC_SETTINGS.ambientTempC,
    advanced: true,
  },
]
