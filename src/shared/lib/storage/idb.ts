import { reportStorageIssue } from './issue'

/** Minimal asynchronous key/value store backed by IndexedDB or an in-memory fallback. */
export interface KvStore {
  get<T>(key: string): Promise<T | undefined>
  set(key: string, value: unknown): Promise<void>
  delete(key: string): Promise<void>
  keys(prefix?: string): Promise<string[]>
}

const DATABASE_NAME = 'toolset'
const DATABASE_VERSION = 1
const OBJECT_STORE = 'kv'

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined' || !indexedDB) {
      reject(new Error('IndexedDB is unavailable'))
      return
    }
    let request: IDBOpenDBRequest
    try {
      request = indexedDB.open(DATABASE_NAME, DATABASE_VERSION)
    } catch (error) {
      reject(error)
      return
    }
    request.onupgradeneeded = () => {
      const database = request.result
      if (!database.objectStoreNames.contains(OBJECT_STORE)) {
        database.createObjectStore(OBJECT_STORE)
      }
    }
    request.onsuccess = () => {
      resolve(request.result)
    }
    request.onerror = () => {
      reject(request.error ?? new Error('IndexedDB open failed'))
    }
    request.onblocked = () => {
      reject(new Error('IndexedDB open blocked'))
    }
  })
}

function requestResult<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => {
      resolve(request.result)
    }
    request.onerror = () => {
      reject(request.error ?? new Error('IndexedDB request failed'))
    }
  })
}

function readValue<T>(database: IDBDatabase, key: string): Promise<T | undefined> {
  let transaction: IDBTransaction
  try {
    transaction = database.transaction(OBJECT_STORE, 'readonly')
  } catch (error) {
    return Promise.reject(error)
  }
  return requestResult(transaction.objectStore(OBJECT_STORE).get(key)) as Promise<T | undefined>
}

function readKeys(database: IDBDatabase): Promise<IDBValidKey[]> {
  let transaction: IDBTransaction
  try {
    transaction = database.transaction(OBJECT_STORE, 'readonly')
  } catch (error) {
    return Promise.reject(error)
  }
  return requestResult(transaction.objectStore(OBJECT_STORE).getAllKeys())
}

function writeValue(database: IDBDatabase, key: string, value: unknown): Promise<void> {
  let transaction: IDBTransaction
  try {
    transaction = database.transaction(OBJECT_STORE, 'readwrite')
  } catch (error) {
    return Promise.reject(error)
  }
  return new Promise<void>((resolve, reject) => {
    transaction.oncomplete = () => {
      resolve()
    }
    transaction.onabort = () => {
      reject(transaction.error ?? new Error('IndexedDB transaction aborted'))
    }
    transaction.onerror = () => {
      reject(transaction.error ?? new Error('IndexedDB transaction failed'))
    }
    try {
      transaction.objectStore(OBJECT_STORE).put(value, key)
    } catch (error) {
      reject(error)
    }
  })
}

function deleteValue(database: IDBDatabase, key: string): Promise<void> {
  let transaction: IDBTransaction
  try {
    transaction = database.transaction(OBJECT_STORE, 'readwrite')
  } catch (error) {
    return Promise.reject(error)
  }
  return new Promise<void>((resolve, reject) => {
    transaction.oncomplete = () => {
      resolve()
    }
    transaction.onabort = () => {
      reject(transaction.error ?? new Error('IndexedDB transaction aborted'))
    }
    transaction.onerror = () => {
      reject(transaction.error ?? new Error('IndexedDB transaction failed'))
    }
    try {
      transaction.objectStore(OBJECT_STORE).delete(key)
    } catch (error) {
      reject(error)
    }
  })
}

function errorName(error: unknown): string {
  if (typeof error === 'object' && error !== null && 'name' in error) {
    const name = (error as { name?: unknown }).name
    if (typeof name === 'string') return name
  }
  return 'UnknownError'
}

const SERIALIZE_ERROR = 'IndexedDB 值必须可序列化'

/**
 * Development-only guard: IndexedDB uses the structured clone algorithm, so functions,
 * DOM nodes or circular references would be written as a useless clone. Fail loudly in
 * development instead of silently storing a broken value.
 */
function assertSerializable(value: unknown): void {
  if (!import.meta.env.DEV) return
  try {
    if (typeof structuredClone === 'function') {
      structuredClone(value)
      assertNoCycles(value, new WeakSet<object>())
      return
    }
    const json = JSON.stringify(value)
    if (json !== undefined) JSON.parse(json)
  } catch {
    throw new Error(SERIALIZE_ERROR)
  }
}

