<script setup lang="ts">
/**
 * 仪表盘 Pane（plan §8.10）。
 *
 * 组合工具栏 / 网格画布 / 组件库 / 变量列表 / 属性面板；负责：
 * - 加载、编辑与持久化当前仪表盘（800ms 防抖保存、并发修改提示）；
 * - 数据源与会话的自动绑定规则；
 * - 撤销 / 重做、快捷键动作、组件与变量的拖放创建；
 * - 一键生成、导入 / 导出、数据 CSV 导出、编辑 ↔ 运行模式。
 */

import {
  computed,
  defineAsyncComponent,
  onActivated,
  onBeforeUnmount,
  onDeactivated,
  onMounted,
  provide,
  ref,
  shallowRef,
  watch,
} from 'vue'

import {
  createHistory,
  normalize,
  placeNew,
  type Dashboard,
  type History,
  type Rect,
  type VarRef,
  type WidgetDefinition,
  type WidgetInstance,
} from '@/domains/dashboard/public'
import { exportSeriesCsv, getSeriesHub } from '@/domains/series/public'
import { downloadText } from '@/shared/lib/download'
import { uuid } from '@/shared/lib/id'
import UiButton from '@/shared/ui/components/UiButton.vue'
import UiCheckbox from '@/shared/ui/components/UiCheckbox.vue'
import UiDialog from '@/shared/ui/components/UiDialog.vue'
import UiEmpty from '@/shared/ui/components/UiEmpty.vue'
import UiFormField from '@/shared/ui/components/UiFormField.vue'
import UiNumberInput from '@/shared/ui/components/UiNumberInput.vue'
import UiSelect from '@/shared/ui/components/UiSelect.vue'
import { confirm } from '@/shared/ui/services/confirm'
import { toast } from '@/shared/ui/services/toast'

import DashboardToolbar from './DashboardToolbar.vue'
import GridCanvas from './GridCanvas.vue'
import PropertyPanel from './PropertyPanel.vue'
import VariableList from './VariableList.vue'
import WidgetLibrary from './WidgetLibrary.vue'
import { DASHBOARD_PANE_KEY, DASHBOARD_RUNTIME_KEY } from './runtime/injection-keys'
import { createDashboardRuntime } from './runtime/context'
import { createFrameLoop, dashboardFps } from './runtime/frame-loop'
import {
  bumpDashboardSessionVersion,
  consumePinnedDefaultSession,
  dashboardSessionVersion,
  paneDashboardState,
  pinDashboardDefaultSession,
  resetDashboardPaneBindings,
  setDashboardPaneBinding,
  setPaneDashboardMode,
  setPaneDashboardPaused,
  setPaneDashboardSelection,
} from './pane-state'
import type { DashboardCustomWidgetRecord } from './dashboard-file'
import {
  collectDashboardCustomWidgets,
  getCustomWidgetSummary,
  importCustomWidgets,
  inspectCustomWidgetImport,
  remapCustomWidgetTypes,
  serialCustomWidgets,
} from './custom/custom-widget-registry'
import { toWidgetDefinition } from './custom/custom-widget-definition'
import {
  CUSTOM_WIDGET_EDITOR_OPENER_KEY,
  CUSTOM_WIDGET_STATE_SAVER_KEY,
} from './custom/injection-keys'
import { customWidgetEditorState, openCustomWidgetEditor } from './custom/editor-state'
import {
  customSafeModeState,
  exitGlobalCustomWidgetSafeMode,
  initCustomWidgetSafeMode,
  unblockCustomWidget,
} from './custom/safe-mode-state'
import {
  createDashboardRecord,
  dashboardSaveError,
  dashboardSaveStatus,
  deleteDashboardRecord,
  duplicateDashboardRecord,
  exportDashboardFile,
  flushDashboardSave,
  generateDashboardRecord,
  importDashboardRecord,
  listDashboardIndex,
  loadDashboard,
  overwriteDashboardConflict,
  readDashboardFile,
  reloadDashboardConflict,
  renameDashboardRecord,
  scheduleDashboardSave,
  serialDashboards,
  type DashboardSaveStatus,
} from '../stores/dashboards'
import { serialLayout, setPaneDashboardId, setPaneDashboardSidebar } from '../stores/layout'
import {
  findSessionByMatch,
  getSessionInstance,
  listBindableSessions,
  recentTerminalSessionId,
  serialSessions,
  type BindableSession,
} from '../stores/sessions'
import {
  createDefaultWidgetProps,
  defaultForField,
  getWidgetDefinition,
  customWidgetIdOf,
} from './widget-registry'

/** 安全模式启动检查（plan §6.10：仪表盘模块加载时调用一次）。 */
initCustomWidgetSafeMode()

/** 编辑器体积较大（含 CodeMirror），按需加载；打开前不进入仪表盘 chunk。 */
const CustomWidgetEditor = defineAsyncComponent(() => import('./custom/CustomWidgetEditor.vue'))

const props = defineProps<{
  paneIndex: number
  sessionId: string | null
}>()

const paneState = paneDashboardState(props.paneIndex)
const runtime = createDashboardRuntime({
  paneIndex: props.paneIndex,
  dashboard: () => working.value,
  bindings: () => paneDashboardState(props.paneIndex).bindings,
  mode: () => paneDashboardState(props.paneIndex).mode,
})

provide(DASHBOARD_RUNTIME_KEY, runtime)
provide(DASHBOARD_PANE_KEY, props.paneIndex)
provide(CUSTOM_WIDGET_EDITOR_OPENER_KEY, (customId: string) => openCustomWidgetEditor(customId))
provide(CUSTOM_WIDGET_STATE_SAVER_KEY, (instanceId: string, state: Record<string, unknown>) => {
  commit((draft) => {
    const target = draft.widgets.find((widget) => widget.id === instanceId)
    if (target) target.state = state
  }, `state:${instanceId}`)
})

const working = shallowRef<Dashboard | null>(null)
const loading = ref(false)
const loadError = ref('')
const pendingEditId = ref<string | null>(null)
const historyVersion = ref(0)
const variableTick = ref(0)
let history: History<Dashboard> | null = null

const layoutPane = computed(() => serialLayout.panes[props.paneIndex] ?? serialLayout.panes[0])
const dashboardId = computed(() => layoutPane.value.dashboardId)
const mode = computed(() => paneState.mode)
const paused = computed(() => paneState.paused)
const selectedIds = computed(() => paneState.selectedIds)
const variableSidebar = computed(() => layoutPane.value.dashboardSidebar)
const editorOpen = computed(() => customWidgetEditorState.open)

const selectedInstances = computed<WidgetInstance[]>(() => {
  const dashboard = working.value
  if (!dashboard) return []
  const ids = new Set(paneState.selectedIds)
  return dashboard.widgets.filter((widget) => ids.has(widget.id))
})

const bindableSessions = computed<BindableSession[]>(() => {
  void serialSessions.views.length
  return listBindableSessions()
})

const dashboardIndex = computed(() => {
  void serialDashboards.index
  return listDashboardIndex()
})

const saveStatus = computed<DashboardSaveStatus>(() => {
  const id = working.value?.id
  return id ? dashboardSaveStatus(id) : 'saved'
})

