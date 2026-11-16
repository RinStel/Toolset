/**
 * 自定义控件安全模式（plan §6.10「安全模式」）。
 *
 * - 调用标记：每次调用自定义控件代码前同步写入 `toolset/safe-mode/pending`，
 *   调用返回或抛出后同步删除；`pagehide` 时也删除。
 * - 启动检查：读到 pending 说明上次页面在执行自定义控件时失去响应，把 customId
 *   加入 `toolset/safe-mode/blocked` 并返回需要横幅提示的控件信息。
 * - 全局安全模式：URL 带 `safe=1` 时不执行任何自定义控件代码。
 *
 * `toolset/safe-mode/*` 是「禁止直接访问 localStorage」规则的例外，不进入备份。
 * 本模块允许注入 storage，便于测试。
 */

/** 调用标记键（plan §6.10）。 */
export const SAFE_MODE_PENDING_KEY = 'toolset/safe-mode/pending'

/** 被暂停控件的键（JSON 字符串数组，plan §6.10）。 */
export const SAFE_MODE_BLOCKED_KEY = 'toolset/safe-mode/blocked'

/** 全局安全模式的 URL 参数名。 */
export const SAFE_MODE_QUERY_PARAM = 'safe'

/** `toolset/safe-mode/pending` 的内容。 */
export interface SafeModePending {
  customId: string
  name: string
  at: number
}

/** 启动检查发现上次卡死时返回的信息，用于显示横幅。 */
export interface SafeModeStoppedWidget {
  customId: string
  name: string
}

/** 可注入的同步存储（默认 `localStorage`）。 */
export interface SafeModeStorage {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
  removeItem(key: string): void
}

export interface SafeModeOptions {
  /** 注入存储（测试用）；传 `null` 表示存储不可用。默认使用 `localStorage`。 */
  storage?: SafeModeStorage | null
  /** 时钟，默认 `Date.now()`。 */
  now?: () => number
  /** 是否在 window 存在时注册 pagehide 清理，默认 true。 */
  registerPageHide?: boolean
}

export interface SafeMode {
  /** 调用自定义控件代码前同步写入 pending 标记。 */
  writePending(customId: string, name: string): void
  /** 同步删除 pending 标记（调用返回、抛出或 pagehide 时调用）。 */
  clearPending(): void
  /** 读取 pending 标记（不删除）。 */
  readPending(): SafeModePending | null
  /**
   * 启动检查：若存在 pending 标记，把其中的 customId 加入 blocked、删除 pending，
   * 并返回需要显示横幅的控件信息；否则返回 `null`。
   */
  checkStartup(): SafeModeStoppedWidget | null
  isBlocked(customId: string): boolean
  block(customId: string): void
  unblock(customId: string): void
  listBlocked(): string[]
  /** `#/tools/serial?safe=1`、`?safe=1` 等 URL 是否处于全局安全模式。 */
  isSafeModeUrl(search: string): boolean
  /** 释放 pagehide 监听。 */
  dispose(): void
}

/** 判断 URL（query 或 hash 路由）是否带 `safe=1`。 */
export function isSafeModeUrl(url: string): boolean {
  const queryIndex = url.indexOf('?')
  if (queryIndex < 0) return false
  const hashIndex = url.indexOf('#', queryIndex)
  const query = url.slice(queryIndex + 1, hashIndex >= 0 ? hashIndex : undefined)
  const value = new URLSearchParams(query).get(SAFE_MODE_QUERY_PARAM)
  return value === '1' || value === 'true'
}

function resolveStorage(storage: SafeModeStorage | null | undefined): SafeModeStorage | null {
  if (storage !== undefined) return storage
  try {
    if (typeof localStorage === 'undefined') return null
    return localStorage
  } catch {
    return null
  }
}

function readBlockedList(storage: SafeModeStorage | null): string[] {
  if (!storage) return []
  let raw: string | null
  try {
    raw = storage.getItem(SAFE_MODE_BLOCKED_KEY)
  } catch {
    return []
  }
  if (!raw) return []
  try {
    const parsed: unknown = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    return parsed.filter((item): item is string => typeof item === 'string')
  } catch {
    return []
  }
}

