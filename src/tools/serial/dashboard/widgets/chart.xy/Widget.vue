<script setup lang="ts">
/**
 * XY 图（plan §8.11 `chart.xy`）。
 *
 * 一个 x 变量对 1–4 个 y 变量：按 idx 对齐成 (x, y) 点对，取最近 `points` 个点；支持
 * 点 / 线两种样式、自动或固定范围、等比例坐标与旧点淡出。
 */

import { computed, ref, watch } from 'vue'

import {
  EMPTY_NO_VARIABLE,
  EMPTY_SOURCE_DISCONNECTED,
  EMPTY_WAITING_DATA,
  SERIES_COLORS,
  type VarRef,
} from '@/domains/dashboard/public'

import {
  asArray,
  asBoolean,
  asNumber,
  asRange,
  asString,
  asVarRef,
  formatNumber,
  resolveCanvasColor,
  seriesColorOf,
} from '../shared/format'
import type { WidgetComponentProps } from '../shared/types'
import { useThemeVersion } from '../shared/runtime'
import {
  useUplot,
  type UplotAlignedData,
  type UplotInstance,
  type UplotOptions,
} from '../shared/use-uplot'
import { useWidgetData } from '../../runtime/useWidgetData'
import WidgetEmpty from '../shared/WidgetEmpty.vue'

defineOptions({ name: 'XyChartWidget' })

const props = defineProps<WidgetComponentProps>()

/* ------------------------------------------------------------------------- */
/* 变量                                                                        */
/* ------------------------------------------------------------------------- */

interface YVariable {
  ref: VarRef
  color: string
}

const xRef = computed(() => asVarRef(props.props.xVar))

const yVariables = computed<YVariable[]>(() => {
  const result: YVariable[] = []
  const items = asArray(props.props.yVars)
  for (let index = 0; index < items.length; index += 1) {
    const item = items[index]
    const ref = asVarRef(item)
    if (!ref) continue
    const record = item && typeof item === 'object' ? (item as Record<string, unknown>) : {}
    result.push({ ref, color: seriesColorOf(record.color, '', index, SERIES_COLORS) })
  }
  return result
})

const refs = computed<VarRef[]>(() => {
  const list: VarRef[] = []
  if (xRef.value) list.push(xRef.value)
  for (const item of yVariables.value) list.push(item.ref)
  return list
})

const data = useWidgetData(() => refs.value, {
  history: { last: 5000 },
  // 1kHz 下历史复制是 O(缓冲样本数)：XY 图以 10fps 重新读取即可（plan §11.5）。
  historyRefreshMs: 100,
})

const pointsLimit = computed(() => Math.max(10, Math.round(asNumber(props.props.points, 500))))

const style = computed(() => (asString(props.props.style) === 'line' ? 'line' : 'points'))
const fade = computed(() => asBoolean(props.props.fade, true))
const equalAspect = computed(() => asBoolean(props.props.equalAspect, false))
const xRange = computed(() => asRange(props.props.xRange))
const yRange = computed(() => asRange(props.props.yRange))

const themeVersion = useThemeVersion()

/* ------------------------------------------------------------------------- */
/* 空状态                                                                      */
/* ------------------------------------------------------------------------- */

const emptyText = computed<string | null>(() => {
  if (!xRef.value || yVariables.value.length === 0) return EMPTY_NO_VARIABLE
  const states = data.sourceStates.value
  if (states.length > 0 && states.every((state) => state === 'unbound')) {
    return EMPTY_SOURCE_DISCONNECTED
  }
  if (data.latest.value.every((value) => value === undefined)) return EMPTY_WAITING_DATA
  return null
})

/* ------------------------------------------------------------------------- */
/* 数据组装                                                                    */
/* ------------------------------------------------------------------------- */

interface XySeries {
  y: Array<number | null>
}

interface XyData {
  x: number[]
  series: XySeries[]
  xMin: number
  xMax: number
  yMin: number
  yMax: number
}

const autoX = ref<{ min: number; max: number }>({ min: 0, max: 1 })
const autoY = ref<{ min: number; max: number }>({ min: 0, max: 1 })
const lastIdx = ref(-1)
const pointCount = ref(0)

