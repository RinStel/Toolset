<script setup lang="ts">
/**
 * 波形图（plan §8.11 `chart.line`）。
 *
 * - uPlot 在组件挂载后懒加载（`await import('uplot')`），数据更新用 `setData`、尺寸用 `setSize`；
 * - 点数超过绘图区宽度 × 4 时先 `minMaxDecimate` 抽取，再按 x 对齐交给 uPlot；
 * - 多变量同一条 x 轴：样本序号模式用 idx，时间模式用相对最新样本的秒数（0 = 最新）；
 * - 运行模式悬停光标 + 图例数值；右上角工具栏：冻结/继续、重置缩放、导出 PNG、导出可见数据 CSV；
 * - 冻结后滚轮缩放、拖动平移；主题切换 / series 配置变化时重建样式。
 */

import { computed, onBeforeUnmount, ref, watch } from 'vue'

import { SERIES_COLORS, type VarRef } from '@/domains/dashboard/public'
import {
  EMPTY_NO_VARIABLE,
  EMPTY_SOURCE_DISCONNECTED,
  EMPTY_WAITING_DATA,
} from '@/domains/dashboard/public'
import { downloadBlob, downloadText } from '@/shared/lib/download'

import {
  alignSeries,
  decimateAligned,
  decimateRaw,
  latestTimeOf,
  plotWidthOf,
  sliceToRaw,
  type RawSeries,
} from '../shared/chart-data'
import {
  asArray,
  asBoolean,
  asNumber,
  asNumberOrNull,
  asRange,
  asString,
  asVarRef,
  clampNullable,
  formatNumber,
  resolveCanvasColor,
  seriesColorOf,
} from '../shared/format'
import type { WidgetComponentProps } from '../shared/types'
import { useThemeVersion } from '../shared/runtime'
import {
  loadedUplot,
  useUplot,
  type UplotAlignedData,
  type UplotInstance,
  type UplotOptions,
  type UplotPathBuilder,
} from '../shared/use-uplot'
import { useSingleVariable } from '../shared/use-single-variable'
import { safeFileName, timestampSuffix, widgetTitleOf } from '../shared/use-send-state'
import { useWidgetData } from '../../runtime/useWidgetData'
import WidgetEmpty from '../shared/WidgetEmpty.vue'

defineOptions({ name: 'LineChartWidget' })

const props = defineProps<WidgetComponentProps>()

/* ------------------------------------------------------------------------- */
/* 变量与窗口                                                                  */
/* ------------------------------------------------------------------------- */

interface LineVariable {
  ref: VarRef
  color: string
  lineWidth: number
  axis: 'left' | 'right'
}

/** `useWidgetData` 的历史上限；实际显示窗口再按 `window` / `windowSeconds` 裁剪。 */
const HISTORY_LAST = 20000
/**
 * 历史窗口刷新间隔（毫秒）。
 *
 * 1kHz 数据下环形缓冲的 `read()` 是 O(缓冲样本数) 的复制（plan §6.8 的契约要求返回
 * 新数组）。每帧为 8 个变量各复制一次 20000 点会产生大量分配并触发 GC 长任务
 * （plan §11.5 `@perf`）。这里让图表以 10fps 重新读取历史，`latest`/冻结等交互仍即时
 * 响应；滚动窗口读取的长度也按显示窗口动态收敛，不再固定复制 20000 点。
 */
const HISTORY_REFRESH_MS = 100

const variables = computed<LineVariable[]>(() => {
  const result: LineVariable[] = []
  const items = asArray(props.props.variables)
  for (let index = 0; index < items.length; index += 1) {
    const item = items[index]
    const ref = asVarRef(item)
    if (!ref) continue
    const record = item && typeof item === 'object' ? (item as Record<string, unknown>) : {}
    if (record.visible === false) continue
    result.push({
      ref,
      color: seriesColorOf(record.color, '', index, SERIES_COLORS),
      lineWidth: Math.min(4, Math.max(0.5, asNumberOrNull(record.lineWidth) ?? 1.5)),
      axis: asString(record.axis) === 'right' ? 'right' : 'left',
    })
  }
  return result
})

const refs = computed(() => variables.value.map((item) => item.ref))

const xMode = computed(() => (asString(props.props.xMode) === 'time' ? 'time' : 'idx'))
const windowPoints = computed(() => Math.max(10, Math.round(asNumber(props.props.window, 1000))))
const windowSeconds = computed(() => Math.max(0.1, asNumber(props.props.windowSeconds, 10)))