const saveError = computed(() => {
  const id = working.value?.id
  return id ? dashboardSaveError(id) : ''
})

const canGenerate = computed(() => {
  void variableTick.value
  void dashboardSessionVersion.value
  return generationCandidate() !== null
})

/** 安全模式横幅（plan §6.10 / §9）：URL 全局安全模式或上次卡死提示。 */
const safeModeBanner = computed<{ kind: 'global' | 'blocked'; text: string } | null>(() => {
  void customSafeModeState.version
  if (customSafeModeState.global) {
    return { kind: 'global', text: '安全模式：自定义控件未加载。' }
  }
  if (customSafeModeState.stoppedId !== null) {
    return {
      kind: 'blocked',
      text: `上次运行自定义控件「${customSafeModeState.stoppedName}」时页面可能失去响应，已暂停该控件。`,
    }
  }
  return null
})

/** 选中单个自定义控件时，把它的定义包装给属性面板（plan §6.10「props」）。 */
const selectedCustomDefinition = computed<WidgetDefinition | undefined>(() => {
  void serialCustomWidgets.revision
  if (selectedInstances.value.length !== 1) return undefined
  const instance = selectedInstances.value[0]
  if (instance === undefined) return undefined
  const customId = customWidgetIdOf(instance.type)
  if (customId === null) return undefined
  const summary = getCustomWidgetSummary(customId)
  if (summary?.definition == null) return undefined
  return toWidgetDefinition(summary.definition, instance.type)
})

function reEnableStoppedWidget(): void {
  const id = customSafeModeState.stoppedId
  if (id !== null) unblockCustomWidget(id)
}

function editStoppedWidget(): void {
  const id = customSafeModeState.stoppedId
  if (id !== null) openCustomWidgetEditor(id)
}

/** 一键生成的候选：已打开仪表盘时用默认数据源，空状态时用当前会话的变量。 */
function generationCandidate(): {
  sessionId: string
  sessionName: string
  alias: string
  variables: ReturnType<typeof runtime.variables>
} | null {
  if (working.value) {
    const alias = runtime.defaultAlias()
    const variables = runtime.variables(alias)
    const bound = runtime.session(alias)
    if (variables.length === 0 || !bound) return null
    return { sessionId: bound.id, sessionName: bound.name, alias, variables }
  }
  const session =
    getSessionInstance(props.sessionId) ?? getSessionInstance(bindableSessions.value[0]?.id)
  if (!session) return null
  const variables = getSeriesHub().source(session.id)?.variables() ?? []
  if (variables.length === 0) return null
  return { sessionId: session.id, sessionName: session.name, alias: 'main', variables }
}

/* ------------------------------------------------------------------------- */
/* 运行时调度                                                                  */
/* ------------------------------------------------------------------------- */

const frameLoop = createFrameLoop({
  fps: () => dashboardFps(),
  onFrame: (now) => {
    if (paneDashboardState(props.paneIndex).paused) return
    runtime.tick(now)
  },
})

function clockNow(): number {
  return typeof performance !== 'undefined' ? performance.now() : Date.now()
}

function startLoop(): void {
  frameLoop.start()
  if (paneState.paused) frameLoop.pause()
}

watch(paused, (value) => {
  if (value) frameLoop.pause()
  else {
    frameLoop.resume()
    runtime.tick(clockNow(), true)
  }
})

watch(
  () => serialSessions.views.map((view) => `${view.id}:${view.state}`).join('|'),
  () => {
    bumpDashboardSessionVersion()
    if (working.value) autoBindSources(working.value)
    runtime.requestUpdate()
    runtime.tick(clockNow(), true)
  },
)

watch(
  () => props.sessionId,
  () => {
    if (working.value) autoBindSources(working.value)
  },
)

// 预设联动：同一个仪表盘已在当前 Pane 打开时，pin 变化也要立即绑定默认数据源。
watch(
  () => paneState.pinnedDefaultSession,
  (pinned) => {
    if (pinned && working.value) autoBindSources(working.value)
  },
)

const variableTimer = setInterval(() => {
  variableTick.value += 1
}, 500)

onMounted(() => {
  window.addEventListener('pagehide', onPageHide)
  if (working.value) startLoop()
})

onActivated(() => {
  if (working.value) {
    startLoop()
    runtime.tick(clockNow(), true)
  }
})

onDeactivated(() => {
  frameLoop.stop()
  void flushCurrentSave()
})

onBeforeUnmount(() => {
  window.removeEventListener('pagehide', onPageHide)
  clearInterval(variableTimer)
  frameLoop.stop()
  void flushCurrentSave()
})

function onPageHide(): void {
  void flushCurrentSave()
}

async function flushCurrentSave(): Promise<void> {
  const id = working.value?.id
  if (id) await flushDashboardSave(id)
}

/* ------------------------------------------------------------------------- */
/* 加载与保存                                                                  */
/* ------------------------------------------------------------------------- */

let loadToken = 0

async function loadById(id: string | null, options: { edit?: boolean } = {}): Promise<void> {
  const token = ++loadToken
  if (!id) {
    working.value = null
    history = null
    loadError.value = ''
    frameLoop.stop()
    return
  }
  loading.value = true
  loadError.value = ''
  try {
    const record = await loadDashboard(id)
    if (token !== loadToken) return
    if (!record) {
      loadError.value = '仪表盘内容不存在或已损坏'
      working.value = null
      history = null
      frameLoop.stop()
      return
    }
    applyLoaded(record, options.edit === true ? 'edit' : 'run')
  } finally {
    if (token === loadToken) loading.value = false
  }
}

function applyLoaded(record: Dashboard, nextMode: 'edit' | 'run'): void {
  working.value = record
  history = createHistory(record, { limit: 100 })
  historyVersion.value += 1
  resetDashboardPaneBindings(props.paneIndex)
  setPaneDashboardSelection(props.paneIndex, [])
  setPaneDashboardMode(props.paneIndex, nextMode)
  setPaneDashboardPaused(props.paneIndex, false)
  paneState.dashboardId = record.id
  autoBindSources(record)
  runtime.syncComputed()
  runtime.tick(clockNow(), true)
  startLoop()
}

watch(
  dashboardId,
  (id) => {
    if (working.value?.id === id) return
    void flushCurrentSave()
    const edit = pendingEditId.value === id
    pendingEditId.value = null
    void loadById(id, { edit })
  },
  { immediate: true },
)

function scheduleSave(): void {
  const dashboard = working.value
  if (dashboard) scheduleDashboardSave(dashboard)
}

/** 提交一次修改（进入撤销历史，按 `mergeKey` 合并连续修改）。 */
function commit(mutator: (draft: Dashboard) => void, mergeKey?: string): void {
  const current = working.value
  if (!current || !history) return
  const draft = JSON.parse(JSON.stringify(current)) as Dashboard
  mutator(draft)
  history.push(draft, mergeKey)
  working.value = history.current()
  historyVersion.value += 1
  scheduleSave()
}

