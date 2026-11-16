<script setup lang="ts">
/**
 * 变量表（plan §8.11 `value.table`）。
 *
 * `variables` 为空时显示 `source`（留空 = 默认数据源）的全部变量；列开关控制显示
 * 值 / 最小 / 最大 / 平均 / 速率 / 样本数；表头「重置统计」调用 `resetStats()`。
 */

import { computed, onBeforeUnmount, ref, shallowRef, watch } from 'vue'

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
  asString,
  asVarRef,
  normalizeDecimals,
  seriesColorOf,
} from '../shared/format'
import type { WidgetComponentProps } from '../shared/types'
import { useDashboardRuntime, useDefaultSource } from '../shared/runtime'
import { useWidgetData } from '../../runtime/useWidgetData'
import WidgetEmpty from '../shared/WidgetEmpty.vue'

defineOptions({ name: 'TableValueWidget' })

const props = defineProps<WidgetComponentProps>()

const runtime = useDashboardRuntime()
const defaultSource = useDefaultSource()

const sourceAlias = computed(() => {
  const configured = asString(props.props.source).trim()
  return configured.length > 0 ? configured : defaultSource.value
})

const explicitRefs = computed<VarRef[]>(() => {
  const result: VarRef[] = []
  for (const item of asArray(props.props.variables)) {
    const ref = asVarRef(item)
    if (ref) result.push(ref)
  }
  return result
})

const usesAllVariables = computed(() => explicitRefs.value.length === 0)

/** 变量列表变化的重新计算触发（`runtime.variables()` 不是响应式的）。 */
const refsVersion = ref(0)

const refs = computed<VarRef[]>(() => {
  void refsVersion.value
  if (!usesAllVariables.value) return explicitRefs.value
  const alias = sourceAlias.value
  return runtime?.variables(alias).map((info) => ({ source: alias, key: info.key })) ?? []
})

const data = useWidgetData(() => refs.value)

let lastAutoKeys = ''

watch(
  () => data.frameIndex.value,
  () => {
    // 「显示该数据源的全部变量」时，只在变量列表实际增减时刷新 `refs`，避免每帧重建计算链。
    if (!usesAllVariables.value) return
    const alias = sourceAlias.value
    const keys = (runtime?.variables(alias) ?? []).map((info) => info.key).join('\u0000')
    if (keys !== lastAutoKeys) {
      lastAutoKeys = keys
      refsVersion.value += 1
    }
  },
)

const columns = computed(() => ({
  value: asBoolean(props.props.colValue, true),
  min: asBoolean(props.props.colMin, false),
  max: asBoolean(props.props.colMax, false),
  mean: asBoolean(props.props.colMean, false),
  rate: asBoolean(props.props.colRate, false),
  count: asBoolean(props.props.colCount, false),
}))

const compact = computed(() => asBoolean(props.props.compact, false))

interface TableRow {
  key: string
  label: string
  unit: string
  color: string
  decimals: number
  valueText: string
  minText: string
  maxText: string
  meanText: string
  rateText: string
  countText: string
}

function formatWith(value: number | undefined, decimals: number): string {
  if (value === undefined || !Number.isFinite(value)) return '--'
  return value.toFixed(normalizeDecimals(decimals, 2))
}

function buildRows(): TableRow[] {
  const alias = sourceAlias.value
  const infos = runtime?.variables(alias) ?? []
  const infoByKey = new Map(infos.map((info) => [info.key, info]))
  const explicit = asArray(props.props.variables)

  return refs.value.map((ref, index) => {
    const meta = data.variables.value[index]
    const info = infoByKey.get(ref.key)
    const decimals = meta?.decimals ?? 2
    const item = explicit[index]
    const itemColor =
      item && typeof item === 'object' ? (item as Record<string, unknown>).color : undefined
    const waitText = '--'
    return {
      key: `${ref.source}/${ref.key}`,
      label: meta?.label ?? ref.key,
      unit: meta?.unit ?? '',
      color: seriesColorOf(itemColor, meta?.color ?? '', index, SERIES_COLORS),
      decimals,
      valueText: info ? formatWith(data.latest.value[index], decimals) : waitText,
      minText: info ? formatWith(info.min, decimals) : waitText,
      maxText: info ? formatWith(info.max, decimals) : waitText,
      meanText: info ? formatWith(info.mean, decimals) : waitText,
      rateText: info ? `${info.rate.toFixed(1)} Hz` : waitText,
      countText: info ? String(info.count) : waitText,
    }
  })
}