/** Detects circular references, which structured clone silently accepts. */
function assertNoCycles(value: unknown, ancestors: WeakSet<object>): void {
  if (typeof value !== 'object' || value === null) return
  if (ancestors.has(value)) throw new Error(SERIALIZE_ERROR)
  ancestors.add(value)
  if (Array.isArray(value)) {
    for (const item of value) assertNoCycles(item, ancestors)
  } else if (value instanceof Map) {
    for (const [key, entry] of value) {
      assertNoCycles(key, ancestors)
      assertNoCycles(entry, ancestors)
    }
  } else if (value instanceof Set) {
    for (const item of value) assertNoCycles(item, ancestors)
  } else if (
    value instanceof Date ||
    value instanceof RegExp ||
    value instanceof ArrayBuffer ||
    ArrayBuffer.isView(value)
  ) {
    // Leaf values accepted by structured clone.
  } else {
    for (const key of Object.keys(value)) {
      assertNoCycles((value as Record<string, unknown>)[key], ancestors)
    }
  }
  ancestors.delete(value)
}

function matchesPrefix(key: string, prefix: string): boolean {
  return prefix === '' || key.startsWith(prefix)
}

class IndexedDbKvStore implements KvStore {
  private readonly memory = new Map<string, unknown>()
  private database: Promise<IDBDatabase | null> | null = null
  private degraded = false
  private reported = false

  constructor(private readonly namespace: string) {}

  get<T>(key: string): Promise<T | undefined> {
    return this.run<T | undefined>(
      async (database) => readValue<T>(database, this.toStorageKey(key)),
      () => this.memory.get(this.toStorageKey(key)) as T | undefined,
    )
  }

  async set(key: string, value: unknown): Promise<void> {
    assertSerializable(value)
    const storageKey = this.toStorageKey(key)
    const written = await this.run<boolean>(
      async (database) => {
        await writeValue(database, storageKey, value)
        return true
      },
      () => false,
    )
    if (!written) this.memory.set(storageKey, value)
  }

  async delete(key: string): Promise<void> {
    const storageKey = this.toStorageKey(key)
    await this.run<boolean>(
      async (database) => {
        await deleteValue(database, storageKey)
        return true
      },
      () => false,
    )
    this.memory.delete(storageKey)
  }

  keys(prefix = ''): Promise<string[]> {
    return this.run<string[]>(
      async (database) => {
        const keys = await readKeys(database)
        return keys
          .map((key) => String(key))
          .filter(
            (key) => key.startsWith(this.namespace) && matchesPrefix(key, this.namespace + prefix),
          )
          .map((key) => key.slice(this.namespace.length))
          .sort()
      },
      () => this.memoryKeys(prefix),
    )
  }

  private memoryKeys(prefix: string): string[] {
    const fullPrefix = this.namespace + prefix
    return [...this.memory.keys()]
      .filter((key) => key.startsWith(fullPrefix))
      .map((key) => key.slice(this.namespace.length))
      .sort()
  }

  private toStorageKey(key: string): string {
    return this.namespace + key
  }

  /**
   * Runs `operation` against IndexedDB and falls back to the memory implementation
   * (reporting an `idb` issue once) when the database cannot be opened or written.
   */
  private async run<T>(
    operation: (database: IDBDatabase) => Promise<T>,
    fallback: () => T,
  ): Promise<T> {
    const database = await this.ensureDatabase()
    if (!database) return fallback()
    try {
      return await operation(database)
    } catch (error) {
      this.degrade(error, 'write')
      return fallback()
    }
  }

  private ensureDatabase(): Promise<IDBDatabase | null> {
    if (this.degraded) return Promise.resolve(null)
    this.database ??= openDatabase().catch((error: unknown) => {
      this.degrade(error, 'open')
      return null
    })
    return this.database
  }

  private degrade(error: unknown, reason: string): void {
    this.degraded = true
    if (this.reported) return
    this.reported = true
    reportStorageIssue({
      kind: 'idb',
      key: this.namespace,
      reason: `${reason}:${errorName(error)}`,
    })
  }
}

/**
 * Creates a kv store. All keys are prefixed with `namespace` inside the shared
 * `toolset` / `kv` database, which keeps tools and domains isolated.
 */
export function createKvStore(namespace = ''): KvStore {
  return new IndexedDbKvStore(namespace)
}