function undo(): void {
  if (!history) return
  working.value = history.undo()
  historyVersion.value += 1
  setPaneDashboardSelection(
    props.paneIndex,
    paneState.selectedIds.filter((id) => working.value?.widgets.some((widget) => widget.id === id)),
  )
  scheduleSave()
}

function redo(): void {
  if (!history) return
  working.value = history.redo()
  historyVersion.value += 1
  scheduleSave()
}

const canUndo = computed(() => {
  void historyVersion.value
  return history?.canUndo() ?? false
})

const canRedo = computed(() => {
  void historyVersion.value
  return history?.canRedo() ?? false
})

/* ------------------------------------------------------------------------- */
/* 数据源绑定                                                                  */
/* ------------------------------------------------------------------------- */

function applyBindingsChanged(): void {
  bumpDashboardSessionVersion()
  runtime.requestUpdate()
  runtime.tick(clockNow(), true)
}

function bindSource(alias: string, sessionId: string | null): void {
  setDashboardPaneBinding(props.paneIndex, alias, sessionId)
  applyBindingsChanged()
}

function autoBindSources(record: Dashboard): void {
  const sessions = listBindableSessions()
  const bindings = paneDashboardState(props.paneIndex).bindings
  const pinned = consumePinnedDefaultSession(props.paneIndex)
  const hasSession = (id: string | null | undefined): boolean =>
    id !== undefined && id !== null && sessions.some((session) => session.id === id)

  for (const alias of Object.keys(bindings)) {
    if (!record.sources.some((source) => source.alias === alias)) {
      setDashboardPaneBinding(props.paneIndex, alias, null)
    }
  }

  record.sources.forEach((source, index) => {
    const existing = bindings[source.alias]
    if (hasSession(existing)) return
    if (existing !== undefined && existing !== null) {
      setDashboardPaneBinding(props.paneIndex, source.alias, null)
    }
    if (index === 0 && hasSession(pinned)) {
      setDashboardPaneBinding(props.paneIndex, source.alias, pinned)
      return
    }
    if (source.match) {
      const matched = findSessionByMatch(source.match)
      if (matched) {
        setDashboardPaneBinding(props.paneIndex, source.alias, matched.id)
        return
      }
    }
    if (index === 0) {
      const recent = recentTerminalSessionId(props.paneIndex)
      if (hasSession(recent)) {
        setDashboardPaneBinding(props.paneIndex, source.alias, recent)
        return
      }
      const first = sessions[0]
      if (first) setDashboardPaneBinding(props.paneIndex, source.alias, first.id)
    }
  })
  bumpDashboardSessionVersion()
  runtime.syncComputed()
}

function onBindSource(payload: { alias: string; sessionId: string | null }): void {
  bindSource(payload.alias, payload.sessionId)
  const session = getSessionInstance(payload.sessionId)
  if (!session) return
  const deviceKey = session.transport.deviceKey
  const providerKind = session.providerKind
  commit((draft) => {
    const source = draft.sources.find((item) => item.alias === payload.alias)
    if (!source) return
    source.match = { deviceKey, providerKind }
  })
}

/* ------------------------------------------------------------------------- */
/* 工具栏动作                                                                  */
/* ------------------------------------------------------------------------- */

async function selectDashboard(id: string | null): Promise<void> {
  if (working.value) await flushCurrentSave()
  setPaneDashboardId(props.paneIndex, id)
}

async function createNewDashboard(name: string): Promise<void> {
  if (working.value) await flushCurrentSave()
  const record = await createDashboardRecord({ name })
  pendingEditId.value = record.id
  setPaneDashboardId(props.paneIndex, record.id)
}

async function duplicateCurrent(): Promise<void> {
  const current = working.value
  if (!current) return
  await flushCurrentSave()
  const copy = await duplicateDashboardRecord(current.id)
  if (!copy) {
    toast.show({ type: 'error', message: '复制仪表盘失败' })
    return
  }
  pendingEditId.value = copy.id
  setPaneDashboardId(props.paneIndex, copy.id)
}

async function renameCurrent(name: string): Promise<void> {
  const current = working.value
  if (!current || current.name === name) return
  commit((draft) => {
    draft.name = name
  }, 'dashboard:name')
  const ok = await renameDashboardRecord(current.id, name)
  if (!ok) toast.show({ type: 'error', message: '重命名失败' })
}

async function deleteCurrent(): Promise<void> {
  const current = working.value
  if (!current) return
  const confirmed = await confirm({
    title: '删除仪表盘',
    message: `删除「${current.name}」后无法恢复，是否继续？`,
    confirmText: '删除',
    danger: true,
  })
  if (!confirmed) return
  await deleteDashboardRecord(current.id)
  working.value = null
  history = null
  frameLoop.stop()
  setPaneDashboardId(props.paneIndex, null)
}

async function generate(): Promise<void> {
  const candidate = generationCandidate()
  if (!candidate) {
    toast.show({ type: 'warn', message: '当前数据源还没有变量，无法一键生成' })
    return
  }
  if (!working.value) {
    // 空状态下先记住要绑定的会话，生成后由自动绑定规则使用（plan §8.13 同款机制）。
    pinDashboardDefaultSession(props.paneIndex, candidate.sessionId)
  }
  const record = await generateDashboardRecord(candidate.variables, {
    alias: candidate.alias,
    name: `${candidate.sessionName} 仪表盘`,
  })
  pendingEditId.value = record.id
  setPaneDashboardId(props.paneIndex, record.id)
}

function setMode(next: 'edit' | 'run'): void {
  setPaneDashboardMode(props.paneIndex, next)
  if (next === 'run') setPaneDashboardSelection(props.paneIndex, [])
}

function togglePause(): void {
  setPaneDashboardPaused(props.paneIndex, !paneState.paused)
}

function toggleVariableSidebar(): void {
  setPaneDashboardSidebar(props.paneIndex, !layoutPane.value.dashboardSidebar)
}

function updateWidgetProps(payload: {
  ids: string[]
  patch: Record<string, unknown>
  mergeKey: string
}): void {
  commit((draft) => {
    for (const widget of draft.widgets) {
      if (!payload.ids.includes(widget.id)) continue
      widget.props = { ...widget.props, ...payload.patch }
    }
  }, payload.mergeKey)
}

function updateCommonProps(payload: {
  ids: string[]
  patch: Record<string, unknown>
  mergeKey: string
}): void {
  commit((draft) => {
    for (const widget of draft.widgets) {
      if (!payload.ids.includes(widget.id)) continue
      widget.common = { ...widget.common, ...payload.patch } as WidgetInstance['common']
    }
  }, payload.mergeKey)
}

function updateDashboard(patch: Partial<Dashboard>): void {
  commit((draft) => {
    Object.assign(draft, patch)
  }, 'dashboard:settings')
}

function commitLayout(rects: Rect[]): void {
  const byId = new Map(rects.map((rect) => [rect.id, rect]))
  commit((draft) => {
    draft.widgets = draft.widgets.map((widget) => {
      const rect = byId.get(widget.id)
      return rect ? { ...widget, x: rect.x, y: rect.y, w: rect.w, h: rect.h } : widget
    })
  })
}

/* ------------------------------------------------------------------------- */
/* 组件创建 / 删除 / 复制                                                      */
/* ------------------------------------------------------------------------- */

