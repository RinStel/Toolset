/**
 * Device memory (plan §6.6): remembers the last used settings per `deviceKey`,
 * keeping at most 50 records (LRU by `updatedAt`).
 */

import { createDomainStorage } from '../../../shared/lib/storage/namespace'
import type { DisplayMode } from '../session/state'
import type { RxOptions } from '../session/rx-framer'

/** Values auto-filled into a new session for the same device. */
export interface DeviceMemory {
  deviceKey: string
  settings: Record<string, unknown>
  protocolId: string | null
  rxOptions: RxOptions
  displayMode: DisplayMode
  updatedAt: number
}

/** Maximum number of remembered devices (plan §6.6). */
export const MAX_DEVICE_MEMORIES = 50

export interface DeviceMemoryStore {
  get(deviceKey: string): DeviceMemory | undefined
  /** All records, most recently used first. */
  list(): DeviceMemory[]
  /** Inserts or replaces the record of `entry.deviceKey`. */
  save(entry: DeviceMemory): void
  remove(deviceKey: string): boolean
  clear(): void
  onChange(listener: (records: DeviceMemory[]) => void): () => void
}

const DISPLAY_MODES: readonly DisplayMode[] = ['raw', 'decoded', 'both']

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isDisplayMode(value: unknown): value is DisplayMode {
  return typeof value === 'string' && (DISPLAY_MODES as readonly string[]).includes(value)
}

function normalizeRecord(value: unknown): DeviceMemory | null {
  if (!isRecord(value)) return null
  if (typeof value.deviceKey !== 'string' || value.deviceKey.length === 0) return null
  const rxOptions = isRecord(value.rxOptions) ? value.rxOptions : {}
  return {
    deviceKey: value.deviceKey,
    settings: isRecord(value.settings) ? { ...value.settings } : {},
    protocolId:
      typeof value.protocolId === 'string' && value.protocolId.length > 0 ? value.protocolId : null,
    rxOptions: {
      framing:
        rxOptions.framing === 'line' ||
        rxOptions.framing === 'idle' ||
        rxOptions.framing === 'chunk'
          ? rxOptions.framing
          : 'line',
      idleMs: typeof rxOptions.idleMs === 'number' ? rxOptions.idleMs : 20,
      encoding:
        rxOptions.encoding === 'ascii' ||
        rxOptions.encoding === 'latin1' ||
        rxOptions.encoding === 'gbk' ||
        rxOptions.encoding === 'utf-8'
          ? rxOptions.encoding
          : 'utf-8',
    },
    displayMode: isDisplayMode(value.displayMode) ? value.displayMode : 'both',
    updatedAt: typeof value.updatedAt === 'number' ? value.updatedAt : 0,
  }
}

/** Creates a store backed by `toolset/link/devices.v1` (in-memory without storage). */
export function createDeviceMemoryStore(): DeviceMemoryStore {
  const local = createDomainStorage('link').local<DeviceMemory[]>('devices', {
    version: 1,
    defaults: () => [],
  })
  const listeners = new Set<(records: DeviceMemory[]) => void>()

  function read(): DeviceMemory[] {
    const raw: unknown = local.get()
    if (!Array.isArray(raw)) return []
    const records: DeviceMemory[] = []
    for (const item of raw) {
      const record = normalizeRecord(item)
      if (record !== null) records.push(record)
    }
    return records.sort((left, right) => right.updatedAt - left.updatedAt)
  }

  function cloneRecords(): DeviceMemory[] {
    return read().map((record) => ({
      ...record,
      settings: { ...record.settings },
      rxOptions: { ...record.rxOptions },
    }))
  }

  function notify(): void {
    const records = cloneRecords()
    for (const listener of [...listeners]) {
      try {
        listener(records)
      } catch {
        // A broken subscriber must not break the store.
      }
    }
  }

  function write(records: DeviceMemory[]): void {
    local.set(records)
    notify()
  }

  return {
    get(deviceKey) {
      return read().find((record) => record.deviceKey === deviceKey)
    },
    list() {
      return cloneRecords()
    },
    save(entry) {
      if (typeof entry.deviceKey !== 'string' || entry.deviceKey.length === 0) return
      const record: DeviceMemory = {
        deviceKey: entry.deviceKey,
        settings: { ...entry.settings },
        protocolId: entry.protocolId,
        rxOptions: { ...entry.rxOptions },
        displayMode: entry.displayMode,
        updatedAt: entry.updatedAt,
      }
      const records = read().filter((item) => item.deviceKey !== record.deviceKey)
      records.push(record)
      records.sort((left, right) => right.updatedAt - left.updatedAt)
      write(records.slice(0, MAX_DEVICE_MEMORIES))
    },
    remove(deviceKey) {
      const before = read()
      const after = before.filter((record) => record.deviceKey !== deviceKey)
      if (after.length === before.length) return false
      write(after)
      return true
    },
    clear() {
      write([])
    },
    onChange(listener) {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
  }
}

let singleton: DeviceMemoryStore | undefined

/** Application-wide device memory store. */
export function getDeviceMemory(): DeviceMemoryStore {
  singleton ??= createDeviceMemoryStore()
  return singleton
}
