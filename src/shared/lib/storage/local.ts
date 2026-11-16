import { reportStorageIssue } from './issue'

export interface LocalStoreOptions<T> {
  /** Current schema version. Changing it requires a `migrate` implementation. */
  version: number
  /** Produces a fresh default value; never share mutable defaults between stores. */
  defaults: () => T
  /**
   * Converts data written by an older version. Return `null` when the value cannot
   * be migrated; the store then keeps a backup of the raw string and uses defaults.
   */
  migrate?: (raw: unknown, fromVersion: number) => T | null
}

export interface LocalStore<T> {
  get(): T
  set(value: T): void
  update(updater: (value: T) => T): void
  subscribe(listener: (value: T) => void): () => void
  reset(): void
}

interface StorageEnvelope<T> {
  version: number
  data: T
}

interface StorageChangeTarget {
  reloadFromStorage(): void
}

type Listener<T> = (value: T) => void

/**
 * Returns the Web Storage instance when it is usable, `null` otherwise.
 *
 * Runtimes without `localStorage` (unit tests, SSR, private mode quotas) fall back to
 * an in-memory implementation instead of throwing.
 */
export function resolveLocalStorage(): Storage | null {
  try {
    const candidate = (globalThis as { localStorage?: Storage | null }).localStorage
    if (!candidate) return null
    if (
      typeof candidate.getItem !== 'function' ||
      typeof candidate.setItem !== 'function' ||
      typeof candidate.removeItem !== 'function'
    ) {
      return null
    }
    return candidate
  } catch {
    return null
  }
}

function isEnvelope(value: unknown): value is StorageEnvelope<unknown> {
  if (typeof value !== 'object' || value === null) return false
  const candidate = value as { version?: unknown; data?: unknown }
  return typeof candidate.version === 'number' && 'data' in candidate
}

function errorName(error: unknown): string {
  if (typeof error === 'object' && error !== null && 'name' in error) {
    const name = (error as { name?: unknown }).name
    if (typeof name === 'string') return name
  }
  return 'UnknownError'
}

const instances = new Map<string, Set<StorageChangeTarget>>()
let storageListenerAttached = false

function attachStorageListener(): void {
  if (storageListenerAttached) return
  if (typeof window === 'undefined' || typeof window.addEventListener !== 'function') return
  storageListenerAttached = true
  window.addEventListener('storage', handleStorageEvent)
}

/** Multi-tab sync: a matching `storage` event re-reads the store and notifies listeners. */
function handleStorageEvent(event: StorageEvent): void {
  const key = event.key
  if (!key) return
  const targets = instances.get(key)
  if (!targets) return
  for (const target of [...targets]) target.reloadFromStorage()
}

function registerInstance(key: string, target: StorageChangeTarget): void {
  attachStorageListener()
  let targets = instances.get(key)
  if (!targets) {
    targets = new Set()
    instances.set(key, targets)
  }
  targets.add(target)
}

class LocalStoreImpl<T> implements LocalStore<T>, StorageChangeTarget {
  private value: T | undefined
  private loaded = false
  private readonly listeners = new Set<Listener<T>>()

  constructor(
    private readonly key: string,
    private readonly options: LocalStoreOptions<T>,
  ) {
    registerInstance(key, this)
  }

  get(): T {
    this.ensureLoaded()
    return this.value as T
  }

  set(value: T): void {
    this.ensureLoaded()
    this.value = value
    this.persist()
    this.notify()
  }

  update(updater: (value: T) => T): void {
    this.set(updater(this.get()))
  }

  subscribe(listener: Listener<T>): () => void {
    this.ensureLoaded()
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }

  reset(): void {
    this.ensureLoaded()
    this.value = this.options.defaults()
    this.persist()
    this.notify()
  }

  reloadFromStorage(): void {
    this.read()
    this.loaded = true
    this.notify()
  }

  private ensureLoaded(): void {
    if (this.loaded) return
    this.read()
    this.loaded = true
  }

  private read(): void {
    const storage = resolveLocalStorage()
    const defaults = this.options.defaults()
    if (!storage) {
      this.value = defaults
      return
    }

    let raw: string | null
    try {
      raw = storage.getItem(this.key)
    } catch {
      this.value = defaults
      return
    }

    if (raw === null) {
      this.value = defaults
      return
    }

    let parsed: unknown
    try {
      parsed = JSON.parse(raw)
    } catch {
      this.handleCorrupt(storage, raw, 'parse')
      return
    }

    if (!isEnvelope(parsed)) {
      this.handleCorrupt(storage, raw, 'shape')
      return
    }

    if (parsed.version > this.options.version) {
      // A newer version of the app wrote this key; we cannot interpret it safely.
      this.handleCorrupt(storage, raw, 'version')
      return
    }

    if (parsed.version === this.options.version) {
      this.value = parsed.data as T
      return
    }

    // Older version: migrate when possible, otherwise treat it as corrupt.
    const migrated = this.options.migrate ? this.options.migrate(parsed.data, parsed.version) : null
    if (migrated === null) {
      this.handleCorrupt(storage, raw, 'migrate')
      return
    }
    this.value = migrated
    this.persist()
  }

  private handleCorrupt(storage: Storage, raw: string, reason: string): void {
    try {
      storage.setItem(`${this.key}.corrupt.${Date.now()}`, raw)
    } catch {
      // The backup is best effort; the sane default value is more important.
    }
    reportStorageIssue({ kind: 'corrupt', key: this.key, reason })
    this.value = this.options.defaults()
    this.persist()
  }

  private persist(): void {
    const storage = resolveLocalStorage()
    if (!storage) return
    const envelope: StorageEnvelope<T> = {
      version: this.options.version,
      data: this.value as T,
    }
    try {
      storage.setItem(this.key, JSON.stringify(envelope))
    } catch (error) {
      // Quota errors keep the in-memory value so the current page still works.
      reportStorageIssue({ kind: 'quota', key: this.key, reason: errorName(error) })
    }
  }

  private notify(): void {
    for (const listener of [...this.listeners]) {
      try {
        listener(this.value as T)
      } catch {
        // A broken subscriber must not prevent the remaining ones from running.
      }
    }
  }
}

/**
 * Creates a persistent local store.
 *
 * `key` is the full Web Storage key, usually built by `createToolStorage`,
 * `createDomainStorage` or `createAppStorage`. The stored format is
 * `{ "version": n, "data": ... }`.
 */
export function createLocalStore<T>(key: string, options: LocalStoreOptions<T>): LocalStore<T> {
  return new LocalStoreImpl(key, options)
}
