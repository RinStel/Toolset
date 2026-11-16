/**
 * Presets (plan §6.6): named bundles of connection settings, protocol, receive
 * framing, display mode and compose options, persisted under `toolset/link/presets.v1`.
 */

import { uuid } from '../../../shared/lib/id'
import { createDomainStorage } from '../../../shared/lib/storage/namespace'
import { normalizeLogPolicy, type LogPolicy } from '../log/policy'
import { normalizeComposeOptions, type ComposeOptions } from '../send/compose'
import { normalizeRxOptions, type RxOptions } from '../session/rx-framer'
import type { DisplayMode, SessionState } from '../session/state'

/** See plan §6.6. */
export interface Preset {
  id: string
  name: string
  providerKind: string
  settings: Record<string, unknown>
  protocolId: string | null
  rxOptions: RxOptions
  displayMode: DisplayMode
  compose: ComposeOptions
  quickGroupId: string | null
  logPolicy: LogPolicy
  /** Tool-owned extras (e.g. `dashboardId`); the link domain only stores them. */
  extras: Record<string, unknown>
}

/**
 * Input of `PresetStore.save`; `id` updates an existing preset. New fields are
 * optional so callers of older code keep working with the defaults.
 */
export type PresetInput = Omit<Preset, 'id' | 'logPolicy' | 'extras'> & {
  id?: string
  logPolicy?: LogPolicy
  extras?: Record<string, unknown>
}

/** Minimal session surface needed to apply a preset. */
export interface PresetApplyTarget {
  readonly providerKind: string
  readonly state: SessionState
  updateSettings(patch: Record<string, unknown>): void
  /** Writes connection settings without the "must be closed" guard. */
  stageSettings(patch: Record<string, unknown>): void
  setProtocol(id: string | null): Promise<void>
  rxOptions: RxOptions
  displayMode: DisplayMode
  compose: ComposeOptions
  logPolicy: LogPolicy
  /** Applies a policy verbatim (used instead of the manual-change setter). */
  applyLogPolicy?(policy: LogPolicy): void
  /**
   * Optional tool-owned extras slot. The link domain does not interpret the
   * values; they are copied verbatim when the target exposes such a field.
   */
  extras?: Record<string, unknown>
}

/** Result of `PresetStore.apply`. */
export type PresetApplyResult =
  { ok: true; deferred: boolean; message?: string } | { ok: false; error: string }

/** Exported JSON payload, file name `toolset-presets.json`. */
export interface PresetExportFile {
  fileName: string
  text: string
}

export type PresetImportResult =
  { ok: true; added: number; updated: number } | { ok: false; error: string }

export interface PresetStore {
  list(): Preset[]
  get(id: string): Preset | undefined
  save(input: PresetInput): Preset
  remove(id: string): boolean
  /** Applies a preset to one session; connection settings are deferred while open. */
  apply(preset: Preset, target: PresetApplyTarget): Promise<PresetApplyResult>
  exportFile(): PresetExportFile
  importJson(text: string): PresetImportResult
  on(ev: 'change', listener: (presets: Preset[]) => void): () => void
}

/** File name from plan §6.6. */
export const PRESET_EXPORT_FILE_NAME = 'toolset-presets.json'

/** Message shown when connection settings cannot be applied immediately. */
export const PRESET_DEFERRED_MESSAGE = '连接参数将在断开后生效'

const DISPLAY_MODES: readonly DisplayMode[] = ['raw', 'decoded', 'both']
const DOMAIN_NAME = 'link'

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isDisplayMode(value: unknown): value is DisplayMode {
  return typeof value === 'string' && (DISPLAY_MODES as readonly string[]).includes(value)
}

function normalizePreset(value: unknown): Preset | null {
  if (!isRecord(value)) return null
  if (typeof value.id !== 'string' || value.id.length === 0) return null
  if (typeof value.name !== 'string') return null
  if (typeof value.providerKind !== 'string' || value.providerKind.length === 0) return null
  return {
    id: value.id,
    name: value.name,
    providerKind: value.providerKind,
    settings: isRecord(value.settings) ? { ...value.settings } : {},
    protocolId:
      typeof value.protocolId === 'string' && value.protocolId.length > 0 ? value.protocolId : null,
    rxOptions: normalizeRxOptions(isRecord(value.rxOptions) ? value.rxOptions : {}),
    displayMode: isDisplayMode(value.displayMode) ? value.displayMode : 'both',
    compose: normalizeComposeOptions(isRecord(value.compose) ? value.compose : {}),
    quickGroupId:
      typeof value.quickGroupId === 'string' && value.quickGroupId.length > 0
        ? value.quickGroupId
        : null,
    logPolicy: normalizeLogPolicy(isRecord(value.logPolicy) ? value.logPolicy : undefined),
    extras: isRecord(value.extras) ? { ...value.extras } : {},
  }
}

