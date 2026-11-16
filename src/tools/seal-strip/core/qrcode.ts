/**
 * 纯 TypeScript ISO/IEC 18004 QR Code 矩阵生成器（Byte 模式，纠错等级 M）。
 *
 * 对应原脚本 `qrcode.QRCode(error_correction=ERROR_CORRECT_M, border=1)` 的
 * 无外部依赖浏览器实现，覆盖 Version 1–10（足以容纳所有封箱证明载荷）。
 */

interface VersionSpec {
  version: number
  size: number
  ecPerBlock: number
  g1Blocks: number
  g1Data: number
  g2Blocks: number
  g2Data: number
  alignment: readonly number[]
}

const VERSION_SPECS: readonly VersionSpec[] = [
  {
    version: 1,
    size: 21,
    ecPerBlock: 10,
    g1Blocks: 1,
    g1Data: 16,
    g2Blocks: 0,
    g2Data: 0,
    alignment: [],
  },
  {
    version: 2,
    size: 25,
    ecPerBlock: 16,
    g1Blocks: 1,
    g1Data: 28,
    g2Blocks: 0,
    g2Data: 0,
    alignment: [6, 18],
  },
  {
    version: 3,
    size: 29,
    ecPerBlock: 26,
    g1Blocks: 1,
    g1Data: 44,
    g2Blocks: 0,
    g2Data: 0,
    alignment: [6, 22],
  },
  {
    version: 4,
    size: 33,
    ecPerBlock: 18,
    g1Blocks: 2,
    g1Data: 32,
    g2Blocks: 0,
    g2Data: 0,
    alignment: [6, 26],
  },
  {
    version: 5,
    size: 37,
    ecPerBlock: 24,
    g1Blocks: 2,
    g1Data: 43,
    g2Blocks: 0,
    g2Data: 0,
    alignment: [6, 30],
  },
  {
    version: 6,
    size: 41,
    ecPerBlock: 16,
    g1Blocks: 4,
    g1Data: 27,
    g2Blocks: 0,
    g2Data: 0,
    alignment: [6, 34],
  },
  {
    version: 7,
    size: 45,
    ecPerBlock: 18,
    g1Blocks: 4,
    g1Data: 31,
    g2Blocks: 0,
    g2Data: 0,
    alignment: [6, 22, 38],
  },
  {
    version: 8,
    size: 49,
    ecPerBlock: 22,
    g1Blocks: 2,
    g1Data: 38,
    g2Blocks: 2,
    g2Data: 39,
    alignment: [6, 24, 42],
  },
  {
    version: 9,
    size: 53,
    ecPerBlock: 22,
    g1Blocks: 3,
    g1Data: 36,
    g2Blocks: 2,
    g2Data: 37,
    alignment: [6, 26, 46],
  },
  {
    version: 10,
    size: 57,
    ecPerBlock: 26,
    g1Blocks: 4,
    g1Data: 43,
    g2Blocks: 1,
    g2Data: 44,
    alignment: [6, 28, 50],
  },
]

const textEncoder = new TextEncoder()

/* ------------------------------------------------------------------------- */
/* GF(256) Reed-Solomon 纠错码                                                */
/* ------------------------------------------------------------------------- */

const GF_EXP = new Uint8Array(512)
const GF_LOG = new Uint8Array(256)

;(() => {
  let x = 1
  for (let i = 0; i < 255; i += 1) {
    GF_EXP[i] = x
    GF_LOG[x] = i
    x <<= 1
    if (x & 0x100) x ^= 0x11d
  }
  for (let i = 255; i < 512; i += 1) {
    GF_EXP[i] = GF_EXP[i - 255] ?? 0
  }
})()

function gfMul(a: number, b: number): number {
  if (a === 0 || b === 0) return 0
  return GF_EXP[(GF_LOG[a] ?? 0) + (GF_LOG[b] ?? 0)] ?? 0
}

