<script setup lang="ts">
/**
 * 自定义控件宿主（plan §6.10「宿主」/「调用保护」/「安全模式」）。
 *
 * 在组件内容区创建 shadow DOM，把 shadow 内的容器 `div` 交给控件 `mount`；所有生命周期
 * 调用都经过调用保护（异常浮层 / 超时停用 / 发送限速），每次进入自定义代码前写入
 * `toolset/safe-mode/pending` 标记，返回后清除。
 *
 * 数据通过 `useWidgetData`（仪表盘内）或等价的外部帧适配器（编辑器预览）下发；只有
 * 有数据或 `requestUpdate` 时才调用 `update`。
 */

import {
  computed,
  inject,
  onBeforeUnmount,
  onMounted,
  onScopeDispose,
  ref,
  shallowRef,
  watch,
  type ComputedRef,
  type Ref,
  type ShallowRef,
} from 'vue'

import {
  MAX_WIDGET_STATE_BYTES,
  compileCustomWidget,
  createCallGuard,
  isSafeModeUrl,
  safeMode,
  type CallGuardDisabledReason,
  type CustomWidgetDefinition,
  type CustomWidgetContext,
  type CustomWidgetInstance,
  type CustomWidgetVariable,
  type WidgetFrameData,
  type WidgetInstance,
} from '@/domains/dashboard/public'
import type { SeriesSlice } from '@/domains/series/public'
import { createProtocolSdk, type PluginSdk } from '@/domains/protocol/public'
import UiButton from '@/shared/ui/components/UiButton.vue'
import { toast } from '@/shared/ui/services/toast'

import { DASHBOARD_RUNTIME_KEY } from '../runtime/injection-keys'
import type { DashboardRuntime, WidgetFrameUpdate } from '../runtime/context'
import { useWidgetData } from '../runtime/useWidgetData'
import { defaultForField } from '../widget-registry'
import {
  getCustomWidgetRecord,
  serialCustomWidgets,
  type CustomWidgetRecord,
} from './custom-widget-registry'
import { appendCustomWidgetLog } from './debug-log'
import { openCustomWidgetEditor } from './editor-state'
import { customSafeModeState, unblockCustomWidget } from './safe-mode-state'
import { CUSTOM_WIDGET_STATE_SAVER_KEY, type CustomWidgetStateSaver } from './injection-keys'

const props = defineProps<{
  instance: WidgetInstance
  runtime?: DashboardRuntime | null
  mode: 'edit' | 'run'
  /** 组件标题（发送失败 Toast 使用）。 */
  title?: string
  /** 覆盖源码（编辑器预览 / 组件测试）；省略时按 `custom:<id>` 从仓库读取。 */
  code?: string
  /** 覆盖名称；默认取编译后的 `meta.name`。 */
  name?: string
  /** 覆盖状态保存（编辑器预览用）。 */
  saveState?: (state: Record<string, unknown>) => void
  /** 覆盖「编辑代码」动作（编辑器预览用）。 */
  editorOpener?: (customId: string) => void
}>()

const customId = computed(() => {
  const type = props.instance.type
  return type.startsWith('custom:') ? type.slice('custom:'.length) : ''
})

const injectedRuntime = inject(DASHBOARD_RUNTIME_KEY, null)
const stateSaver = inject<CustomWidgetStateSaver | null>(CUSTOM_WIDGET_STATE_SAVER_KEY, null)
const effectiveRuntime = computed<DashboardRuntime | null>(
  () => props.runtime ?? injectedRuntime ?? null,
)

/**
 * 编辑器预览的宿主位于 `DashboardPane` 子树内（Teleport 不改变注入链），会注入到
 * 仪表盘运行时；显式传入的预览运行时与注入的不同，此时必须走外部数据适配器。
 */
const useExternalData =
  injectedRuntime === null ||
  (props.runtime !== undefined && props.runtime !== null && props.runtime !== injectedRuntime)

/* ------------------------------------------------------------------------- */
/* 源码加载                                                                    */
/* ------------------------------------------------------------------------- */

const record = shallowRef<CustomWidgetRecord | null>(null)
const definition = shallowRef<CustomWidgetDefinition | null>(null)
const loadError = ref('')
const missing = ref(false)
const loaded = ref(false)

