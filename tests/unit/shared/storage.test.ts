// @vitest-environment happy-dom
import 'fake-indexeddb/auto'

import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { createKvStore } from '@/shared/lib/storage/idb'
import type { StorageIssue } from '@/shared/lib/storage/issue'
import { createLocalStore } from '@/shared/lib/storage/local'
import {
  createAppStorage,
  createDomainStorage,
  createToolStorage,
  onStorageIssue,
} from '@/shared/lib/storage/namespace'

/** Minimal controllable Web Storage implementation (plan §6.3 tests). */
class FakeStorage implements Storage {
  private readonly entries = new Map<string, string>()
  /** When set, every write throws this error (quota simulation). */
  writeError: Error | null = null

  get length(): number {
    return this.entries.size
  }

  clear(): void {
    this.entries.clear()
  }

  getItem(key: string): string | null {
    return this.entries.get(key) ?? null
  }

  key(index: number): string | null {
    const keys = [...this.entries.keys()]
    return keys[index] ?? null
  }

  removeItem(key: string): void {
    this.entries.delete(key)
  }

  setItem(key: string, value: string): void {
    if (this.writeError) throw this.writeError
    this.entries.set(key, String(value))
  }

  keys(): string[] {
    return [...this.entries.keys()]
  }

  backupsOf(key: string): string[] {
    return this.keys().filter((stored) => stored.startsWith(`${key}.corrupt.`))
  }
}

let storage: FakeStorage
let issues: StorageIssue[] = []

const stopIssueHandler = onStorageIssue((issue) => {
  issues.push(issue)
})

function readRaw(key: string): string {
  const raw = storage.getItem(key)
  expect(raw).not.toBeNull()
  return raw as string
}

function readEnvelope(key: string): unknown {
  return JSON.parse(readRaw(key))
}

function quotaError(): Error {
  return Object.assign(new Error('quota exceeded'), { name: 'QuotaExceededError' })
}

function dispatchStorageEvent(key: string | null): void {
  const event = new Event('storage')
  Object.defineProperty(event, 'key', { value: key, configurable: true })
  window.dispatchEvent(event)
}

const basicOptions = () => ({
  version: 1,
  defaults: () => ({ a: 1, b: 'x' }),
})

beforeEach(() => {
  storage = new FakeStorage()
  issues = []
  vi.stubGlobal('localStorage', storage)
})

afterEach(() => {
  vi.unstubAllGlobals()
})

afterAll(() => {
  stopIssueHandler()
})

describe('LocalStore basics', () => {
  it('returns defaults, persists updates and notifies every subscriber', () => {
    const store = createLocalStore<{ a: number; b: string }>('test/basic.v1', basicOptions())
    expect(store.get()).toEqual({ a: 1, b: 'x' })

    const first: unknown[] = []
    const second: unknown[] = []
    const offFirst = store.subscribe((value) => first.push(value))
    const offSecond = store.subscribe((value) => second.push(value))

    store.update((value) => ({ ...value, a: value.a + 1 }))
    expect(store.get()).toEqual({ a: 2, b: 'x' })
    expect(first).toEqual([{ a: 2, b: 'x' }])
    expect(second).toEqual([{ a: 2, b: 'x' }])
    expect(readEnvelope('test/basic.v1')).toEqual({ version: 1, data: { a: 2, b: 'x' } })

    offFirst()
    store.set({ a: 9, b: 'y' })
    expect(first).toHaveLength(1)
    expect(second).toHaveLength(2)

    store.reset()
    expect(store.get()).toEqual({ a: 1, b: 'x' })
    expect(readEnvelope('test/basic.v1')).toEqual({ version: 1, data: { a: 1, b: 'x' } })
    expect(issues).toEqual([])
  })

  it('reads back a persisted envelope instead of using defaults', () => {
    storage.setItem('test/persisted.v1', JSON.stringify({ version: 1, data: { a: 7, b: 'saved' } }))
    const store = createLocalStore<{ a: number; b: string }>('test/persisted.v1', basicOptions())
    expect(store.get()).toEqual({ a: 7, b: 'saved' })
  })
})