function rsGeneratorPoly(degree: number): Uint8Array {
  let poly: number[] = [1]
  for (let i = 0; i < degree; i += 1) {
    const factor = GF_EXP[i] ?? 1
    const next = new Array<number>(poly.length + 1).fill(0)
    for (let j = 0; j < poly.length; j += 1) {
      const coeff = poly[j] ?? 0
      next[j] = (next[j] ?? 0) ^ coeff
      next[j + 1] = (next[j + 1] ?? 0) ^ gfMul(coeff, factor)
    }
    poly = next
  }
  return Uint8Array.from(poly)
}

function rsEncode(data: Uint8Array, ecCount: number): Uint8Array {
  const gen = rsGeneratorPoly(ecCount)
  const buffer = new Uint8Array(data.length + ecCount)
  buffer.set(data)

  for (let i = 0; i < data.length; i += 1) {
    const factor = buffer[i] ?? 0
    if (factor === 0) continue
    for (let j = 0; j < gen.length; j += 1) {
      buffer[i + j] = (buffer[i + j] ?? 0) ^ gfMul(gen[j] ?? 0, factor)
    }
  }
  return buffer.slice(data.length)
}

/* ------------------------------------------------------------------------- */
/* 数据编码与码字交织                                                         */
/* ------------------------------------------------------------------------- */

function selectVersion(byteLength: number): VersionSpec {
  for (const spec of VERSION_SPECS) {
    const totalDataCodewords = spec.g1Blocks * spec.g1Data + spec.g2Blocks * spec.g2Data
    const countBits = spec.version <= 9 ? 8 : 16
    const neededBits = 4 + countBits + byteLength * 8
    if (neededBits <= totalDataCodewords * 8) {
      return spec
    }
  }
  throw new RangeError(`QR payload too long (${byteLength} bytes) for versions 1-10`)
}

function encodeDataCodewords(bytes: Uint8Array, spec: VersionSpec): Uint8Array {
  const totalData = spec.g1Blocks * spec.g1Data + spec.g2Blocks * spec.g2Data
  const bits: number[] = []

  const pushBits = (value: number, width: number): void => {
    for (let i = width - 1; i >= 0; i -= 1) {
      bits.push((value >>> i) & 1)
    }
  }

  // Byte mode: 0100
  pushBits(0b0100, 4)
  pushBits(bytes.length, spec.version <= 9 ? 8 : 16)
  for (let i = 0; i < bytes.length; i += 1) {
    pushBits(bytes[i] ?? 0, 8)
  }

  // Terminator (up to 4 zero bits)
  const maxBits = totalData * 8
  const terminator = Math.min(4, maxBits - bits.length)
  for (let i = 0; i < terminator; i += 1) bits.push(0)

  // Pad to byte boundary
  while (bits.length % 8 !== 0) bits.push(0)

  const codewords = new Uint8Array(totalData)
  const byteCount = Math.floor(bits.length / 8)
  for (let i = 0; i < byteCount; i += 1) {
    let byteVal = 0
    for (let b = 0; b < 8; b += 1) {
      byteVal = (byteVal << 1) | (bits[i * 8 + b] ?? 0)
    }
    codewords[i] = byteVal
  }

  // Pad codewords alternating 0xEC / 0x11
  const padBytes = [0xec, 0x11]
  for (let i = byteCount; i < totalData; i += 1) {
    codewords[i] = padBytes[(i - byteCount) % 2] ?? 0xec
  }
  return codewords
}

