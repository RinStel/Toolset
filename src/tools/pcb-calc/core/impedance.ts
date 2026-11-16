/**
 * PCB 特征阻抗计算、目标阻抗三档反算、防串扰间距与蛇形等长绕线计算内核。
 *
 * 所有几何尺寸输入输出统一采用 `mil` 作为内部基准单位，避免多处单位换算引入误差。
 */

import type { TransmissionLineMode } from './presets'

export interface ImpedanceInput {
  mode: TransmissionLineMode
  targetZ: number
  wMil: number
  sMil: number
  sGndMil: number
  hMil: number
  h2Mil: number
  tMil: number
  er: number
}

export interface ImpedanceResult {
  primaryZ: number
  z0Single: number
  zOdd: number | null
  zEven: number | null
  couplingFactor: number | null
  effEr: number
  delayPsPerMm: number
  delayPsPerInch: number
  inductanceNhPerMm: number
  capacitancePfPerMm: number
  errorOhm: number
  errorPct: number
}

export interface TraceRecommendation {
  id: string
  tierLabel: string
  tag: string
  wMil: number
  sMil: number
  sGndMil: number
  actualZ: number
  errorPct: number
  manufacturable: boolean
}

export interface CrosstalkInput {
  wMil: number
  sMil: number
  hMil: number
  neighborEdgeGapMil: number
  isDifferential: boolean
}

export type CrosstalkLevel = 'low' | 'moderate' | 'high'

export interface CrosstalkResult {
  edgeGap3WMil: number
  edgeGap5WMil: number
  edgeGap3HMil: number
  edgeGap5HMil: number
  recommendedPairGapMil: number
  copperPourGapMil: number
  cpwgViaPitchMil: number
  nextCoeff: number
  nextDb: number
  nextLevel: CrosstalkLevel
  tromboneMinGapMil: number
  tromboneMinAmplitudeMil: number
  miterCornerMil: number
}

const C0_MM_PER_PS = 0.299792458

function clampPositive(value: number, fallback: number, min = 0.05): number {
  if (!Number.isFinite(value) || value <= 0) return fallback
  return Math.max(min, value)
}

/**
 * Hilberg 精确椭圆积分比 K(k) / K(sqrt(1 - k^2)) 逼近。
 */
function ellipticRatioK(k: number): number {
  const safeK = Math.max(1e-7, Math.min(1 - 1e-7, k))
  const kp = Math.sqrt(1 - safeK * safeK)
  if (safeK >= Math.SQRT1_2) {
    const denom = Math.max(1e-12, Math.log((2 * (1 + Math.sqrt(safeK))) / (1 - Math.sqrt(safeK))))
    return denom / Math.PI
  }
  const numer = Math.log((2 * (1 + Math.sqrt(kp))) / (1 - Math.sqrt(kp)))
  return Math.PI / Math.max(1e-12, numer)
}

/**
 * Hammerstad-Jensen 外层单端微带线特征阻抗与有效介电常数。
 */
function calcMicrostripCore(
  wMil: number,
  hMil: number,
  tMil: number,
  er: number,
): { z0: number; effEr: number } {
  const w = clampPositive(wMil, 5)
  const h = clampPositive(hMil, 4)
  const t = clampPositive(tMil, 1.378, 0.01)
  const safeEr = Math.max(1.0, er)

  const u = w / h
  const th = t / h
  const sqrtTerm = Math.sqrt(6.517 * u)
  const cothVal = 1 / Math.tanh(Math.max(1e-4, sqrtTerm))
  const deltaUa = (th / Math.PI) * Math.log(1 + (4 * Math.E) / (th * cothVal * cothVal))
  const deltaUr = ((1 + 1 / Math.cosh(Math.sqrt(safeEr - 1))) / 2) * deltaUa
  const uEff = Math.max(0.01, u + deltaUr)

  const a =
    1 +
    Math.log((uEff ** 4 + (uEff / 52) ** 2) / (uEff ** 4 + 0.432)) / 49 +
    Math.log(1 + (uEff / 18.1) ** 3) / 18.7
  const b = 0.564 * ((safeEr - 0.9) / (safeEr + 3)) ** 0.053
  const effEr = (safeEr + 1) / 2 + ((safeEr - 1) / 2) * (1 + 10 / uEff) ** (-a * b)

  const fu = 6 + (2 * Math.PI - 6) * Math.exp(-((30.666 / uEff) ** 0.7528))
  const z0Air = 60 * Math.log(fu / uEff + Math.sqrt(1 + (2 / uEff) ** 2))
  const z0Bare = z0Air / Math.sqrt(effEr)
  // 阻焊绿油覆盖修正 (Coated Microstrip)：JLC 绿油 (CEr≈3.8, C1≈1.1mil, C2≈0.6mil) 会降低表层走线阻抗约 5–7%
  const smFactor = 1 - 0.068 * Math.exp(-0.14 * u) * (1 - 1 / safeEr)
  const z0 = z0Bare * smFactor
  return { z0, effEr: effEr / (smFactor * smFactor) }
}