describe('LocalStore version migration', () => {
  it('migrates older data and persists the migrated envelope', () => {
    storage.setItem('test/migrate.v2', JSON.stringify({ version: 1, data: { level: 1 } }))
    const fromVersions: number[] = []
    const store = createLocalStore<{ level: number; note: string }>('test/migrate.v2', {
      version: 2,
      defaults: () => ({ level: 0, note: 'default' }),
      migrate: (raw, fromVersion) => {
        fromVersions.push(fromVersion)
        const data = raw as { level: number }
        return { level: data.level + 10, note: 'migrated' }
      },
    })

    expect(store.get()).toEqual({ level: 11, note: 'migrated' })
    expect(fromVersions).toEqual([1])
    expect(readEnvelope('test/migrate.v2')).toEqual({
      version: 2,
      data: { level: 11, note: 'migrated' },
    })
    expect(issues).toEqual([])
  })

  it('backs up and resets to defaults when migrate returns null', () => {
    const key = 'test/migrate-null.v2'
    const corrupted = JSON.stringify({ version: 1, data: { bad: true } })
    storage.setItem(key, corrupted)
    const store = createLocalStore<{ ok: boolean }>(key, {
      version: 2,
      defaults: () => ({ ok: true }),
      migrate: () => null,
    })

    expect(store.get()).toEqual({ ok: true })
    const backups = storage.backupsOf(key)
    expect(backups).toHaveLength(1)
    expect(storage.getItem(backups[0] as string)).toBe(corrupted)
    expect(readEnvelope(key)).toEqual({ version: 2, data: { ok: true } })
    expect(issues).toHaveLength(1)
    expect(issues[0]?.kind).toBe('corrupt')
    expect(issues[0]?.key).toBe(key)
    expect(issues[0]?.reason).toBe('migrate')
  })

  it('treats data from a newer app version as corrupt', () => {
    const key = 'test/newer.v1'
    storage.setItem(key, JSON.stringify({ version: 5, data: { future: true } }))
    const store = createLocalStore<{ a: number; b: string }>(key, basicOptions())

    expect(store.get()).toEqual({ a: 1, b: 'x' })
    expect(storage.backupsOf(key)).toHaveLength(1)
    expect(issues[0]?.reason).toBe('version')
    expect(issues[0]?.kind).toBe('corrupt')
  })

  it('treats unparsable JSON and wrong shapes as corrupt', () => {
    const brokenKey = 'test/broken.v1'
    storage.setItem(brokenKey, '{not json')
    const broken = createLocalStore<{ a: number; b: string }>(brokenKey, basicOptions())
    expect(broken.get()).toEqual({ a: 1, b: 'x' })
    expect(issues[0]?.reason).toBe('parse')

    const shapeKey = 'test/shape.v1'
    storage.setItem(shapeKey, JSON.stringify({ data: { a: 2 } }))
    const wrongShape = createLocalStore<{ a: number; b: string }>(shapeKey, basicOptions())
    expect(wrongShape.get()).toEqual({ a: 1, b: 'x' })
    expect(issues[1]?.reason).toBe('shape')

    for (const key of [brokenKey, shapeKey]) {
      const backups = storage.backupsOf(key)
      expect(backups).toHaveLength(1)
      expect(readEnvelope(key)).toEqual({ version: 1, data: { a: 1, b: 'x' } })
    }
  })
})

describe('LocalStore quota handling', () => {
  it('keeps the in-memory value and reports a quota issue', () => {
    const key = 'test/quota.v1'
    const store = createLocalStore<{ value: number }>(key, {
      version: 1,
      defaults: () => ({ value: 0 }),
    })
    store.set({ value: 5 })
    expect(readEnvelope(key)).toEqual({ version: 1, data: { value: 5 } })

    storage.writeError = quotaError()
    store.set({ value: 9 })

    expect(store.get()).toEqual({ value: 9 })
    expect(readEnvelope(key)).toEqual({ version: 1, data: { value: 5 } })
    expect(issues).toHaveLength(1)
    expect(issues[0]?.kind).toBe('quota')
    expect(issues[0]?.key).toBe(key)
    expect(issues[0]?.reason).toBe('QuotaExceededError')
  })
})

describe('LocalStore cross-tab sync', () => {
  it('re-reads and notifies subscribers when a matching storage event arrives', () => {
    const key = 'test/event.v1'
    const store = createLocalStore<{ n: number }>(key, {
      version: 1,
      defaults: () => ({ n: 0 }),
    })
    expect(store.get()).toEqual({ n: 0 })

    const seen: unknown[] = []
    store.subscribe((value) => seen.push(value))

    storage.setItem(key, JSON.stringify({ version: 1, data: { n: 2 } }))
    dispatchStorageEvent(key)

    expect(store.get()).toEqual({ n: 2 })
    expect(seen).toEqual([{ n: 2 }])
  })

  it('ignores storage events for other keys', () => {
    const key = 'test/event-ignore.v1'
    storage.setItem(key, JSON.stringify({ version: 1, data: { n: 1 } }))
    const store = createLocalStore<{ n: number }>(key, {
      version: 1,
      defaults: () => ({ n: 0 }),
    })
    const seen: unknown[] = []
    store.subscribe((value) => seen.push(value))

    storage.setItem('test/other.v1', JSON.stringify({ version: 1, data: { n: 9 } }))
    dispatchStorageEvent('test/other.v1')
    dispatchStorageEvent(null)

    expect(store.get()).toEqual({ n: 1 })
    expect(seen).toEqual([])
  })
})