/** 高频流下表格不需要 30fps 重算与 DOM 补丁；限制到 10fps，并在停流后补刷最终统计值。 */
const TABLE_REFRESH_MS = 100
const rows = shallowRef<TableRow[]>([])
let lastRowsUpdateAt = Number.NEGATIVE_INFINITY
let throttleTimer: ReturnType<typeof setTimeout> | null = null

function clearThrottleTimer(): void {
  if (throttleTimer !== null) {
    clearTimeout(throttleTimer)
    throttleTimer = null
  }
}

function nowMs(): number {
  return typeof performance !== 'undefined' ? performance.now() : Date.now()
}

function refreshRowsNow(): void {
  clearThrottleTimer()
  lastRowsUpdateAt = nowMs()
  rows.value = buildRows()
}

watch(
  () => [refs.value, sourceAlias.value, data.variables.value, props.props.variables] as const,
  () => {
    refreshRowsNow()
  },
  { immediate: true },
)

watch(
  () => data.frameIndex.value,
  () => {
    const elapsed = nowMs() - lastRowsUpdateAt
    if (elapsed >= TABLE_REFRESH_MS) {
      refreshRowsNow()
      return
    }
    if (throttleTimer === null) {
      throttleTimer = setTimeout(
        () => {
          throttleTimer = null
          refreshRowsNow()
        },
        Math.max(10, TABLE_REFRESH_MS - elapsed),
      )
    }
  },
)

onBeforeUnmount(() => {
  clearThrottleTimer()
})

const emptyText = computed<string | null>(() => {
  const alias = sourceAlias.value
  const state = runtime?.sourceState(alias) ?? 'unbound'
  if (state === 'unbound') return EMPTY_SOURCE_DISCONNECTED
  if (refs.value.length === 0) {
    return usesAllVariables.value ? EMPTY_WAITING_DATA : EMPTY_NO_VARIABLE
  }
  return null
})

const resetting = computed(() => runtime?.series(sourceAlias.value) !== undefined)

function resetStats(): void {
  runtime?.series(sourceAlias.value)?.resetStats()
  props.ctx.requestUpdate()
  refreshRowsNow()
}

function columnCount(): number {
  const current = columns.value
  let count = 1
  if (current.value) count += 1
  if (current.min) count += 1
  if (current.max) count += 1
  if (current.mean) count += 1
  if (current.rate) count += 1
  if (current.count) count += 1
  return count
}
</script>

