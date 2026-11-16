const BYTE_UNITS = ['B', 'KB', 'MB', 'GB', 'TB'] as const

function pad(value: number, length = 2): string {
  return String(value).padStart(length, '0')
}

/**
 * Formats a timestamp as `HH:mm:ss.SSS` for the log view.
 *
 * @param value Date, epoch milliseconds or nothing (current time).
 */
export function formatTimestamp(value: Date | number = Date.now()): string {
  const date = typeof value === 'number' ? new Date(value) : value
  return `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}.${pad(
    date.getMilliseconds(),
    3,
  )}`
}

/**
 * Formats a byte count using binary units, e.g. `0 B`, `512 B`, `1.5 KB`, `12 MB`.
 */
export function formatBytes(bytes: number, fractionDigits = 1): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B'
  const base = 1024
  let value = bytes
  let unitIndex = 0
  while (value >= base && unitIndex < BYTE_UNITS.length - 1) {
    value /= base
    unitIndex += 1
  }
  const unit = BYTE_UNITS[unitIndex] ?? 'B'
  if (unitIndex === 0) return `${Math.round(value)} B`
  const rounded = Number(value.toFixed(fractionDigits))
  return `${rounded} ${unit}`
}

/** Formats a duration in milliseconds for status bars, e.g. `12 ms`, `1.4 s`. */
export function formatDuration(milliseconds: number): string {
  if (!Number.isFinite(milliseconds) || milliseconds < 0) return '0 ms'
  if (milliseconds < 1000) return `${Math.round(milliseconds)} ms`
  return `${(milliseconds / 1000).toFixed(1)} s`
}
