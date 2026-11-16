/**
 * 商品封箱条核心生成器与核验器。
 *
 * 与 `tmp/create_rinstel_anti_fake_card.py` 保持算法与 SVG 几何坐标完全一致：
 * - 56×34mm 单张尺寸 / 210×297mm A4 三列七行二十一联排版
 * - SHA-256 校验码（CHK）与 16 位微缩摘要
 * - BLAKE2s（digestSize=3）6 位独立签名短码（SIG）
 * - SHA-256 4×4 抗视频压缩视觉指纹块（含稀疏度钳制）
 * - 种子驱动的 5 层专属波浪底纹（guilloche）
 * - QR Code（Level M）+ 骑缝对齐刻度与右下斜切引导线
 */

import {
  A4_COLS,
  A4_H,
  A4_ROWS,
  A4_TOTAL,
  A4_W,
  ALPHA,
  CARD_H,
  CARD_W,
  getSealStylePreset,
  type SealStyleId,
} from './seal-themes'
import { blake2sHex, PyRandom, sha256Bytes, sha256Hex } from './crypto'
import { generateQrMatrix } from './qrcode'

export interface CardRenderOptions {
  brand?: string
  cnTitle?: string
  styleId?: SealStyleId
}

export interface CardRecord {
  seq: number
  code: string
  chk: [string, string, string]
  chkText: string
  token16: string
  sig6: string
  qrPayload: string
  matrixCells: boolean[][]
}

export interface VerifySealResult {
  validFormat: boolean
  inputKind: 'code' | 'qr' | 'invalid'
  rawInput: string
  code: string
  expectedChk: string
  providedChk: string | null
  chkMatched: boolean | null
  token16: string
  sig6: string
  qrPayload: string
  matrixCells: boolean[][]
  errorMessage: string | null
}

function escapeXml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;')
}

function randomAlphaChar(): string {
  const len = ALPHA.length
  const cryptoObj = globalThis.crypto
  if (cryptoObj && typeof cryptoObj.getRandomValues === 'function') {
    const maxValid = Math.floor(0x100000000 / len) * len
    const buf = new Uint32Array(1)
    while (true) {
      cryptoObj.getRandomValues(buf)
      const val = buf[0] ?? 0
      if (val < maxValid) return ALPHA.charAt(val % len)
    }
  }
  return ALPHA.charAt(Math.floor(Math.random() * len))
}

/**
 * 生成 11 位主封箱编号（`XXXX-XXXX-XXX`）。
 */
export function randCode(rng?: Pick<PyRandom, 'choice'>): string {
  let raw = ''
  for (let i = 0; i < 11; i += 1) {
    raw += rng ? rng.choice(ALPHA) : randomAlphaChar()
  }
  return `${raw.slice(0, 4)}-${raw.slice(4, 8)}-${raw.slice(8)}`
}

/**
 * 规范化用户输入的封箱编号（允许忽略大小写、连字符与空格）。
 */
export function normalizeSealCode(raw: string): string | null {
  const compact = raw
    .trim()
    .toUpperCase()
    .replace(/[\s-]+/g, '')
  if (compact.length !== 11) return null
  for (let i = 0; i < compact.length; i += 1) {
    if (!ALPHA.includes(compact.charAt(i))) return null
  }
  return `${compact.slice(0, 4)}-${compact.slice(4, 8)}-${compact.slice(8)}`
}

/**
 * 计算 3 段式 SHA-256 校验码（`XX-XXXX-XXXX`）。
 */
export function checksum(code: string): [string, string, string] {
  const h = sha256Hex(`RINSTEL-SEAL-PROOF|${code}`)
  return [h.slice(0, 2), h.slice(2, 6), h.slice(6, 10)]
}

/**
 * 派生 16 位微缩摘要串与 6 位 BLAKE2s 独立签名短码。
 */
export function derivedTokens(code: string): [string, string] {
  const token16 = sha256Hex(`RINSTEL-MICRO|${code}`).slice(0, 16)
  const sig6 = blake2sHex(`RINSTEL-SIG|${code}`, 3)
  return [token16, sig6]
}

/**
 * 计算抗视频压缩 4×4 视觉指纹块位图（确保黑格数在 4–12 之间）。
 */
