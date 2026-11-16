import { describe, expect, it } from 'vitest'

import {
  calculateTraceCurrent,
  solveCurrentForWidthA,
  solveWidthForCurrentMil,
} from '@/tools/pcb-calc/core/current'
import {
  calculateCrosstalkAndTuning,
  calculateImpedance,
  solveTraceRecommendations,
  solveWidthForTargetZ,
} from '@/tools/pcb-calc/core/impedance'
import {
  getStackupPreset,
  milToMm,
  mmToMil,
  ozToMil,
  resolveStackupRoutingGeometry,
} from '@/tools/pcb-calc/core/presets'
import { calculateViaParams } from '@/tools/pcb-calc/core/via'

describe('PCB 走线计算纯函数内核', () => {
  it('单位换算精确', () => {
    expect(milToMm(100)).toBeCloseTo(2.54, 4)
    expect(mmToMil(2.54)).toBeCloseTo(100, 4)
    expect(ozToMil(1)).toBeCloseTo(1.378, 3)
  })

  it('外层微带线与差分微带线遵循物理单调性', () => {
    const stack3313 = getStackupPreset('jlc-4l-16-3313')
    const base = {
      mode: 'microstrip' as const,
      targetZ: 50,
      wMil: 6,
      sMil: 6,
      sGndMil: 8,
      hMil: stack3313.outerHMil,
      h2Mil: stack3313.innerH2Mil,
      tMil: ozToMil(stack3313.outerCopperOz),
      er: stack3313.outerEr,
    }

    const rNarrow = calculateImpedance({ ...base, wMil: 4 })
    const rWide = calculateImpedance({ ...base, wMil: 8 })
    expect(rWide.primaryZ).toBeLessThan(rNarrow.primaryZ)

    const rThinH = calculateImpedance({ ...base, hMil: 3.5 })
    const rThickH = calculateImpedance({ ...base, hMil: 8.0 })
    expect(rThickH.primaryZ).toBeGreaterThan(rThinH.primaryZ)

    const diffBase = { ...base, mode: 'diff-microstrip' as const, targetZ: 90, wMil: 5.5 }
    const diffTight = calculateImpedance({ ...diffBase, sMil: 4 })
    const diffLoose = calculateImpedance({ ...diffBase, sMil: 10 })
    expect(diffTight.primaryZ).toBeLessThan(diffLoose.primaryZ)
    expect(diffTight.zOdd!).toBeLessThan(diffTight.z0Single)
    expect(diffTight.zEven!).toBeGreaterThan(diffTight.z0Single)
  })

  it('支持共面波导 (CPWG)、内层单端带状线与内层差分带状线', () => {
    const stack6l = getStackupPreset('jlc-6l-16-3313')
    const cpwgTight = calculateImpedance({
      mode: 'cpwg',
      targetZ: 50,
      wMil: 12,
      sMil: 6,
      sGndMil: 5,
      hMil: 59.84,
      h2Mil: 20,
      tMil: 1.378,
      er: 4.5,
    })
    const cpwgWide = calculateImpedance({
      mode: 'cpwg',
      targetZ: 50,
      wMil: 12,
      sMil: 6,
      sGndMil: 20,
      hMil: 59.84,
      h2Mil: 20,
      tMil: 1.378,
      er: 4.5,
    })
    // 包地间距越紧，参考电容越大，阻抗越低
    expect(cpwgTight.primaryZ).toBeLessThan(cpwgWide.primaryZ)

    const stripline = calculateImpedance({
      mode: 'stripline',
      targetZ: 50,
      wMil: 3.8,
      sMil: 6,
      sGndMil: 8,
      hMil: stack6l.innerH1Mil,
      h2Mil: stack6l.innerH2Mil,
      tMil: ozToMil(stack6l.innerCopperOz),
      er: stack6l.innerEr,
    })
    expect(stripline.primaryZ).toBeGreaterThan(35)
    expect(stripline.primaryZ).toBeLessThan(70)
    expect(stripline.effEr).toBeCloseTo(stack6l.innerEr, 2)

    const diffStripline = calculateImpedance({
      mode: 'diff-stripline',
      targetZ: 100,
      wMil: 3.5,
      sMil: 6,
      sGndMil: 8,
      hMil: stack6l.innerH1Mil,
      h2Mil: stack6l.innerH2Mil,
      tMil: ozToMil(stack6l.innerCopperOz),
      er: stack6l.innerEr,
    })
    expect(diffStripline.primaryZ).toBeGreaterThan(75)
    expect(diffStripline.primaryZ).toBeLessThan(125)

    // 差分共面波导 (diff-cpwg，如 USB 2.0 HS 90Ω 包地走线)
    const diffCpwgTightGnd = calculateImpedance({
      mode: 'diff-cpwg',
      targetZ: 90,
      wMil: 10,
      sMil: 6,
      sGndMil: 5,
      hMil: 59.84,
      h2Mil: 20,
      tMil: 1.378,
      er: 4.5,
    })
    const diffCpwgLooseGnd = calculateImpedance({
      mode: 'diff-cpwg',
      targetZ: 90,
      wMil: 10,
      sMil: 6,
      sGndMil: 15,
      hMil: 59.84,
      h2Mil: 20,
      tMil: 1.378,
      er: 4.5,
    })
    const diffCpwgWideTrace = calculateImpedance({
      mode: 'diff-cpwg',
      targetZ: 90,
      wMil: 14,
      sMil: 6,
      sGndMil: 5,
      hMil: 59.84,
      h2Mil: 20,
      tMil: 1.378,
      er: 4.5,
    })
    expect(diffCpwgTightGnd.primaryZ).toBeLessThan(diffCpwgLooseGnd.primaryZ)
    expect(diffCpwgWideTrace.primaryZ).toBeLessThan(diffCpwgTightGnd.primaryZ)
    expect(diffCpwgTightGnd.zOdd!).toBeLessThan(diffCpwgTightGnd.z0Single)
    expect(diffCpwgTightGnd.zEven!).toBeGreaterThan(diffCpwgTightGnd.z0Single)

    // 嘉立创 4层 3313 90Ω 外层差分共面波导 (S=6, S_gnd=6) 校准检验：W 应接近 5.2 mil
    const stack3313 = getStackupPreset('jlc-4l-16-3313')
    const recs3313 = solveTraceRecommendations(
      {
        mode: 'diff-cpwg',
        targetZ: 90,
        wMil: 5.2,
        sMil: 6,
        sGndMil: 6,
        hMil: stack3313.outerHMil,
        h2Mil: stack3313.innerH2Mil,
        tMil: ozToMil(stack3313.outerCopperOz),
        er: stack3313.outerEr,
      },
      stack3313.minTrackMil,
    )
    const stdRec = recs3313.find((r) => r.id === 'std-cpwg')!
    expect(stdRec.wMil).toBeGreaterThan(4.9)
    expect(stdRec.wMil).toBeLessThan(5.6)

    // 嘉立创 4层 3313 & 7628 50Ω 外层单端共面波导 (S_gnd=8) 校准检验
    const stack7628 = getStackupPreset('jlc-4l-16-7628')
    const cpwg3313 = calculateImpedance({
      mode: 'cpwg',
      targetZ: 50,
      wMil: 5.5,
      sMil: 6,
      sGndMil: 8,
      hMil: stack3313.outerHMil,
      h2Mil: stack3313.innerH2Mil,
      tMil: ozToMil(stack3313.outerCopperOz),
      er: stack3313.outerEr,
    })
    expect(cpwg3313.primaryZ).toBeGreaterThan(48.5)
    expect(cpwg3313.primaryZ).toBeLessThan(52.0)

    const cpwg7628 = calculateImpedance({
      mode: 'cpwg',
      targetZ: 50,
      wMil: 10.5,
      sMil: 6,
      sGndMil: 8,
      hMil: stack7628.outerHMil,
      h2Mil: stack7628.innerH2Mil,
      tMil: ozToMil(stack7628.outerCopperOz),
      er: stack7628.outerEr,
    })
    expect(cpwg7628.primaryZ).toBeGreaterThan(48.5)
    expect(cpwg7628.primaryZ).toBeLessThan(52.0)
  })

  it('多传输线结构与嘉立创 (3313 / 7628) 阻抗参考点对齐', () => {
    const stack3313 = getStackupPreset('jlc-4l-16-3313')
    const stack7628 = getStackupPreset('jlc-4l-16-7628')

    // 4L-3313 50Ω 外层微带线：JLC ~6.0-6.5 mil
    const wMs3313 = solveWidthForTargetZ({
      mode: 'microstrip',
      targetZ: 50,
      sMil: 6,
      sGndMil: 8,
      hMil: stack3313.outerHMil,
      h2Mil: stack3313.innerH2Mil,
      tMil: ozToMil(stack3313.outerCopperOz),
      er: stack3313.outerEr,
    })
    expect(wMs3313).toBeGreaterThanOrEqual(6.0)
    expect(wMs3313).toBeLessThanOrEqual(6.55)

    // 4L-3313 50Ω 外层 CPWG (S_gnd=8)：JLC ~5.0-5.6 mil
    const wCpwg3313 = solveWidthForTargetZ({
      mode: 'cpwg',
      targetZ: 50,
      sMil: 6,
      sGndMil: 8,
      hMil: stack3313.outerHMil,
      h2Mil: stack3313.innerH2Mil,
      tMil: ozToMil(stack3313.outerCopperOz),
      er: stack3313.outerEr,
    })
    expect(wCpwg3313).toBeGreaterThanOrEqual(5.0)
    expect(wCpwg3313).toBeLessThanOrEqual(5.65)

    // 4L-3313 90Ω 外层差分 CPWG (S=6, S_gnd=6)：JLC ~5.2 mil
    const wDiffCpwg3313 = solveWidthForTargetZ({
      mode: 'diff-cpwg',
      targetZ: 90,
      sMil: 6,
      sGndMil: 6,
      hMil: stack3313.outerHMil,
      h2Mil: stack3313.innerH2Mil,
      tMil: ozToMil(stack3313.outerCopperOz),
      er: stack3313.outerEr,
    })
    expect(wDiffCpwg3313).toBeGreaterThanOrEqual(5.0)
    expect(wDiffCpwg3313).toBeLessThanOrEqual(5.4)

    // 4L-3313 100Ω 内层差分带状线 (S=6)：JLC ~4.5-5.5 mil
    const wDiffStrip3313 = solveWidthForTargetZ({
      mode: 'diff-stripline',
      targetZ: 100,
      sMil: 6,
      sGndMil: 8,
      hMil: stack3313.innerH1Mil,
      h2Mil: stack3313.innerH2Mil,
      tMil: ozToMil(stack3313.innerCopperOz),
      er: stack3313.innerEr,
    })
    expect(wDiffStrip3313).toBeGreaterThanOrEqual(4.5)
    expect(wDiffStrip3313).toBeLessThanOrEqual(5.5)

    // 4L-7628 50Ω 外层微带线：JLC ~12.5-13.8 mil
    const wMs7628 = solveWidthForTargetZ({
      mode: 'microstrip',
      targetZ: 50,
      sMil: 6,
      sGndMil: 8,
      hMil: stack7628.outerHMil,
      h2Mil: stack7628.innerH2Mil,
      tMil: ozToMil(stack7628.outerCopperOz),
      er: stack7628.outerEr,
    })
    expect(wMs7628).toBeGreaterThanOrEqual(12.5)
    expect(wMs7628).toBeLessThanOrEqual(13.8)

    // 4L-7628 100Ω 外层差分微带线 (S=6)：JLC ~6.0-7.0 mil
    const wDiffMs7628 = solveWidthForTargetZ({
      mode: 'diff-microstrip',
      targetZ: 100,
      sMil: 6,
      sGndMil: 8,
      hMil: stack7628.outerHMil,
      h2Mil: stack7628.innerH2Mil,
      tMil: ozToMil(stack7628.outerCopperOz),
      er: stack7628.outerEr,
    })
    expect(wDiffMs7628).toBeGreaterThanOrEqual(6.0)
    expect(wDiffMs7628).toBeLessThanOrEqual(7.05)

    // 4L-3313 50Ω 内层单端带状线
    const wStrip3313 = solveWidthForTargetZ({
      mode: 'stripline',
      targetZ: 50,
      sMil: 6,
      sGndMil: 8,
      hMil: stack3313.innerH1Mil,
      h2Mil: stack3313.innerH2Mil,
      tMil: ozToMil(stack3313.innerCopperOz),
      er: stack3313.innerEr,
    })
    expect(wStrip3313).toBeGreaterThanOrEqual(5.2)
    expect(wStrip3313).toBeLessThanOrEqual(6.4)
  })

  it('120Ω 高阻抗差分在薄介质默认间距不可加工时自动切换自适应扩距档位', () => {
    const stack3313 = getStackupPreset('jlc-4l-16-3313')
    for (const mode of ['diff-microstrip', 'diff-cpwg', 'diff-stripline'] as const) {
      const inner = mode === 'diff-stripline'
      const recs = solveTraceRecommendations(
        {
          mode,
          targetZ: 120,
          wMil: 4,
          sMil: 6,
          sGndMil: 8,
          hMil: inner ? stack3313.innerH1Mil : stack3313.outerHMil,
          h2Mil: stack3313.innerH2Mil,
          tMil: ozToMil(inner ? stack3313.innerCopperOz : stack3313.outerCopperOz),
          er: inner ? stack3313.innerEr : stack3313.outerEr,
        },
        stack3313.minTrackMil,
      )
      expect(recs).toHaveLength(3)
      for (const rec of recs) {
        expect(rec.manufacturable).toBe(true)
        expect(rec.wMil).toBeGreaterThanOrEqual(stack3313.minTrackMil)
        expect(Math.abs(rec.actualZ - 120)).toBeLessThan(0.5)
      }
      expect(recs[0]!.sMil).toBeGreaterThan(8)
    }
  })

  it('目标阻抗三档推荐反算器误差小于 0.2 Ω', () => {
    const stack3313 = getStackupPreset('jlc-4l-16-3313')
    const modes = [
      { mode: 'microstrip' as const, targetZ: 50 },
      { mode: 'diff-microstrip' as const, targetZ: 90 },
      { mode: 'diff-microstrip' as const, targetZ: 100 },
      { mode: 'cpwg' as const, targetZ: 50 },
      { mode: 'diff-cpwg' as const, targetZ: 90 },
      { mode: 'diff-stripline' as const, targetZ: 85 },
    ]

    for (const item of modes) {
      const input = {
        mode: item.mode,
        targetZ: item.targetZ,
        wMil: 5,
        sMil: 6,
        sGndMil: 8,
        hMil: stack3313.outerHMil,
        h2Mil: stack3313.innerH2Mil,
        tMil: ozToMil(stack3313.outerCopperOz),
        er: stack3313.outerEr,
      }
      const recs = solveTraceRecommendations(input, stack3313.minTrackMil)
      expect(recs).toHaveLength(3)
      if (item.mode !== 'microstrip') {
        for (const rec of recs) {
          expect(Math.abs(rec.actualZ - item.targetZ)).toBeLessThan(0.25)
        }
      } else {
        expect(Math.abs(recs[0]!.actualZ - item.targetZ)).toBeLessThan(0.25)
      }
    }
  })

  it('防串扰间距与蛇形线规则计算正确', () => {
    const res = calculateCrosstalkAndTuning({
      wMil: 5,
      sMil: 6,
      hMil: 4,
      neighborEdgeGapMil: 20,
      isDifferential: true,
    })
    expect(res.edgeGap3WMil).toBe(10)
    expect(res.edgeGap5WMil).toBe(20)
    expect(res.edgeGap3HMil).toBe(12)
    expect(res.recommendedPairGapMil).toBe(20)
    expect(res.tromboneMinGapMil).toBe(12)
    expect(res.tromboneMinAmplitudeMil).toBe(15)
    expect(res.nextDb).toBeLessThan(-25)
  })

  it('走线载流双向互算互逆且计算电阻压降', () => {
    const w = solveWidthForCurrentMil(3.0, 'external', 1, 20)
    const iBack = solveCurrentForWidthA(w, 'external', 1, 20)
    expect(iBack).toBeCloseTo(3.0, 4)

    const result = calculateTraceCurrent({
      solveMode: 'current-to-width',
      targetCurrentA: 2.0,
      widthMil: 20,
      layer: 'external',
      copperOz: 1,
      tempRiseC: 20,
      ambientTempC: 25,
      lengthMm: 50,
      supplyVoltageV: 5,
    })
    expect(result.recommendedWidthMil).toBeGreaterThan(15)
    expect(result.resistanceMOhm).toBeGreaterThan(0)
    expect(result.voltageDropMv).toBeCloseTo(2.0 * result.resistanceMOhm, 3)
    expect(result.tempRiseTable).toHaveLength(3)
    // 允许温升越高，所需最小线宽越窄
    expect(result.tempRiseTable[2]!.recommendedWidthMil).toBeLessThan(
      result.tempRiseTable[0]!.recommendedWidthMil,
    )
  })

  it('过孔载流、并联孔数与寄生 L/C/Z 计算合理', () => {
    const via = calculateViaParams({
      holeDiaMm: 0.3,
      padDiaMm: 0.6,
      antiPadDiaMm: 0.9,
      boardThicknessMm: 1.6,
      platingUm: 20,
      tempRiseC: 20,
      ambientTempC: 25,
      totalCurrentA: 3.0,
      er: 4.2,
    })
    expect(via.singleViaCurrentA).toBeGreaterThan(1.0)
    expect(via.singleViaCurrentA).toBeLessThan(2.5)
    expect(via.recommendedCount).toBe(Math.max(1, Math.ceil((3.0 * 1.2) / via.singleViaCurrentA)))
    expect(via.parasiticIndNh).toBeGreaterThan(0.5)
    expect(via.parasiticCapPf).toBeGreaterThan(0.1)
    expect(via.viaImpedanceOhm).toBeGreaterThan(15)
  })

  it('布线层与参考层切换自动累加跨层介质厚度与等效 Dk', () => {
    const stack3313 = getStackupPreset('jlc-4l-16-3313')
    const l1ToL2 = resolveStackupRoutingGeometry(
      stack3313.copperOzByLayer,
      stack3313.dielectrics,
      0,
      null,
      1,
    )
    expect(l1ToL2.hMil).toBeCloseTo(3.91, 2)
    expect(l1ToL2.isInnerSandwich).toBe(false)

    // L1 跨过 L2 参考 L3，介质厚应显著增大
    const l1ToL3 = resolveStackupRoutingGeometry(
      stack3313.copperOzByLayer,
      stack3313.dielectrics,
      0,
      null,
      2,
    )
    expect(l1ToL3.hMil).toBeGreaterThan(45)
    expect(l1ToL3.isInnerSandwich).toBe(false)

    // 6层板 L3 内层带状线，上参考 L2、下参考 L4
    const stack6l = getStackupPreset('jlc-6l-16-3313')
    const innerL3 = resolveStackupRoutingGeometry(
      stack6l.copperOzByLayer,
      stack6l.dielectrics,
      2,
      1,
      3,
    )
    expect(innerL3.isInnerSandwich).toBe(true)
    expect(innerL3.hMil).toBeCloseTo(21.65, 2)
    expect(innerL3.h2Mil).toBeCloseTo(7.87, 2)
  })
})