async function loadSource(): Promise<void> {
  loaded.value = false
  missing.value = false
  loadError.value = ''
  if (props.code !== undefined) {
    const compiled = compileCustomWidget(props.code)
    if (!compiled.ok) {
      loadError.value = compiled.error
      definition.value = null
      loaded.value = true
      return
    }
    definition.value = compiled.definition
    loaded.value = true
    return
  }
  const id = customId.value
  if (id.length === 0) {
    missing.value = true
    loaded.value = true
    return
  }
  const found = await getCustomWidgetRecord(id)
  if (found === undefined) {
    record.value = null
    definition.value = null
    missing.value = true
    loaded.value = true
    return
  }
  record.value = found
  const compiled = compileCustomWidget(found.code)
  if (!compiled.ok) {
    definition.value = null
    loadError.value = compiled.error
    loaded.value = true
    return
  }
  definition.value = compiled.definition
  loaded.value = true
}

async function reloadAndMount(): Promise<void> {
  await loadSource()
  mountNow()
  if (latestValues.value.length > 0) updateNow()
}

/* ------------------------------------------------------------------------- */
/* props / 变量                                                                 */
/* ------------------------------------------------------------------------- */

const mergedProps = computed<Record<string, unknown>>(() => {
  const def = definition.value
  const defaults: Record<string, unknown> = {}
  for (const field of def?.props ?? []) {
    const value = defaultForField(field)
    if (value !== undefined) defaults[field.key] = value
  }
  return { ...defaults, ...props.instance.props }
})

function parseRefs(value: unknown): Array<{ source: string; key: string }> {
  if (!Array.isArray(value)) return []
  const refs: Array<{ source: string; key: string }> = []
  for (const item of value) {
    if (typeof item !== 'object' || item === null) continue
    const recordValue = item as Record<string, unknown>
    if (typeof recordValue.source === 'string' && typeof recordValue.key === 'string') {
      refs.push({ source: recordValue.source, key: recordValue.key })
    }
  }
  return refs
}

const refs = computed(() => parseRefs(mergedProps.value.variables))

/* ------------------------------------------------------------------------- */
/* 数据订阅：仪表盘内用 useWidgetData，编辑器预览用外部适配器                    */
/* ------------------------------------------------------------------------- */

const injectedData = useWidgetData(refs)

interface ExternalWidgetData {
  latest: ShallowRef<Array<number | undefined>>
  appended: ShallowRef<SeriesSlice[]>
  variables: ComputedRef<DashboardVariableMetaLike[]>
  frameIndex: Ref<number>
}

interface DashboardVariableMetaLike {
  source: string
  key: string
  label: string
  unit: string
  color: string
  decimals: number
  scale: number
  offset: number
}

/** 仪表盘以外的宿主（编辑器预览 / 测试）没有注入运行时，这里提供等价的数据帧。 */
function createExternalWidgetData(
  runtime: ComputedRef<DashboardRuntime | null>,
): ExternalWidgetData {
  const latest = shallowRef<Array<number | undefined>>([])
  const appended = shallowRef<SeriesSlice[]>([])
  const frameIndex = ref(0)
  const lastSeen = new Map<string, number>()
  let unsubscribe: (() => void) | null = null

  function empty(): SeriesSlice {
    return { idx: new Float64Array(0), t: new Float64Array(0), v: new Float64Array(0) }
  }

  function refKey(ref: { source: string; key: string }): string {
    return `${ref.source}\u0000${ref.key}`
  }

  function refresh(update?: WidgetFrameUpdate): void {
    const current = refs.value
    const active = runtime.value
    if (active === null) {
      latest.value = current.map(() => undefined)
      appended.value = current.map(() => empty())
      return
    }
    if (update !== undefined) frameIndex.value += 1
    latest.value =
      update !== undefined ? [...update.latest] : current.map((ref) => active.displayValue(ref))
    const next: SeriesSlice[] = []
    for (const ref of current) {
      const previous = lastSeen.get(refKey(ref)) ?? -1
      const slice = active.read(ref, {
        sinceIdx: Math.max(0, previous + 1),
        limit: 10_000,
      })
      if (slice.idx.length > 0) {
        const last = slice.idx[slice.idx.length - 1]
        if (last !== undefined) lastSeen.set(refKey(ref), last)
        next.push(slice)
      } else {
        next.push(empty())
      }
    }
    appended.value = next
  }

  function subscribe(): void {
    unsubscribe?.()
    unsubscribe = null
    refresh()
    const active = runtime.value
    if (active === null) return
    unsubscribe = active.subscribeFrame(
      () => refs.value,
      (update) => {
        refresh(update)
      },
    )
  }

  subscribe()
  watch(runtime, subscribe)
  watch(
    () => props.instance.type,
    () => {
      lastSeen.clear()
      subscribe()
    },
  )
  onScopeDispose(() => {
    unsubscribe?.()
    unsubscribe = null
  })

  return {
    latest,
    appended,
    frameIndex,
    variables: computed<DashboardVariableMetaLike[]>(() => {
      void frameIndex.value
      const active = runtime.value
      return refs.value.map((ref) => {
        if (active === null) {
          return {
            ...ref,
            label: ref.key,
            unit: '',
            color: 'var(--series-1)',
            decimals: 2,
            scale: 1,
            offset: 0,
          }
        }
        const meta = active.meta(ref)
        return {
          source: ref.source,
          key: ref.key,
          label: meta.label,
          unit: meta.unit,
          color: meta.color,
          decimals: meta.decimals,
          scale: meta.scale,
          offset: meta.offset,
        }
      })
    }),
  }
}