function clonePreset(preset: Preset): Preset {
  return {
    ...preset,
    settings: { ...preset.settings },
    rxOptions: { ...preset.rxOptions },
    compose: { ...preset.compose },
    logPolicy: { ...preset.logPolicy },
    extras: { ...preset.extras },
  }
}

/** Creates the preset store backed by `toolset/link/presets.v1`. */
export function createPresetStore(): PresetStore {
  const local = createDomainStorage(DOMAIN_NAME).local<Preset[]>('presets', {
    version: 1,
    defaults: () => [],
  })
  const listeners = new Set<(presets: Preset[]) => void>()

  function read(): Preset[] {
    const raw: unknown = local.get()
    if (!Array.isArray(raw)) return []
    const presets: Preset[] = []
    for (const item of raw) {
      const preset = normalizePreset(item)
      if (preset !== null) presets.push(preset)
    }
    return presets
  }

  function notify(): void {
    const presets = read().map(clonePreset)
    for (const listener of [...listeners]) {
      try {
        listener(presets)
      } catch {
        // A broken subscriber must not break the store.
      }
    }
  }

  function write(presets: Preset[]): void {
    local.set(presets)
    notify()
  }

  return {
    list() {
      return read().map(clonePreset)
    },
    get(id) {
      const found = read().find((preset) => preset.id === id)
      return found === undefined ? undefined : clonePreset(found)
    },
    save(input) {
      const preset = normalizePreset({
        ...input,
        id: typeof input.id === 'string' && input.id.length > 0 ? input.id : uuid(),
      })
      if (preset === null) throw new Error('预设内容不完整')
      const presets = read()
      const index = presets.findIndex((item) => item.id === preset.id)
      if (index >= 0) presets[index] = preset
      else presets.push(preset)
      write(presets)
      return clonePreset(preset)
    },
    remove(id) {
      const presets = read()
      const remaining = presets.filter((preset) => preset.id !== id)
      if (remaining.length === presets.length) return false
      write(remaining)
      return true
    },
    async apply(preset, target) {
      if (preset.providerKind !== target.providerKind) {
        return { ok: false, error: '预设只能套用到相同类型的通道' }
      }
      const state = target.state
      const immediately = state === 'idle' || state === 'closed' || state === 'error'
      if (immediately) target.updateSettings({ ...preset.settings })
      else target.stageSettings({ ...preset.settings })
      await target.setProtocol(preset.protocolId)
      target.rxOptions = { ...preset.rxOptions }
      target.displayMode = preset.displayMode
      target.compose = { ...preset.compose }
      const logPolicy = { ...preset.logPolicy }
      if (target.applyLogPolicy !== undefined) target.applyLogPolicy(logPolicy)
      else target.logPolicy = logPolicy
      if (target.extras !== undefined) target.extras = { ...preset.extras }
      return immediately
        ? { ok: true, deferred: false }
        : { ok: true, deferred: true, message: PRESET_DEFERRED_MESSAGE }
    },
    exportFile() {
      return {
        fileName: PRESET_EXPORT_FILE_NAME,
        text: JSON.stringify({ version: 1, presets: read().map(clonePreset) }, null, 2),
      }
    },
    importJson(text) {
      let parsed: unknown
      try {
        parsed = JSON.parse(text)
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        return { ok: false, error: `预设文件不是合法的 JSON：${message}` }
      }
      const candidates = Array.isArray(parsed)
        ? parsed
        : isRecord(parsed) && Array.isArray(parsed.presets)
          ? parsed.presets
          : null
      if (candidates === null) return { ok: false, error: '预设文件格式不正确：缺少 presets 数组' }

      const imported: Preset[] = []
      for (let index = 0; index < candidates.length; index += 1) {
        const preset = normalizePreset(candidates[index])
        if (preset === null) {
          return { ok: false, error: `预设文件格式不正确：第 ${index + 1} 项无效` }
        }
        imported.push(preset)
      }

      const existing = read()
      const byId = new Map(existing.map((preset, index) => [preset.id, index]))
      let added = 0
      let updated = 0
      for (const preset of imported) {
        const index = byId.get(preset.id)
        if (index === undefined) {
          byId.set(preset.id, existing.length)
          existing.push(preset)
          added += 1
        } else {
          existing[index] = preset
          updated += 1
        }
      }
      write(existing)
      return { ok: true, added, updated }
    },
    on(ev, listener) {
      void ev
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
  }
}

let singleton: PresetStore | undefined

/** Application-wide preset store. */
export function getPresetStore(): PresetStore {
  singleton ??= createPresetStore()
  return singleton
}