/** 最近一次读取得到的样本速率（样本/秒），用于时间窗口按需读取历史。 */
let estimatedRate = 0

/**
 * 历史窗口需要读取的点数。
 *
 * 样本序号模式只需要「最近 windowPoints 个点」；时间模式按估算的样本速率换算成点数，
 * 不再固定读取 20000 点。上限与之前一致（`HISTORY_LAST`），因此显示结果不变。
 */
function historyNeed(): number {
  if (xMode.value === 'idx') {
    return Math.min(HISTORY_LAST, Math.max(10, windowPoints.value + 8))
  }
  const rate = estimatedRate > 0 ? estimatedRate : 1000
  const needed = Math.ceil(windowSeconds.value * rate * 1.5) + 32
  return Math.max(64, Math.min(HISTORY_LAST, needed))
}

const data = useWidgetData(() => refs.value, {
  history: () => ({ last: historyNeed() }),
  historyRefreshMs: HISTORY_REFRESH_MS,
})

const triggerRef = computed(() => asVarRef(props.props.triggerVar))
const triggerLevel = computed(() => asNumberOrNull(props.props.triggerLevel))
const trigger = useSingleVariable(() => triggerRef.value, { last: 1 })

/* ------------------------------------------------------------------------- */
/* 外观属性                                                                    */
/* ------------------------------------------------------------------------- */

const lineStyle = computed(() => {
  const value = asString(props.props.lineStyle, 'line')
  return value === 'step' || value === 'scatter' ? value : 'line'
})
const showGrid = computed(() => asBoolean(props.props.showGrid, true))
const showLegend = computed(() => asBoolean(props.props.showLegend, true))
const legendPos = computed(() => {
  const value = asString(props.props.legendPos, 'top')
  return value === 'bottom' || value === 'right' ? value : 'top'
})
const showPoints = computed(() => asBoolean(props.props.showPoints, false))
const cursorEnabled = computed(() => asBoolean(props.props.cursor, true))
const yLeft = computed(() => asRange(props.props.yLeft))
const yRight = computed(() => asRange(props.props.yRight))

const themeVersion = useThemeVersion()

/* ------------------------------------------------------------------------- */
/* 空状态                                                                      */
/* ------------------------------------------------------------------------- */

const emptyText = computed<string | null>(() => {
  if (variables.value.length === 0) return EMPTY_NO_VARIABLE
  const states = data.sourceStates.value
  if (states.length > 0 && states.every((state) => state === 'unbound')) {
    return EMPTY_SOURCE_DISCONNECTED
  }
  const hasSample = data.slices.value.some((slice) => slice.v.length > 0)
  if (!hasSample && data.latest.value.every((value) => value === undefined)) {
    return EMPTY_WAITING_DATA
  }
  return null
})

/* ------------------------------------------------------------------------- */
/* 数据组装                                                                    */
/* ------------------------------------------------------------------------- */

const pointCount = ref(0)
const lastIdx = ref(-1)

interface ChartData {
  aligned: ReturnType<typeof alignSeries>
  lastIdx: number
}

function sliceArrayLike(array: ArrayLike<number>, start: number): ArrayLike<number> {
  if (array instanceof Float64Array) return array.subarray(start)
  return Array.prototype.slice.call(array, start) as ArrayLike<number>
}

function sliceWindow(series: RawSeries): RawSeries {
  if (xMode.value === 'idx') {
    const length = Math.min(series.x.length, series.y.length)
    const start = Math.max(0, length - windowPoints.value)
    if (start === 0) return series
    return {
      x: sliceArrayLike(series.x, start),
      y: sliceArrayLike(series.y, start),
    }
  }
  const keepX: number[] = []
  const keepY: number[] = []
  const limit = -windowSeconds.value
  for (let point = 0; point < series.x.length; point += 1) {
    const x = series.x[point] as number
    if (x < limit - 0.001) continue
    keepX.push(x)
    keepY.push(series.y[point] as number)
  }
  return { x: keepX, y: keepY }
}