function buildFinalBitstream(codewords: Uint8Array, spec: VersionSpec): boolean[] {
  const dataBlocks: Uint8Array[] = []
  const ecBlocks: Uint8Array[] = []

  let offset = 0
  for (let i = 0; i < spec.g1Blocks; i += 1) {
    const block = codewords.slice(offset, offset + spec.g1Data)
    offset += spec.g1Data
    dataBlocks.push(block)
    ecBlocks.push(rsEncode(block, spec.ecPerBlock))
  }
  for (let i = 0; i < spec.g2Blocks; i += 1) {
    const block = codewords.slice(offset, offset + spec.g2Data)
    offset += spec.g2Data
    dataBlocks.push(block)
    ecBlocks.push(rsEncode(block, spec.ecPerBlock))
  }

  const maxDataLen = Math.max(spec.g1Data, spec.g2Data)
  const interleaved: number[] = []
  for (let i = 0; i < maxDataLen; i += 1) {
    for (const block of dataBlocks) {
      if (i < block.length) interleaved.push(block[i] ?? 0)
    }
  }
  for (let i = 0; i < spec.ecPerBlock; i += 1) {
    for (const ec of ecBlocks) {
      if (i < ec.length) interleaved.push(ec[i] ?? 0)
    }
  }

  const bitStream: boolean[] = []
  for (const byteVal of interleaved) {
    for (let b = 7; b >= 0; b -= 1) {
      bitStream.push(((byteVal >>> b) & 1) === 1)
    }
  }
  return bitStream
}

/* ------------------------------------------------------------------------- */
/* 矩阵构建、功能图案与掩模评估                                               */
/* ------------------------------------------------------------------------- */

function createGrid<T>(size: number, fill: T): T[][] {
  return Array.from({ length: size }, () => Array.from({ length: size }, () => fill))
}

function placeFinder(
  modules: boolean[][],
  isFunction: boolean[][],
  topRow: number,
  leftCol: number,
  size: number,
): void {
  for (let dr = -1; dr <= 7; dr += 1) {
    const r = topRow + dr
    if (r < 0 || r >= size) continue
    for (let dc = -1; dc <= 7; dc += 1) {
      const c = leftCol + dc
      if (c < 0 || c >= size) continue
      const isBorder = dr === -1 || dr === 7 || dc === -1 || dc === 7
      const isRing = dr === 0 || dr === 6 || dc === 0 || dc === 6
      const isCenter = dr >= 2 && dr <= 4 && dc >= 2 && dc <= 4
      modules[r]![c] = !isBorder && (isRing || isCenter)
      isFunction[r]![c] = true
    }
  }
}

function placeAlignment(
  modules: boolean[][],
  isFunction: boolean[][],
  centerRow: number,
  centerCol: number,
): void {
  for (let dr = -2; dr <= 2; dr += 1) {
    for (let dc = -2; dc <= 2; dc += 1) {
      const r = centerRow + dr
      const c = centerCol + dc
      const dark = Math.max(Math.abs(dr), Math.abs(dc)) !== 1
      modules[r]![c] = dark
      isFunction[r]![c] = true
    }
  }
}

function setupFunctionPatterns(spec: VersionSpec): {
  modules: boolean[][]
  isFunction: boolean[][]
} {
  const { size, alignment, version } = spec
  const modules = createGrid(size, false)
  const isFunction = createGrid(size, false)

  // Three finder patterns + white separators
  placeFinder(modules, isFunction, 0, 0, size)
  placeFinder(modules, isFunction, 0, size - 7, size)
  placeFinder(modules, isFunction, size - 7, 0, size)

  // Alignment patterns (skip corners overlapping finders)
  for (const r of alignment) {
    for (const c of alignment) {
      if (isFunction[r]?.[c]) continue
      placeAlignment(modules, isFunction, r, c)
    }
  }

  // Timing patterns
  for (let i = 8; i < size - 8; i += 1) {
    const dark = i % 2 === 0
    if (!isFunction[6]![i]) {
      modules[6]![i] = dark
      isFunction[6]![i] = true
    }
    if (!isFunction[i]![6]) {
      modules[i]![6] = dark
      isFunction[i]![6] = true
    }
  }

  // Dark module
  modules[size - 8]![8] = true
  isFunction[size - 8]![8] = true

  // Reserve format info cells
  for (let i = 0; i <= 8; i += 1) {
    if (i !== 6) {
      isFunction[8]![i] = true
      isFunction[i]![8] = true
    }
  }
  for (let i = size - 8; i < size; i += 1) {
    isFunction[8]![i] = true
  }
  for (let i = size - 7; i < size; i += 1) {
    isFunction[i]![8] = true
  }

  // Version info (version >= 7)
  if (version >= 7) {
    let rem = version
    for (let i = 0; i < 12; i += 1) {
      rem = (rem << 1) ^ ((rem >>> 11) * 0x1f25)
    }
    const versionBits = (version << 12) | rem
    for (let i = 0; i < 18; i += 1) {
      const dark = ((versionBits >>> i) & 1) === 1
      const a = Math.floor(i / 3)
      const b = (i % 3) + size - 11
      modules[a]![b] = dark
      isFunction[a]![b] = true
      modules[b]![a] = dark
      isFunction[b]![a] = true
    }
  }

  return { modules, isFunction }
}

