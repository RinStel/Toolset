/**
 * uPlot 图表的公共宿主（plan §8.11「图表实现要求」）。
 *
 * 约定（`widget-definition-light` 与 `check-chunks` 规则要求）：
 * - uPlot 只在组件的 `onMounted` 之后通过 `await import('uplot')`（样式一并）加载，
 *   因此 `definition.ts` 与入口闭包都不会静态引入 uPlot；
 * - 数据更新用 `setData`，不重建实例；尺寸变化用 `setSize`；
 * - 主题切换 / series 配置变化时用 `rebuild()` 重建 series 样式；
 * - `onBeforeUnmount` 时 `destroy()`。
 */

import { onBeforeUnmount, ref, shallowRef, watch, type Ref, type ShallowRef } from 'vue'

import type uPlot from 'uplot'

/** uPlot 实例类型（`uplot` 的默认导出是类，类型空间同名）。 */
export type UplotInstance = uPlot

/** uPlot 的选项 / 数据 / 路径构造器类型（供图表组件复用）。 */
export type UplotOptions = uPlot.Options
export type UplotAlignedData = uPlot.AlignedData
export type UplotPathBuilder = uPlot.Series.PathBuilder

/** uPlot 构造器类型（动态 import 的默认导出）。 */
export type UplotConstructor = typeof import('uplot')

/** `useUplot()` 的宿主参数。 */
export interface UseUplotOptions {
  /** 图表容器（`v-if` 隐藏时自动销毁）。 */
  container: Ref<HTMLElement | null>
  /** 构建 uPlot 选项；在创建 / 重建时调用，可在此读取主题色。 */
  options: (width: number, height: number) => uPlot.Options
  /** 当前数据（创建时与首次渲染使用）。 */
  data: () => uPlot.AlignedData | null
}

/** `useUplot()` 的返回值。 */
export interface UplotHost {
  chart: ShallowRef<UplotInstance | null>
  /** 实例是否已创建（uPlot 模块已加载）。 */
  ready: Ref<boolean>
  /** 创建实例（幂等）；容器不存在时什么都不做。 */
  create(): Promise<void>
  /** 销毁实例。 */
  destroy(): void
  /** 重建实例（serie 样式 / 主题 / 模式变化时）。 */
  rebuild(): Promise<void>
  /** 更新数据；`resetScales` 用于恢复自动缩放。 */
  setData(data: uPlot.AlignedData | null, resetScales?: boolean): void
  /** 更新尺寸。 */
  setSize(width: number, height: number): void
}

const MIN_CHART_WIDTH = 32
const MIN_CHART_HEIGHT = 24

let uplotConstructor: UplotConstructor | null = null
let uplotLoading: Promise<UplotConstructor> | null = null

/** 加载 uPlot（含主题样式）；模块级缓存，重复挂载不会重复下载。 */
export async function loadUplot(): Promise<UplotConstructor> {
  if (uplotConstructor !== null) return uplotConstructor
  uplotLoading ??= (async () => {
    const module = await import('uplot')
    await import('uplot/dist/uPlot.min.css')
    uplotConstructor = module.default
    return module.default
  })()
  return uplotLoading
}

/** 已加载的 uPlot 构造器（用于取 `paths` 等静态成员）；未加载时返回 `null`。 */
export function loadedUplot(): UplotConstructor | null {
  return uplotConstructor
}

function emptyAlignedData(seriesCount: number): uPlot.AlignedData {
  const length = Math.max(1, seriesCount)
  const arrays: Float64Array[] = []
  for (let index = 0; index < length; index += 1) arrays.push(new Float64Array(0))
  return arrays as unknown as uPlot.AlignedData
}

/** 创建一个 uPlot 宿主。 */
export function useUplot(host: UseUplotOptions): UplotHost {
  const chart = shallowRef<UplotInstance | null>(null)
  const ready = ref(false)
  const latestData = shallowRef<uPlot.AlignedData | null>(null)
  let createToken = 0
  let disposed = false

  function chartSize(element: HTMLElement): { width: number; height: number } {
    return {
      width: Math.max(MIN_CHART_WIDTH, element.clientWidth),
      height: Math.max(MIN_CHART_HEIGHT, element.clientHeight),
    }
  }

  async function create(): Promise<void> {
    const element = host.container.value
    if (!element || chart.value !== null) return
    const token = ++createToken
    let Constructor: UplotConstructor
    try {
      Constructor = await loadUplot()
    } catch (error) {
      console.error('[dashboard] uPlot 加载失败', error)
      return
    }
    if (disposed || token !== createToken || chart.value !== null) return
    const current = host.container.value
    if (!current) return
    const size = chartSize(current)
    // 优先取调用方的最新数据（重建时 series 数量可能已经变化）。
    const data = host.data() ?? latestData.value ?? emptyAlignedData(1)
    try {
      chart.value = new Constructor(host.options(size.width, size.height), data, current)
      ready.value = true
      if (latestData.value === null) latestData.value = data
    } catch (error) {
      console.error('[dashboard] uPlot 初始化失败', error)
      chart.value = null
      ready.value = false
    }
  }

  function destroy(): void {
    createToken += 1
    const current = chart.value
    chart.value = null
    ready.value = false
    latestData.value = null
    if (!current) return
    try {
      current.destroy()
    } catch (error) {
      console.error('[dashboard] uPlot 销毁失败', error)
    }
  }

  async function rebuild(): Promise<void> {
    destroy()
    await create()
  }

  function setData(data: uPlot.AlignedData | null, resetScales = true): void {
    latestData.value = data
    const current = chart.value
    if (!current || data === null) return
    try {
      current.setData(data, resetScales)
    } catch (error) {
      console.error('[dashboard] uPlot setData 失败', error)
    }
  }

  function setSize(width: number, height: number): void {
    const current = chart.value
    if (!current) return
    const safeWidth = Math.max(MIN_CHART_WIDTH, width)
    const safeHeight = Math.max(MIN_CHART_HEIGHT, height)
    if (current.width === safeWidth && current.height === safeHeight) return
    try {
      current.setSize({ width: safeWidth, height: safeHeight })
    } catch (error) {
      console.error('[dashboard] uPlot setSize 失败', error)
    }
  }

  watch(
    host.container,
    (element) => {
      if (element) void create()
      else destroy()
    },
    { flush: 'post' },
  )

  onBeforeUnmount(() => {
    disposed = true
    destroy()
  })

  return { chart, ready, create, destroy, rebuild, setData, setSize }
}