/** 从读取到的历史窗口估算样本速率（样本/秒），用于时间模式的按需读取长度。 */
function updateEstimatedRate(
  slices: readonly { idx: ArrayLike<number>; t: ArrayLike<number> }[],
): void {
  let best = 0
  for (const slice of slices) {
    const length = slice.idx.length
    if (length < 2) continue
    const firstIdx = slice.idx[0] as number
    const lastIdx = slice.idx[length - 1] as number
    const firstT = slice.t[0] as number
    const lastT = slice.t[length - 1] as number
    const spanSeconds = (lastT - firstT) / 1000
    if (!(spanSeconds > 0) || !(lastIdx > firstIdx)) continue
    const rate = (lastIdx - firstIdx) / spanSeconds
    if (Number.isFinite(rate) && rate > best) best = rate
  }
  if (best > 0) estimatedRate = best
}

function buildChartData(): ChartData | null {
  const items = variables.value
  if (items.length === 0) return null
  const slices = data.slices.value
  updateEstimatedRate(slices)
  const latestT = latestTimeOf(slices)
  const buckets = plotWidthOf(props.size.width)
  const raw: RawSeries[] = []
  let last = -1

  for (let index = 0; index < items.length; index += 1) {
    const slice = slices[index]
    if (!slice) continue
    const sliceLast = slice.idx.length > 0 ? (slice.idx[slice.idx.length - 1] as number) : -1
    if (sliceLast > last) last = sliceLast
    const windowed = sliceWindow(sliceToRaw(slice, xMode.value, latestT))
    raw.push(decimateRaw(windowed, buckets))
  }

  let aligned = alignSeries(raw)
  if (aligned.pointCount > buckets * 4) aligned = decimateAligned(aligned, buckets)
  return { aligned, lastIdx: last }
}

function alignedData(): UplotAlignedData | null {
  const built = buildChartData()
  if (!built) return null
  pointCount.value = built.aligned.pointCount
  lastIdx.value = built.lastIdx
  const x = Float64Array.from(built.aligned.x)
  return [x, ...built.aligned.ys] as unknown as UplotAlignedData
}

/* ------------------------------------------------------------------------- */
/* uPlot 宿主                                                                  */
/* ------------------------------------------------------------------------- */

const container = ref<HTMLElement | null>(null)
const legendHost = ref<HTMLElement | null>(null)

function themeColor(cssVar: string, fallback: string): string {
  const value = props.ctx.theme(cssVar)
  return value.length > 0 ? value : fallback
}

function headerValue(value: number | undefined): string {
  return value === undefined || value === null ? '' : formatNumber(Number(value), 1)
}

function buildOptions(width: number, height: number): UplotOptions {
  const gridColor = themeColor('--border', '#262c38')
  const textColor = themeColor('--text-faint', '#687185')
  const fontUi = themeColor('--font-ui', 'system-ui, sans-serif')
  const axisFont = `11px ${fontUi}`
  const items = variables.value
  const hasRight = items.some((item) => item.axis === 'right')

  const stepBuilder: UplotPathBuilder | undefined =
    lineStyle.value === 'step' ? loadedUplot()?.paths?.stepped?.({ align: 1 }) : undefined
  const scatterBuilder: UplotPathBuilder | undefined =
    lineStyle.value === 'scatter' ? () => null : undefined

  const options: UplotOptions = {
    width,
    height,
    padding: [4, 6, 0, 0],
    cursor: {
      show: props.mode === 'run' && cursorEnabled.value,
      x: true,
      y: false,
      drag: { setScale: false, x: false, y: false },
      points: { show: false },
    },
    legend: {
      show: showLegend.value,
      live: true,
      mount: (_self, element) => {
        legendHost.value?.appendChild(element)
      },
    },
    scales: {
      x: { time: false },
      y: {
        range: (_self, initMin, initMax) => [
          clampNullable(initMin, yLeft.value.min, yLeft.value.max),
          clampNullable(initMax, yLeft.value.min, yLeft.value.max),
        ],
      },
    },
    axes: [
      {
        scale: 'x',
        side: 2,
        stroke: textColor,
        font: axisFont,
        grid: { show: showGrid.value, stroke: gridColor, width: 1 },
        ticks: { show: showGrid.value, stroke: gridColor, width: 1 },
        values: (_self, splits) =>
          splits.map((value) =>
            xMode.value === 'idx' ? String(Math.round(value)) : formatNumber(value, 1),
          ),
      },
      {
        scale: 'y',
        side: 3,
        stroke: textColor,
        font: axisFont,
        grid: { show: showGrid.value, stroke: gridColor, width: 1 },
        ticks: { show: showGrid.value, stroke: gridColor, width: 1 },
      },
    ],
    series: [
      {
        label: xMode.value === 'idx' ? '样本' : '时间 (s)',
        value: (_self: UplotInstance, value: number) => headerValue(value),
      },
      ...items.map((item, index) => {
        const meta = data.variables.value[index]
        const color = resolveCanvasColor(item.color, props.ctx.theme, meta?.color ?? '')
        return {
          label: meta?.label ?? item.ref.key,
          scale: item.axis === 'right' ? 'y2' : 'y',
          stroke: color,
          width: item.lineWidth,
          paths:
            lineStyle.value === 'step'
              ? stepBuilder
              : lineStyle.value === 'scatter'
                ? scatterBuilder
                : undefined,
          points: {
            show: showPoints.value || lineStyle.value === 'scatter',
            size: lineStyle.value === 'scatter' ? 4 : 3,
            width: 1,
            stroke: color,
            fill: color,
          },
          value: (_self: UplotInstance, value: number) => {
            if (value === undefined || value === null || Number.isNaN(value)) return ''
            return formatNumber(Number(value), meta?.decimals ?? 2)
          },
        }
      }),
    ],
  }

  if (hasRight) {
    options.scales = {
      ...options.scales,
      y2: {
        range: (_self, initMin, initMax) => [
          clampNullable(initMin, yRight.value.min, yRight.value.max),
          clampNullable(initMax, yRight.value.min, yRight.value.max),
        ],
      },
    }
    options.axes = [
      ...(options.axes ?? []),
      {
        scale: 'y2',
        side: 1,
        stroke: textColor,
        font: axisFont,
        grid: { show: false, stroke: gridColor, width: 1 },
        ticks: { show: showGrid.value, stroke: gridColor, width: 1 },
      },
    ]
  }

  return options
}