function placeDataBits(
  modules: boolean[][],
  isFunction: boolean[][],
  bitStream: readonly boolean[],
): void {
  const size = modules.length
  let bitIdx = 0
  let upward = true

  for (let rightCol = size - 1; rightCol >= 1; rightCol -= 2) {
    if (rightCol === 6) rightCol = 5
    for (let step = 0; step < size; step += 1) {
      const r = upward ? size - 1 - step : step
      for (let dx = 0; dx < 2; dx += 1) {
        const c = rightCol - dx
        if (isFunction[r]?.[c]) continue
        modules[r]![c] = bitStream[bitIdx] ?? false
        bitIdx += 1
      }
    }
    upward = !upward
  }
}

function maskCondition(mask: number, r: number, c: number): boolean {
  switch (mask) {
    case 0:
      return (r + c) % 2 === 0
    case 1:
      return r % 2 === 0
    case 2:
      return c % 3 === 0
    case 3:
      return (r + c) % 3 === 0
    case 4:
      return (Math.floor(r / 2) + Math.floor(c / 3)) % 2 === 0
    case 5:
      return ((r * c) % 2) + ((r * c) % 3) === 0
    case 6:
      return (((r * c) % 2) + ((r * c) % 3)) % 2 === 0
    case 7:
    default:
      return (((r + c) % 2) + ((r * c) % 3)) % 2 === 0
  }
}

function writeFormatInfo(modules: boolean[][], mask: number): void {
  const size = modules.length
  // Error correction Level M = 0b00
  const data = (0b00 << 3) | (mask & 7)
  let rem = data
  for (let i = 0; i < 10; i += 1) {
    rem = (rem << 1) ^ ((rem >>> 9) * 0x537)
  }
  const formatBits = ((data << 10) | rem) ^ 0x5412

  const getBit = (idx: number): boolean => ((formatBits >>> idx) & 1) === 1

  // Copy 1 (top-left)
  for (let i = 0; i <= 5; i += 1) modules[i]![8] = getBit(i)
  modules[7]![8] = getBit(6)
  modules[8]![8] = getBit(7)
  modules[8]![7] = getBit(8)
  for (let i = 9; i < 15; i += 1) modules[8]![14 - i] = getBit(i)

  // Copy 2 (top-right & bottom-left)
  for (let i = 0; i <= 7; i += 1) modules[8]![size - 1 - i] = getBit(i)
  for (let i = 8; i < 15; i += 1) modules[size - 15 + i]![8] = getBit(i)
}

