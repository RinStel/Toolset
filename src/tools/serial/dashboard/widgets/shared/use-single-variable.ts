/**
 * 单变量组件的公共数据视图（plan §8.11「公共约定」）。
 *
 * `value.number` / `value.gauge` / `value.led` / `chart.fft` 以及控件的
 * `feedbackVar` 都只需要一个变量；这里统一通过 `useWidgetData`（唯一数据读取入口）
 * 取显示值、元信息与空状态文案。
 */

import { computed, type ComputedRef } from 'vue'

import {
  EMPTY_NO_VARIABLE,
  EMPTY_SOURCE_DISCONNECTED,
  EMPTY_WAITING_DATA,
  type VarRef,
} from '@/domains/dashboard/public'

import type { DashboardSourceState, DashboardVariableMeta } from '../../runtime/context'
import {
  useWidgetData,
  type WidgetData,
  type WidgetDataHistoryOptions,
  type WidgetDataOptions,
} from '../../runtime/useWidgetData'

function fallbackMeta(ref: VarRef | null): DashboardVariableMeta {
  return {
    source: ref?.source ?? '',
    key: ref?.key ?? '',
    label: ref?.key ?? '',
    unit: '',
    color: 'var(--series-1)',
    decimals: 2,
    scale: 1,
    offset: 0,
    computed: ref?.key.startsWith('fx.') ?? false,
  }
}

/** 单变量视图。 */
export interface SingleVariableView {
  data: WidgetData
  /** 变量元信息（显示名、单位、颜色、小数位）；未绑定时为占位值。 */
  meta: ComputedRef<DashboardVariableMeta>
  /** 显示值（已应用 scale/offset）。 */
  value: ComputedRef<number | undefined>
  /** 数据源状态。 */
  sourceState: ComputedRef<DashboardSourceState>
  /** 空状态文案；有数据时为 `null`。 */
  empty: ComputedRef<string | null>
}

/**
 * @param ref 变量的 getter（未绑定时返回 `null`）
 * @param history 历史窗口（`chart.fft` 需要最近 `size` 个样本）
 * @param options 其他数据读取选项（例如 `historyRefreshMs` 降低历史复制频率）
 */
export function useSingleVariable(
  ref: () => VarRef | null,
  history?: WidgetDataHistoryOptions | (() => WidgetDataHistoryOptions),
  options?: Omit<WidgetDataOptions, 'history'>,
): SingleVariableView {
  const data = useWidgetData(
    () => {
      const current = ref()
      return current ? [current] : []
    },
    { ...(history !== undefined ? { history } : {}), ...options },
  )

  const meta = computed<DashboardVariableMeta>(() => {
    const current = ref()
    return data.variables.value[0] ?? fallbackMeta(current)
  })

  const value = computed(() => data.latest.value[0])

  const sourceState = computed<DashboardSourceState>(
    () => data.sourceStates.value[0] ?? (ref() === null ? 'unbound' : 'open'),
  )

  const empty = computed<string | null>(() => {
    if (ref() === null) return EMPTY_NO_VARIABLE
    if (sourceState.value === 'unbound') return EMPTY_SOURCE_DISCONNECTED
    if (value.value === undefined || !Number.isFinite(value.value)) return EMPTY_WAITING_DATA
    return null
  })

  return { data, meta, value, sourceState, empty }
}