const host = useUplot({ container, options: buildOptions, data: alignedData })

const frozen = ref(false)

/** 最近一次真正交给 uPlot 的历史窗口（用于跳过没有新数据的帧）。 */
let lastRenderedSlices: unknown = null

function renderChart(): void {
  lastRenderedSlices = data.slices.value
  host.setData(alignedData(), true)
}

function rebuildChart(): void {
  if (!container.value) return
  if (legendHost.value) legendHost.value.textContent = ''
  lastRenderedSlices = null
  void host.rebuild().then(() => {
    attachInteractions()
    renderChart()
  })
}

/* ------------------------------------------------------------------------- */
/* 冻结 / 滚轮缩放 / 拖动平移                                                  */
/* ------------------------------------------------------------------------- */

let overElement: HTMLElement | null = null
let panning = false
let panStartX = 0
let panStartMin = 0
let panStartMax = 0

function chartInstance(): UplotInstance | null {
  return host.chart.value
}

function xScaleSpan(): { min: number; max: number } | null {
  const chart = chartInstance()
  const scale = chart?.scales['x']
  if (!scale || scale.min === undefined || scale.max === undefined) return null
  return { min: scale.min, max: scale.max }
}

function onWheel(event: WheelEvent): void {
  if (props.mode !== 'run' || !frozen.value) return
  const chart = chartInstance()
  const span = xScaleSpan()
  if (!chart || !span) return
  event.preventDefault()
  const rect = overElement?.getBoundingClientRect()
  const left = rect ? event.clientX - rect.left : chart.width / 2
  const anchor = chart.posToVal(left, 'x')
  const factor = event.deltaY < 0 ? 0.8 : 1.25
  const nextMin = anchor - (anchor - span.min) * factor
  const nextMax = anchor + (span.max - anchor) * factor
  if (nextMax - nextMin < 1e-6) return
  chart.setScale('x', { min: nextMin, max: nextMax })
}

function onPointerDown(event: PointerEvent): void {
  if (props.mode !== 'run' || !frozen.value) return
  const span = xScaleSpan()
  if (!span) return
  panning = true
  panStartX = event.clientX
  panStartMin = span.min
  panStartMax = span.max
  overElement?.setPointerCapture?.(event.pointerId)
}

function onPointerMove(event: PointerEvent): void {
  if (!panning || !frozen.value) return
  const chart = chartInstance()
  if (!chart) return
  const width = Math.max(1, chart.bbox.width)
  const valuePerPixel = (panStartMax - panStartMin) / width
  const delta = (event.clientX - panStartX) * valuePerPixel
  chart.setScale('x', { min: panStartMin - delta, max: panStartMax - delta })
}