describe('storage namespaces', () => {
  it('builds versioned keys per tool, domain and app', () => {
    const tool = createToolStorage('serial')
    tool.local('settings', { version: 1, defaults: () => ({ baudRate: 115200 }) }).set({
      baudRate: 9600,
    })
    expect(readEnvelope('toolset/tool/serial/settings.v1')).toEqual({
      version: 1,
      data: { baudRate: 9600 },
    })

    createDomainStorage('link')
      .local<string[]>('presets', { version: 2, defaults: () => [] })
      .set(['p1'])
    expect(readEnvelope('toolset/link/presets.v2')).toEqual({ version: 2, data: ['p1'] })

    const app = createAppStorage()
    app.local('settings', { version: 1, defaults: () => ({ theme: 'system' }) }).set({
      theme: 'light',
    })
    expect(readEnvelope('toolset/app/settings.v1')).toEqual({
      version: 1,
      data: { theme: 'light' },
    })
  })

  it('does not leak the namespace into kv keys returned by keys()', async () => {
    const kv = createDomainStorage('protocol').kv
    await kv.set('plugin/a', { id: 'a' })
    await kv.set('plugin/b', { id: 'b' })
    await kv.set('other', 1)

    expect(await kv.get('plugin/a')).toEqual({ id: 'a' })
    expect(await kv.keys()).toEqual(['other', 'plugin/a', 'plugin/b'])
    expect(await kv.keys('plugin/')).toEqual(['plugin/a', 'plugin/b'])
    await kv.delete('plugin/a')
    expect(await kv.get('plugin/a')).toBeUndefined()
    expect(await kv.keys('plugin/')).toEqual(['plugin/b'])
  })
})

describe('storage without localStorage', () => {
  it('falls back to an in-memory store instead of throwing', () => {
    vi.stubGlobal('localStorage', undefined)
    const store = createLocalStore<{ a: number; b: string }>('test/memory.v1', basicOptions())

    expect(store.get()).toEqual({ a: 1, b: 'x' })
    store.set({ a: 2, b: 'y' })
    expect(store.get()).toEqual({ a: 2, b: 'y' })
    expect(issues).toEqual([])
  })
})

describe('KvStore', () => {
  it('stores, reads, lists and deletes values in IndexedDB', async () => {
    const kv = createKvStore('unit-idb/')
    await kv.set('one', { value: 1 })
    await kv.set('two', [1, 2, 3])

    expect(await kv.get('one')).toEqual({ value: 1 })
    expect(await kv.get('two')).toEqual([1, 2, 3])
    expect(await kv.get('missing')).toBeUndefined()
    expect(await kv.keys()).toEqual(['one', 'two'])
    expect(await kv.keys('t')).toEqual(['two'])

    await kv.delete('one')
    expect(await kv.get('one')).toBeUndefined()
    expect(await kv.keys()).toEqual(['two'])
    expect(issues).toEqual([])
  })

  it('falls back to memory when opening IndexedDB throws', async () => {
    vi.stubGlobal('indexedDB', {
      open: () => {
        throw new Error('open failed')
      },
    })
    const kv = createKvStore('fallback-throw/')

    await kv.set('key', { payload: 42 })
    expect(await kv.get('key')).toEqual({ payload: 42 })
    expect(await kv.keys()).toEqual(['key'])
    await kv.delete('key')
    expect(await kv.get('key')).toBeUndefined()
    expect(await kv.keys()).toEqual([])

    expect(issues).toHaveLength(1)
    expect(issues[0]?.kind).toBe('idb')
    expect(issues[0]?.key).toBe('fallback-throw/')
    expect(issues[0]?.reason).toContain('open')
  })

  it('falls back to memory when IndexedDB is missing', async () => {
    vi.stubGlobal('indexedDB', undefined)
    const kv = createKvStore('fallback-missing/')

    await kv.set('key', 'value')
    expect(await kv.get('key')).toBe('value')
    expect(await kv.keys('ke')).toEqual(['key'])
    expect(issues).toHaveLength(1)
    expect(issues[0]?.kind).toBe('idb')
  })
})