function currentRects(): Rect[] {
  return (
    working.value?.widgets.map((widget) => ({
      id: widget.id,
      x: widget.x,
      y: widget.y,
      w: widget.w,
      h: widget.h,
    })) ?? []
  )
}

function makeCommon(definitionTitle: string): WidgetInstance['common'] {
  return {
    title: definitionTitle,
    showTitle: true,
    titleAlign: 'left',
    background: 'default',
    border: true,
    padding: 8,
    fontScale: 1,
  }
}

function addWidgetInstance(type: string, at?: { x: number; y: number }): void {
  if (!working.value) return
  const definition = getWidgetDefinition(type)
  const customId = customWidgetIdOf(type)
  const customSummary = customId !== null ? getCustomWidgetSummary(customId) : undefined
  const customDefinition = customSummary?.definition ?? null
  const width = definition?.defaultSize.w ?? customSummary?.size.default.w ?? 6
  const height = definition?.defaultSize.h ?? customSummary?.size.default.h ?? 6
  const instanceId = uuid()
  const placed = placeNew(currentRects(), width, height, at ? { ...at, id: instanceId } : undefined)
  let instanceProps: Record<string, unknown> = definition
    ? createDefaultWidgetProps(definition)
    : {}
  if (customDefinition !== null) {
    instanceProps = {}
    for (const field of customDefinition.props ?? []) {
      const value = defaultForField(field)
      if (value !== undefined) instanceProps[field.key] = value
    }
    // 声明了 variables 的控件默认绑定默认数据源的前 N 个变量，放到仪表盘后立即有数据。
    if (customDefinition.variables !== undefined) {
      const available = runtime.variables(runtime.defaultAlias())
      const count = Math.min(
        customDefinition.variables.max,
        Math.max(customDefinition.variables.min, 0),
      )
      instanceProps.variables = available.slice(0, count).map((info) => ({
        source: runtime.defaultAlias(),
        key: info.key,
      }))
    }
  }
  const instance: WidgetInstance = {
    id: instanceId,
    type,
    version: definition?.version ?? 1,
    x: placed.placed.x,
    y: placed.placed.y,
    w: placed.placed.w,
    h: placed.placed.h,
    common: makeCommon(definition?.title ?? customDefinition?.meta.name ?? type),
    props: instanceProps,
  }
  commit((draft) => {
    for (const widget of draft.widgets) {
      const rect = placed.items.find((item) => item.id === widget.id)
      if (rect) {
        widget.x = rect.x
        widget.y = rect.y
        widget.w = rect.w
        widget.h = rect.h
      }
    }
    draft.widgets.push(instance)
  })
  setPaneDashboardSelection(props.paneIndex, [instanceId])
  setPaneDashboardMode(props.paneIndex, 'edit')
}

function deleteSelected(instanceId: string | null): void {
  const ids = new Set(instanceId ? [instanceId] : paneState.selectedIds)
  if (ids.size === 0) return
  commit((draft) => {
    draft.widgets = draft.widgets.filter((widget) => !ids.has(widget.id))
  })
  setPaneDashboardSelection(props.paneIndex, [])
}

const clipboard = ref<WidgetInstance[]>([])

function copySelected(instanceId: string | null): void {
  const ids = new Set(instanceId ? [instanceId] : paneState.selectedIds)
  clipboard.value = (working.value?.widgets ?? [])
    .filter((widget) => ids.has(widget.id))
    .map((widget) => JSON.parse(JSON.stringify(widget)) as WidgetInstance)
  if (clipboard.value.length > 0) {
    toast.show({ type: 'info', message: `已复制 ${clipboard.value.length} 个组件` })
  }
}

function duplicateWidgets(source: WidgetInstance[], offset = 1): void {
  if (source.length === 0) return
  const copies = source.map((widget) => ({
    ...(JSON.parse(JSON.stringify(widget)) as WidgetInstance),
    id: uuid(),
    x: Math.min(24 - widget.w, widget.x + offset),
    y: widget.y + offset,
  }))
  commit((draft) => {
    draft.widgets.push(...copies)
  })
  setPaneDashboardSelection(
    props.paneIndex,
    copies.map((widget) => widget.id),
  )
}

function duplicateSelected(instanceId: string | null): void {
  const ids = new Set(instanceId ? [instanceId] : paneState.selectedIds)
  const source = (working.value?.widgets ?? []).filter((widget) => ids.has(widget.id))
  duplicateWidgets(source)
}

function pasteClipboard(): void {
  if (clipboard.value.length === 0) return
  duplicateWidgets(clipboard.value, 1)
}

function toTopRow(instanceId: string | null): void {
  const ids = new Set(instanceId ? [instanceId] : paneState.selectedIds)
  if (ids.size === 0) return
  commit((draft) => {
    for (const widget of draft.widgets) {
      if (ids.has(widget.id)) widget.y = 0
    }
    const rects = normalize(
      draft.widgets.map((widget) => ({
        id: widget.id,
        x: widget.x,
        y: widget.y,
        w: widget.w,
        h: widget.h,
      })),
    )
    for (const widget of draft.widgets) {
      const rect = rects.find((item) => item.id === widget.id)
      if (rect) {
        widget.x = rect.x
        widget.y = rect.y
      }
    }
  })
}

function onContextAction(payload: { action: string; instanceId: string | null }): void {
  switch (payload.action) {
    case 'undo':
      undo()
      break
    case 'redo':
      redo()
      break
    case 'copy':
      copySelected(payload.instanceId)
      break
    case 'paste':
      pasteClipboard()
      break
    case 'duplicate':
      duplicateSelected(payload.instanceId)
      break
    case 'delete':
      deleteSelected(payload.instanceId)
      break
    case 'to-top':
      toTopRow(payload.instanceId)
      break
    case 'save-as-custom':
      toast.show({ type: 'info', message: '另存为自定义控件模板将在后续版本提供' })
      break
  }
}

/* ------------------------------------------------------------------------- */
/* 变量拖放                                                                    */
/* ------------------------------------------------------------------------- */

function createChartForVariable(ref: VarRef, at?: { x: number; y: number }): void {
  if (!working.value) return
  const definition = getWidgetDefinition('chart.line')
  const width = definition?.defaultSize.w ?? 12
  const height = definition?.defaultSize.h ?? 8
  const instanceId = uuid()
  const placed = placeNew(currentRects(), width, height, at ? { ...at, id: instanceId } : undefined)
  const instance: WidgetInstance = {
    id: instanceId,
    type: 'chart.line',
    version: definition?.version ?? 1,
    x: placed.placed.x,
    y: placed.placed.y,
    w: placed.placed.w,
    h: placed.placed.h,
    common: makeCommon(definition?.title ?? '波形图'),
    props: {
      ...(definition ? createDefaultWidgetProps(definition) : {}),
      variables: [{ ...ref }],
    },
  }
  commit((draft) => {
    for (const widget of draft.widgets) {
      const rect = placed.items.find((item) => item.id === widget.id)
      if (rect) {
        widget.x = rect.x
        widget.y = rect.y
        widget.w = rect.w
        widget.h = rect.h
      }
    }
    draft.widgets.push(instance)
  })
  setPaneDashboardSelection(props.paneIndex, [instanceId])
}