function onPointerUp(): void {
  panning = false
}

function detachInteractions(): void {
  const element = overElement
  overElement = null
  if (!element) return
  element.removeEventListener('wheel', onWheel)
  element.removeEventListener('pointerdown', onPointerDown)
  element.removeEventListener('pointermove', onPointerMove)
  element.removeEventListener('pointerup', onPointerUp)
  element.removeEventListener('pointerleave', onPointerUp)
}

function attachInteractions(): void {
  detachInteractions()
  const chart = chartInstance()
  if (!chart) return
  const element = chart.over
  if (!element) return
  overElement = element
  element.addEventListener('wheel', onWheel, { passive: false })
  element.addEventListener('pointerdown', onPointerDown)
  element.addEventListener('pointermove', onPointerMove)
  element.addEventListener('pointerup', onPointerUp)
  element.addEventListener('pointerleave', onPointerUp)
}

function toggleFreeze(): void {
  frozen.value = !frozen.value
  if (!frozen.value) renderChart()
}

function resetZoom(): void {
  renderChart()
}

/* ------------------------------------------------------------------------- */
/* 导出                                                                        */
/* ------------------------------------------------------------------------- */

function exportFileName(extension: string): string {
  return `${safeFileName(widgetTitleOf(props.instance, '波形图'))}_${timestampSuffix()}.${extension}`
}

function exportPng(): void {
  const canvas = chartInstance()?.ctx.canvas
  if (!canvas) return
  const filename = exportFileName('png')
  if (typeof canvas.toBlob === 'function') {
    canvas.toBlob((blob) => {
      if (blob) downloadBlob(blob, filename)
    }, 'image/png')
    return
  }
  const anchor = document.createElement('a')
  anchor.href = canvas.toDataURL('image/png')
  anchor.download = filename
  anchor.click()
}

function exportCsv(): void {
  const built = buildChartData()
  if (!built) return
  const labels = [
    xMode.value === 'idx' ? 'idx' : 'time_s',
    ...variables.value.map((item, index) => data.variables.value[index]?.label ?? item.ref.key),
  ]
  const rows: string[] = [labels.join(',')]
  const span = frozen.value ? xScaleSpan() : null
  for (let index = 0; index < built.aligned.x.length; index += 1) {
    const x = built.aligned.x[index] as number
    if (span && (x < span.min || x > span.max)) continue
    const cells = [String(x)]
    for (const values of built.aligned.ys) {
      const value = values[index]
      cells.push(value === null || value === undefined ? '' : String(value))
    }
    rows.push(cells.join(','))
  }
  downloadText(`\uFEFF${rows.join('\r\n')}`, exportFileName('csv'), 'text/csv;charset=utf-8')
}

/* ------------------------------------------------------------------------- */
/* 响应与生命周期                                                              */
/* ------------------------------------------------------------------------- */

watch(host.ready, (ready) => {
  if (ready) attachInteractions()
  else detachInteractions()
})

const styleSignature = computed(() =>
  JSON.stringify([
    variables.value.map((item) => [
      item.ref.source,
      item.ref.key,
      item.color,
      item.axis,
      item.lineWidth,
    ]),
    data.variables.value.map((meta) => [meta.label, meta.color, meta.decimals]),
    lineStyle.value,
    showPoints.value,
    showGrid.value,
    showLegend.value,
    legendPos.value,
    cursorEnabled.value,
    props.mode,
    themeVersion.value,
    xMode.value,
    yLeft.value.min,
    yLeft.value.max,
    yRight.value.min,
    yRight.value.max,
  ]),
)

watch(styleSignature, () => {
  if (!container.value) return
  rebuildChart()
})

