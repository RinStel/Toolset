/**
 * Structured storage problem reporting.
 *
 * The storage layer lives in `shared/lib` and must not import UI code, so it never
 * shows a toast itself. It reports a structured issue and lets the app shell decide
 * the wording (see plan §6.3).
 */

export type StorageIssueKind = 'corrupt' | 'quota' | 'idb'

export interface StorageIssue {
  kind: StorageIssueKind
  /** Storage key (or kv namespace) that triggered the issue. */
  key: string
  /** Machine readable reason, e.g. `parse`, `version`, `migrate`, `open`, `write`. */
  reason?: string
}

export type StorageIssueHandler = (issue: StorageIssue) => void

let handler: StorageIssueHandler | null = null

/**
 * Registers the global storage issue handler. `main.ts` calls this once to map
 * issues to toasts; returns a function that removes the handler again.
 */
export function onStorageIssue(next: StorageIssueHandler): () => void {
  handler = next
  return () => {
    if (handler === next) handler = null
  }
}

/** @internal Reports an issue to the registered handler (no-op when unset). */
export function reportStorageIssue(issue: StorageIssue): void {
  handler?.(issue)
}
