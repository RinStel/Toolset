<script setup lang="ts">
/**
 * 频谱图（plan §8.11 `chart.fft`）。
 *
 * 取变量最近 `size` 个样本做单边幅度谱（`spectrum()`）；采样率留空时按最近样本时间
 * 间隔的中位数估算；`average` 为指数平均的窗口数；`showPeak` 标出最高峰的频率与幅值。
 */

import { computed, ref, watch } from 'vue'

import {
  EMPTY_NO_VARIABLE,
  EMPTY_SOURCE_DISCONNECTED,
  EMPTY_WAITING_DATA,
} from '@/domains/dashboard/public'
import { spectrum, type SpectrumScale, type SpectrumWindow } from '@/domains/series/public'

import {
  asBoolean,
  asNumberOrNull,
  asRange,
  asString,
  asVarRef,
  clampNumber,
  formatNumber,
} from '../shared/format'
import type { WidgetComponentProps } from '../shared/types'
import { useThemeVersion } from '../shared/runtime'
import {
  useUplot,
  type UplotAlignedData,
  type UplotInstance,
  type UplotOptions,
} from '../shared/use-uplot'
import { useSingleVariable } from '../shared/use-single-variable'
import WidgetEmpty from '../shared/WidgetEmpty.vue'

defineOptions({ name: 'FftChartWidget' })

const props = defineProps<WidgetComponentProps>()

/** 采样率自动估算时最多检查最近这么多个时间间隔（O(1) 避免大数组排序）。 */
const SAMPLE_RATE_WINDOW = 256
/**
 * 频谱重新计算的间隔（毫秒）。
 *
 * 一次历史复制 + `size` 点 FFT 在 1kHz 场景下每帧执行会持续占用主线程；
 * 频谱本身不需要 30fps，250ms 更新一次即可（plan §11.5 `@perf` 的 long task 约束）。
 */
const SPECTRUM_REFRESH_MS = 250

const size = computed(() => {
  const parsed = Math.round(asNumberOrNull(props.props.size) ?? 1024)
  const clamped = clampNumber(parsed, 256, 16384)
  return 2 ** Math.round(Math.log2(clamped))
})

const variable = useSingleVariable(
  () => asVarRef(props.props.variable),
  () => ({ last: size.value }),
  { historyRefreshMs: SPECTRUM_REFRESH_MS },
)

/* ------------------------------------------------------------------------- */
/* 参数                                                                        */
/* ------------------------------------------------------------------------- */

const windowType = computed<SpectrumWindow>(() => {
  const value = asString(props.props.window, 'hann')
  return value === 'none' || value === 'hamming' || value === 'blackman' ? value : 'hann'
})

const scaleMode = computed<SpectrumScale>(() =>
  asString(props.props.scale) === 'linear' ? 'linear' : 'db',
)

const removeDc = computed(() => asBoolean(props.props.removeDc, true))
const average = computed(() =>
  Math.round(clampNumber(asNumberOrNull(props.props.average) ?? 1, 1, 16)),
)
const logX = computed(() => asBoolean(props.props.logX, false))
const showPeak = computed(() => asBoolean(props.props.showPeak, true))
const yRange = computed(() => asRange(props.props.yRange))
const sampleRateInput = computed(() => asNumberOrNull(props.props.sampleRate))

const themeVersion = useThemeVersion()

/* ------------------------------------------------------------------------- */
/* 频谱计算                                                                    */
/* ------------------------------------------------------------------------- */

function estimateSampleRate(times: ArrayLike<number>, count: number): number | undefined {
  const window = Math.min(count, SAMPLE_RATE_WINDOW)
  if (window < 3) return undefined
  const diffs: number[] = []
  const start = Math.max(1, times.length - window)
  for (let index = start; index < times.length; index += 1) {
    const diff = (times[index] as number) - (times[index - 1] as number)
    if (diff > 0 && Number.isFinite(diff)) diffs.push(diff)
  }
  if (diffs.length === 0) return undefined
  diffs.sort((left, right) => left - right)
  const median = diffs[Math.floor(diffs.length / 2)] as number
  if (median <= 0) return undefined
  return 1000 / median
}

const peak = ref<{ freq: number; mag: number } | null>(null)
const lastPointCount = ref(0)
const lastIdx = ref(-1)

let averageMag: Float64Array | null = null
let averageKey = ''