watch(
  () => data.frameIndex.value,
  () => {
    if (frozen.value) return
    // 历史窗口未刷新（`historyRefreshMs` 节流期间）时无需重新 setData。
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

watch(
  () => trigger.value.value,
  (value, previous) => {
    const level = triggerLevel.value
    if (level === null || value === undefined || previous === undefined) return
    if (previous < level && value >= level && !frozen.value) frozen.value = true
  },
)

onBeforeUnmount(() => {
  detachInteractions()
})
</script>

<template>
  <div
    class="chart-line"
    :data-point-count="pointCount"
    :data-last-idx="lastIdx >= 0 ? lastIdx : ''"
    :data-frozen="frozen ? 'true' : 'false'"
    data-testid="chart-line"
  >
    <WidgetEmpty v-if="emptyText !== null" :text="emptyText" icon />

    <div v-else class="chart-line__layout" :class="`is-legend-${legendPos}`">
      <div
        v-if="showLegend"
        ref="legendHost"
        class="chart-line__legend"
        :class="`is-${legendPos}`"
        data-testid="chart-line-legend"
      />

      <div class="chart-line__plot">
        <div ref="container" class="chart-line__canvas" data-testid="chart-line-canvas" />

        <div class="chart-line__toolbar" @pointerdown.stop>
          <button
            class="chart-line__tool"
            type="button"
            :title="frozen ? '继续刷新' : '冻结画面'"
            data-testid="chart-line-freeze"
            @click="toggleFreeze"
          >
            {{ frozen ? '继续' : '冻结' }}
          </button>
          <button
            class="chart-line__tool"
            type="button"
            title="重置缩放"
            data-testid="chart-line-reset"
            @click="resetZoom"
          >
            重置
          </button>
          <button
            class="chart-line__tool"
            type="button"
            title="导出 PNG"
            data-testid="chart-line-png"
            @click="exportPng"
          >
            PNG
          </button>
          <button
            class="chart-line__tool"
            type="button"
            title="导出可见数据 CSV"
            data-testid="chart-line-csv"
            @click="exportCsv"
          >
            CSV
          </button>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.chart-line {
  display: flex;
  flex-direction: column;
  width: 100%;
  height: 100%;
  min-width: 0;
  min-height: 0;
  overflow: hidden;
}

.chart-line__layout {
  display: flex;
  flex: 1 1 auto;
  min-width: 0;
  min-height: 0;
}

.chart-line__layout.is-legend-top,
.chart-line__layout.is-legend-bottom {
  flex-direction: column;
}

.chart-line__layout.is-legend-right {
  flex-direction: row;
}

.chart-line__plot {
  position: relative;
  display: flex;
  flex: 1 1 auto;
  min-width: 0;
  min-height: 0;
  order: 1;
}

.chart-line__canvas {
  flex: 1 1 auto;
  width: 100%;
  height: 100%;
  min-width: 0;
  min-height: 0;
  overflow: hidden;
}

.chart-line__legend {
  flex: none;
  min-width: 0;
  padding: 0 2px;
  overflow: auto;
  color: var(--text-dim);
  font-size: 10px;
}

.chart-line__legend.is-top {
  order: 0;
  max-height: 40%;
}

.chart-line__legend.is-bottom {
  order: 2;
  max-height: 30%;
}

.chart-line__legend.is-right {
  order: 2;
  width: 34%;
  max-width: 220px;
  border-left: 1px solid var(--border);
  padding-left: 6px;
}

.chart-line__toolbar {
  position: absolute;
  top: 0;
  right: 0;
  z-index: 2;
  display: flex;
  gap: 2px;
  padding: 2px;
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  background: color-mix(in srgb, var(--bg-elev) 86%, transparent);
  opacity: 0.55;
  transition: opacity 120ms ease;
}

.chart-line__plot:hover .chart-line__toolbar,
.chart-line__toolbar:focus-within {
  opacity: 1;
}

.chart-line__tool {
  min-width: 22px;
  height: 18px;
  padding: 0 4px;
  border: 1px solid transparent;
  border-radius: var(--radius-sm);
  background: transparent;
  color: var(--text-dim);
  font-size: 10px;
  line-height: 1;
  cursor: pointer;
}

.chart-line__tool:hover {
  border-color: var(--border);
  background: var(--bg-hover);
  color: var(--text);
}

.chart-line__tool:focus-visible {
  outline: none;
  box-shadow: var(--focus-ring);
}

.chart-line :deep(.u-legend) {
  color: var(--text-dim);
  font-family: var(--font-ui);
  font-size: 10px;
}

.chart-line :deep(.u-legend .u-series > th) {
  border-color: var(--border);
}

.chart-line :deep(.u-legend .u-value) {
  color: var(--text);
  font-family: var(--font-mono);
}

.chart-line :deep(.u-select) {
  background: color-mix(in srgb, var(--accent) 22%, transparent);
}
</style>
