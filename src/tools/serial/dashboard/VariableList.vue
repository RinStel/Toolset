<script setup lang="ts">
/**
 * 变量列表（plan §8.10「变量列表」）。
 *
 * 显示所选数据源的全部变量：颜色点、显示名、最新值、单位、迷你曲线、速率；
 * 计算变量用 `fx` 徽标标出，出错时显示红色感叹号。点击变量名编辑 `variableMeta`，
 * 「+ 计算变量」打开带实时预览的对话框。行可以直接拖到画布或组件的变量属性上
 * （HTML5 拖放，MIME 为 `application/x-toolset-variable`）。
 */

import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { AlertCircle, Plus, Sparkles } from 'lucide-vue-next'

import type { Dashboard, VarRef } from '@/domains/dashboard/public'
import { isValidVariableKey } from '@/domains/protocol/public'
import type { ComputedVariable } from '@/domains/series/public'
import type { DashboardRuntime } from './runtime/context'
import UiButton from '@/shared/ui/components/UiButton.vue'
import UiColorInput from '@/shared/ui/components/UiColorInput.vue'
import UiDialog from '@/shared/ui/components/UiDialog.vue'
import UiFormField from '@/shared/ui/components/UiFormField.vue'
import UiInput from '@/shared/ui/components/UiInput.vue'
import UiNumberInput from '@/shared/ui/components/UiNumberInput.vue'
import { serialSettings } from '../stores/settings'

const props = defineProps<{
  paneIndex: number
  dashboard: Dashboard
  runtime: DashboardRuntime
  mode: 'edit' | 'run'
}>()

const emit = defineEmits<{
  'update-meta': [payload: { source: string; key: string; patch: Record<string, unknown> }]
  'add-computed': [payload: { source: string; computed: ComputedVariable }]
  'remove-computed': [payload: { source: string; key: string }]
}>()

const selectedSource = ref(props.dashboard.sources[0]?.alias ?? 'main')

watch(
  () => props.dashboard.sources,
  (sources) => {
    if (!sources.some((source) => source.alias === selectedSource.value)) {
      selectedSource.value = sources[0]?.alias ?? 'main'
    }
  },
  { deep: true },
)

/** 手动刷新节拍：变量列表不经过仪表盘刷新调度（暂停全部时仍要能看数据）。 */
const tick = ref(0)
let timer: ReturnType<typeof setInterval> | null = null

onMounted(() => {
  // 500ms：1kHz 场景下每次节拍都要读变量统计与迷你曲线（`read()` 是 O(缓冲样本数)），
  // 降低一半读取频率即可满足肉眼刷新需求（plan §11.5 `@perf`）。
  timer = setInterval(() => {
    tick.value += 1
  }, 500)
})

onBeforeUnmount(() => {
  if (timer !== null) clearInterval(timer)
  timer = null
})

const source = computed(() => {
  void tick.value
  return props.runtime.series(selectedSource.value)
})

interface VariableRow {
  key: string
  label: string
  unit: string
  color: string
  decimals: number
  value: number | undefined
  valueText: string
  rate: number
  computed: boolean
  error?: string
  ref: VarRef
}

const rows = computed<VariableRow[]>(() => {
  void tick.value
  const alias = selectedSource.value
  return props.runtime.variables(alias).map((info) => {
    const ref: VarRef = { source: alias, key: info.key }
    const meta = props.runtime.meta(ref)
    const value = props.runtime.displayValue(ref)
    return {
      key: info.key,
      label: meta.label,
      unit: meta.unit,
      color: meta.color,
      decimals: meta.decimals,
      value,
      valueText: formatValue(value, meta.decimals),
      rate: info.rate,
      computed: meta.computed,
      ...(meta.error !== undefined ? { error: meta.error } : {}),
      ref,
    }
  })
})

const ignoredCount = computed(() => {
  void tick.value
  return source.value?.ignoredVariables.length ?? 0
})

const maxVariables = computed(() => serialSettings.maxVariablesPerSource)

function formatValue(value: number | undefined, decimals: number): string {
  if (value === undefined || !Number.isFinite(value)) return '--'
  return value.toFixed(Math.max(0, Math.min(10, Math.round(decimals))))
}

/* ------------------------------------------------------------------------- */
/* 迷你曲线（最近 100 点，宽 60px）                                            */
/* ------------------------------------------------------------------------- */

const canvasMap = new Map<string, HTMLCanvasElement>()

