/**
 * Browser download helpers shared by log export and preset export.
 * The functions are no-ops outside a DOM environment so pure logic stays testable.
 */
function triggerDownload(url: string, filename: string, revokeDelayMs = 0): void {
  if (typeof document === 'undefined' || !document.body) return
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  anchor.rel = 'noopener'
  anchor.style.display = 'none'
  document.body.append(anchor)
  anchor.click()
  anchor.remove()
  if (revokeDelayMs > 0) {
    setTimeout(() => {
      URL.revokeObjectURL(url)
    }, revokeDelayMs)
  }
}

function createObjectUrl(blob: Blob): string | null {
  if (typeof URL === 'undefined' || typeof URL.createObjectURL !== 'function') return null
  return URL.createObjectURL(blob)
}

/** Downloads a `Blob` using a temporary object URL. */
export function downloadBlob(blob: Blob, filename: string): void {
  const url = createObjectUrl(blob)
  if (!url) return
  triggerDownload(url, filename, 1000)
}

/** Downloads UTF-8 text. */
export function downloadText(
  text: string,
  filename: string,
  mimeType = 'text/plain;charset=utf-8',
): void {
  downloadBlob(new Blob([text], { type: mimeType }), filename)
}

/** Downloads raw bytes. */
export function downloadBytes(
  bytes: Uint8Array,
  filename: string,
  mimeType = 'application/octet-stream',
): void {
  const copy = new Uint8Array(bytes)
  downloadBlob(new Blob([copy.buffer], { type: mimeType }), filename)
}