export function visualMatrixBits(code: string): { bits: number; cells: boolean[][] } {
  const digest = sha256Bytes(`RINSTEL-GRID|${code}`)
  let bits = ((digest[0] ?? 0) << 8) | (digest[1] ?? 0)

  let pop = 0
  for (let i = 0; i < 16; i += 1) {
    if ((bits >> i) & 1) pop += 1
  }
  if (pop < 4) {
    bits |= 0b1010010110100101
  } else if (pop > 12) {
    bits &= 0b1101101001011010
  }

  const cells: boolean[][] = []
  for (let r = 0; r < 4; r += 1) {
    const row: boolean[] = []
    for (let c = 0; c < 4; c += 1) {
      const idx = r * 4 + c
      row.push(((bits >> idx) & 1) === 1)
    }
    cells.push(row)
  }

  return { bits, cells }
}

export function buildCardRecord(code: string, seq: number): CardRecord {
  const chk = checksum(code)
  const chkText = `${chk[0]}-${chk[1]}-${chk[2]}`
  const [token16, sig6] = derivedTokens(code)
  const { cells } = visualMatrixBits(code)
  const qrPayload = `RINSTEL-SEAL|${code}|${chkText}`
  return {
    seq,
    code,
    chk,
    chkText,
    token16,
    sig6,
    qrPayload,
    matrixCells: cells,
  }
}

export function generateCardBatch(
  options: {
    seed?: number | null
    startSeq?: number
    count?: number
  } = {},
): CardRecord[] {
  const count = options.count ?? A4_TOTAL
  const startSeq = options.startSeq ?? 1
  const rng =
    options.seed !== null && options.seed !== undefined && Number.isFinite(options.seed)
      ? new PyRandom(Math.trunc(options.seed))
      : undefined
  const cards: CardRecord[] = []
  for (let i = 0; i < count; i += 1) {
    cards.push(buildCardRecord(randCode(rng), startSeq + i))
  }
  return cards
}

export function visualMatrix4x4Svg(
  code: string,
  x: number,
  y: number,
  size: number,
  ink = '#000000',
  paper = '#ffffff',
): string {
  const { cells } = visualMatrixBits(code)
  const pad = 0.4
  const inner = size - 2 * pad
  const cell = inner / 4.0
  const rects: string[] = [
    `<rect x="${x.toFixed(2)}" y="${y.toFixed(2)}" width="${size.toFixed(2)}" height="${size.toFixed(2)}" ` +
      `fill="${paper}" stroke="${ink}" stroke-width="0.22" rx="0.3"/>`,
  ]
  for (let r = 0; r < 4; r += 1) {
    for (let c = 0; c < 4; c += 1) {
      if (cells[r]?.[c]) {
        const rx = x + pad + c * cell
        const ry = y + pad + r * cell
        rects.push(
          `<rect x="${rx.toFixed(3)}" y="${ry.toFixed(3)}" width="${cell.toFixed(3)}" height="${cell.toFixed(3)}" fill="${ink}"/>`,
        )
      }
    }
  }
  return `<g>${rects.join('')}</g>`
}

export function qrGroupSvg(
  code: string,
  x: number,
  y: number,
  size: number,
  ink = '#000000',
): string {
  const [c1, c2, c3] = checksum(code)
  const data = `RINSTEL-SEAL|${code}|${c1}-${c2}-${c3}`
  const m = generateQrMatrix(data, 1)
  const d = size / m.length
  const parts: string[] = []

  for (let j = 0; j < m.length; j += 1) {
    const row = m[j]!
    let run: number | null = null
    for (let i = 0; i <= row.length; i += 1) {
      const val = i < row.length ? (row[i] ?? false) : false
      if (val && run === null) {
        run = i
      }
      if (run !== null && !val) {
        const w = (i - run) * d
        parts.push(
          `M${(x + run * d).toFixed(4)},${(y + j * d).toFixed(4)}h${w.toFixed(4)}v${d.toFixed(4)}h-${w.toFixed(4)}z`,
        )
        run = null
      }
    }
  }
  return `<g><path d="${parts.join(' ')}" fill="${ink}"/></g>`
}