const externalData = useExternalData ? createExternalWidgetData(effectiveRuntime) : null

const latestValues = computed<Array<number | undefined>>(() =>
  externalData !== null ? externalData.latest.value : injectedData.latest.value,
)

const appendedSlices = computed<SeriesSlice[]>(() =>
  externalData !== null ? externalData.appended.value : injectedData.appended.value,
)

const variableMetas = computed<DashboardVariableMetaLike[]>(() => {
  if (externalData !== null) return externalData.variables.value
  return injectedData.variables.value.map((meta) => ({
    source: meta.source,
    key: meta.key,
    label: meta.label,
    unit: meta.unit,
    color: meta.color,
    decimals: meta.decimals,
    scale: meta.scale,
    offset: meta.offset,
  }))
})

const frameIndex = computed(() =>
  externalData !== null ? externalData.frameIndex.value : injectedData.frameIndex.value,
)

/* ------------------------------------------------------------------------- */
/* shadow DOM / 状态                                                            */
/* ------------------------------------------------------------------------- */

const hostRef = ref<HTMLElement | null>(null)
const rootRef = ref<HTMLElement | null>(null)
const shadowContainer = shallowRef<HTMLElement | null>(null)
const size = ref({ width: 0, height: 0 })

const instance = shallowRef<CustomWidgetInstance | undefined>(undefined)
const displayName = ref('')

const errorMessage = ref('')
const disabledText = ref('')
const globalSafeMode = ref(
  isSafeModeUrl(typeof window === 'undefined' ? '' : window.location.search + window.location.hash),
)
const blocked = computed(() => {
  void customSafeModeState.version
  const id = customId.value
  if (id.length === 0) return false
  return !globalSafeMode.value && safeMode.isBlocked(id)
})

const guard = createCallGuard({
  onError(info) {
    errorMessage.value = info.message
    appendCustomWidgetLog(customId.value || 'preview', `[${info.kind}] 异常：${info.message}`)
  },
  onDisabled(reason) {
    disabledText.value = disabledReasonText(reason)
    errorMessage.value = ''
    appendCustomWidgetLog(customId.value || 'preview', `[停用] ${disabledText.value}`)
  },
  onEnabled() {
    disabledText.value = ''
    errorMessage.value = ''
  },
})

function disabledReasonText(reason: CallGuardDisabledReason): string {
  switch (reason.reason) {
    case 'errors':
      return '已停用：多次出错'
    case 'slowCall':
      return `执行时间过长（${Math.round(reason.durationMs)} ms），已停用`
    case 'slowAverage':
      return '平均执行时间过长，已停用'
  }
}

/** 进入自定义代码前写 pending 标记，返回 / 抛出后同步清除（plan §6.10）。 */
function protectedCall<T>(kind: Parameters<typeof guard.call>[0], fn: () => T): T | undefined {
  const id = customId.value || 'preview'
  safeMode.writePending(id, displayName.value || id)
  try {
    return guard.call(kind, fn)
  } finally {
    safeMode.clearPending()
  }
}