function setCanvas(key: string, element: Element | null): void {
  if (element instanceof HTMLCanvasElement) {
    canvasMap.set(key, element)
    drawSpark(key, element)
  } else {
    canvasMap.delete(key)
  }
}

function drawSpark(key: string, canvas: HTMLCanvasElement): void {
  const alias = selectedSource.value
  const slice = props.runtime.read({ source: alias, key }, { last: 100 })
  const width = 60
  const height = 18
  if (canvas.width !== width || canvas.height !== height) {
    canvas.width = width
    canvas.height = height
  }
  const context = canvas.getContext('2d')
  if (!context) return
  context.clearRect(0, 0, width, height)
  if (slice.v.length < 2) return
  let min = Number.POSITIVE_INFINITY
  let max = Number.NEGATIVE_INFINITY
  for (const value of slice.v) {
    if (!Number.isFinite(value)) continue
    if (value < min) min = value
    if (value > max) max = value
  }
  if (!Number.isFinite(min) || !Number.isFinite(max)) return
  if (min === max) {
    min -= 1
    max += 1
  }
  const meta = props.runtime.meta({ source: alias, key })
  context.strokeStyle = meta.color.startsWith('var(') ? '#3b82f6' : meta.color
  context.lineWidth = 1
  context.beginPath()
  for (let index = 0; index < slice.v.length; index += 1) {
    const value = slice.v[index] as number
    const x = (index / (slice.v.length - 1)) * (width - 1)
    const y = height - 2 - ((value - min) / (max - min)) * (height - 4)
    if (index === 0) context.moveTo(x, y)
    else context.lineTo(x, y)
  }
  context.stroke()
}

function redrawSparks(): void {
  if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return
  for (const [key, canvas] of canvasMap) drawSpark(key, canvas)
}

watch(tick, () => {
  void nextTick(redrawSparks)
})

watch(selectedSource, () => {
  void nextTick(redrawSparks)
})

/* ------------------------------------------------------------------------- */
/* 拖放                                                                        */
/* ------------------------------------------------------------------------- */

function onDragStart(event: DragEvent, row: VariableRow): void {
  if (!event.dataTransfer) return
  const payload = JSON.stringify({ kind: 'variable', source: row.ref.source, key: row.ref.key })
  event.dataTransfer.setData('application/x-toolset-variable', payload)
  event.dataTransfer.setData('text/plain', payload)
  event.dataTransfer.effectAllowed = 'copy'
}

/* ------------------------------------------------------------------------- */
/* variableMeta 编辑                                                           */
/* ------------------------------------------------------------------------- */

const metaDialogOpen = ref(false)
const metaTarget = ref<VariableRow | null>(null)
const metaDraft = ref({
  label: '',
  unit: '',
  color: '',
  scale: 1,
  offset: 0,
  decimals: 2,
})

function openMeta(row: VariableRow): void {
  metaTarget.value = row
  const override = props.dashboard.variableMeta[`${row.ref.source}/${row.ref.key}`] ?? {}
  metaDraft.value = {
    label: override.label ?? '',
    unit: override.unit ?? '',
    color: override.color ?? '',
    scale: override.scale ?? 1,
    offset: override.offset ?? 0,
    decimals: override.decimals ?? row.decimals,
  }
  metaDialogOpen.value = true
}

function saveMeta(): void {
  const target = metaTarget.value
  if (!target) return
  const patch: Record<string, unknown> = {}
  const label = metaDraft.value.label.trim()
  const unit = metaDraft.value.unit.trim()
  const color = metaDraft.value.color.trim()
  if (label.length > 0) patch.label = label
  else patch.label = undefined
  patch.unit = unit
  patch.color = color.length > 0 ? color : undefined
  patch.scale = Number.isFinite(metaDraft.value.scale) ? metaDraft.value.scale : 1
  patch.offset = Number.isFinite(metaDraft.value.offset) ? metaDraft.value.offset : 0
  patch.decimals = Math.max(0, Math.min(10, Math.round(metaDraft.value.decimals)))
  emit('update-meta', { source: target.ref.source, key: target.ref.key, patch })
  metaDialogOpen.value = false
}

/* ------------------------------------------------------------------------- */
/* 计算变量                                                                    */
/* ------------------------------------------------------------------------- */

const computedDialogOpen = ref(false)
const computedDraft = ref({ key: '', expr: '', unit: '' })

function openComputedDialog(): void {
  computedDraft.value = { key: '', expr: '', unit: '' }
  computedDialogOpen.value = true
}

const computedPreview = computed(() => {
  const expr = computedDraft.value.expr.trim()
  if (expr.length === 0) return { value: null as number | null, error: '' }
  return evaluateExpression(expr)
})