function averageConfigKey(): string {
  return `${size.value}/${windowType.value}/${scaleMode.value}/${removeDc.value}/${average.value}`
}

interface FftResult {
  freq: Float64Array
  mag: Float64Array
  displayMag: Float64Array
}

function computeSpectrum(): FftResult | null {
  const slice = variable.data.slices.value[0]
  if (!slice || slice.v.length === 0) return null
  const fftSize = size.value
  if (slice.v.length < 8) return null

  const sampleRate = sampleRateInput.value ?? estimateSampleRate(slice.t, fftSize)
  if (sampleRate === undefined || !(sampleRate > 0)) return null

  const samples = slice.v.length > fftSize ? slice.v.subarray(slice.v.length - fftSize) : slice.v
  let result
  try {
    result = spectrum(samples, {
      size: fftSize,
      window: windowType.value,
      sampleRate,
      scale: scaleMode.value,
      removeDc: removeDc.value,
    })
  } catch {
    return null
  }

  let displayed = result.mag
  if (average.value > 1) {
    const key = averageConfigKey()
    const alpha = 1 / average.value
    if (averageMag === null || averageMag.length !== result.mag.length || averageKey !== key) {
      averageMag = Float64Array.from(result.mag)
      averageKey = key
    } else {
      for (let index = 0; index < result.mag.length; index += 1) {
        averageMag[index] =
          alpha * (result.mag[index] as number) + (1 - alpha) * (averageMag[index] as number)
      }
    }
    displayed = averageMag
  } else {
    averageMag = null
    averageKey = ''
  }

  let peakIndex = 0
  let peakMag = Number.NEGATIVE_INFINITY
  for (let index = 1; index < displayed.length; index += 1) {
    const value = displayed[index] as number
    if (value > peakMag) {
      peakMag = value
      peakIndex = index
    }
  }
  peak.value =
    Number.isFinite(peakMag) && peakMag > Number.NEGATIVE_INFINITY
      ? { freq: result.freq[peakIndex] as number, mag: peakMag }
      : null

  lastIdx.value = slice.idx.length > 0 ? (slice.idx[slice.idx.length - 1] as number) : -1
  const start = logX.value && result.freq.length > 1 ? 1 : 0
  lastPointCount.value = result.freq.length - start
  return { freq: result.freq, mag: result.mag, displayMag: displayed }
}

/* ------------------------------------------------------------------------- */
/* 空状态                                                                      */
/* ------------------------------------------------------------------------- */

const emptyText = computed<string | null>(() => {
  if (asVarRef(props.props.variable) === null) return EMPTY_NO_VARIABLE
  if (variable.sourceState.value === 'unbound') return EMPTY_SOURCE_DISCONNECTED
  // 采样率自动时由 `computeSpectrum()` 从样本时间间隔估算，这里只需样本够做一次 FFT。
  const slice = variable.data.slices.value[0]
  if (!slice || slice.v.length < 8) return EMPTY_WAITING_DATA
  return null
})

/* ------------------------------------------------------------------------- */
/* uPlot                                                                       */
/* ------------------------------------------------------------------------- */

const container = ref<HTMLElement | null>(null)

function themeColor(cssVar: string, fallback: string): string {
  const value = props.ctx.theme(cssVar)
  return value.length > 0 ? value : fallback
}

function buildOptions(width: number, height: number): UplotOptions {
  const gridColor = themeColor('--border', '#262c38')
  const textColor = themeColor('--text-faint', '#687185')
  const fontUi = themeColor('--font-ui', 'system-ui, sans-serif')
  const axisFont = `11px ${fontUi}`
  const stroke =
    variable.meta.value.color.length > 0 ? variable.meta.value.color : 'var(--series-1)'

  return {
    width,
    height,
    padding: [4, 6, 0, 0],
    cursor: { show: props.mode === 'run', x: true, y: true, points: { show: true, size: 4 } },
    legend: { show: false },
    scales: {
      x: logX.value ? { time: false, distr: 3, log: 10 } : { time: false },
      y: {
        range: (_self, initMin, initMax) => [
          yRange.value.min ?? initMin,
          yRange.value.max ?? initMax,
        ],
      },
    },
    axes: [
      {
        scale: 'x',
        side: 2,
        stroke: textColor,
        font: axisFont,
        label: '频率 (Hz)',
        labelSize: 16,
        grid: { show: true, stroke: gridColor, width: 1 },
        ticks: { show: true, stroke: gridColor, width: 1 },
      },
      {
        scale: 'y',
        side: 3,
        stroke: textColor,
        font: axisFont,
        label: scaleMode.value === 'db' ? 'dB' : '幅值',
        labelSize: 16,
        grid: { show: true, stroke: gridColor, width: 1 },
        ticks: { show: true, stroke: gridColor, width: 1 },
      },
    ],
    series: [
      { label: '频率' },
      {
        label: '幅值',
        stroke,
        width: 1.2,
        fill: themeColor('--accent-soft', 'rgba(59, 130, 246, 0.14)'),
        value: (_self: UplotInstance, value: number) =>
          value === undefined || value === null || Number.isNaN(value)
            ? ''
            : formatNumber(Number(value), scaleMode.value === 'db' ? 1 : 3),
      },
    ],
  }
}