/* ------------------------------------------------------------------------- */
/* CustomWidgetContext                                                         */
/* ------------------------------------------------------------------------- */

const sdk: PluginSdk = createProtocolSdk()
const stateStore = shallowRef<Record<string, unknown>>({})
let saveTimer: ReturnType<typeof setTimeout> | null = null

function emptySlice(): SeriesSlice {
  return { idx: new Float64Array(0), t: new Float64Array(0), v: new Float64Array(0) }
}

function logLine(...args: unknown[]): void {
  const text = args
    .map((value) => {
      if (typeof value === 'string') return value
      try {
        return JSON.stringify(value) ?? String(value)
      } catch {
        return String(value)
      }
    })
    .join(' ')
  appendCustomWidgetLog(customId.value || 'preview', text)
  console.debug('[custom-widget]', ...args)
}

/** JSON 往返并检查 64KB 上限；超限或不可序列化时抛出（plan §6.10 `saveState`）。 */
function statePayload(): Record<string, unknown> {
  const payload = JSON.parse(JSON.stringify(stateStore.value)) as Record<string, unknown>
  const bytes = new TextEncoder().encode(JSON.stringify(payload)).length
  if (bytes > MAX_WIDGET_STATE_BYTES) {
    throw new Error(`控件状态超过 64KB（当前 ${Math.ceil(bytes / 1024)}KB）`)
  }
  return payload
}

function writeStatePayload(payload: Record<string, unknown>): void {
  if (props.saveState !== undefined) props.saveState(payload)
  else stateSaver?.(props.instance.id, payload)
}

function saveStateNow(): void {
  writeStatePayload(statePayload())
}

// 占位标识：避免未使用变量告警（主题订阅在 ctx 构造时创建）。
let onThemeChangeUnsubscriber: (() => void) | null = null

const context: CustomWidgetContext = {
  get props() {
    return mergedProps.value
  },
  get variables() {
    return variableMetas.value.map<CustomWidgetVariable>((meta) => ({
      source: meta.source,
      key: meta.key,
      label: meta.label,
      unit: meta.unit,
      color: meta.color,
    }))
  },
  get size() {
    return size.value
  },
  get mode() {
    return props.mode
  },
  latest(index: number) {
    return latestValues.value[index]
  },
  history(index: number, query?: { last?: number; fromT?: number }) {
    const ref = refs.value[index]
    if (ref === undefined || effectiveRuntime.value === null) return emptySlice()
    const last =
      query?.last === undefined ? undefined : Math.max(1, Math.min(100_000, Math.floor(query.last)))
    return effectiveRuntime.value.read(ref, {
      ...(last === undefined ? {} : { last }),
      ...(query?.fromT === undefined ? {} : { fromT: query.fromT }),
      limit: 100_000,
    })
  },
  async send(cmd, value) {
    const runtime = effectiveRuntime.value
    if (runtime === null) throw new Error('仪表盘运行时不可用')
    try {
      await guard.send(async () => {
        await runtime.send(cmd, value)
      })
    } catch (error) {
      flashSend('danger')
      toast.show({
        type: 'error',
        message: `${displayName.value || '自定义控件'}：${errorText(error)}`,
      })
      throw error
    }
    flashSend('ok')
  },
  async sendBytes(bytes, source) {
    const runtime = effectiveRuntime.value
    if (runtime === null) throw new Error('仪表盘运行时不可用')
    try {
      await guard.send(async () => {
        await runtime.sendBytes(bytes, source)
      })
    } catch (error) {
      flashSend('danger')
      toast.show({
        type: 'error',
        message: `${displayName.value || '自定义控件'}：${errorText(error)}`,
      })
      throw error
    }
    flashSend('ok')
  },
  sourceState(source?: string) {
    if (effectiveRuntime.value === null) return 'unbound'
    return effectiveRuntime.value.sourceState(source ?? effectiveRuntime.value.defaultAlias())
  },
  get state() {
    return stateStore.value
  },
  saveState() {
    // 先同步做 JSON 往返与 64KB 检查（超限时调用方立即收到异常），再 1 秒内合并写回。
    const payload = statePayload()
    if (saveTimer !== null) clearTimeout(saveTimer)
    saveTimer = setTimeout(() => {
      saveTimer = null
      try {
        writeStatePayload(payload)
      } catch (error) {
        toast.show({ type: 'error', message: errorText(error) })
      }
    }, 1000)
  },
  theme(cssVar: string) {
    return effectiveRuntime.value?.theme(cssVar) ?? ''
  },
  onThemeChange(callback: () => void) {
    onThemeChangeUnsubscriber?.()
    onThemeChangeUnsubscriber = effectiveRuntime.value?.onThemeChange(callback) ?? null
    return () => {
      onThemeChangeUnsubscriber?.()
      onThemeChangeUnsubscriber = null
    }
  },
  requestUpdate() {
    effectiveRuntime.value?.requestUpdate()
  },
  log: logLine,
  sdk,
}

