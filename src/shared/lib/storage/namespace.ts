import { createKvStore, type KvStore } from './idb'
import { createLocalStore, type LocalStore, type LocalStoreOptions } from './local'

export { onStorageIssue } from './issue'
export type { StorageIssue, StorageIssueHandler, StorageIssueKind } from './issue'
export type { KvStore } from './idb'
export type { LocalStore, LocalStoreOptions } from './local'

/** Root of every localStorage key written by the app. */
export const STORAGE_ROOT = 'toolset'

/** Prefix used by tool scoped storage: `toolset/tool/<toolId>/`. */
export const TOOL_STORAGE_PREFIX = `${STORAGE_ROOT}/tool/`

/** Prefix used by domain scoped storage: `toolset/<domain>/`. */
export const DOMAIN_STORAGE_PREFIX = `${STORAGE_ROOT}/`

/** Prefix used by the app shell storage: `toolset/app/`. */
export const APP_STORAGE_PREFIX = `${STORAGE_ROOT}/app/`

export interface StorageNamespace {
  local<T>(name: string, options: LocalStoreOptions<T>): LocalStore<T>
  kv: KvStore
}

function buildKey(prefix: string, name: string, version: number): string {
  return `${prefix}${name}.v${version}`
}

function createNamespace(prefix: string): StorageNamespace {
  return {
    local<T>(name: string, options: LocalStoreOptions<T>): LocalStore<T> {
      return createLocalStore(buildKey(prefix, name, options.version), options)
    },
    kv: createKvStore(prefix),
  }
}

/**
 * Storage owned by one tool: `toolset/tool/<id>/` in localStorage and the same
 * namespace inside the shared IndexedDB `kv` object store.
 */
export function createToolStorage(toolId: string): StorageNamespace {
  return createNamespace(`${TOOL_STORAGE_PREFIX}${toolId}/`)
}

/**
 * Storage owned by one domain: `toolset/<domain>/`.
 */
export function createDomainStorage(domain: string): StorageNamespace {
  return createNamespace(`${DOMAIN_STORAGE_PREFIX}${domain}/`)
}

/**
 * Storage owned by the app shell: `toolset/app/`.
 *
 * Only localStorage is exposed because appearance/settings are write-through and
 * must be readable by the inline theme script in `index.html`.
 */
export function createAppStorage(): Pick<StorageNamespace, 'local'> {
  const prefix = APP_STORAGE_PREFIX
  return {
    local<T>(name: string, options: LocalStoreOptions<T>): LocalStore<T> {
      return createLocalStore(buildKey(prefix, name, options.version), options)
    },
  }
}