function buildXyData(): XyData | null {
  const xRefValue = xRef.value
  const yItems = yVariables.value
  if (!xRefValue || yItems.length === 0) return null

  const slices = data.slices.value
  const xSlice = slices[0]
  if (!xSlice || xSlice.v.length === 0) return null
  const limit = pointsLimit.value
  const offset = Math.max(0, xSlice.v.length - limit)

  const yByIndex: Array<Map<number, number>> = []
  for (let itemIndex = 0; itemIndex < yItems.length; itemIndex += 1) {
    const ySlice = slices[itemIndex + 1]
    const map = new Map<number, number>()
    if (ySlice) {
      for (let index = 0; index < ySlice.idx.length; index += 1) {
        map.set(ySlice.idx[index] as number, ySlice.v[index] as number)
      }
    }
    yByIndex.push(map)
  }

  const x: number[] = []
  const ys: Array<Array<number | null>> = yItems.map(() => [])
  let xMin = Number.POSITIVE_INFINITY
  let xMax = Number.NEGATIVE_INFINITY
  let yMin = Number.POSITIVE_INFINITY
  let yMax = Number.NEGATIVE_INFINITY
  let plotted = 0
  let latestIdx = -1

  for (let index = offset; index < xSlice.idx.length; index += 1) {
    const idx = xSlice.idx[index] as number
    const xValue = xSlice.v[index] as number
    if (!Number.isFinite(xValue)) continue
    x.push(xValue)
    if (xValue < xMin) xMin = xValue
    if (xValue > xMax) xMax = xValue
    if (idx > latestIdx) latestIdx = idx
    for (let itemIndex = 0; itemIndex < yItems.length; itemIndex += 1) {
      const y = yByIndex[itemIndex]?.get(idx)
      const target = ys[itemIndex]
      if (!target) continue
      if (y === undefined || !Number.isFinite(y)) {
        target.push(null)
        continue
      }
      target.push(y)
      plotted += 1
      if (y < yMin) yMin = y
      if (y > yMax) yMax = y
    }
  }

  if (x.length === 0 || plotted === 0) return null
  if (xMin === xMax) {
    xMin -= 1
    xMax += 1
  }
  if (yMin === yMax) {
    yMin -= 1
    yMax += 1
  }
  autoX.value = { min: xMin, max: xMax }
  autoY.value = { min: yMin, max: yMax }
  lastIdx.value = latestIdx
  pointCount.value = plotted
  return { x, series: ys.map((values) => ({ y: values })), xMin, xMax, yMin, yMax }
}

/** 等比例坐标：把 x/y 的数据范围扩到屏幕比例一致。 */
function aspectAdjusted(
  width: number,
  height: number,
): { x: { min: number; max: number }; y: { min: number; max: number } } {
  const x = { ...autoX.value }
  const y = { ...autoY.value }
  if (!equalAspect.value || width <= 0 || height <= 0) return { x, y }
  const xSpan = x.max - x.min
  const ySpan = y.max - y.min
  if (xSpan <= 0 || ySpan <= 0) return { x, y }
  const targetYSpan = (xSpan / width) * height
  if (ySpan < targetYSpan) {
    const center = (y.min + y.max) / 2
    y.min = center - targetYSpan / 2
    y.max = center + targetYSpan / 2
  } else {
    const targetXSpan = (ySpan / height) * width
    const center = (x.min + x.max) / 2
    x.min = center - targetXSpan / 2
    x.max = center + targetXSpan / 2
  }
  return { x, y }
}

function alignedData(): UplotAlignedData | null {
  const built = buildXyData()
  if (!built) return null
  const x = Float64Array.from(built.x)
  return [x, ...built.series.map((item) => item.y)] as unknown as UplotAlignedData
}

/* ------------------------------------------------------------------------- */
/* uPlot                                                                       */
/* ------------------------------------------------------------------------- */

const container = ref<HTMLElement | null>(null)
const legendHost = ref<HTMLElement | null>(null)

function themeColor(cssVar: string, fallback: string): string {
  const value = props.ctx.theme(cssVar)
  return value.length > 0 ? value : fallback
}

function buildOptions(width: number, height: number): UplotOptions {
  const gridColor = themeColor('--border', '#262c38')
  const textColor = themeColor('--text-faint', '#687185')
  const fontUi = themeColor('--font-ui', 'system-ui, sans-serif')
  return {
    width,
    height,
    padding: [4, 6, 0, 0],
    cursor: { show: props.mode === 'run', x: true, y: true, points: { show: true, size: 4 } },
    legend: {
      show: true,
      live: true,
      mount: (_self, element) => {
        legendHost.value?.appendChild(element)
      },
    },
    scales: {
      x: {
        time: false,
        // 范围在每次 redraw 时按最新数据（与等比例坐标）重新计算。
        range: (self) => {
          const current = aspectAdjusted(self.width, self.height)
          return [xRange.value.min ?? current.x.min, xRange.value.max ?? current.x.max] as [
            number,
            number,
          ]
        },
      },
      y: {
        range: (self) => {
          const current = aspectAdjusted(self.width, self.height)
          return [yRange.value.min ?? current.y.min, yRange.value.max ?? current.y.max] as [
            number,
            number,
          ]
        },
      },
    },
    axes: [
      {
        scale: 'x',
        side: 2,
        stroke: textColor,
        font: `11px ${fontUi}`,
        grid: { show: true, stroke: gridColor, width: 1 },
        ticks: { show: true, stroke: gridColor, width: 1 },
      },
      {
        scale: 'y',
        side: 3,
        stroke: textColor,
        font: `11px ${fontUi}`,
        grid: { show: true, stroke: gridColor, width: 1 },
        ticks: { show: true, stroke: gridColor, width: 1 },
      },
    ],
    hooks: {
      drawSeries: [
        (self: UplotInstance, seriesIdx: number) => {
          if (seriesIdx < 1) return
          if (style.value === 'points' && fade.value) drawFadePoints(self, seriesIdx)
        },
      ],
    },
    series: [
      { label: 'x' },
      ...yVariables.value.map((item, index) => {
        const meta = data.variables.value[index + 1]
        const color = resolveCanvasColor(item.color, props.ctx.theme, meta?.color ?? '')
        return {
          label: meta?.label ?? item.ref.key,
          stroke: color,
          width: 1.5,
          spanGaps: true,
          paths: style.value === 'points' ? () => null : undefined,
          points: {
            show: style.value === 'points' && !fade.value,
            size: 4,
            width: 1,
            stroke: color,
            fill: color,
          },
          value: (_self: UplotInstance, value: number) =>
            value === undefined || value === null || Number.isNaN(value)
              ? ''
              : formatNumber(Number(value), meta?.decimals ?? 2),
        }
      }),
    ],
  }
}