function onDropVariable(payload: {
  ref: VarRef
  instanceId: string | null
  x: number
  y: number
}): void {
  if (!working.value) return
  if (paneState.mode === 'run') setPaneDashboardMode(props.paneIndex, 'edit')

  if (payload.instanceId === null) {
    createChartForVariable(payload.ref, { x: payload.x, y: payload.y })
    return
  }

  const widget = working.value.widgets.find((item) => item.id === payload.instanceId)
  if (!widget) return
  const definition = getWidgetDefinition(widget.type)
  const variablesField = definition?.props.find((field) => field.type === 'variables')
  const variableField = definition?.props.find((field) => field.type === 'variable')

  if (variablesField && variablesField.type === 'variables') {
    const current = Array.isArray(widget.props[variablesField.key])
      ? (widget.props[variablesField.key] as unknown[])
      : []
    const max = variablesField.max ?? 16
    if (current.length >= max) {
      toast.show({ type: 'warn', message: `该组件最多绑定 ${max} 个变量` })
      return
    }
    const item: Record<string, unknown> = { ...payload.ref }
    for (const itemField of variablesField.itemFields ?? []) {
      const defaultValue = defaultForField(itemField)
      if (defaultValue !== undefined) item[itemField.key] = defaultValue
    }
    commit((draft) => {
      const target = draft.widgets.find((candidate) => candidate.id === payload.instanceId)
      if (!target) return
      target.props = { ...target.props, [variablesField.key]: [...current, item] }
    }, `variables:${variablesField.key}`)
    return
  }

  if (variableField) {
    commit((draft) => {
      const target = draft.widgets.find((candidate) => candidate.id === payload.instanceId)
      if (!target) return
      target.props = { ...target.props, [variableField.key]: payload.ref }
    }, `variable:${variableField.key}`)
    return
  }

  toast.show({ type: 'warn', message: '该组件不支持绑定变量' })
}

/* ------------------------------------------------------------------------- */
/* 变量元信息 / 计算变量                                                       */
/* ------------------------------------------------------------------------- */

function updateVariableMeta(payload: {
  source: string
  key: string
  patch: Record<string, unknown>
}): void {
  const metaKey = `${payload.source}/${payload.key}`
  commit((draft) => {
    const existing = { ...(draft.variableMeta[metaKey] ?? {}) } as Record<string, unknown>
    for (const [key, value] of Object.entries(payload.patch)) {
      if (value === undefined) delete existing[key]
      else existing[key] = value
    }
    if (Object.keys(existing).length === 0) delete draft.variableMeta[metaKey]
    else draft.variableMeta[metaKey] = existing as Dashboard['variableMeta'][string]
  }, `meta:${metaKey}`)
}

function addComputed(payload: {
  source: string
  computed: { key: string; expr: string; unit?: string }
}): void {
  commit((draft) => {
    const list = draft.computed[payload.source] ?? []
    draft.computed[payload.source] = [...list, payload.computed]
  })
  runtime.syncComputed()
}

function removeComputed(payload: { source: string; key: string }): void {
  commit((draft) => {
    const list = draft.computed[payload.source] ?? []
    draft.computed[payload.source] = list.filter((item) => item.key !== payload.key)
  })
  runtime.syncComputed()
}

/* ------------------------------------------------------------------------- */
/* 导入 / 导出                                                                 */
/* ------------------------------------------------------------------------- */

async function exportCurrent(): Promise<void> {
  const dashboard = working.value
  if (!dashboard) return
  // 导出该仪表盘用到的全部自定义控件记录（plan §8.10 / §6.10）。
  const customWidgets = await collectDashboardCustomWidgets(dashboard.widgets)
  const file = exportDashboardFile(dashboard, customWidgets)
  downloadText(file.text, file.fileName, 'application/json;charset=utf-8')
  toast.show({ type: 'success', message: `已导出 ${file.fileName}` })
}

interface ImportPending {
  dashboard: Dashboard
  customWidgets: DashboardCustomWidgetRecord[]
}

const importPending = ref<ImportPending | null>(null)
const importSafetyOpen = ref(false)
const importConflictOpen = ref(false)
const importWidgetConflictOpen = ref(false)
const importWidgetConflicts = ref<Array<{ name: string }>>([])

function handleImport(payload: { text: string; fileName: string }): void {
  const parsed = readDashboardFile(payload.text)
  if (!parsed.ok) {
    toast.show({ type: 'error', message: parsed.error })
    return
  }
  importPending.value = {
    dashboard: parsed.file.dashboard,
    customWidgets: parsed.file.customWidgets,
  }
  if (parsed.file.customWidgets.length > 0) {
    importSafetyOpen.value = true
    return
  }
  void continueImport()
}

/** 安全说明确认后：先处理控件 id 冲突，再写入控件并处理仪表盘 id 冲突。 */
async function continueImport(): Promise<void> {
  const pending = importPending.value
  if (!pending) return
  const conflicts = await inspectCustomWidgetImport(pending.customWidgets)
  if (conflicts.length > 0) {
    importWidgetConflicts.value = conflicts.map((item) => ({ name: item.incoming.name }))
    importWidgetConflictOpen.value = true
    return
  }
  await applyImportedWidgets('overwrite')
}

/** 把文件中的控件写入仓库；「保留两者」时改写仪表盘实例引用。 */
async function applyImportedWidgets(choice: 'overwrite' | 'keep-both'): Promise<void> {
  const pending = importPending.value
  if (!pending) return
  if (pending.customWidgets.length > 0) {
    const result = await importCustomWidgets(pending.customWidgets, choice)
    if (Object.keys(result.idMap).length > 0) {
      pending.dashboard = {
        ...pending.dashboard,
        widgets: remapCustomWidgetTypes(pending.dashboard.widgets, result.idMap),
      }
    }
    if (result.written > 0) {
      toast.show({
        type: 'success',
        message: `已导入 ${result.written} 个自定义控件${result.skipped > 0 ? `（跳过 ${result.skipped} 个相同代码）` : ''}`,
      })
    }
  }
  await proceedAfterWidgets()
}

async function proceedAfterWidgets(): Promise<void> {
  const pending = importPending.value
  if (!pending) return
  const exists = dashboardIndex.value.some((entry) => entry.id === pending.dashboard.id)
  if (exists) {
    importConflictOpen.value = true
    return
  }
  await finishImport('overwrite')
}

/** 控件 id 冲突处理：覆盖或保留两者（保留时改写仪表盘实例引用）。 */
async function resolveWidgetConflicts(choice: 'overwrite' | 'keep-both'): Promise<void> {
  importWidgetConflictOpen.value = false
  importWidgetConflicts.value = []
  try {
    await applyImportedWidgets(choice)
  } catch (widgetError) {
    toast.show({ type: 'error', message: `导入自定义控件失败：${errorMessage(widgetError)}` })
  }
}

