import { describe, expect, it } from 'vitest'

import { A4_TOTAL, ALPHA } from '@/tools/seal-strip/core/seal-themes'
import { blake2sHex, PyRandom, sha256Hex } from '@/tools/seal-strip/core/crypto'
import {
  buildCardRecord,
  cardsToCsv,
  checksum,
  derivedTokens,
  generateCardBatch,
  guillocheSvg,
  makeA4SheetSvg,
  makeCardSvg,
  normalizeSealCode,
  randCode,
  verifySealInput,
  visualMatrix4x4Svg,
  visualMatrixBits,
} from '@/tools/seal-strip/core/generator'
import { generateQrMatrix } from '@/tools/seal-strip/core/qrcode'

describe('seal-strip crypto & generator', () => {
  it('PyRandom(20261115) 与 Python 脚本生成完全一致的序列', () => {
    const rng = new PyRandom(20261115)
    const first = randCode(rng)
    expect(first).toBe('M3YC-QDWE-84H')

    // 21 联确定性复现
    const batch1 = generateCardBatch({ seed: 20261115 })
    const batch2 = generateCardBatch({ seed: 20261115 })
    expect(batch1).toHaveLength(A4_TOTAL)
    expect(batch1[0]?.code).toBe('M3YC-QDWE-84H')
    expect(batch1.map((c) => c.code)).toEqual(batch2.map((c) => c.code))
  })

  it('校验码、微缩摘要与 BLAKE2s 签名短码与 Python hashlib 完全一致', () => {
    const code = 'M3YC-QDWE-84H'
    expect(checksum(code)).toEqual(['14', '58E2', 'A039'])
    expect(derivedTokens(code)).toEqual(['1E3E45B7395F0E52', '04E214'])
    expect(blake2sHex(`RINSTEL-SIG|${code}`, 3)).toBe('04E214')
    expect(sha256Hex(`RINSTEL-SEAL-PROOF|${code}`).slice(0, 10)).toBe('1458E2A039')
  })

  it('随机生成的编码长度、分隔格式与防混淆字符集正确', () => {
    const code = randCode()
    expect(code).toMatch(/^[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{3}$/)
    const compact = code.replaceAll('-', '')
    expect(compact).toHaveLength(11)
    for (const ch of compact) {
      expect(ALPHA.includes(ch)).toBe(true)
      expect(['0', 'O', '1', 'I']).not.toContain(ch)
    }
  })

  it('4x4 视觉指纹矩阵稀疏度始终保持在 4–12 格之间并输出精确 SVG', () => {
    const batch = generateCardBatch({ seed: 20261115 })
    for (const card of batch) {
      const { cells } = visualMatrixBits(card.code)
      expect(cells).toHaveLength(4)
      const filled = cells.flat().filter(Boolean).length
      expect(filled).toBeGreaterThanOrEqual(4)
      expect(filled).toBeLessThanOrEqual(12)
    }

    const svg = visualMatrix4x4Svg('M3YC-QDWE-84H', 28.0, 17.0, 6.8)
    expect(svg).toContain('<rect x="28.00" y="17.00" width="6.80" height="6.80"')
  })

  it('QR Code 矩阵包含完整静区与定位图案', () => {
    const matrix = generateQrMatrix('RINSTEL-SEAL|M3YC-QDWE-84H|14-58E2-A039', 1)
    // 39 bytes Byte mode Level M => Version 3 (29x29) + border 1 => 31x31
    expect(matrix).toHaveLength(31)
    expect(matrix[0]).toHaveLength(31)
    // 静区首行全白
    expect(matrix[0]?.every((cell) => cell === false)).toBe(true)
    // 左上角 Finder 外框左上点 (1, 1) 为黑
    expect(matrix[1]?.[1]).toBe(true)
    // Finder 中心点 (4, 4) 为黑
    expect(matrix[4]?.[4]).toBe(true)
    // Finder 内白环 (2, 2) 为白
    expect(matrix[2]?.[2]).toBe(false)
  })

  it('波浪底纹 guilloche 输出 5 条 120 点折线', () => {
    const svg = guillocheSvg('M3YC-QDWE-84H', 2.6, 25.0, 32.4, 6.2)
    const polylines = svg.match(/<polyline /g) ?? []
    expect(polylines).toHaveLength(5)
    // 首段折线包含 120 对坐标
    const firstPointsMatch = svg.match(/points="([^"]+)"/)
    expect(firstPointsMatch).not.toBeNull()
    expect(firstPointsMatch?.[1]?.split(' ')).toHaveLength(120)
  })

  it('单张 SVG 与 A4 二十一联排版 SVG 结构完整', () => {
    const batch = generateCardBatch({ seed: 20261115 })
    const first = batch[0]!
    const singleSvg = makeCardSvg(first.code, first.seq)
    expect(singleSvg).toContain('width="56mm" height="34mm" viewBox="0 0 56 34"')
    expect(singleSvg).toContain('RinStel')
    expect(singleSvg).toContain('封箱证明')
    expect(singleSvg).toContain('#01')
    expect(singleSvg).toContain('M3YC-QDWE-84H')
    expect(singleSvg).toContain('CHK 14-58E2-A039')
    expect(singleSvg).toContain('1E3E45B7395F0E52')
    expect(singleSvg).toContain('SIG · 04E214')

    const sheetSvg = makeA4SheetSvg(batch)
    expect(sheetSvg).toContain('width="210mm" height="297mm" viewBox="0 0 210 297"')
    const cardGroups = sheetSvg.match(/<g transform="translate\(/g) ?? []
    expect(cardGroups).toHaveLength(21)
    expect(sheetSvg).toContain('#21')
    expect(sheetSvg).toContain('RinStel 封箱证明 (56×34mm · 21联)')
  })

  it('编码规范化、核验台与 CSV 导出逻辑正确', () => {
    expect(normalizeSealCode('m3ycqdwe84h')).toBe('M3YC-QDWE-84H')
    expect(normalizeSealCode('M3YC-QDWE-84O')).toBeNull() // O 为易混淆禁止字符

    const byCode = verifySealInput('m3ycqdwe84h')
    expect(byCode.validFormat).toBe(true)
    expect(byCode.inputKind).toBe('code')
    expect(byCode.expectedChk).toBe('14-58E2-A039')
    expect(byCode.chkMatched).toBeNull()

    const byValidQr = verifySealInput('RINSTEL-SEAL|M3YC-QDWE-84H|14-58E2-A039')
    expect(byValidQr.validFormat).toBe(true)
    expect(byValidQr.inputKind).toBe('qr')
    expect(byValidQr.chkMatched).toBe(true)

    const byTamperedQr = verifySealInput('RINSTEL-SEAL|M3YC-QDWE-84H|FF-0000-0000')
    expect(byTamperedQr.validFormat).toBe(true)
    expect(byTamperedQr.chkMatched).toBe(false)

    const csv = cardsToCsv([buildCardRecord('M3YC-QDWE-84H', 1)])
    expect(csv.startsWith('\uFEFF序号,品牌,标题')).toBe(true)
    expect(csv).toContain('"M3YC-QDWE-84H","14-58E2-A039","1E3E45B7395F0E52","04E214"')
  })
})
