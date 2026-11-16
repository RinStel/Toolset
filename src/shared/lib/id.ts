/** Generates an RFC 4122 version 4 UUID (crypto.randomUUID when available). */
export function uuid(): string {
  const cryptoApi = typeof crypto === 'undefined' ? undefined : crypto
  if (typeof cryptoApi?.randomUUID === 'function') return cryptoApi.randomUUID()

  const bytes = new Uint8Array(16)
  if (typeof cryptoApi?.getRandomValues === 'function') {
    cryptoApi.getRandomValues(bytes)
  } else {
    for (let index = 0; index < bytes.length; index += 1) {
      bytes[index] = Math.floor(Math.random() * 256)
    }
  }
  // Set version (4) and variant (10xx) bits.
  const versionByte = bytes[6] ?? 0
  bytes[6] = (versionByte & 0x0f) | 0x40
  const variantByte = bytes[8] ?? 0
  bytes[8] = (variantByte & 0x3f) | 0x80

  const hex = [...bytes].map((byte) => byte.toString(16).padStart(2, '0')).join('')
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
}

/**
 * Creates an incrementing id generator, e.g. `createIdSequence('s')` produces
 * `s1`, `s2`, … for session ids.
 */
export function createIdSequence(prefix = ''): () => string {
  let next = 1
  return () => {
    const id = `${prefix}${next}`
    next += 1
    return id
  }
}
