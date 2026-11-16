import { describe, expect, it } from 'vitest'

import { spectrum } from '../../../src/domains/series/fft'
import type { SpectrumOptions } from '../../../src/domains/series/types'

function sine(size: number, frequency: number, sampleRate: number, amplitude = 1): Float64Array {
  const samples = new Float64Array(size)
  for (let i = 0; i < size; i += 1) {
    samples[i] = amplitude * Math.sin((2 * Math.PI * frequency * i) / sampleRate)
  }
  return samples
}

function options(patch: Partial<SpectrumOptions> = {}): SpectrumOptions {
  return {
    size: 1024,
    window: 'hann',
    sampleRate: 1000,
    scale: 'linear',
    removeDc: false,
    ...patch,
  }
}

function peakIndex(mag: Float64Array): number {
  let best = 1
  for (let i = 2; i < mag.length - 1; i += 1) {
    if ((mag[i] as number) > (mag[best] as number)) best = i
  }
  return best
}

describe('series/fft', () => {
  it('50Hz、幅度 1、采样率 1000、size 1024、汉宁窗：峰值频点与幅度正确', () => {
    const result = spectrum(sine(1024, 50, 1000), options())
    expect(result.freq).toHaveLength(513)
    expect(result.mag).toHaveLength(513)

    const peak = peakIndex(result.mag)
    const peakFrequency = result.freq[peak] as number
    expect(Math.abs(peakFrequency - 50)).toBeLessThan(1000 / 1024 + 0.01)
    expect(Math.abs((result.mag[peak] as number) - 1)).toBeLessThan(0.05)
  })

  it('无窗时精确落在整数频点上的正弦幅度为 1', () => {
    const size = 1024
    const bin = 50
    const frequency = (bin * 1000) / size
    const result = spectrum(sine(size, frequency, 1000), options({ window: 'none' }))
    expect(peakIndex(result.mag)).toBe(bin)
    expect(result.mag[bin] as number).toBeCloseTo(1, 6)
  })

  it('removeDc 去除直流分量', () => {
    const constant = new Float64Array(1024).fill(5)
    const withDc = spectrum(constant, options({ removeDc: false }))
    expect(withDc.mag[0] as number).toBeCloseTo(5, 6)

    const withoutDc = spectrum(constant, options({ removeDc: true }))
    expect(Math.abs(withoutDc.mag[0] as number)).toBeLessThan(1e-9)
    expect(Math.abs(withoutDc.mag[10] as number)).toBeLessThan(1e-9)
  })

  it('dB 刻度为 20·log10(max(mag, 1e-12))', () => {
    const result = spectrum(sine(1024, 50, 1000), options({ scale: 'db' }))
    const peak = peakIndex(result.mag)
    expect(Math.abs(result.mag[peak] as number)).toBeLessThan(1)

    const constant = spectrum(new Float64Array(1024), options({ scale: 'db', removeDc: false }))
    expect(constant.mag[0] as number).toBeCloseTo(20 * Math.log10(1e-12), 6)
  })

  it('样本不足 size 时在前面补 0', () => {
    const result = spectrum(new Float64Array(100).fill(5), options({ removeDc: true }))
    expect(result.freq).toHaveLength(513)
    expect(Math.abs(result.mag[0] as number)).toBeLessThan(1e-9)
    expect(Math.abs(result.mag[100] as number)).toBeLessThan(1e-9)
  })

  it('size 与采样率校验', () => {
    const samples = new Float64Array(1024)
    for (const size of [128, 1000, 20000]) {
      expect(() => spectrum(samples, options({ size }))).toThrow()
    }
    expect(() => spectrum(samples, options({ sampleRate: 0 }))).toThrow()
    expect(() =>
      spectrum(samples, options({ window: 'rect' as unknown as SpectrumOptions['window'] })),
    ).toThrow()
  })
})