/* ------------------------------------------------------------------------- */
/* 发送反馈（边框闪烁，plan §8.11）                                             */
/* ------------------------------------------------------------------------- */

const flashState = ref<'' | 'ok' | 'danger'>('')
let flashTimer: ReturnType<typeof setTimeout> | null = null

function flashSend(kind: 'ok' | 'danger'): void {
  flashState.value = kind
  if (flashTimer !== null) clearTimeout(flashTimer)
  flashTimer = setTimeout(() => {
    flashState.value = ''
    flashTimer = null
  }, 260)
}

/* ------------------------------------------------------------------------- */
/* mount / update / propsChanged / resize / destroy                            */
/* ------------------------------------------------------------------------- */

let resizeObserver: ResizeObserver | null = null
let resizeFrame = 0
let mountedDefinition: CustomWidgetDefinition | null = null
let mountedPropsSignature = ''

function clearShadow(): void {
  const container = shadowContainer.value
  if (container !== null) container.replaceChildren()
}

function destroyInstance(): void {
  guard.destroy()
  instance.value = undefined
  mountedDefinition = null
  mountedPropsSignature = ''
}

function canRun(): boolean {
  if (missing.value || loadError.value !== '' || definition.value === null) return false
  if (globalSafeMode.value) return false
  if (blocked.value) return false
  if (guard.disabled) return false
  return true
}

function applyInitialState(): void {
  const original = props.instance.state
  if (original !== undefined && typeof original === 'object' && original !== null) {
    try {
      stateStore.value = JSON.parse(JSON.stringify(original)) as Record<string, unknown>
      return
    } catch {
      // 损坏的状态按空对象处理。
    }
  }
  stateStore.value = {}
}

function mountNow(): void {
  destroyInstance()
  clearShadow()
  if (!loaded.value || !canRun()) return
  const container = shadowContainer.value
  const def = definition.value
  if (container === null || def === null) return
  displayName.value = props.name ?? def.meta.name ?? customId.value
  applyInitialState()
  mountedDefinition = def
  const created = protectedCall('mount', () => def.mount(container, context))
  const next = created === undefined ? undefined : created
  if (next?.propsChanged === undefined && next !== undefined) {
    // 保留引用即可；propsChanged 缺失时用重新 mount 处理属性变化。
  }
  instance.value = next
  guard.attach(next)
  mountedPropsSignature = propsSignature()
}

function propsSignature(): string {
  try {
    return JSON.stringify(mergedProps.value)
  } catch {
    return ''
  }
}

function updateNow(): void {
  const current = instance.value
  if (current?.update === undefined || mountedDefinition === null) return
  if (!canRun()) return
  const data: WidgetFrameData = {
    now: typeof performance !== 'undefined' ? performance.now() : Date.now(),
    latest: [...latestValues.value],
    appended: appendedSlices.value.map((slice) => ({
      idx: slice.idx,
      t: slice.t,
      v: slice.v,
    })),
  }
  protectedCall('update', () => current.update?.(data))
}

function onPropsChanged(): void {
  const current = instance.value
  if (current === undefined) return
  if (!canRun()) return
  const signature = propsSignature()
  if (signature === mountedPropsSignature) return
  mountedPropsSignature = signature
  if (current.propsChanged !== undefined) {
    protectedCall('propsChanged', () => current.propsChanged?.(mergedProps.value))
    return
  }
  // 未实现 propsChanged：destroy 后重新 mount（plan §6.10）。
  mountNow()
}

function measure(): { width: number; height: number } {
  const element = hostRef.value
  if (element === null) return size.value
  const width = element.clientWidth
  const height = element.clientHeight
  if (width === size.value.width && height === size.value.height) return size.value
  size.value = { width, height }
  return size.value
}