function alignedData(): UplotAlignedData | null {
  const result = computeSpectrum()
  if (!result) return null
  const start = logX.value && result.freq.length > 1 ? 1 : 0
  const freq = Float64Array.from(result.freq.subarray(start))
  const mag = Float64Array.from(result.displayMag.subarray(start))
  return [freq, mag] as unknown as UplotAlignedData
}

const host = useUplot({ container, options: buildOptions, data: alignedData })

/** 最近一次真正计算的频谱历史窗口（用于跳过没有新数据的帧）。 */
let lastRenderedSlices: unknown = null

function renderChart(): void {
  lastRenderedSlices = variable.data.slices.value
  host.setData(alignedData(), true)
}

const styleSignature = computed(() =>
  JSON.stringify([
    size.value,
    windowType.value,
    scaleMode.value,
    logX.value,
    removeDc.value,
    average.value,
    sampleRateInput.value,
    yRange.value.min,
    yRange.value.max,
    props.mode,
    themeVersion.value,
    variable.meta.value.color,
    variable.meta.value.label,
  ]),
)

watch(styleSignature, () => {
  averageMag = null
  averageKey = ''
  lastRenderedSlices = null
  if (!container.value || emptyText.value !== null) return
  void host.rebuild().then(renderChart)
})

watch(
  () => variable.data.frameIndex.value,
  () => {
    if (variable.data.slices.value === lastRenderedSlices) return
    renderChart()
  },
  { flush: 'post' },
)

watch(
  () => [props.size.width, props.size.height] as const,
  () => {
    const element = container.value
    if (!element) return
    host.setSize(element.clientWidth, element.clientHeight)
  },
  { flush: 'post' },
)

const peakText = computed(() => {
  const current = peak.value
  if (!current) return ''
  const unit = scaleMode.value === 'db' ? 'dB' : ''
  return `峰值 ${formatNumber(current.freq, 1)} Hz / ${formatNumber(current.mag, 1)} ${unit}`.trim()
})
</script>

<template>
  <div
    class="chart-fft"
    :data-point-count="lastPointCount"
    :data-last-idx="lastIdx >= 0 ? lastIdx : ''"
    data-testid="chart-fft"
  >
    <WidgetEmpty v-if="emptyText !== null" :text="emptyText" icon />

    <div v-else class="chart-fft__plot">
      <div ref="container" class="chart-fft__canvas" data-testid="chart-fft-canvas" />
      <div
        v-if="showPeak && peakText.length > 0"
        class="chart-fft__peak"
        data-testid="chart-fft-peak"
      >
        {{ peakText }}
      </div>
    </div>
  </div>
</template>

<style scoped>
.chart-fft {
  display: flex;
  width: 100%;
  height: 100%;
  min-width: 0;
  min-height: 0;
  overflow: hidden;
}

.chart-fft__plot {
  position: relative;
  display: flex;
  flex: 1 1 auto;
  min-width: 0;
  min-height: 0;
}

.chart-fft__canvas {
  flex: 1 1 auto;
  width: 100%;
  height: 100%;
  min-width: 0;
  min-height: 0;
  overflow: hidden;
}

.chart-fft__peak {
  position: absolute;
  top: 2px;
  left: 46px;
  padding: 1px 5px;
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  background: color-mix(in srgb, var(--bg-elev) 86%, transparent);
  color: var(--text-dim);
  font-family: var(--font-mono);
  font-size: 10px;
  pointer-events: none;
}

.chart-fft :deep(.u-select) {
  background: color-mix(in srgb, var(--accent) 22%, transparent);
}
</style>
