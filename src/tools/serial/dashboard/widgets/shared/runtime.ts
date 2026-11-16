/**
 * 内置组件对仪表盘运行时的只读访问（plan §8.10 / §8.11）。
 *
 * 数据读取仍然只允许通过 `useWidgetData`；这里只用于：
 * - 取默认数据源 alias（`value.text` / `value.table`）；
 * - 读取变量统计（`value.table` 的 min/max/mean/rate/count）与 `resetStats`；
 * - 订阅主题切换（图表重建 series 配色）。
 */

import { computed, inject, onBeforeUnmount, onMounted, ref, type ComputedRef, type Ref } from 'vue'

import { DEFAULT_SOURCE_ALIAS } from '@/domains/dashboard/public'

import type { DashboardRuntime } from '../../runtime/context'
import { DASHBOARD_RUNTIME_KEY } from '../../runtime/injection-keys'

/** 取注入的运行时；测试或独立预览时可能没有，返回 `null`。 */
export function useDashboardRuntime(): DashboardRuntime | null {
  return inject(DASHBOARD_RUNTIME_KEY, null)
}

/** 默认数据源 alias（仪表盘第一个数据源）。 */
export function useDefaultSource(): ComputedRef<string> {
  const runtime = useDashboardRuntime()
  return computed(() => runtime?.defaultAlias() ?? DEFAULT_SOURCE_ALIAS)
}

/** 主题变化计数；图表在它变化时重建 uPlot 的 series 样式（plan §8.11）。 */
export function useThemeVersion(): Ref<number> {
  const runtime = useDashboardRuntime()
  const version = ref(0)
  let unsubscribe: (() => void) | null = null

  onMounted(() => {
    if (!runtime) return
    unsubscribe = runtime.onThemeChange(() => {
      version.value += 1
    })
  })

  onBeforeUnmount(() => {
    unsubscribe?.()
    unsubscribe = null
  })

  return version
}