async function finishImport(mode: 'overwrite' | 'copy'): Promise<void> {
  const pending = importPending.value
  importPending.value = null
  importConflictOpen.value = false
  importSafetyOpen.value = false
  if (!pending) return
  const record = await importDashboardRecord(pending.dashboard, mode)
  pendingEditId.value = record.id
  if (working.value?.id === record.id) {
    applyLoaded(record, paneState.mode)
  } else {
    setPaneDashboardId(props.paneIndex, record.id)
  }
  toast.show({ type: 'success', message: `已导入仪表盘「${record.name}」` })
}

function confirmImportSafety(): void {
  importSafetyOpen.value = false
  void continueImport()
}

function cancelImportSafety(): void {
  importSafetyOpen.value = false
  importPending.value = null
}

function cancelImportConflict(): void {
  importConflictOpen.value = false
  importPending.value = null
}

function cancelWidgetConflict(): void {
  importWidgetConflictOpen.value = false
  importWidgetConflicts.value = []
  importPending.value = null
}

/* ------------------------------------------------------------------------- */
/* 数据 CSV 导出                                                               */
/* ------------------------------------------------------------------------- */

const csvDialogOpen = ref(false)
const csvSource = ref('')
const csvKeys = ref<string[]>([])
const csvRangeMode = ref<'all' | 'seconds'>('all')
const csvSeconds = ref(60)

function openCsvDialog(): void {
  const dashboard = working.value
  if (!dashboard) return
  const alias = dashboard.sources[0]?.alias ?? 'main'
  csvSource.value = alias
  csvRangeMode.value = 'all'
  csvSeconds.value = 60
  resetCsvKeys(alias)
  csvDialogOpen.value = true
}

function usedKeysFor(alias: string): string[] {
  const dashboard = working.value
  if (!dashboard) return []
  const keys = new Set<string>()
  const walk = (value: unknown, depth = 0): void => {
    if (depth > 6 || value === null || value === undefined) return
    if (Array.isArray(value)) {
      for (const item of value) walk(item, depth + 1)
      return
    }
    if (typeof value !== 'object') return
    const record = value as Record<string, unknown>
    if (record.source === alias && typeof record.key === 'string') {
      keys.add(record.key)
      return
    }
    for (const item of Object.values(record)) walk(item, depth + 1)
  }
  walk(dashboard.widgets.map((widget) => widget.props))
  return [...keys]
}

function resetCsvKeys(alias: string): void {
  const used = usedKeysFor(alias)
  const available = runtime.variables(alias).map((info) => info.key)
  csvKeys.value = used.length > 0 ? used.filter((key) => available.includes(key)) : available
}

watch(csvSource, (alias) => {
  if (csvDialogOpen.value) resetCsvKeys(alias)
})

const csvAvailableKeys = computed(() => {
  void variableTick.value
  return runtime.variables(csvSource.value).map((info) => info.key)
})

function toggleCsvKey(key: string): void {
  csvKeys.value = csvKeys.value.includes(key)
    ? csvKeys.value.filter((item) => item !== key)
    : [...csvKeys.value, key]
}

function timestampSuffix(): string {
  const date = new Date()
  const pad = (value: number): string => String(value).padStart(2, '0')
  return `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}-${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`
}