function evaluatePenalty(modules: boolean[][]): number {
  const size = modules.length
  let penalty = 0

  // Rule 1: 5 or more consecutive modules of the same color in rows / cols
  for (let r = 0; r < size; r += 1) {
    let runColor = modules[r]?.[0] ?? false
    let runLen = 1
    for (let c = 1; c < size; c += 1) {
      const color = modules[r]?.[c] ?? false
      if (color === runColor) {
        runLen += 1
      } else {
        if (runLen >= 5) penalty += 3 + (runLen - 5)
        runColor = color
        runLen = 1
      }
    }
    if (runLen >= 5) penalty += 3 + (runLen - 5)
  }

  for (let c = 0; c < size; c += 1) {
    let runColor = modules[0]?.[c] ?? false
    let runLen = 1
    for (let r = 1; r < size; r += 1) {
      const color = modules[r]?.[c] ?? false
      if (color === runColor) {
        runLen += 1
      } else {
        if (runLen >= 5) penalty += 3 + (runLen - 5)
        runColor = color
        runLen = 1
      }
    }
    if (runLen >= 5) penalty += 3 + (runLen - 5)
  }

  // Rule 2: 2x2 blocks of the same color
  for (let r = 0; r < size - 1; r += 1) {
    for (let c = 0; c < size - 1; c += 1) {
      const v = modules[r]?.[c] ?? false
      if (
        (modules[r]?.[c + 1] ?? false) === v &&
        (modules[r + 1]?.[c] ?? false) === v &&
        (modules[r + 1]?.[c + 1] ?? false) === v
      ) {
        penalty += 3
      }
    }
  }

  // Rule 3: finder-like patterns 1:1:3:1:1 with 4 light modules on either side
  const matchesPattern = (arr: boolean[]): number => {
    let count = 0
    const p1 = [true, false, true, true, true, false, true, false, false, false, false]
    const p2 = [false, false, false, false, true, false, true, true, true, false, true]
    for (let i = 0; i <= arr.length - 11; i += 1) {
      let m1 = true
      let m2 = true
      for (let k = 0; k < 11; k += 1) {
        if (arr[i + k] !== p1[k]) m1 = false
        if (arr[i + k] !== p2[k]) m2 = false
        if (!m1 && !m2) break
      }
      if (m1) count += 40
      if (m2) count += 40
    }
    return count
  }

  for (let r = 0; r < size; r += 1) {
    penalty += matchesPattern(modules[r]!)
  }
  for (let c = 0; c < size; c += 1) {
    const colArr: boolean[] = []
    for (let r = 0; r < size; r += 1) colArr.push(modules[r]?.[c] ?? false)
    penalty += matchesPattern(colArr)
  }

  // Rule 4: balance of dark modules
  let darkCount = 0
  for (let r = 0; r < size; r += 1) {
    for (let c = 0; c < size; c += 1) {
      if (modules[r]?.[c]) darkCount += 1
    }
  }
  const total = size * size
  const percentDeviation = Math.abs((darkCount * 100) / total - 50)
  penalty += Math.floor(percentDeviation / 5) * 10

  return penalty
}

function applyMask(base: boolean[][], isFunction: boolean[][], mask: number): boolean[][] {
  const masked = base.map((row, r) =>
    row.map((val, c) => (isFunction[r]?.[c] ? val : maskCondition(mask, r, c) ? !val : val)),
  )
  writeFormatInfo(masked, mask)
  return masked
}

/**
 * 生成指定文本的 QR Code 二维布尔矩阵（含静区 border）。
 */
export function generateQrMatrix(data: string, border = 1): boolean[][] {
  const bytes = textEncoder.encode(data)
  const spec = selectVersion(bytes.length)
  const codewords = encodeDataCodewords(bytes, spec)
  const bitStream = buildFinalBitstream(codewords, spec)

  const { modules, isFunction } = setupFunctionPatterns(spec)
  placeDataBits(modules, isFunction, bitStream)

  let bestMatrix: boolean[][] | null = null
  let bestPenalty = Number.POSITIVE_INFINITY

  for (let mask = 0; mask < 8; mask += 1) {
    const candidate = applyMask(modules, isFunction, mask)
    const penalty = evaluatePenalty(candidate)
    if (penalty < bestPenalty) {
      bestPenalty = penalty
      bestMatrix = candidate
    }
  }

  const core = bestMatrix ?? applyMask(modules, isFunction, 0)
  if (border <= 0) return core

  const fullSize = core.length + border * 2
  const withBorder = createGrid(fullSize, false)
  for (let r = 0; r < core.length; r += 1) {
    for (let c = 0; c < core.length; c += 1) {
      withBorder[r + border]![c + border] = core[r]?.[c] ?? false
    }
  }
  return withBorder
}
