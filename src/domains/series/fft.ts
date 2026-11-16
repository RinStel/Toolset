/**
 * 基 2 FFT 与单边幅度谱（plan §6.8）。
 *
 * `spectrum()` 取最后 `size` 个样本（不足时前面补 0），加窗后做 FFT，输出
 * `size / 2 + 1` 个点。幅度按 `2·|X[k]| / (N·cg)` 归一化（DC 与 Nyquist 不乘 2），
 * `cg` 为窗函数的相干增益。
 */

import {
  MAX_SPECTRUM_SIZE,
  MIN_SPECTRUM_SIZE,
  type Spectrum,
  type SpectrumOptions,
  type SpectrumScale,
  type SpectrumWindow,
} from './types'

const LOG_FLOOR = 1e-12

const WINDOWS: readonly SpectrumWindow[] = ['none', 'hann', 'hamming', 'blackman']
const SCALES: readonly SpectrumScale[] = ['linear', 'db']

function validateOptions(opts: SpectrumOptions): void {
  const size = opts.size
  if (
    !Number.isInteger(size) ||
    size < MIN_SPECTRUM_SIZE ||
    size > MAX_SPECTRUM_SIZE ||
    (size & (size - 1)) !== 0
  ) {
    throw new Error(`FFT 长度必须是 ${MIN_SPECTRUM_SIZE}–${MAX_SPECTRUM_SIZE} 之间的 2 的幂`)
  }
  if (!Number.isFinite(opts.sampleRate) || opts.sampleRate <= 0) {
    throw new Error('采样率必须是正数')
  }
  if (!WINDOWS.includes(opts.window)) throw new Error(`未知的窗函数：${String(opts.window)}`)
  if (!SCALES.includes(opts.scale)) throw new Error(`未知的纵轴刻度：${String(opts.scale)}`)
}

/** 窗函数在位置 `n`（0 ≤ n < N）的系数。 */
function windowValue(window: SpectrumWindow, n: number, size: number): number {
  switch (window) {
    case 'hann':
      return 0.5 - 0.5 * Math.cos((2 * Math.PI * n) / (size - 1))
    case 'hamming':
      return 0.54 - 0.46 * Math.cos((2 * Math.PI * n) / (size - 1))
    case 'blackman':
      return (
        0.42 -
        0.5 * Math.cos((2 * Math.PI * n) / (size - 1)) +
        0.08 * Math.cos((4 * Math.PI * n) / (size - 1))
      )
    case 'none':
    default:
      return 1
  }
}

/** 原地基 2 FFT（Cooley–Tukey，输入长度必须是 2 的幂）。 */
function fft(real: Float64Array, imaginary: Float64Array): void {
  const size = real.length
  for (let i = 1, j = 0; i < size; i += 1) {
    let bit = size >> 1
    for (; (j & bit) !== 0; bit >>= 1) j ^= bit
    j ^= bit
    if (i < j) {
      const realTemp = real[i] as number
      real[i] = real[j] as number
      real[j] = realTemp
      const imaginaryTemp = imaginary[i] as number
      imaginary[i] = imaginary[j] as number
      imaginary[j] = imaginaryTemp
    }
  }
  for (let length = 2; length <= size; length <<= 1) {
    const angle = (-2 * Math.PI) / length
    const stepReal = Math.cos(angle)
    const stepImaginary = Math.sin(angle)
    const half = length >> 1
    for (let start = 0; start < size; start += length) {
      let wReal = 1
      let wImaginary = 0
      for (let offset = 0; offset < half; offset += 1) {
        const evenIndex = start + offset
        const oddIndex = evenIndex + half
        const oddReal = real[oddIndex] as number
        const oddImaginary = imaginary[oddIndex] as number
        const productReal = oddReal * wReal - oddImaginary * wImaginary
        const productImaginary = oddReal * wImaginary + oddImaginary * wReal
        const evenReal = real[evenIndex] as number
        const evenImaginary = imaginary[evenIndex] as number
        real[evenIndex] = evenReal + productReal
        imaginary[evenIndex] = evenImaginary + productImaginary
        real[oddIndex] = evenReal - productReal
        imaginary[oddIndex] = evenImaginary - productImaginary
        const nextReal = wReal * stepReal - wImaginary * stepImaginary
        wImaginary = wReal * stepImaginary + wImaginary * stepReal
        wReal = nextReal
      }
    }
  }
}

/** 单边幅度谱（plan §6.8）。 */
export function spectrum(samples: Float64Array, opts: SpectrumOptions): Spectrum {
  validateOptions(opts)
  const size = opts.size
  const real = new Float64Array(size)
  const imaginary = new Float64Array(size)

  const usable = Math.min(size, samples.length)
  const offset = size - usable
  let mean = 0
  if (opts.removeDc && usable > 0) {
    let sum = 0
    for (let i = 0; i < usable; i += 1) sum += samples[samples.length - usable + i] as number
    mean = sum / usable
  }
  for (let i = 0; i < usable; i += 1) {
    real[offset + i] = (samples[samples.length - usable + i] as number) - mean
  }

  let windowSum = 0
  for (let i = 0; i < size; i += 1) {
    const coefficient = windowValue(opts.window, i, size)
    windowSum += coefficient
    real[i] = (real[i] as number) * coefficient
  }
  const coherentGain = windowSum / size
  const normalizer = size * coherentGain

  fft(real, imaginary)

  const bins = size / 2 + 1
  const freq = new Float64Array(bins)
  const mag = new Float64Array(bins)
  for (let k = 0; k < bins; k += 1) {
    const magnitude = Math.sqrt((real[k] as number) ** 2 + (imaginary[k] as number) ** 2)
    const singleSided =
      k === 0 || k === size / 2 ? magnitude / normalizer : (2 * magnitude) / normalizer
    freq[k] = (k * opts.sampleRate) / size
    mag[k] = opts.scale === 'db' ? 20 * Math.log10(Math.max(singleSided, LOG_FLOOR)) : singleSided
  }
  return { freq, mag }
}