const computedNameError = computed(() => {
  const key = computedDraft.value.key.trim()
  if (key.length === 0) return ''
  return isValidVariableKey(key) ? '' : '变量名只能包含字母、数字、下划线，且不能以数字开头'
})

function evaluateExpression(expr: string): { value: number | null; error: string } {
  const alias = selectedSource.value
  const values: Record<string, number> = {}
  let lastT = Date.now()
  for (const info of props.runtime.variables(alias)) {
    values[info.key] = info.last
    if (info.lastAt > 0) lastT = Math.max(lastT, info.lastAt)
  }
  const lib: Record<string, unknown> = {
    abs: Math.abs,
    sqrt: Math.sqrt,
    pow: Math.pow,
    exp: Math.exp,
    log: Math.log,
    log10: Math.log10,
    sin: Math.sin,
    cos: Math.cos,
    tan: Math.tan,
    asin: Math.asin,
    acos: Math.acos,
    atan: Math.atan,
    atan2: Math.atan2,
    min: Math.min,
    max: Math.max,
    floor: Math.floor,
    ceil: Math.ceil,
    round: Math.round,
    sign: Math.sign,
    hypot: Math.hypot,
    PI: Math.PI,
    E: Math.E,
    clamp: (value: number, low: number, high: number) => Math.min(high, Math.max(low, value)),
  }
  try {
    const fn = new Function(
      'v',
      't',
      'dt',
      'prev',
      'lib',
      '"use strict"; const { abs, sqrt, pow, exp, log, log10, sin, cos, tan, asin, acos, atan, atan2, min, max, floor, ceil, round, sign, hypot, PI, E, clamp } = lib; return (' +
        expr +
        ');',
    ) as (...args: unknown[]) => unknown
    const result = fn(values, lastT, 0, Number.NaN, lib)
    if (typeof result !== 'number' || !Number.isFinite(result)) {
      return { value: null, error: '结果不是有限数' }
    }
    return { value: result, error: '' }
  } catch (error) {
    return { value: null, error: error instanceof Error ? error.message : String(error) }
  }
}

function addComputed(): void {
  const key = computedDraft.value.key.trim()
  const expr = computedDraft.value.expr.trim()
  if (computedNameError.value.length > 0 || key.length === 0) return
  if (expr.length === 0) return
  const existing = new Set(props.runtime.variables(selectedSource.value).map((info) => info.key))
  if (
    existing.has(`fx.${key}`) ||
    (props.dashboard.computed[selectedSource.value] ?? []).some((item) => item.key === key)
  ) {
    return
  }
  const computedVariable: ComputedVariable = { key, expr }
  const unit = computedDraft.value.unit.trim()
  if (unit.length > 0) computedVariable.unit = unit
  emit('add-computed', { source: selectedSource.value, computed: computedVariable })
  computedDialogOpen.value = false
}

function computedVariables(): ComputedVariable[] {
  return props.dashboard.computed[selectedSource.value] ?? []
}

function removeComputed(key: string): void {
  emit('remove-computed', { source: selectedSource.value, key })
}
</script>