/**
 * Wadell / Hilberg 共面波导带地 (Coated CBCPW) 特征阻抗与有效介电常数。
 * 底部参考地耦合引入 Hammerstad 铜厚边缘等效宽度修正，表层槽缝计入平行板侧壁电容与阻焊覆盖效应。
 */
function calcCpwgCore(
  wMil: number,
  sGndMil: number,
  hMil: number,
  tMil: number,
  er: number,
  sideFactor = 1.0,
): { z0: number; effEr: number } {
  const w = clampPositive(wMil, 8)
  const s = clampPositive(sGndMil, 6, 0.5)
  const h = clampPositive(hMil, 8)
  const t = clampPositive(tMil, 1.378, 0.01)
  const safeEr = Math.max(1.0, er)

  // 1. 底部参考地耦合：加入 Hammerstad 铜厚边缘等效宽度修正，解决薄介质下低估铜厚边缘电容问题
  const u = w / h
  const th = t / h
  const cothVal = 1 / Math.tanh(Math.sqrt(Math.max(1e-4, 6.517 * u)))
  const deltaUa = (th / Math.PI) * Math.log(1 + (4 * Math.E) / (th * cothVal * cothVal))
  const deltaUr = ((1 + 1 / Math.cosh(Math.sqrt(safeEr - 1))) / 2) * deltaUa
  const wBottom = w + deltaUr * h

  const a1 = w / 2
  const b1 = a1 + s
  const k1 = Math.max(1e-5, Math.min(0.9999, a1 / b1))
  const r1 = ellipticRatioK(k1) * sideFactor

  const a2 = wBottom / 2
  const b2 = a2 + s
  const argA = (Math.PI * a2) / (2 * h)
  const argB = (Math.PI * b2) / (2 * h)
  const k2 =
    argB > 18
      ? Math.tanh(argA)
      : Math.max(1e-5, Math.min(0.9999, Math.tanh(argA) / Math.tanh(argB)))
  const r2 = ellipticRatioK(k2)

  // 2. 铜箔侧壁对共面地的平行板电容与阻焊绿油 (CEr≈3.8) 覆盖效应
  const cWallAir = (t / s) * sideFactor
  const erTop = 2.1
  const erGap = 3.3

  const cNormAir = r1 + r2 + cWallAir
  const cNorm = erTop * r1 + safeEr * r2 + erGap * cWallAir
  const effEr = cNorm / Math.max(1e-6, cNormAir)
  const z0 = (60 * Math.PI) / Math.sqrt(Math.max(1e-6, cNorm * cNormAir))
  return { z0, effEr }
}

/**
 * Wadell / IPC-2141A 内层对称或非对称带状线特征阻抗。
 */
function calcStriplineCore(
  wMil: number,
  h1Mil: number,
  h2Mil: number,
  tMil: number,
  er: number,
): { z0: number; effEr: number; bEff: number } {
  const w = clampPositive(wMil, 4)
  const h1 = clampPositive(h1Mil, 4)
  const h2 = clampPositive(h2Mil, 20)
  const t = clampPositive(tMil, 0.689, 0.01)
  const safeEr = Math.max(1.0, er)

  // 偏心参考平面的等效对称板间距离
  const bEff = (4 * h1 * h2) / (h1 + h2) + t
  const dielectricSpan = Math.max(0.5, bEff - t)

  const m = (6 * dielectricSpan) / (3 * bEff - t)
  const wEff =
    w +
    (t / Math.PI) *
      (1 -
        0.5 *
          Math.log(
            (t / (2 * w + 1.1 * t)) ** 2 + Math.max(1e-8, (0.0796 * t) / (w + 1.1 * t)) ** m,
          ))

  const x = (4 * dielectricSpan) / (Math.PI * Math.max(0.1, wEff))
  const z0 = (30 / Math.sqrt(safeEr)) * Math.log(1 + x * (2 * x + Math.sqrt(4 * x * x + 6.27)))
  return { z0, effEr: safeEr, bEff }
}

