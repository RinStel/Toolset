/**
 * 浏览器端专用字体检测、公共云字体自动加载与本地字体文件加载（FontFace API）。
 */

import { REQUIRED_FONTS, type RequiredFontSpec } from './seal-themes'

export type FontSourceKind = 'local' | 'cloud' | 'system' | 'missing'

export interface FontCheckItem extends RequiredFontSpec {
  available: boolean
  loadedFromLocal: boolean
  loadedFromCloud: boolean
  sourceKind: FontSourceKind
}

interface LoadedFontEntry {
  cssFamily: string
  weight: string
  dataUrl: string
}

interface CloudWoff2Fallback {
  cssFamily: string
  weight: string
  url: string
}

const CLOUD_FONT_STYLESHEETS: readonly string[] = [
  'https://cdn.jsdelivr.net/npm/lxgw-wenkai-webfont@1.7.0/style.css',
  'https://fonts.bunny.net/css?family=ibm-plex-mono:600,700|space-grotesk:700&display=swap',
  'https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@600;700&family=Space+Grotesk:wght@700&display=swap',
]

const CLOUD_WOFF2_FALLBACKS: readonly CloudWoff2Fallback[] = [
  {
    cssFamily: 'Space Grotesk',
    weight: '700',
    url: 'https://cdn.jsdelivr.net/npm/@fontsource/space-grotesk@5/files/space-grotesk-latin-700-normal.woff2',
  },
  {
    cssFamily: 'IBM Plex Mono',
    weight: '700',
    url: 'https://cdn.jsdelivr.net/npm/@fontsource/ibm-plex-mono@5/files/ibm-plex-mono-latin-700-normal.woff2',
  },
  {
    cssFamily: 'IBM Plex Mono',
    weight: '600',
    url: 'https://cdn.jsdelivr.net/npm/@fontsource/ibm-plex-mono@5/files/ibm-plex-mono-latin-600-normal.woff2',
  },
]

const CLOUD_FETCH_TIMEOUT_MS = 4500

const localLoadedFamilies = new Set<string>()
const cloudLoadedFamilies = new Set<string>()
const loadedFontEntries: LoadedFontEntry[] = []

let activeCloudLoadPromise: Promise<FontCheckItem[]> | null = null

function isTestDomRuntime(): boolean {
  if (typeof window === 'undefined' || typeof document === 'undefined') return true
  if (typeof FontFace === 'undefined' || !('fonts' in document)) return true
  if ('happyDOM' in window) return true
  const ua = typeof navigator !== 'undefined' ? navigator.userAgent : ''
  return /HappyDOM|jsdom/i.test(ua)
}

function bufferToDataUrl(buffer: ArrayBuffer, mimeHint: string): string {
  const bytes = new Uint8Array(buffer)
  let binary = ''
  const chunkSize = 0x8000
  for (let i = 0; i < bytes.length; i += chunkSize) {
    const chunk = bytes.subarray(i, i + chunkSize)
    binary += String.fromCharCode(...chunk)
  }
  const base64 = btoa(binary)
  const lower = mimeHint.toLowerCase()
  const mime = lower.endsWith('.otf')
    ? 'font/otf'
    : lower.endsWith('.woff2')
      ? 'font/woff2'
      : 'font/ttf'
  return `data:${mime};base64,${base64}`
}

/** 生成已加载字体二进制的 `@font-face` CSS（供矢量打印 iframe 内联复用）。 */
export function getLoadedFontCss(): string {
  return loadedFontEntries
    .map(
      (entry) =>
        `@font-face{font-family:"${entry.cssFamily}";src:url("${entry.dataUrl}");font-weight:${entry.weight};font-style:normal;}`,
    )
    .join('\n')
}

/** 生成供打印文档使用的完整字体样式（云端样式表 `<link>` + 内联 `@font-face`）。 */
export function getPrintFontStylesHtml(): string {
  const links = CLOUD_FONT_STYLESHEETS.map(
    (href) => `<link rel="stylesheet" crossorigin="anonymous" href="${href}" />`,
  ).join('\n')
  const inlineCss = getLoadedFontCss()
  const styleBlock = inlineCss ? `\n<style>${inlineCss}</style>` : ''
  return `${links}${styleBlock}`
}