export function guillocheSvg(
  code: string,
  x: number,
  y: number,
  w: number,
  h: number,
  ink = '#000000',
  paper = '#ffffff',
): string {
  const seed = Number.parseInt(sha256Hex(`GUILLOCHE|${code}`).slice(0, 8), 16)
  const rng = new PyRandom(seed)
  const layers: string[] = [
    `<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="${paper}" stroke="${ink}" stroke-width="0.18" rx="0.35"/>`,
  ]
  const rows = 5
  const tau = Math.PI * 2
  for (let row = 0; row < rows; row += 1) {
    const pts: string[] = []
    const f1 = 1.4 + rng.random() * 1.1
    const f2 = 3.0 + rng.random() * 2.0
    const a1 = 0.18 + rng.random() * 0.06
    const a2 = 0.04 + rng.random() * 0.04
    const ph1 = rng.random() * tau
    const ph2 = rng.random() * tau
    const base = y + 0.78 + (row * (h - 1.56)) / (rows - 1)
    for (let i = 0; i < 120; i += 1) {
      const t = i / 119
      const yy = base + a1 * Math.sin(tau * f1 * t + ph1) + a2 * Math.sin(tau * f2 * t + ph2)
      const xx = x + 0.45 + t * (w - 0.9)
      pts.push(`${xx.toFixed(3)},${yy.toFixed(3)}`)
    }
    layers.push(
      `<polyline points="${pts.join(' ')}" fill="none" stroke="${ink}" stroke-width="0.14"/>`,
    )
  }
  return `<g>${layers.join('')}</g>`
}

export function edgeAnchorsSvg(ink = '#000000'): string {
  return `<g>
      <line x1="28.0" y1="0.0" x2="28.0" y2="1.3" stroke="${ink}" stroke-width="0.28"/>
      <line x1="28.0" y1="${CARD_H - 1.3}" x2="28.0" y2="${CARD_H}" stroke="${ink}" stroke-width="0.28"/>
      <line x1="0.0" y1="17.0" x2="1.3" y2="17.0" stroke="${ink}" stroke-width="0.28"/>
      <line x1="${CARD_W - 1.3}" y1="17.0" x2="${CARD_W}" y2="17.0" stroke="${ink}" stroke-width="0.28"/>
      <line x1="${CARD_W - 4.0}" y1="${CARD_H - 0.8}" x2="${CARD_W - 0.8}" y2="${CARD_H - 4.0}"
            stroke="${ink}" stroke-width="0.22" stroke-dasharray="0.7 0.5"/>
    </g>`
}

/**
 * 生成单张 56×34mm 防掉包封箱证明卡 SVG 字符串。
 */