function buildMetrics(
  primaryZ: number,
  z0Single: number,
  zOdd: number | null,
  zEven: number | null,
  effEr: number,
  targetZ: number,
): ImpedanceResult {
  const safeTarget = clampPositive(targetZ, 50)
  const delayPsPerMm = Math.sqrt(effEr) / C0_MM_PER_PS
  const delayPsPerInch = delayPsPerMm * 25.4
  // 使用标准传输线 L0 = Z0 * td，C0 = td / Z0（单端以 Z0、差分以 Zdiff 为传输阻抗）
  const inductanceNhPerMm = (primaryZ * delayPsPerMm) / 1000
  const capacitancePfPerMm = delayPsPerMm / primaryZ
  const couplingFactor =
    zOdd !== null && zEven !== null ? (zEven - zOdd) / Math.max(1e-6, zEven + zOdd) : null
  const errorOhm = primaryZ - safeTarget
  const errorPct = (errorOhm / safeTarget) * 100

  return {
    primaryZ,
    z0Single,
    zOdd,
    zEven,
    couplingFactor,
    effEr,
    delayPsPerMm,
    delayPsPerInch,
    inductanceNhPerMm,
    capacitancePfPerMm,
    errorOhm,
    errorPct,
  }
}

export function calculateImpedance(input: ImpedanceInput): ImpedanceResult {
  const w = clampPositive(input.wMil, 5)
  const s = clampPositive(input.sMil, 6, 0.5)
  const sGnd = clampPositive(input.sGndMil, 6, 0.5)
  const h = clampPositive(input.hMil, 4)
  const h2 = clampPositive(input.h2Mil, 20)
  const t = clampPositive(input.tMil, 1.378, 0.01)
  const er = Math.max(1.0, Number.isFinite(input.er) ? input.er : 4.1)

  if (input.mode === 'microstrip') {
    const { z0, effEr } = calcMicrostripCore(w, h, t, er)
    return buildMetrics(z0, z0, null, null, effEr, input.targetZ)
  }

  if (input.mode === 'diff-microstrip') {
    const { z0, effEr } = calcMicrostripCore(w, h, t, er)
    const g = Math.max(0.05, s / h)
    // 阻焊绿油 (CEr≈3.8) 填充线间缝隙会增强表层差分奇模耦合
    const wallCouple = 0.12 * (t / Math.max(0.5, s))
    const zOdd = z0 * (1 - 0.5 * Math.exp(-0.96 * g ** 0.86) - wallCouple)
    const zEven = (z0 * z0) / Math.max(1e-3, zOdd)
    const zDiff = 2 * zOdd
    return buildMetrics(zDiff, z0, zOdd, zEven, effEr, input.targetZ)
  }

  if (input.mode === 'cpwg') {
    const { z0, effEr } = calcCpwgCore(w, sGnd, h, t, er)
    return buildMetrics(z0, z0, null, null, effEr, input.targetZ)
  }

  if (input.mode === 'diff-cpwg') {
    const { z0, effEr } = calcCpwgCore(w, sGnd, h, t, er, 0.86)
    const u = Math.max(0.05, w / h)
    const g = Math.max(0.05, s / h)
    const couple = 0.48 * Math.exp((-0.96 * g ** 0.84) / u ** 0.15)
    const zOdd = z0 * (1 - couple)
    const zEven = (z0 * z0) / Math.max(1e-3, zOdd)
    const zDiff = 2 * zOdd
    return buildMetrics(zDiff, z0, zOdd, zEven, effEr, input.targetZ)
  }

  if (input.mode === 'stripline') {
    const { z0, effEr } = calcStriplineCore(w, h, h2, t, er)
    return buildMetrics(z0, z0, null, null, effEr, input.targetZ)
  }

  const { z0, effEr, bEff } = calcStriplineCore(w, h, h2, t, er)
  const zOdd = z0 * (1 - 0.347 * Math.exp((-2.9 * s) / bEff))
  const zEven = (z0 * z0) / Math.max(1e-3, zOdd)
  const zDiff = 2 * zOdd
  return buildMetrics(zDiff, z0, zOdd, zEven, effEr, input.targetZ)
}

/**
 * 二分反算指定目标阻抗对应的最佳线宽 W (mil)。
 */
export function solveWidthForTargetZ(input: Omit<ImpedanceInput, 'wMil'>): number {
  const target = clampPositive(input.targetZ, 50)
  let low = 1.5
  let high = 260
  for (let i = 0; i < 36; i += 1) {
    const mid = (low + high) / 2
    const z = calculateImpedance({ ...input, wMil: mid }).primaryZ
    if (z > target) {
      low = mid
    } else {
      high = mid
    }
  }
  return (low + high) / 2
}

/**
 * 针对当前传输线类型与目标阻抗生成直观的「三档推荐走线方案」（或单端最优匹配 + 边界）。
 */