function scheduleResize(): void {
  if (resizeFrame !== 0) return
  const schedule =
    typeof requestAnimationFrame === 'function'
      ? requestAnimationFrame
      : (callback: () => void): number => setTimeout(callback, 16) as unknown as number
  resizeFrame = schedule(() => {
    resizeFrame = 0
    const next = measure()
    const current = instance.value
    if (current?.resize === undefined || !canRun()) return
    protectedCall('resize', () => current.resize?.(next))
  })
}

/* ------------------------------------------------------------------------- */
/* 生命周期                                                                    */
/* ------------------------------------------------------------------------- */

onMounted(() => {
  const host = hostRef.value
  if (host !== null) {
    const root = host.shadowRoot ?? host.attachShadow({ mode: 'open' })
    if (root.querySelector('[data-custom-widget-container]') === null) {
      const style = document.createElement('style')
      style.textContent =
        ':host { display: block; width: 100%; height: 100%; overflow: hidden; }' +
        '[data-custom-widget-container] { width: 100%; height: 100%; overflow: hidden; }'
      root.append(style)
      const container = document.createElement('div')
      container.dataset.customWidgetContainer = ''
      root.append(container)
    }
    shadowContainer.value = root.querySelector<HTMLElement>('[data-custom-widget-container]')
  }
  measure()
  if (hostRef.value !== null && typeof ResizeObserver !== 'undefined') {
    resizeObserver = new ResizeObserver(() => {
      scheduleResize()
    })
    resizeObserver.observe(hostRef.value)
  }
  void reloadAndMount()
})

watch(
  () => serialCustomWidgets.revision,
  () => {
    if (props.code !== undefined) return
    void reloadAndMount()
  },
)

watch(
  () => customSafeModeState.version,
  () => {
    globalSafeMode.value = isSafeModeUrl(
      typeof window === 'undefined' ? '' : window.location.search + window.location.hash,
    )
    if (canRun()) void reloadAndMount()
    else {
      destroyInstance()
      clearShadow()
    }
  },
)

watch(mergedProps, () => {
  if (!loaded.value) return
  onPropsChanged()
})

watch(frameIndex, () => {
  updateNow()
})

watch(
  () => props.instance.id,
  () => {
    void reloadAndMount()
  },
)

watch(
  () => [props.code, props.name, props.instance.type] as const,
  () => {
    void reloadAndMount()
  },
)

onBeforeUnmount(() => {
  resizeObserver?.disconnect()
  resizeObserver = null
  if (resizeFrame !== 0 && typeof cancelAnimationFrame === 'function') {
    cancelAnimationFrame(resizeFrame)
  }
  resizeFrame = 0
  if (saveTimer !== null) {
    clearTimeout(saveTimer)
    saveTimer = null
    try {
      saveStateNow()
    } catch {
      // 卸载时无法提示；状态超限时忽略。
    }
  }
  if (flashTimer !== null) clearTimeout(flashTimer)
  flashTimer = null
  onThemeChangeUnsubscriber?.()
  onThemeChangeUnsubscriber = null
  destroyInstance()
  guard.destroy()
  clearShadow()
})

/* ------------------------------------------------------------------------- */
/* 错误浮层动作                                                                */
/* ------------------------------------------------------------------------- */

function retry(): void {
  errorMessage.value = ''
  guard.reset()
  mountNow()
}

function reEnable(): void {
  unblockCustomWidget(customId.value)
  disabledText.value = ''
  errorMessage.value = ''
  guard.reset()
  mountNow()
}

function editCode(): void {
  const id = customId.value
  if (id.length === 0) return
  if (props.editorOpener !== undefined) {
    props.editorOpener(id)
    return
  }
  openCustomWidgetEditor(id)
}

function errorText(error: unknown): string {
  return error instanceof Error && error.message.length > 0 ? error.message : String(error)
}
</script>

