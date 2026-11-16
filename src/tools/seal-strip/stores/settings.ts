/**
 * 商品封箱条工具设置（持久化到 `toolset/tool/seal-strip/settings.v1`）。
 */

import { reactive, readonly } from 'vue'

import type { SettingField } from '@/shared/contracts/settings'
import { createToolStorage } from '@/shared/lib/storage/namespace'

import {
  DEFAULT_SEAL_STYLE,
  isSealStyleId,
  SEAL_STYLE_PRESETS,
  type SealStyleId,
} from '../core/seal-themes'

export type SeedMode = 'random' | 'fixed'

export interface SealStripSettings {
  brand: string
  cnTitle: string
  baseName: string
  cardStyle: SealStyleId
  defaultSeedMode: SeedMode
  defaultSeed: number
}

export const DEFAULT_SEAL_STRIP_SETTINGS: Readonly<SealStripSettings> = Object.freeze({
  brand: 'RinStel',
  cnTitle: '封箱证明',
  baseName: 'RinStel_封箱证明',
  cardStyle: DEFAULT_SEAL_STYLE,
  defaultSeedMode: 'random',
  defaultSeed: 20261115,
})

function normalizeText(value: unknown, fallback: string, maxLen: number): string {
  if (typeof value !== 'string') return fallback
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed.slice(0, maxLen) : fallback
}

function normalizeSeed(value: unknown): number {
  const parsed = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(parsed)) return DEFAULT_SEAL_STRIP_SETTINGS.defaultSeed
  return Math.max(0, Math.min(999_999_999, Math.trunc(parsed)))
}

export function normalizeSealStripSettings(raw: unknown): SealStripSettings {
  const source = (typeof raw === 'object' && raw !== null ? raw : {}) as Record<string, unknown>
  const defaults = DEFAULT_SEAL_STRIP_SETTINGS
  return {
    brand: normalizeText(source.brand, defaults.brand, 24),
    cnTitle: normalizeText(source.cnTitle, defaults.cnTitle, 16),
    baseName: normalizeText(source.baseName, defaults.baseName, 48),
    cardStyle: isSealStyleId(source.cardStyle) ? source.cardStyle : defaults.cardStyle,
    defaultSeedMode: source.defaultSeedMode === 'fixed' ? 'fixed' : 'random',
    defaultSeed: normalizeSeed(source.defaultSeed),
  }
}

const store = createToolStorage('seal-strip').local<SealStripSettings>('settings', {
  version: 1,
  defaults: () => ({ ...DEFAULT_SEAL_STRIP_SETTINGS }),
  migrate: (raw) => normalizeSealStripSettings(raw),
})

const state = reactive<SealStripSettings>(normalizeSealStripSettings(store.get()))

store.subscribe((value) => {
  Object.assign(state, normalizeSealStripSettings(value))
})

export const sealStripSettings = readonly(state)

export function updateSealStripSettings(patch: Partial<SealStripSettings>): void {
  const next = normalizeSealStripSettings({ ...state, ...patch })
  if (typeof patch.defaultSeed === 'number' && Number.isFinite(patch.defaultSeed)) {
    next.defaultSeed = Math.max(0, Math.trunc(patch.defaultSeed))
  }
  Object.assign(state, next)
  store.set(next)
}

export function resetSealStripSettings(): void {
  const next = normalizeSealStripSettings(DEFAULT_SEAL_STRIP_SETTINGS)
  Object.assign(state, next)
  store.reset()
}

export const SETTINGS_FIELDS: SettingField[] = [
  {
    key: 'brand',
    label: '默认品牌标识',
    type: 'text',
    maxLength: 24,
    default: DEFAULT_SEAL_STRIP_SETTINGS.brand,
  },
  {
    key: 'cnTitle',
    label: '默认封签标题',
    type: 'text',
    maxLength: 16,
    default: DEFAULT_SEAL_STRIP_SETTINGS.cnTitle,
  },
  {
    key: 'baseName',
    label: '默认导出文件前缀',
    type: 'text',
    maxLength: 48,
    default: DEFAULT_SEAL_STRIP_SETTINGS.baseName,
  },
  {
    key: 'cardStyle',
    label: '默认卡面油墨风格',
    type: 'select',
    options: SEAL_STYLE_PRESETS.map((preset) => ({ label: preset.label, value: preset.id })),
    default: DEFAULT_SEAL_STRIP_SETTINGS.cardStyle,
  },
  {
    key: 'defaultSeedMode',
    label: '默认序列生成模式',
    type: 'select',
    options: [
      { label: '随机真随机生成', value: 'random' },
      { label: '固定种子复现', value: 'fixed' },
    ],
    default: DEFAULT_SEAL_STRIP_SETTINGS.defaultSeedMode,
    advanced: true,
  },
  {
    key: 'defaultSeed',
    label: '默认固定种子',
    type: 'number',
    min: 0,
    max: 999999999,
    step: 1,
    default: DEFAULT_SEAL_STRIP_SETTINGS.defaultSeed,
    advanced: true,
  },
]
