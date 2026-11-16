// Type-only import that also pulls the Web Serial global augmentation into every
// program that imports this module.
import type { Serial } from './web-serial'

/** Returns the Web Serial API, or `undefined` when it is not exposed. */
function serialApi(): Serial | undefined {
  if (typeof navigator === 'undefined') return undefined
  return navigator.serial
}

/** True when the page runs in a secure context (required by Web Serial). */
export function isSecureContext(): boolean {
  if (typeof window === 'undefined') return false
  if (window.isSecureContext === true) return true
  const location = window.location
  if (!location) return false
  if (location.protocol === 'https:') return true
  const hostname = location.hostname
  return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '[::1]'
}

/** True when `navigator.serial` exists with the methods used by the serial transport. */
export function hasWebSerial(): boolean {
  const serial = serialApi()
  return typeof serial?.requestPort === 'function' && typeof serial.getPorts === 'function'
}

/**
 * Why Web Serial is unavailable, or `null` when it is usable. The UI turns this
 * into a localized hint instead of showing a generic "not supported".
 */
export function webSerialSupport():
  { ok: true } | { ok: false; reason: 'insecure' | 'unsupported' } {
  if (!isSecureContext()) return { ok: false, reason: 'insecure' }
  if (!hasWebSerial()) return { ok: false, reason: 'unsupported' }
  return { ok: true }
}