<template>
  <div
    ref="rootRef"
    class="custom-widget-host"
    :class="{ 'flash-ok': flashState === 'ok', 'flash-danger': flashState === 'danger' }"
    :data-testid="`custom-widget-${customId || 'preview'}`"
    :data-custom-widget-id="customId"
    :data-custom-widget-mode="mode"
  >
    <div ref="hostRef" class="custom-widget-host__mount" />

    <div
      v-if="missing"
      class="custom-widget-host__overlay custom-widget-host__overlay--missing"
      role="alert"
      data-testid="custom-widget-missing"
    >
      找不到自定义控件（<code>{{ customId }}</code
      >），可能已被删除
    </div>

    <div
      v-else-if="loadError"
      class="custom-widget-host__overlay custom-widget-host__overlay--error"
      role="alert"
      data-testid="custom-widget-compile-error"
    >
      <span class="custom-widget-host__message">自定义控件代码无法编译：{{ loadError }}</span>
      <div class="custom-widget-host__actions">
        <UiButton size="sm" @click="editCode">编辑代码</UiButton>
      </div>
    </div>

    <div
      v-else-if="globalSafeMode"
      class="custom-widget-host__overlay custom-widget-host__overlay--paused"
      data-testid="custom-widget-paused"
    >
      已暂停（安全模式）
    </div>

    <div
      v-else-if="blocked"
      class="custom-widget-host__overlay custom-widget-host__overlay--paused"
      data-testid="custom-widget-paused"
    >
      <span class="custom-widget-host__message">已暂停（安全模式）</span>
      <div class="custom-widget-host__actions">
        <UiButton
          size="sm"
          variant="primary"
          data-testid="custom-widget-reenable"
          @click="reEnable"
        >
          重新启用
        </UiButton>
        <UiButton size="sm" data-testid="custom-widget-edit-code" @click="editCode">
          编辑代码
        </UiButton>
      </div>
    </div>

    <div
      v-else-if="disabledText"
      class="custom-widget-host__overlay custom-widget-host__overlay--disabled"
      role="alert"
      data-testid="custom-widget-disabled"
    >
      <span class="custom-widget-host__message">{{ disabledText }}</span>
      <div class="custom-widget-host__actions">
        <UiButton
          size="sm"
          variant="primary"
          data-testid="custom-widget-reenable"
          @click="reEnable"
        >
          重新启用
        </UiButton>
        <UiButton size="sm" data-testid="custom-widget-edit-code" @click="editCode">
          编辑代码
        </UiButton>
      </div>
    </div>

    <div
      v-else-if="errorMessage"
      class="custom-widget-host__overlay custom-widget-host__overlay--error"
      role="alert"
      data-testid="custom-widget-error"
    >
      <span class="custom-widget-host__message">出错：{{ errorMessage }}</span>
      <div class="custom-widget-host__actions">
        <UiButton size="sm" data-testid="custom-widget-retry" @click="retry"> 重试 </UiButton>
        <UiButton size="sm" variant="ghost" data-testid="custom-widget-edit-code" @click="editCode">
          编辑代码
        </UiButton>
      </div>
    </div>
  </div>
</template>

<style scoped>
.custom-widget-host {
  position: relative;
  display: flex;
  flex: 1 1 auto;
  width: 100%;
  height: 100%;
  min-width: 0;
  min-height: 0;
  overflow: hidden;
}

.custom-widget-host.flash-ok {
  box-shadow: inset 0 0 0 1px var(--ok);
}

.custom-widget-host.flash-danger {
  box-shadow: inset 0 0 0 1px var(--danger);
}

.custom-widget-host__mount {
  display: block;
  flex: 1 1 auto;
  width: 100%;
  height: 100%;
  min-width: 0;
  min-height: 0;
}

.custom-widget-host__overlay {
  position: absolute;
  inset: 0;
  z-index: 2;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 6px;
  padding: 6px;
  background: var(--bg-elev);
  color: var(--text-dim);
  font-size: 11px;
  line-height: 1.5;
  text-align: center;
}

.custom-widget-host__overlay--error,
.custom-widget-host__overlay--disabled {
  color: var(--danger);
}

.custom-widget-host__overlay--paused {
  color: var(--warn);
}

.custom-widget-host__overlay--missing {
  color: var(--text-faint);
}

.custom-widget-host__message {
  max-width: 100%;
  overflow-wrap: anywhere;
}

.custom-widget-host__actions {
  display: flex;
  align-items: center;
  gap: 4px;
  flex-wrap: wrap;
  justify-content: center;
}

.custom-widget-host__overlay code {
  color: var(--text-dim);
  font-family: var(--font-mono);
  font-size: 10px;
}
</style>