<template>
  <div class="variable-list" data-testid="variable-list">
    <div class="variable-list__head">
      <select
        v-model="selectedSource"
        class="variable-list__source"
        aria-label="数据源"
        data-testid="variable-source-select"
      >
        <option v-for="item in dashboard.sources" :key="item.alias" :value="item.alias">
          {{ item.alias }} · {{ item.label }}
        </option>
      </select>
      <UiButton
        size="sm"
        variant="ghost"
        data-testid="variable-add-computed"
        title="新增计算变量"
        @click="openComputedDialog"
      >
        <Plus :size="12" aria-hidden="true" />
        计算变量
      </UiButton>
    </div>

    <p v-if="ignoredCount > 0" class="variable-list__warning" data-testid="variable-limit-warning">
      已忽略 {{ ignoredCount }} 个变量（超出每个数据源
      {{ maxVariables }} 个的上限），可在工具设置中调整
    </p>

    <div v-if="rows.length === 0" class="variable-list__empty">
      <p v-if="runtime.sourceState(selectedSource) === 'unbound'">数据源未连接</p>
      <p v-else>等待数据…</p>
    </div>

    <div v-else class="variable-list__rows">
      <div
        v-for="row in rows"
        :key="row.key"
        class="variable-list__row"
        :data-testid="`variable-item-${row.key}`"
        :data-value="row.valueText"
        draggable="true"
        @dragstart="onDragStart($event, row)"
      >
        <span class="variable-list__color" :style="{ background: row.color }" aria-hidden="true" />
        <button
          class="variable-list__name"
          type="button"
          :title="`${row.label}（${row.key}）— 点击编辑显示设置`"
          @click="openMeta(row)"
        >
          {{ row.label }}
          <span v-if="row.computed" class="variable-list__fx" title="计算变量">fx</span>
        </button>
        <span
          v-if="row.error"
          class="variable-list__error"
          :title="`计算出错：${row.error}。修改表达式后恢复`"
        >
          <AlertCircle :size="12" aria-hidden="true" />
        </span>
        <span class="variable-list__value">{{ row.valueText }}</span>
        <span class="variable-list__unit">{{ row.unit }}</span>
        <canvas
          :ref="(element) => setCanvas(row.key, element as Element | null)"
          class="variable-list__spark"
        />
        <span class="variable-list__rate">{{ row.rate.toFixed(1) }}Hz</span>
      </div>
    </div>

    <div v-if="computedVariables().length > 0" class="variable-list__computed">
      <h4 class="variable-list__computed-title">计算变量</h4>
      <div v-for="item in computedVariables()" :key="item.key" class="variable-list__computed-row">
        <Sparkles :size="11" aria-hidden="true" />
        <code>fx.{{ item.key }}</code>
        <span class="variable-list__computed-expr">{{ item.expr }}</span>
        <button
          class="variable-list__computed-remove"
          type="button"
          title="删除计算变量"
          @click="removeComputed(item.key)"
        >
          ×
        </button>
      </div>
    </div>

    <UiDialog
      v-model="metaDialogOpen"
      title="变量显示设置"
      width="min(92vw, 420px)"
      confirm-text="保存"
      @confirm="saveMeta"
    >
      <div class="variable-list__form" data-testid="variable-meta-dialog">
        <UiFormField label="显示名">
          <UiInput v-model="metaDraft.label" size="sm" aria-label="显示名" />
        </UiFormField>
        <UiFormField label="单位">
          <UiInput v-model="metaDraft.unit" size="sm" aria-label="单位" />
        </UiFormField>
        <UiFormField label="颜色（留空使用调色板）">
          <UiColorInput v-model="metaDraft.color" aria-label="颜色" />
        </UiFormField>
        <UiFormField label="缩放">
          <UiNumberInput v-model="metaDraft.scale" size="sm" :step="0.1" aria-label="缩放" />
        </UiFormField>
        <UiFormField label="偏移">
          <UiNumberInput v-model="metaDraft.offset" size="sm" :step="0.1" aria-label="偏移" />
        </UiFormField>
        <UiFormField label="小数位">
          <UiNumberInput
            v-model="metaDraft.decimals"
            size="sm"
            :min="0"
            :max="10"
            aria-label="小数位"
          />
        </UiFormField>
      </div>

      <template #footer>
        <UiButton size="md" @click="metaDialogOpen = false">取消</UiButton>
        <UiButton size="md" variant="primary" data-testid="variable-meta-confirm" @click="saveMeta">
          保存
        </UiButton>
      </template>
    </UiDialog>

    <UiDialog
      v-model="computedDialogOpen"
      title="新增计算变量"
      width="min(92vw, 460px)"
      confirm-text="添加"
      :confirm-disabled="
        computedDraft.key.trim().length === 0 ||
        computedDraft.expr.trim().length === 0 ||
        computedNameError.length > 0
      "
      @confirm="addComputed"
    >
      <div class="variable-list__form" data-testid="variable-computed-dialog">
        <UiFormField label="名称" :error="computedNameError">
          <UiInput
            v-model="computedDraft.key"
            size="sm"
            placeholder="例如 ch0_sq"
            aria-label="变量名"
            data-testid="variable-computed-name"
          />
        </UiFormField>
        <UiFormField
          label="表达式"
          hint="可用 v.<变量>、t、dt、prev 和常用数学函数，例如 v.ch0 * v.ch0"
        >
          <UiInput
            v-model="computedDraft.expr"
            size="sm"
            monospace
            placeholder="v.ch0 * v.ch0"
            aria-label="表达式"
            data-testid="variable-computed-expr"
          />
        </UiFormField>
        <UiFormField label="单位">
          <UiInput v-model="computedDraft.unit" size="sm" aria-label="单位" />
        </UiFormField>
        <p v-if="computedPreview.error" class="variable-list__preview is-error">
          预览失败：{{ computedPreview.error }}
        </p>
        <p v-else-if="computedPreview.value !== null" class="variable-list__preview">
          预览：{{ computedPreview.value.toFixed(4) }}
        </p>
        <p v-else class="variable-list__preview">输入表达式后显示当前计算结果。</p>
      </div>

      <template #footer>
        <UiButton size="md" @click="computedDialogOpen = false">取消</UiButton>
        <UiButton
          size="md"
          variant="primary"
          :disabled="
            computedDraft.key.trim().length === 0 ||
            computedDraft.expr.trim().length === 0 ||
            computedNameError.length > 0
          "
          data-testid="variable-computed-confirm"
          @click="addComputed"
        >
          添加
        </UiButton>
      </template>
    </UiDialog>
  </div>