<template>
  <div
    class="value-table"
    :class="{ 'is-compact': compact }"
    :data-row-count="rows.length"
    data-testid="value-table"
  >
    <WidgetEmpty v-if="emptyText !== null" :text="emptyText" />

    <div v-else class="value-table__wrap">
      <div class="value-table__header">
        <span class="value-table__source">{{ sourceAlias }}</span>
        <span class="value-table__spacer" />
        <button
          class="value-table__reset"
          type="button"
          :disabled="!resetting"
          data-testid="value-table-reset-stats"
          @click="resetStats"
        >
          重置统计
        </button>
      </div>

      <table class="value-table__table" :data-columns="columnCount()">
        <thead>
          <tr>
            <th class="value-table__name">变量</th>
            <th v-if="columns.value" class="value-table__num">值</th>
            <th v-if="columns.min" class="value-table__num">最小</th>
            <th v-if="columns.max" class="value-table__num">最大</th>
            <th v-if="columns.mean" class="value-table__num">平均</th>
            <th v-if="columns.rate" class="value-table__num">速率</th>
            <th v-if="columns.count" class="value-table__num">样本数</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="row in rows" :key="row.key" data-testid="value-table-row">
            <th class="value-table__name">
              <span
                class="value-table__dot"
                :style="{ background: row.color }"
                aria-hidden="true"
              />
              <span class="value-table__label" :title="row.label">{{ row.label }}</span>
              <span v-if="row.unit.length > 0" class="value-table__unit">{{ row.unit }}</span>
            </th>
            <td v-if="columns.value" class="value-table__num">{{ row.valueText }}</td>
            <td v-if="columns.min" class="value-table__num">{{ row.minText }}</td>
            <td v-if="columns.max" class="value-table__num">{{ row.maxText }}</td>
            <td v-if="columns.mean" class="value-table__num">{{ row.meanText }}</td>
            <td v-if="columns.rate" class="value-table__num">{{ row.rateText }}</td>
            <td v-if="columns.count" class="value-table__num">{{ row.countText }}</td>
          </tr>
        </tbody>
      </table>
    </div>
  </div>
</template>

<style scoped>
.value-table {
  display: flex;
  flex-direction: column;
  width: 100%;
  height: 100%;
  min-width: 0;
  min-height: 0;
  overflow: hidden;
  font-size: 11px;
}

.value-table__wrap {
  display: flex;
  flex-direction: column;
  min-width: 0;
  min-height: 0;
  height: 100%;
}

.value-table__header {
  display: flex;
  align-items: center;
  gap: 6px;
  flex: none;
  height: 20px;
  color: var(--text-faint);
  font-size: 10px;
}

.value-table__source {
  font-family: var(--font-mono);
}

.value-table__spacer {
  flex: 1 1 auto;
}

.value-table__reset {
  height: 18px;
  padding: 0 5px;
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  background: var(--bg-elev-2);
  color: var(--text-dim);
  font-size: 10px;
  cursor: pointer;
}

.value-table__reset:hover:not(:disabled) {
  border-color: var(--accent);
  color: var(--text);
}

.value-table__reset:disabled {
  opacity: 0.5;
  cursor: default;
}

.value-table__table {
  flex: 1 1 auto;
  width: 100%;
  min-height: 0;
  overflow: auto;
  border-collapse: collapse;
  font-variant-numeric: tabular-nums;
}

.value-table__table thead th {
  position: sticky;
  top: 0;
  z-index: 1;
  padding: 1px 4px;
  border-bottom: 1px solid var(--border);
  background: var(--bg-elev);
  color: var(--text-faint);
  font-weight: 500;
  text-align: left;
  white-space: nowrap;
}

.value-table__table tbody th,
.value-table__table tbody td {
  padding: 1px 4px;
  border-bottom: 1px solid color-mix(in srgb, var(--border) 55%, transparent);
  font-weight: 400;
  text-align: left;
  white-space: nowrap;
}

.is-compact .value-table__table tbody th,
.is-compact .value-table__table tbody td {
  padding: 0 4px;
  font-size: 10px;
}

.value-table__name {
  display: flex;
  align-items: center;
  gap: 4px;
  min-width: 0;
  max-width: 0;
  width: 100%;
}

.value-table__dot {
  flex: none;
  width: 6px;
  height: 6px;
  border-radius: 50%;
}

.value-table__label {
  flex: 1 1 auto;
  overflow: hidden;
  color: var(--text);
  text-overflow: ellipsis;
}

.value-table__unit {
  flex: none;
  color: var(--text-faint);
  font-size: 9px;
}

.value-table__num {
  text-align: right;
  color: var(--text);
  font-family: var(--font-mono);
}
</style>