function writeBlockedList(storage: SafeModeStorage | null, ids: string[]): void {
  if (!storage) return
  try {
    storage.setItem(SAFE_MODE_BLOCKED_KEY, JSON.stringify(ids))
  } catch {
    // 存储不可用（隐私模式/配额）时静默失败，安全模式退化为仅本次会话有效。
  }
}

function parsePending(raw: string | null, now: () => number): SafeModePending | null {
  if (!raw) return null
  try {
    const parsed: unknown = JSON.parse(raw)
    if (typeof parsed !== 'object' || parsed === null) return null
    const record = parsed as Record<string, unknown>
    if (typeof record.customId !== 'string' || record.customId === '') return null
    return {
      customId: record.customId,
      name: typeof record.name === 'string' && record.name !== '' ? record.name : record.customId,
      at: typeof record.at === 'number' && Number.isFinite(record.at) ? record.at : now(),
    }
  } catch {
    return null
  }
}

/** 创建安全模式控制器（测试可注入 storage 与时钟）。 */
export function createSafeMode(options: SafeModeOptions = {}): SafeMode {
  const storage = resolveStorage(options.storage)
  const now = options.now ?? (() => Date.now())

  function clearPending(): void {
    if (!storage) return
    try {
      storage.removeItem(SAFE_MODE_PENDING_KEY)
    } catch {
      // 忽略存储错误。
    }
  }

  let pageHideHandler: (() => void) | undefined

  const mode: SafeMode = {
    writePending(customId: string, name: string): void {
      if (!storage) return
      const record: SafeModePending = { customId, name, at: now() }
      try {
        storage.setItem(SAFE_MODE_PENDING_KEY, JSON.stringify(record))
      } catch {
        // 同步写入失败时无法检测卡死，但不影响控件运行。
      }
    },
    clearPending,
    readPending(): SafeModePending | null {
      if (!storage) return null
      try {
        return parsePending(storage.getItem(SAFE_MODE_PENDING_KEY), now)
      } catch {
        return null
      }
    },
    checkStartup(): SafeModeStoppedWidget | null {
      if (!storage) return null
      let raw: string | null = null
      try {
        raw = storage.getItem(SAFE_MODE_PENDING_KEY)
      } catch {
        return null
      }
      if (!raw) return null
      const record = parsePending(raw, now)
      clearPending()
      if (!record) return null
      const blocked = readBlockedList(storage)
      if (!blocked.includes(record.customId)) {
        blocked.push(record.customId)
        writeBlockedList(storage, blocked)
      }
      return { customId: record.customId, name: record.name }
    },
    isBlocked(customId: string): boolean {
      return readBlockedList(storage).includes(customId)
    },
    block(customId: string): void {
      const blocked = readBlockedList(storage)
      if (blocked.includes(customId)) return
      blocked.push(customId)
      writeBlockedList(storage, blocked)
    },
    unblock(customId: string): void {
      const blocked = readBlockedList(storage)
      const next = blocked.filter((id) => id !== customId)
      if (next.length === blocked.length) return
      writeBlockedList(storage, next)
    },
    listBlocked(): string[] {
      return readBlockedList(storage)
    },
    isSafeModeUrl,
    dispose(): void {
      if (pageHideHandler && typeof window !== 'undefined') {
        window.removeEventListener('pagehide', pageHideHandler)
        pageHideHandler = undefined
      }
    },
  }

  if (
    options.registerPageHide !== false &&
    typeof window !== 'undefined' &&
    typeof window.addEventListener === 'function'
  ) {
    pageHideHandler = (): void => {
      mode.clearPending()
    }
    window.addEventListener('pagehide', pageHideHandler)
  }

  return mode
}

/** 浏览器环境的默认单例；页面卸载时清除 pending 标记。 */
export const safeMode: SafeMode = createSafeMode()