export function solveTraceRecommendations(
  input: ImpedanceInput,
  minTrackMil = 3.5,
): TraceRecommendation[] {
  const safeTarget = clampPositive(input.targetZ, 50)
  const evaluate = (
    id: string,
    tierLabel: string,
    tag: string,
    sMil: number,
    sGndMil: number,
    overrideTargetZ = safeTarget,
  ): TraceRecommendation => {
    const wSolved = solveWidthForTargetZ({
      ...input,
      sMil,
      sGndMil,
      targetZ: overrideTargetZ,
    })
    const actualZ = calculateImpedance({
      ...input,
      wMil: wSolved,
      sMil,
      sGndMil,
    }).primaryZ
    const errorPct = ((actualZ - safeTarget) / safeTarget) * 100
    const gapToCheck =
      input.mode === 'diff-cpwg'
        ? Math.min(sMil, sGndMil)
        : input.mode === 'cpwg'
          ? sGndMil
          : input.mode === 'diff-microstrip' || input.mode === 'diff-stripline'
            ? sMil
            : minTrackMil
    const manufacturable = wSolved >= minTrackMil && gapToCheck >= minTrackMil
    return {
      id,
      tierLabel,
      tag,
      wMil: wSolved,
      sMil,
      sGndMil,
      actualZ,
      errorPct,
      manufacturable,
    }
  }

  const findAdaptiveBaseGap = (
    startMil: number,
    solveAtGap: (gapMil: number) => TraceRecommendation,
  ): number | null => {
    const first = Math.ceil(startMil * 2) / 2
    for (let gap = first; gap <= 36; gap += 0.5) {
      if (solveAtGap(gap).manufacturable) return gap
    }
    return null
  }

  const buildWithAdaptiveFallback = (
    defaults: TraceRecommendation[],
    startMil: number,
    tiers: Array<{ id: string; tierLabel: string; tag: string; offsetMil: number }>,
    solveAtGap: (id: string, tierLabel: string, tag: string, gapMil: number) => TraceRecommendation,
  ): TraceRecommendation[] => {
    if (defaults.some((item) => item.manufacturable)) return defaults
    const baseGap = findAdaptiveBaseGap(startMil, (gap) => solveAtGap('probe', '', '', gap))
    if (baseGap !== null) {
      return tiers.map((tier) => {
        const gap = Math.min(40, Math.round((baseGap + tier.offsetMil) * 2) / 2)
        return solveAtGap(tier.id, tier.tierLabel, tier.tag, gap)
      })
    }
    return [16, 24, 32].map((gap, index) => {
      const tier = tiers[index] ?? tiers[0]!
      return solveAtGap(tier.id, tier.tierLabel, tier.tag, gap)
    })
  }

  if (input.mode === 'diff-microstrip' || input.mode === 'diff-stripline') {
    const baseCandidates = [
      { id: 'compact', tierLabel: '紧凑扇出档', tag: '适合芯片引脚密集区', sMil: 4.5 },
      { id: 'balanced', tierLabel: '常规平衡档', tag: '嘉立创推荐主力搭配', sMil: 6.0 },
      { id: 'relaxed', tierLabel: '宽松低耗档', tag: '抗蚀刻波动更优', sMil: 8.0 },
    ]
    const defaults = baseCandidates.map((item) =>
      evaluate(item.id, item.tierLabel, item.tag, item.sMil, input.sGndMil),
    )
    return buildWithAdaptiveFallback(
      defaults,
      8.5,
      [
        { id: 'compact', tierLabel: '紧凑扩距档', tag: '满足最小线宽起算', offsetMil: 0 },
        { id: 'balanced', tierLabel: '平衡扩距档', tag: '高阻抗自适应间距', offsetMil: 2.5 },
        { id: 'relaxed', tierLabel: '宽松扩距档', tag: '抗蚀刻波动更优', offsetMil: 6.0 },
      ],
      (id, tierLabel, tag, gapMil) => evaluate(id, tierLabel, tag, gapMil, input.sGndMil),
    )
  }

  if (input.mode === 'diff-cpwg') {
    const diffCpwgCandidates = [
      {
        id: 'compact-cpwg',
        tierLabel: '紧凑包地档',
        tag: '适合双面板压窄线宽或高密区',
        sMil: 5.0,
        sGndMil: 5.0,
      },
      {
        id: 'std-cpwg',
        tierLabel: '常规包地档',
        tag: '嘉立创差分包地主力搭配',
        sMil: 6.0,
        sGndMil: 6.0,
      },
      {
        id: 'wide-cpwg',
        tierLabel: '宽松包地档',
        tag: '低损耗 · 抗蚀刻波动',
        sMil: 8.0,
        sGndMil: 8.0,
      },
    ]
    const defaults = diffCpwgCandidates.map((item) =>
      evaluate(item.id, item.tierLabel, item.tag, item.sMil, item.sGndMil),
    )
    return buildWithAdaptiveFallback(
      defaults,
      8.5,
      [
        { id: 'compact-cpwg', tierLabel: '紧凑扩距档', tag: '满足最小线宽起算', offsetMil: 0 },
        { id: 'std-cpwg', tierLabel: '平衡扩距档', tag: '高阻抗自适应包地', offsetMil: 2.5 },
        { id: 'wide-cpwg', tierLabel: '宽松扩距档', tag: '低损耗 · 抗蚀刻波动', offsetMil: 6.0 },
      ],
      (id, tierLabel, tag, gapMil) => evaluate(id, tierLabel, tag, gapMil, gapMil),
    )
  }

  if (input.mode === 'cpwg') {
    const cpwgCandidates = [
      { id: 'tight-gnd', tierLabel: '紧密包地档', tag: '压窄线宽 · 适合双面板', sGndMil: 5.0 },
      { id: 'std-gnd', tierLabel: '常规包地档', tag: '均衡屏蔽与加工裕量', sGndMil: 8.0 },
      { id: 'wide-gnd', tierLabel: '宽松包地档', tag: '低趋肤损耗', sGndMil: 12.0 },
    ]
    const defaults = cpwgCandidates.map((item) =>
      evaluate(item.id, item.tierLabel, item.tag, input.sMil, item.sGndMil),
    )
    return buildWithAdaptiveFallback(
      defaults,
      12.5,
      [
        { id: 'tight-gnd', tierLabel: '紧凑扩距档', tag: '满足最小线宽起算', offsetMil: 0 },
        { id: 'std-gnd', tierLabel: '平衡扩距档', tag: '高阻抗自适应包地', offsetMil: 3.0 },
        { id: 'wide-gnd', tierLabel: '宽松扩距档', tag: '低趋肤损耗', offsetMil: 8.0 },
      ],
      (id, tierLabel, tag, gapMil) => evaluate(id, tierLabel, tag, input.sMil, gapMil),
    )
  }

  return [
    evaluate('optimal', '目标精准匹配', '中心目标值', input.sMil, input.sGndMil, safeTarget),
    evaluate(
      'min-width-tol',
      '下限公差 (-5%)',
      '高密度极限细线',
      input.sMil,
      input.sGndMil,
      safeTarget * 1.05,
    ),
    evaluate(
      'max-width-tol',
      '上限公差 (+5%)',
      '降插损宽走线',
      input.sMil,
      input.sGndMil,
      safeTarget * 0.95,
    ),
  ]
}