</template>

<style scoped>
.variable-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
  min-width: 0;
}

.variable-list__head {
  display: flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
}

.variable-list__source {
  flex: 1 1 auto;
  min-width: 0;
  height: var(--control-h);
  padding: 0 10px;
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  background: var(--bg-sunken);
  color: var(--text);
  font-size: 12px;
}

.variable-list__source:focus-visible {
  outline: none;
  box-shadow: var(--focus-ring);
}

.variable-list__warning {
  margin: 0;
  color: var(--warn);
  font-size: 10px;
  line-height: 1.5;
}

.variable-list__empty {
  color: var(--text-faint);
  font-size: 11px;
}

.variable-list__empty p {
  margin: 0;
}

.variable-list__rows {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
}

.variable-list__row {
  display: flex;
  align-items: center;
  gap: 7px;
  min-width: 0;
  height: var(--control-h);
  padding: 0 6px;
  border: 1px solid transparent;
  border-radius: var(--radius-sm);
  cursor: grab;
}

.variable-list__row:hover {
  border-color: var(--border);
  background: var(--bg-hover);
}

.variable-list__row:active {
  cursor: grabbing;
}

.variable-list__color {
  flex: none;
  width: 6px;
  height: 6px;
  border-radius: 50%;
}

.variable-list__name {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  flex: 1 1 auto;
  min-width: 0;
  overflow: hidden;
  padding: 0;
  border: none;
  background: transparent;
  color: var(--text);
  font-size: 12px;
  text-align: left;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.variable-list__name:hover {
  color: var(--accent-hover);
}

.variable-list__fx {
  flex: none;
  padding: 0 3px;
  border-radius: 2px;
  background: var(--accent-soft);
  color: var(--accent);
  font-family: var(--font-mono);
  font-size: 9px;
}

.variable-list__error {
  flex: none;
  color: var(--danger);
}

.variable-list__value {
  flex: none;
  min-width: 52px;
  color: var(--text);
  font-family: var(--font-mono);
  font-size: 11px;
  text-align: right;
}

.variable-list__unit {
  flex: none;
  max-width: 38px;
  overflow: hidden;
  color: var(--text-faint);
  font-size: 10px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.variable-list__spark {
  flex: none;
  width: 64px;
  height: 20px;
  opacity: 0.9;
}

.variable-list__rate {
  flex: none;
  min-width: 38px;
  color: var(--text-faint);
  font-family: var(--font-mono);
  font-size: 10px;
  text-align: right;
}

.variable-list__computed {
  display: flex;
  flex-direction: column;
  gap: 3px;
  margin-top: 4px;
  padding-top: 6px;
  border-top: 1px solid var(--border);
}

.variable-list__computed-title {
  margin: 0;
  color: var(--text-faint);
  font-size: 10px;
  font-weight: 500;
  letter-spacing: 0.06em;
}

.variable-list__computed-row {
  display: flex;
  align-items: center;
  gap: 5px;
  min-width: 0;
  color: var(--text-dim);
  font-size: 10px;
}

.variable-list__computed-row code {
  color: var(--accent);
  font-family: var(--font-mono);
  font-size: 10px;
}

.variable-list__computed-expr {
  min-width: 0;
  overflow: hidden;
  color: var(--text-faint);
  font-family: var(--font-mono);
  font-size: 9px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.variable-list__computed-remove {
  flex: none;
  margin-left: auto;
  border: none;
  background: transparent;
  color: var(--text-faint);
  font-size: 12px;
  line-height: 1;
}

.variable-list__computed-remove:hover {
  color: var(--danger);
}

.variable-list__form {
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
}

.variable-list__preview {
  margin: 0;
  color: var(--text-faint);
  font-family: var(--font-mono);
  font-size: 10px;
  line-height: 1.5;
}

.variable-list__preview.is-error {
  color: var(--danger);
}
</style>