/** 旧点淡出：按数据顺序决定 alpha（越靠左越透明）。 */
function drawFadePoints(self: UplotInstance, seriesIdx: number): void {
  const series = self.series[seriesIdx]
  if (!series) return
  const values = self.data[seriesIdx] as Array<number | null> | Float64Array | undefined
  const xs = self.data[0] as Array<number | null> | Float64Array | undefined
  if (!values || !xs) return
  const color = typeof series.stroke === 'string' ? series.stroke : 'var(--series-1)'
  const context = self.ctx
  const count = Math.min(values.length, xs.length)
  if (count === 0) return
  context.save()
  for (let index = 0; index < count; index += 1) {
    const y = values[index]
    const x = xs[index]
    if (y === null || y === undefined || x === null || x === undefined) continue
    if (!Number.isFinite(y) || !Number.isFinite(x)) continue
    const ratio = count === 1 ? 1 : index / (count - 1)
    context.globalAlpha = 0.12 + 0.88 * ratio
    context.fillStyle = color
    const left = self.valToPos(x, 'x', true)
    const top = self.valToPos(y, 'y', true)
    context.beginPath()
    context.arc(left, top, 2.2, 0, Math.PI * 2)
    context.fill()
  }
  context.restore()
}

const host = useUplot({ container, options: buildOptions, data: alignedData })

/** 最近一次真正交给 uPlot 的历史窗口（用于跳过没有新数据的帧）。 */
let lastRenderedSlices: unknown = null

function renderChart(): void {
  lastRenderedSlices = data.slices.value
  host.setData(alignedData(), true)
}

const styleSignature = computed(() =>
  JSON.stringify([
    yVariables.value.map((item) => [item.ref.source, item.ref.key, item.color]),
    data.variables.value.map((meta) => [meta.label, meta.color, meta.decimals]),
    style.value,
    fade.value,
    equalAspect.value,
    props.mode,
    themeVersion.value,
    xRange.value.min,
    xRange.value.max,
    yRange.value.min,
    yRange.value.max,
  ]),
)

watch(styleSignature, () => {
  if (!container.value) return
  if (emptyText.value !== null) return
  if (legendHost.value) legendHost.value.textContent = ''
  lastRenderedSlices = null
  void host.rebuild().then(renderChart)
})

watch(
  () => data.frameIndex.value,
  () => {
    if (data.slices.value === lastRenderedSlices) return
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
</script>

<template>
  <div
    class="chart-xy"
    :data-point-count="pointCount"
    :data-last-idx="lastIdx >= 0 ? lastIdx : ''"
    data-testid="chart-xy"
  >
    <WidgetEmpty v-if="emptyText !== null" :text="emptyText" icon />

    <div v-else class="chart-xy__layout">
      <div ref="legendHost" class="chart-xy__legend" data-testid="chart-xy-legend" />
      <div ref="container" class="chart-xy__canvas" data-testid="chart-xy-canvas" />
    </div>
  </div>
</template>

<style scoped>
.chart-xy {
  display: flex;
  width: 100%;
  height: 100%;
  min-width: 0;
  min-height: 0;
  overflow: hidden;
}

.chart-xy__layout {
  display: flex;
  flex-direction: column;
  flex: 1 1 auto;
  min-width: 0;
  min-height: 0;
}

.chart-xy__legend {
  flex: none;
  max-height: 30%;
  padding: 0 2px;
  overflow: auto;
  color: var(--text-dim);
  font-size: 10px;
}

.chart-xy__canvas {
  flex: 1 1 auto;
  width: 100%;
  height: 100%;
  min-width: 0;
  min-height: 0;
  overflow: hidden;
}

.chart-xy :deep(.u-legend) {
  color: var(--text-dim);
  font-family: var(--font-ui);
  font-size: 10px;
}

.chart-xy :deep(.u-legend .u-value) {
  color: var(--text);
  font-family: var(--font-mono);
}
</style>