/**
 * 防串扰净间距（3W/5W/3H）、近端串扰估算 (dB) 与蛇形等长线规范速算。
 */
export function calculateCrosstalkAndTuning(params: CrosstalkInput): CrosstalkResult {
  const w = clampPositive(params.wMil, 5)
  const h = clampPositive(params.hMil, 4)
  const gap = clampPositive(params.neighborEdgeGapMil, 10, 0.1)

  const edgeGap3WMil = 2 * w
  const edgeGap5WMil = 4 * w
  const edgeGap3HMil = 3 * h
  const edgeGap5HMil = 5 * h

  const recommendedPairGapMil = params.isDifferential
    ? Math.max(edgeGap5WMil, edgeGap3HMil)
    : Math.max(edgeGap3WMil, edgeGap3HMil)
  const copperPourGapMil = Math.max(3 * w, 2.5 * h)
  const cpwgViaPitchMil = Math.min(80, Math.max(30, 4 * h))

  const nextCoeff = 1 / (1 + (gap / h) ** 2)
  const nextDb = 20 * Math.log10(Math.max(1e-6, nextCoeff))
  const nextLevel: CrosstalkLevel = nextDb <= -35 ? 'low' : nextDb <= -25 ? 'moderate' : 'high'

  return {
    edgeGap3WMil,
    edgeGap5WMil,
    edgeGap3HMil,
    edgeGap5HMil,
    recommendedPairGapMil,
    copperPourGapMil,
    cpwgViaPitchMil,
    nextCoeff,
    nextDb,
    nextLevel,
    tromboneMinGapMil: Math.max(edgeGap3WMil, edgeGap3HMil),
    tromboneMinAmplitudeMil: 3 * w,
    miterCornerMil: 1.5 * w,
  }
}