function isFontLoadedInDocument(family: string): boolean {
  if (typeof document === 'undefined' || !('fonts' in document)) return false
  const fontSet = document.fonts
  try {
    for (const face of fontSet) {
      const normalized = face.family.replace(/['"]/g, '').trim().toLowerCase()
      if (normalized === family.toLowerCase() && face.status === 'loaded') {
        return true
      }
    }
    if (typeof fontSet.check === 'function' && fontSet.check(`16px "${family}"`)) {
      return measureFontAvailable(family)
    }
  } catch {
    return false
  }
  return measureFontAvailable(family)
}

function measureFontAvailable(family: string): boolean {
  if (typeof document === 'undefined') return false
  try {
    const canvas = document.createElement('canvas')
    const ctx = canvas.getContext('2d')
    if (!ctx) return false
    const testText = 'RinStel 封箱证明 M3YC-QDWE-84H 0123456789'
    ctx.font = '24px monospace'
    const baseMono = ctx.measureText(testText).width
    ctx.font = '24px sans-serif'
    const baseSans = ctx.measureText(testText).width

    ctx.font = `24px "${family}", monospace`
    const testMono = ctx.measureText(testText).width
    ctx.font = `24px "${family}", sans-serif`
    const testSans = ctx.measureText(testText).width

    return Math.abs(testMono - baseMono) > 0.1 || Math.abs(testSans - baseSans) > 0.1
  } catch {
    return false
  }
}

export function checkRequiredFonts(): FontCheckItem[] {
  return REQUIRED_FONTS.map((spec) => {
    const fromLocal = localLoadedFamilies.has(spec.cssFamily)
    const fromCloud = !fromLocal && cloudLoadedFamilies.has(spec.cssFamily)
    const inDoc = isFontLoadedInDocument(spec.cssFamily)
    const available = fromLocal || fromCloud || inDoc
    const sourceKind: FontSourceKind = fromLocal
      ? 'local'
      : fromCloud
        ? 'cloud'
        : inDoc
          ? 'system'
          : 'missing'
    return {
      ...spec,
      available,
      loadedFromLocal: fromLocal,
      loadedFromCloud: fromCloud,
      sourceKind,
    }
  })
}

function injectCloudStylesheet(href: string): Promise<void> {
  if (typeof document === 'undefined' || !document.head) return Promise.resolve()
  const existing = Array.from(
    document.head.querySelectorAll<HTMLLinkElement>('link[data-seal-cloud-font]'),
  ).find((link) => link.href === href)
  if (existing) {
    return Promise.resolve()
  }

  return new Promise<void>((resolve) => {
    const link = document.createElement('link')
    link.rel = 'stylesheet'
    link.href = href
    link.crossOrigin = 'anonymous'
    link.dataset.sealCloudFont = '1'

    let settled = false
    const done = (): void => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      resolve()
    }
    const timer = setTimeout(done, CLOUD_FETCH_TIMEOUT_MS)
    link.addEventListener('load', done, { once: true })
    link.addEventListener('error', done, { once: true })
    document.head.append(link)
  })
}

async function triggerFontsForText(sampleChars: string): Promise<void> {
  if (typeof document === 'undefined' || !('fonts' in document)) return
  const fontSet = document.fonts
  if (typeof fontSet.load !== 'function') return

  const tasks: Promise<unknown>[] = [
    fontSet.load('700 16px "Space Grotesk"', `RinStel${sampleChars}`),
    fontSet.load('600 16px "IBM Plex Mono"', 'SEAL ID SCAN SIG'),
    fontSet.load('700 16px "IBM Plex Mono"', 'M3YC-QDWE-84H0123456789ABCDEFGHJKLMNPQRSTUVWXYZ#·'),
    fontSet.load('400 16px "LXGW WenKai"', `封箱证明${sampleChars}`),
    fontSet.load('700 16px "LXGW WenKai"', `封箱证明${sampleChars}`),
  ]

  await Promise.allSettled(tasks)
}

async function fetchWoff2FontFace(entry: CloudWoff2Fallback): Promise<boolean> {
  if (typeof fetch !== 'function' || typeof FontFace === 'undefined') return false
  const controller = typeof AbortController !== 'undefined' ? new AbortController() : null
  const timer = controller ? setTimeout(() => controller.abort(), CLOUD_FETCH_TIMEOUT_MS) : null

  try {
    const response = await fetch(entry.url, {
      mode: 'cors',
      signal: controller?.signal,
    })
    if (!response.ok) return false
    const buffer = await response.arrayBuffer()
    const face = new FontFace(entry.cssFamily, buffer, {
      weight: entry.weight,
      style: 'normal',
    })
    const loadedFace = await face.load()
    document.fonts.add(loadedFace)
    loadedFontEntries.push({
      cssFamily: entry.cssFamily,
      weight: entry.weight,
      dataUrl: bufferToDataUrl(buffer, entry.url),
    })
    return true
  } catch {
    return false
  } finally {
    if (timer !== null) clearTimeout(timer)
  }
}

function markLoadedCloudFamilies(): void {
  if (typeof document === 'undefined' || !('fonts' in document)) return
  for (const spec of REQUIRED_FONTS) {
    if (localLoadedFamilies.has(spec.cssFamily)) continue
    for (const face of document.fonts) {
      const normalized = face.family.replace(/['"]/g, '').trim().toLowerCase()
      if (normalized === spec.cssFamily.toLowerCase() && face.status === 'loaded') {
        cloudLoadedFamilies.add(spec.cssFamily)
        break
      }
    }
  }
}

/**
 * 尝试从公共云（jsDelivr / Bunny Fonts / Google Fonts）加载三款专用字体。
 *
 * 在离线、受限沙箱或测试 DOM 环境下安全降级，不抛出未捕获异常。
 */
export async function loadCloudFonts(extraSampleText = ''): Promise<FontCheckItem[]> {
  if (isTestDomRuntime()) {
    return checkRequiredFonts()
  }
  if (activeCloudLoadPromise) {
    return activeCloudLoadPromise
  }

  activeCloudLoadPromise = (async () => {
    try {
      await Promise.allSettled(CLOUD_FONT_STYLESHEETS.map((href) => injectCloudStylesheet(href)))
      await triggerFontsForText(extraSampleText)
      markLoadedCloudFamilies()

      // 若样式表尚未激活某些拉丁 WOFF2 字体，回退直连 @fontsource WOFF2 文件
      const missingFallbacks = CLOUD_WOFF2_FALLBACKS.filter(
        (item) =>
          !localLoadedFamilies.has(item.cssFamily) && !cloudLoadedFamilies.has(item.cssFamily),
      )
      if (missingFallbacks.length > 0) {
        const results = await Promise.allSettled(
          missingFallbacks.map((item) => fetchWoff2FontFace(item)),
        )
        results.forEach((res, idx) => {
          if (res.status === 'fulfilled' && res.value) {
            const target = missingFallbacks[idx]
            if (target) cloudLoadedFamilies.add(target.cssFamily)
          }
        })
      }
    } catch {
      // 网络失败时静默降级为当前检测状态
    } finally {
      activeCloudLoadPromise = null
    }
    return checkRequiredFonts()
  })()

  return activeCloudLoadPromise
}

function inferTargetFamily(fileName: string): RequiredFontSpec | null {
  const normalized = fileName.toLowerCase().replace(/[\s_-]+/g, '')
  for (const spec of REQUIRED_FONTS) {
    if (normalized.includes(spec.keyword)) return spec
  }
  return null
}

function inferWeight(fileName: string): string {
  const lower = fileName.toLowerCase()
  if (lower.includes('bold') || lower.includes('700')) return '700'
  if (lower.includes('semibold') || lower.includes('600')) return '600'
  if (lower.includes('medium') || lower.includes('500')) return '500'
  return '400'
}

export interface LoadFontsResult {
  loaded: string[]
  errors: string[]
}

/**
 * 读取用户选择的本地字体文件并通过 FontFace API 注册到当前页面 `document.fonts`。
 */
export async function loadLocalFontFiles(
  files: FileList | readonly File[],
): Promise<LoadFontsResult> {
  const loaded: string[] = []
  const errors: string[] = []

  if (
    typeof FontFace === 'undefined' ||
    typeof document === 'undefined' ||
    !('fonts' in document)
  ) {
    return {
      loaded,
      errors: ['当前运行环境不支持浏览器 FontFace API。'],
    }
  }

  for (const file of Array.from(files)) {
    const spec = inferTargetFamily(file.name)
    if (!spec) {
      errors.push(
        `未能从文件名识别专用字体归属：${file.name}（文件名需包含 SpaceGrotesk / LXGWWenKai / IBMPlexMono）`,
      )
      continue
    }
    try {
      const buffer = await file.arrayBuffer()
      const weight = inferWeight(file.name)
      const face = new FontFace(spec.cssFamily, buffer, { weight, style: 'normal' })
      const loadedFace = await face.load()
      document.fonts.add(loadedFace)
      localLoadedFamilies.add(spec.cssFamily)
      loadedFontEntries.push({
        cssFamily: spec.cssFamily,
        weight,
        dataUrl: bufferToDataUrl(buffer, file.name),
      })
      loaded.push(`${spec.name} (${file.name})`)
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error)
      errors.push(`加载 ${file.name} 失败：${reason}`)
    }
  }

  return { loaded, errors }
}