export function makeCardSvg(code: string, seq: number, options: CardRenderOptions = {}): string {
  const style = getSealStylePreset(options.styleId)
  const ink = style.ink
  const paper = style.paper
  const headerBg = style.headerBg
  const headerText = style.headerText
  const brand = escapeXml((options.brand ?? 'RinStel').trim() || 'RinStel')
  const cnTitle = escapeXml((options.cnTitle ?? '封箱证明').trim() || '封箱证明')

  const [c1, c2, c3] = checksum(code)
  const [token16, sig6] = derivedTokens(code)
  const seqLabel = `#${String(seq).padStart(2, '0')}`

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${CARD_W}mm" height="${CARD_H}mm" viewBox="0 0 ${CARD_W} ${CARD_H}">
  <defs>
    <style>
      /* 严格指定三款专用字体，移除所有通用回退字体 */
      .seal-brand-font{fill:${ink};font-family:"Space Grotesk";}
      .seal-cn-font{fill:${ink};font-family:"LXGW WenKai";}
      .seal-mono{fill:${ink};font-family:"IBM Plex Mono";}

      .seal-brand{font-size:3.15px;font-weight:700;letter-spacing:0.35px;}
      .seal-cn-title{font-size:2.10px;font-weight:700;letter-spacing:0.45px;}
      .seal-light{fill:${headerText} !important;}
      .seal-tag{font-size:1.65px;font-weight:700;letter-spacing:0.25px;}
      .seal-tiny{font-size:1.5px;font-weight:600;letter-spacing:0.12px;}
      .seal-code{font-size:3.80px;font-weight:700;letter-spacing:0.08px;}
      .seal-subcode{font-size:1.72px;font-weight:700;letter-spacing:0.12px;}
      .seal-micro{font-size:1.30px;font-weight:700;letter-spacing:0.14px;}
      .seal-form{stroke:${ink};stroke-width:0.24;fill:none;}
    </style>
  </defs>

  <!-- 外框 -->
  <rect x="0" y="0" width="${CARD_W}" height="${CARD_H}" fill="${paper}"/>
  <rect x="0.8" y="0.8" width="${CARD_W - 1.6}" height="${CARD_H - 1.6}" rx="0.6" fill="${paper}" stroke="${ink}" stroke-width="0.32"/>

  <!-- 顶部品牌栏：RinStel · 封箱证明 · 序号 -->
  <rect x="1.4" y="1.4" width="${CARD_W - 2.8}" height="5.2" fill="${headerBg}"/>
  <text x="2.8" y="4.95" class="seal-brand-font seal-brand seal-light">${brand}</text>
  <text x="29.5" y="4.75" class="seal-cn-font seal-cn-title seal-light" text-anchor="middle">${cnTitle}</text>
  <text x="${CARD_W - 2.8}" y="4.85" class="seal-mono seal-tag seal-light" text-anchor="end">${seqLabel}</text>

  <!-- 左侧上栏：主封箱编号 -->
  <text x="2.6" y="9.4" class="seal-mono seal-tiny">SEAL ID</text>
  <text x="2.6" y="14.3" class="seal-mono seal-code">${escapeXml(code)}</text>
  <line x1="2.6" y1="15.8" x2="35.0" y2="15.8" class="seal-form"/>

  <!-- 左侧中栏：校验码 + 派生摘要（左） & 抗视频压缩 4x4 视觉指纹块（右） -->
  <text x="2.6" y="18.9" class="seal-mono seal-subcode">CHK ${c1}-${c2}-${c3}</text>
  <rect x="2.6" y="20.6" width="23.8" height="3.2" fill="${paper}" stroke="${ink}" stroke-width="0.18" rx="0.25"/>
  <text x="14.5" y="22.65" class="seal-mono seal-micro" text-anchor="middle">${token16}</text>

  ${visualMatrix4x4Svg(code, 28.0, 17.0, 6.8, ink, paper)}

  <!-- 左侧下栏：专属波浪底纹 -->
  ${guillocheSvg(code, 2.6, 25.0, 32.4, 6.2, ink, paper)}

  <!-- 右侧栏：二维码 + 独立签名短码 -->
  <rect x="36.8" y="8.0" width="16.6" height="16.6" fill="${paper}" stroke="${ink}" stroke-width="0.22"/>
  ${qrGroupSvg(code, 37.5, 8.7, 15.2, ink)}

  <text x="45.1" y="27.3" class="seal-mono seal-tiny" text-anchor="middle">SCAN</text>
  <text x="45.1" y="29.9" class="seal-mono seal-tiny" text-anchor="middle">SIG · ${sig6}</text>

  <!-- 骑缝对齐刻度与斜切引导线 -->
  ${edgeAnchorsSvg(ink)}
</svg>`
}

export const A4_GAP_X = 6.0
export const A4_GAP_Y = 5.0
export const A4_MARGIN_X = (A4_W - (A4_COLS * CARD_W + (A4_COLS - 1) * A4_GAP_X)) / 2
export const A4_MARGIN_Y = 12.0

/**
 * 生成 A4 二十一联排版印刷 SVG（3 列 × 7 行，带四角裁切线）。
 */
export function makeA4SheetSvg(
  cards: ReadonlyArray<Pick<CardRecord, 'code' | 'seq'>>,
  options: CardRenderOptions = {},
): string {
  const style = getSealStylePreset(options.styleId)
  const ink = style.ink
  const paper = style.paper
  const brand = escapeXml((options.brand ?? 'RinStel').trim() || 'RinStel')
  const cnTitle = escapeXml((options.cnTitle ?? '封箱证明').trim() || '封箱证明')

  const sheet: string[] = [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${A4_W}mm" height="${A4_H}mm" viewBox="0 0 ${A4_W} ${A4_H}">`,
    `<rect width="100%" height="100%" fill="${paper}"/>`,
    `<style>@page{size:A4 portrait;margin:0;}.seal-crop{stroke:${ink};stroke-width:0.18}.seal-lbl{font-size:2.4px;font-family:"LXGW WenKai","IBM Plex Mono";fill:${ink}}</style>`,
  ]

  const count = Math.min(cards.length, A4_TOTAL)
  for (let idx = 0; idx < count; idx += 1) {
    const item = cards[idx]!
    const col = idx % A4_COLS
    const row = Math.floor(idx / A4_COLS)
    const x = A4_MARGIN_X + col * (CARD_W + A4_GAP_X)
    const y = A4_MARGIN_Y + row * (CARD_H + A4_GAP_Y)

    const inner = makeCardSvg(item.code, item.seq, options)
    const innerStart = inner.indexOf('>') + 1
    const innerEnd = inner.lastIndexOf('</svg>')
    const innerBody = inner.slice(innerStart, innerEnd)
    sheet.push(`<g transform="translate(${x},${y})">${innerBody}</g>`)

    const l = x
    const t = y
    const r = x + CARD_W
    const b = y + CARD_H
    const m = 2.2
    const gap = 0.6
    sheet.push(
      `<path d="M${l - m},${t}H${l - gap} M${l},${t - m}V${t - gap} ` +
        `M${r + m},${t}H${r + gap} M${r},${t - m}V${t - gap} ` +
        `M${l - m},${b}H${l - gap} M${l},${b + m}V${b + gap} ` +
        `M${r + m},${b}H${r + gap} M${r},${b + m}V${b + gap}" class="seal-crop"/>`,
    )
  }

  sheet.push(
    `<text x="${A4_MARGIN_X}" y="290" class="seal-lbl">` +
      `${brand} ${cnTitle} (56×34mm · ${A4_ROWS * A4_COLS}联) | 打印设置：A4 100%实际大小 / 关闭省墨模式 / 600DPI以上</text>`,
  )
  sheet.push('</svg>')
  return sheet.join('')
}