function exportDataCsv(): void {
  const dashboard = working.value
  if (!dashboard) return
  const alias = csvSource.value
  const source = runtime.series(alias)
  if (!source) {
    toast.show({ type: 'error', message: `数据源 ${alias} 未连接` })
    return
  }
  if (csvKeys.value.length === 0) {
    toast.show({ type: 'warn', message: '请至少选择一个变量' })
    return
  }
  let fromIdx: number | undefined
  if (csvRangeMode.value === 'seconds') {
    const cutoff = Date.now() - Math.max(1, csvSeconds.value) * 1000
    let first: number | undefined
    for (const key of csvKeys.value) {
      const slice = source.read(key, { fromT: cutoff, limit: 1 })
      const idx = slice.idx[0]
      if (idx !== undefined && (first === undefined || idx < first)) first = idx
    }
    if (first === undefined) {
      toast.show({ type: 'warn', message: '所选范围内没有数据' })
      return
    }
    fromIdx = first
  }
  const csv = exportSeriesCsv(source, csvKeys.value, fromIdx === undefined ? {} : { fromIdx })
  const safeName = dashboard.name.replace(/[\\/:*?"<>|]/g, '_')
  downloadText(csv, `${safeName}_${alias}_${timestampSuffix()}.csv`, 'text/csv;charset=utf-8')
  toast.show({ type: 'success', message: '已导出数据 CSV' })
  csvDialogOpen.value = false
}

/* ------------------------------------------------------------------------- */
/* 并发修改                                                                    */
/* ------------------------------------------------------------------------- */

const conflictOpen = ref(false)
const lastStatus = ref<DashboardSaveStatus>('saved')

watch(saveStatus, (status) => {
  if (status === 'conflict' && lastStatus.value !== 'conflict' && !conflictOpen.value) {
    conflictOpen.value = true
  }
  if (status === 'error' && lastStatus.value !== 'error') {
    toast.show({ type: 'error', message: '保存仪表盘失败，工具栏已标记为「未保存」' })
  }
  lastStatus.value = status
})

async function resolveOverwrite(): Promise<void> {
  conflictOpen.value = false
  const dashboard = working.value
  if (!dashboard) return
  const result = await overwriteDashboardConflict(dashboard)
  if (result.ok) toast.show({ type: 'success', message: '已覆盖其他标签页的修改' })
  else if ('error' in result) toast.show({ type: 'error', message: result.error })
}

async function reloadFromConflict(): Promise<void> {
  conflictOpen.value = false
  const id = working.value?.id
  if (!id) return
  const record = await reloadDashboardConflict(id)
  if (!record) {
    toast.show({ type: 'error', message: '重新加载失败' })
    return
  }
  const keepMode = paneState.mode
  working.value = record
  history = createHistory(record, { limit: 100 })
  historyVersion.value += 1
  setPaneDashboardMode(props.paneIndex, keepMode)
  toast.show({ type: 'success', message: '已重新加载其他标签页的版本' })
}

/* ------------------------------------------------------------------------- */
/* 空状态                                                                      */
/* ------------------------------------------------------------------------- */

const emptyFileInput = ref<HTMLInputElement | null>(null)

async function onEmptyImportFile(event: Event): Promise<void> {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  input.value = ''
  if (!file) return
  handleImport({ text: await file.text(), fileName: file.name })
}

async function createFromEmpty(): Promise<void> {
  const record = await createDashboardRecord({ name: '未命名仪表盘' })
  pendingEditId.value = record.id
  setPaneDashboardId(props.paneIndex, record.id)
}

function errorMessage(error: unknown): string {
  if (error instanceof Error && error.message.length > 0) return error.message
  return String(error)
}
</script>

<template>
  <div
    class="dashboard-pane"
    :class="`is-${mode}`"
    :data-pane-index="paneIndex"
    data-dashboard-pane
    data-testid="dashboard-pane"
  >
    <DashboardToolbar
      :dashboards="dashboardIndex"
      :dashboard="working"
      :save-status="saveStatus"
      :save-error="saveError"
      :mode="mode"
      :paused="paused"
      :can-undo="canUndo"
      :can-redo="canRedo"
      :bindings="paneState.bindings"
      :sessions="bindableSessions"
      :can-generate="canGenerate"
      :variable-sidebar="variableSidebar"
      @select="selectDashboard"
      @new="createNewDashboard"
      @duplicate="duplicateCurrent"
      @rename="renameCurrent"
      @delete="deleteCurrent"
      @import-file="handleImport"
      @export="exportCurrent"
      @generate="generate"
      @toggle-pause="togglePause"
      @mode-change="setMode"
      @undo="undo"
      @redo="redo"
      @toggle-variable-sidebar="toggleVariableSidebar"
      @add-source="
        (source) =>
          commit((draft) => {
            draft.sources.push(source)
          })
      "
      @remove-source="
        (alias) =>
          commit((draft) => {
            if (draft.sources.length > 1) {
              draft.sources = draft.sources.filter((source) => source.alias !== alias)
            }
          }, 'dashboard:sources')
      "
      @bind-source="onBindSource"
      @export-csv="openCsvDialog"
    />

    <div
      v-if="safeModeBanner !== null"
      class="dashboard-pane__safe-banner"
      role="alert"
      data-testid="safe-mode-banner"
      :data-safe-mode="safeModeBanner.kind"
    >
      <span class="dashboard-pane__safe-text">{{ safeModeBanner.text }}</span>
      <div class="dashboard-pane__safe-actions">
        <template v-if="safeModeBanner.kind === 'global'">
          <UiButton
            size="sm"
            variant="primary"
            data-testid="safe-mode-exit"
            @click="exitGlobalCustomWidgetSafeMode"
          >
            退出安全模式
          </UiButton>
        </template>
        <template v-else>
          <UiButton
            size="sm"
            variant="primary"
            data-testid="safe-mode-reenable"
            @click="reEnableStoppedWidget"
          >
            重新启用
          </UiButton>
          <UiButton size="sm" data-testid="safe-mode-edit" @click="editStoppedWidget">
            编辑代码
          </UiButton>
        </template>
      </div>
    </div>

    <div v-if="loading" class="dashboard-pane__message">正在加载仪表盘…</div>

    <div v-else-if="!dashboardId" class="dashboard-pane__empty" data-testid="dashboard-empty">
      <UiEmpty
        title="还没有打开的仪表盘"
        description="新建一个空白仪表盘、根据当前变量一键生成，或导入已有的仪表盘文件。"
      >
        <UiButton variant="primary" data-testid="dashboard-empty-new" @click="createFromEmpty">
          新建空白仪表盘
        </UiButton>
        <UiButton :disabled="!canGenerate" data-testid="dashboard-empty-generate" @click="generate">
          一键生成（需要已有变量）
        </UiButton>
        <UiButton
          variant="ghost"
          data-testid="dashboard-empty-import"
          @click="emptyFileInput?.click()"
        >
          导入仪表盘
        </UiButton>
        <input
          ref="emptyFileInput"
          class="dashboard-pane__file"
          type="file"
          accept=".json,application/json"
          data-testid="dashboard-empty-import-file"
          @change="onEmptyImportFile"
        />
      </UiEmpty>
    </div>

    <div v-else-if="!working || loadError" class="dashboard-pane__empty">
      <UiEmpty title="仪表盘无法打开" :description="loadError || '仪表盘内容不存在。'">
        <UiButton data-testid="dashboard-empty-new" @click="createFromEmpty"
          >新建空白仪表盘</UiButton
        >
        <UiButton variant="ghost" @click="selectDashboard(null)">返回列表</UiButton>
      </UiEmpty>
    </div>

    <div v-else class="dashboard-pane__body">
      <aside v-if="mode === 'edit'" class="dashboard-pane__sidebar" data-testid="dashboard-sidebar">
        <WidgetLibrary @create="(type) => addWidgetInstance(type)" />
        <div class="dashboard-pane__divider" />
        <VariableList
          :pane-index="paneIndex"
          :dashboard="working"
          :runtime="runtime"
          :mode="mode"
          @update-meta="updateVariableMeta"
          @add-computed="addComputed"
          @remove-computed="removeComputed"
        />
      </aside>

      <aside
        v-else-if="variableSidebar"
        class="dashboard-pane__sidebar"
        data-testid="dashboard-sidebar"
      >
        <VariableList
          :pane-index="paneIndex"
          :dashboard="working"
          :runtime="runtime"
          :mode="mode"
          @update-meta="updateVariableMeta"
          @add-computed="addComputed"
          @remove-computed="removeComputed"
        />
      </aside>

      <GridCanvas
        :dashboard="working"
        :mode="mode"
        :selected-ids="selectedIds"
        :runtime="runtime"
        @update:selected-ids="(ids) => setPaneDashboardSelection(paneIndex, ids)"
        @commit-layout="commitLayout"
        @create-widget="
          (payload) => addWidgetInstance(payload.type, { x: payload.x, y: payload.y })
        "
        @drop-variable="onDropVariable"
        @context-action="onContextAction"
      />

      <aside v-if="mode === 'edit'" class="dashboard-pane__properties">
        <PropertyPanel
          :dashboard="working"
          :selected="selectedInstances"
          :mode="mode"
          :runtime="runtime"
          :definition="selectedCustomDefinition"
          @update-props="updateWidgetProps"
          @update-common="updateCommonProps"
          @update-dashboard="(payload) => updateDashboard(payload.patch)"
        />
      </aside>
    </div>

    <UiDialog
      v-model="importSafetyOpen"
      title="安全说明"
      width="min(92vw, 520px)"
      @confirm="confirmImportSafety"
    >
      <div class="dashboard-pane__dialog" data-testid="dashboard-import-safety">
        <p>
          该仪表盘包含自定义控件。自定义控件与页面拥有相同的权限（可以访问
          DOM、本地存储和已打开的串口）， 只应运行自己编写或信任的代码。
        </p>
        <p>导入后请先检查控件代码，确认可信后再运行。</p>
      </div>
      <template #footer>
        <UiButton size="md" @click="cancelImportSafety">取消</UiButton>
        <UiButton
          size="md"
          variant="primary"
          data-testid="dashboard-import-safety-confirm"
          @click="confirmImportSafety"
        >
          我已了解风险，继续导入
        </UiButton>
      </template>
    </UiDialog>

    <UiDialog
      v-model="importConflictOpen"
      title="仪表盘 id 已存在"
      width="min(92vw, 460px)"
      :show-footer="false"
    >
      <div class="dashboard-pane__dialog" data-testid="dashboard-import-conflict">
        <p>已存在相同 id 的仪表盘，请选择处理方式：</p>
        <div class="dashboard-pane__dialog-actions">
          <UiButton
            variant="primary"
            data-testid="dashboard-import-overwrite"
            @click="finishImport('overwrite')"
          >
            覆盖
          </UiButton>
          <UiButton data-testid="dashboard-import-copy" @click="finishImport('copy')">
            另存为副本
          </UiButton>
          <UiButton variant="ghost" @click="cancelImportConflict"> 取消 </UiButton>
        </div>
      </div>
    </UiDialog>

    <UiDialog
      v-model="conflictOpen"
      title="该仪表盘已在其他标签页修改"
      width="min(92vw, 460px)"
      :show-footer="false"
    >
      <div class="dashboard-pane__dialog" data-testid="dashboard-conflict">
        <p>其他标签页写入了更新版本。覆盖会丢弃对方的修改；重新加载会丢弃本页未保存的修改。</p>
        <div class="dashboard-pane__dialog-actions">
          <UiButton
            variant="danger"
            data-testid="dashboard-conflict-overwrite"
            @click="resolveOverwrite"
          >
            覆盖
          </UiButton>
          <UiButton
            variant="primary"
            data-testid="dashboard-conflict-reload"
            @click="reloadFromConflict"
          >
            重新加载
          </UiButton>
          <UiButton variant="ghost" @click="conflictOpen = false">取消</UiButton>
        </div>
      </div>
    </UiDialog>

    <UiDialog
      v-model="importWidgetConflictOpen"
      title="自定义控件 id 已存在"
      width="min(92vw, 520px)"
      :show-footer="false"
    >
      <div class="dashboard-pane__dialog" data-testid="dashboard-import-widget-conflict">
        <p>以下自定义控件的 id 已存在，但代码不同，请选择处理方式：</p>
        <ul class="dashboard-pane__conflict-list">
          <li v-for="item in importWidgetConflicts" :key="item.name">{{ item.name }}</li>
        </ul>
        <div class="dashboard-pane__dialog-actions">
          <UiButton
            variant="danger"
            data-testid="dashboard-import-widget-overwrite"
            @click="resolveWidgetConflicts('overwrite')"
          >
            覆盖
          </UiButton>
          <UiButton
            variant="primary"
            data-testid="dashboard-import-widget-keep-both"
            @click="resolveWidgetConflicts('keep-both')"
          >
            保留两者
          </UiButton>
          <UiButton variant="ghost" @click="cancelWidgetConflict">取消</UiButton>
        </div>
      </div>
    </UiDialog>

    <UiDialog
      v-model="csvDialogOpen"
      title="导出数据 CSV"
      width="min(94vw, 520px)"
      confirm-text="导出"
      :confirm-disabled="csvKeys.length === 0"
      @confirm="exportDataCsv"
    >
      <div class="dashboard-pane__dialog" data-testid="dashboard-data-export-dialog">
        <UiFormField label="数据源">
          <UiSelect
            v-model="csvSource"
            :options="
              working?.sources.map((source) => ({
                label: `${source.alias} · ${source.label}`,
                value: source.alias,
              })) ?? []
            "
            size="sm"
            aria-label="数据源"
            data-testid="dashboard-data-export-source"
          />
        </UiFormField>

        <UiFormField label="变量">
          <div class="dashboard-pane__csv-keys">
            <UiCheckbox
              v-for="key in csvAvailableKeys"
              :key="key"
              :model-value="csvKeys.includes(key)"
              :label="key"
              size="sm"
              :data-testid="`dashboard-data-export-var-${key}`"
              @update:model-value="toggleCsvKey(key)"
            />
            <p v-if="csvAvailableKeys.length === 0" class="dashboard-pane__hint">
              该数据源还没有变量。
            </p>
          </div>
        </UiFormField>

        <UiFormField label="范围">
          <div class="dashboard-pane__csv-range" data-testid="dashboard-data-export-range">
            <label class="dashboard-pane__radio">
              <input v-model="csvRangeMode" type="radio" value="all" aria-label="全部缓冲" />
              全部缓冲
            </label>
            <label class="dashboard-pane__radio">
              <input v-model="csvRangeMode" type="radio" value="seconds" aria-label="最近 N 秒" />
              最近
            </label>
            <UiNumberInput
              v-model="csvSeconds"
              :min="1"
              :max="86400"
              size="sm"
              unit="秒"
              :disabled="csvRangeMode !== 'seconds'"
              aria-label="秒数"
              data-testid="dashboard-data-export-seconds"
            />
          </div>
        </UiFormField>
      </div>
      <template #footer>
        <UiButton size="md" @click="csvDialogOpen = false">取消</UiButton>
        <UiButton
          size="md"
          variant="primary"
          :disabled="csvKeys.length === 0"
          data-testid="dashboard-data-export-confirm"
          @click="exportDataCsv"
        >
          导出
        </UiButton>
      </template>
    </UiDialog>

    <CustomWidgetEditor v-if="editorOpen" />
  </div>
</template>

<style scoped>
.dashboard-pane {
  display: flex;
  flex-direction: column;
  height: 100%;
  min-width: 0;
  min-height: 0;
  background: var(--bg);
}

.dashboard-pane__body {
  display: flex;
  flex: 1 1 auto;
  min-width: 0;
  min-height: 0;
}

.dashboard-pane__sidebar {
  display: flex;
  flex-direction: column;
  gap: 10px;
  flex: none;
  width: clamp(210px, 16vw, 250px);
  min-height: 0;
  padding: 10px;
  overflow-y: auto;
  border-right: 1px solid var(--border);
  background: var(--bg-elev);
}

.dashboard-pane__properties {
  flex: none;
  width: clamp(250px, 19vw, 300px);
  min-height: 0;
  border-left: 1px solid var(--border);
  background: var(--bg-elev);
}

.dashboard-pane__divider {
  height: 1px;
  margin: 2px 0;
  background: var(--border);
}

.dashboard-pane__empty,
.dashboard-pane__message {
  display: flex;
  align-items: center;
  justify-content: center;
  flex: 1 1 auto;
  min-height: 0;
  background: var(--bg);
}

.dashboard-pane__message {
  color: var(--text-faint);
  font-size: 12px;
}

.dashboard-pane__file {
  display: none;
}

.dashboard-pane__safe-banner {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-2);
  flex: none;
  padding: 5px 10px;
  border-bottom: 1px solid var(--warn);
  background: var(--warn-soft);
  color: var(--warn);
  font-size: 11px;
  line-height: 1.5;
}

.dashboard-pane__safe-text {
  min-width: 0;
  overflow-wrap: anywhere;
}

.dashboard-pane__safe-actions {
  display: flex;
  align-items: center;
  gap: 4px;
  flex: none;
}

.dashboard-pane__conflict-list {
  margin: 0;
  padding-left: var(--space-4);
  color: var(--text);
  font-family: var(--font-mono);
  font-size: 11px;
}

.dashboard-pane__dialog {
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
  min-width: 0;
  color: var(--text-dim);
  font-size: 12px;
  line-height: 1.6;
}

.dashboard-pane__dialog p {
  margin: 0;
}

.dashboard-pane__dialog-actions {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  flex-wrap: wrap;
}

.dashboard-pane__csv-keys {
  display: flex;
  flex-direction: column;
  gap: 2px;
  max-height: 220px;
  overflow-y: auto;
}

.dashboard-pane__csv-range {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  flex-wrap: wrap;
}

.dashboard-pane__radio {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  color: var(--text-dim);
  font-size: 11px;
  cursor: pointer;
}

.dashboard-pane__hint {
  margin: 0;
  color: var(--text-faint);
  font-size: 11px;
}
</style>