/**
 * 核验纯封箱编号或扫码得到的二维码文本。
 */
export function verifySealInput(rawInput: string): VerifySealResult {
  const trimmed = rawInput.trim()
  if (!trimmed) {
    return {
      validFormat: false,
      inputKind: 'invalid',
      rawInput,
      code: '',
      expectedChk: '',
      providedChk: null,
      chkMatched: null,
      token16: '',
      sig6: '',
      qrPayload: '',
      matrixCells: [],
      errorMessage: '请输入 11 位 SEAL ID 或完整的二维码扫描文本。',
    }
  }

  let inputKind: 'code' | 'qr' = 'code'
  let rawCode = trimmed
  let providedChk: string | null = null

  if (trimmed.toUpperCase().startsWith('RINSTEL-SEAL|')) {
    inputKind = 'qr'
    const parts = trimmed.split('|')
    if (parts.length < 3 || !parts[1] || !parts[2]) {
      return {
        validFormat: false,
        inputKind: 'invalid',
        rawInput,
        code: '',
        expectedChk: '',
        providedChk: null,
        chkMatched: null,
        token16: '',
        sig6: '',
        qrPayload: '',
        matrixCells: [],
        errorMessage: '二维码载荷格式无效，应为 RINSTEL-SEAL|XXXX-XXXX-XXX|XX-XXXX-XXXX。',
      }
    }
    rawCode = parts[1]
    providedChk = parts[2].trim().toUpperCase()
  }

  const normalizedCode = normalizeSealCode(rawCode)
  if (!normalizedCode) {
    return {
      validFormat: false,
      inputKind: 'invalid',
      rawInput,
      code: '',
      expectedChk: '',
      providedChk,
      chkMatched: null,
      token16: '',
      sig6: '',
      qrPayload: '',
      matrixCells: [],
      errorMessage: '封箱编号须为 11 位有效字符（已剔除易混淆字符 0 / O / 1 / I）。',
    }
  }

  const record = buildCardRecord(normalizedCode, 1)
  const chkMatched = providedChk === null ? null : providedChk === record.chkText

  return {
    validFormat: true,
    inputKind,
    rawInput,
    code: record.code,
    expectedChk: record.chkText,
    providedChk,
    chkMatched,
    token16: record.token16,
    sig6: record.sig6,
    qrPayload: record.qrPayload,
    matrixCells: record.matrixCells,
    errorMessage: null,
  }
}

/**
 * 导出当前批次 21 张封箱卡的核验台账 CSV（带 UTF-8 BOM）。
 */
export function cardsToCsv(
  cards: readonly CardRecord[],
  options: { brand?: string; cnTitle?: string } = {},
): string {
  const brand = (options.brand ?? 'RinStel').trim() || 'RinStel'
  const cnTitle = (options.cnTitle ?? '封箱证明').trim() || '封箱证明'
  const header = [
    '序号',
    '品牌',
    '标题',
    '封箱编号(SEAL ID)',
    '校验码(CHK)',
    '微缩摘要(16位)',
    '签名短码(SIG)',
    '二维码载荷',
  ]
  const rows = cards.map((card) =>
    [
      `#${String(card.seq).padStart(2, '0')}`,
      brand,
      cnTitle,
      card.code,
      card.chkText,
      card.token16,
      card.sig6,
      card.qrPayload,
    ]
      .map((cell) => `"${cell.replaceAll('"', '""')}"`)
      .join(','),
  )
  return `\uFEFF${header.join(',')}\n${rows.join('\n')}\n`
}
