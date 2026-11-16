/**
 * 串口助手会话状态（plan §8.3）。
 *
 * 订阅 `LinkManager` 的会话列表以及每个 `LinkSession` 的状态 / 日志 / 统计 /
 * 协议 / 任务 / 控制线事件，维护界面使用的 `SessionView[]`、两个 Pane 的绑定关系
 * 和焦点 Pane。
 *
 * 绑定关系不持久化：会话本身不跨页面保留，`keepAlive` 只保证返回工具页时组件实例
 * 还在。
 */

import { reactive } from 'vue'

import {
  getLinkManager,
  type DisplayMode,
  type LinkManagerAuthorizedEntry,
  type LinkSession,
  type LinkSignals,
  type LinkTasks,
  type LogPolicy,
  type PresetApplyTarget,
  type SessionProtocol,
  type SessionState,
  type SessionStats,
  type TransportProvider,
} from '@/domains/link/public'
import { confirm } from '@/shared/ui/services/confirm'
import { toast } from '@/shared/ui/services/toast'

import { getDeviceCompose, saveDeviceCompose } from './deviceCompose'
import { serialLayout } from './layout'
import { logLimitsFromSettings, serialSettings } from './settings'

/** 界面使用的会话快照。 */
export interface SessionView {
  id: string
  name: string
  state: SessionState
  lastError: string | null
  stats: SessionStats
  protocol: SessionProtocol | null
  signals: LinkSignals
  tasks: LinkTasks
  /** 未在任何 Pane 中显示时收到的 RX 条数。 */
  unread: number
  /** 日志事件计数，用于让状态栏等派生显示随日志刷新。 */
  logVersion: number
  providerKind: string
  settings: Readonly<Record<string, unknown>>
  deviceAvailable: boolean
  /** 会话当前的日志策略（plan §8.4）。 */
  logPolicy: LogPolicy
  /** 抽样/不记录策略下累计省略的解析帧数（用于工具栏提示）。 */
  omittedFrames: number
}

/** 会话 store 的响应式状态。 */
export interface SerialSessionsState {
  views: SessionView[]
  /** 两个 Pane 各自绑定的 sessionId。 */
  panes: [string | null, string | null]
  focusedPane: 0 | 1
}

const manager = getLinkManager()
const subscriptions = new Map<string, Array<() => void>>()

/**
 * 手动发送的草稿，按 sessionId 保存在模块级 Map 中（不持久化）。
 *
 * 组件在工具页内被 KeepAlive 保留、返回首页再回来时也仍然存在；即使组件被重建，
 * 草稿也不会丢失（e2e 用例 12）。
 */
const drafts = new Map<string, string>()

/** 读取一个会话的手动发送草稿。 */
export function getSessionDraft(sessionId: string | null | undefined): string {
  if (!sessionId) return ''
  return drafts.get(sessionId) ?? ''
}

/** 保存一个会话的手动发送草稿。 */
export function setSessionDraft(sessionId: string | null | undefined, value: string): void {
  if (!sessionId) return
  if (value.length === 0) drafts.delete(sessionId)
  else drafts.set(sessionId, value)
}

/** 清空已释放会话的草稿。 */
function purgeDrafts(presentIds: ReadonlySet<string>): void {
  for (const sessionId of [...drafts.keys()]) {
    if (!presentIds.has(sessionId)) drafts.delete(sessionId)
  }
}

/** 界面状态；组件只读，修改请使用本模块导出的动作函数。 */
export const serialSessions = reactive<SerialSessionsState>({
  views: [],
  panes: [null, null],
  focusedPane: 0,
})

function createSessionView(session: LinkSession): SessionView {
  return {
    id: session.id,
    name: session.name,
    state: session.state,
    lastError: session.lastError,
    stats: session.stats,
    protocol: session.protocol,
    signals: session.signals,
    tasks: session.tasks,
    unread: 0,
    logVersion: 0,
    providerKind: session.providerKind,
    settings: session.settings,
    deviceAvailable: session.deviceAvailable,
    logPolicy: session.logPolicy,
    omittedFrames: session.logOmittedFrames,
  }
}

function findView(sessionId: string): SessionView | undefined {
  return serialSessions.views.find((view) => view.id === sessionId)
}

/** 供组件查询当前可见的会话快照。 */
export function getSessionView(sessionId: string | null | undefined): SessionView | undefined {
  if (!sessionId) return undefined
  return findView(sessionId)
}

/** 供组件访问底层 `LinkSession`（发送、连接、控制线、日志缓冲等）。 */
export function getSessionInstance(sessionId: string | null | undefined): LinkSession | undefined {
  if (!sessionId) return undefined
  return manager.get(sessionId)
}

/** 最后获得焦点的 Pane 显示的会话。 */
export function focusedSessionView(): SessionView | undefined {
  const paneIndex = serialSessions.focusedPane
  return findView(serialSessions.panes[paneIndex] ?? '')
}

/** 已注册的传输提供者（按 `order` 排序，由 link 领域保证）。 */
export function listTransportProviders(): TransportProvider[] {
  return manager.listProviders()
}

/** 按 kind 查找传输提供者。 */
export function findTransportProvider(kind: string): TransportProvider | undefined {
  return manager.listProviders().find((provider) => provider.kind === kind)
}

/** 已授权的端口列表，`sessionId` 非空表示该端口已打开。 */
export function listAuthorizedTransports(): Promise<LinkManagerAuthorizedEntry[]> {
  return manager.listAuthorized()
}

function isDisplayedAnywhere(sessionId: string): boolean {
  return serialSessions.panes[0] === sessionId || serialSessions.panes[1] === sessionId
}

function clearUnread(sessionId: string): void {
  const view = findView(sessionId)
  if (view) view.unread = 0
}

function refreshScalarFields(view: SessionView, session: LinkSession): void {
  view.name = session.name
  view.state = session.state
  view.lastError = session.lastError
  view.stats = session.stats
  view.protocol = session.protocol
  view.signals = session.signals
  view.tasks = session.tasks
  view.providerKind = session.providerKind
  view.settings = session.settings
  view.deviceAvailable = session.deviceAvailable
  view.logPolicy = session.logPolicy
  view.omittedFrames = session.logOmittedFrames
}

function subscribeSession(session: LinkSession): void {
  const sessionId = session.id
  const unsubscribers: Array<() => void> = []

  unsubscribers.push(
    session.on('state', (state) => {
      const view = findView(sessionId)
      if (!view) return
      view.state = state
      view.lastError = session.lastError
      view.deviceAvailable = session.deviceAvailable
      if (state === 'open') saveDeviceCompose(session.transport.deviceKey, session.compose)
    }),
  )

  unsubscribers.push(
    session.on('entries', (payload) => {
      const view = findView(sessionId)
      if (!view) return
      view.logVersion += 1
      const rxCount = payload.added.reduce(
        (count, entry) => count + (entry.dir === 'rx' ? 1 : 0),
        0,
      )
      if (rxCount === 0) return
      if (isDisplayedAnywhere(sessionId)) view.unread = 0
      else view.unread += rxCount
    }),
  )

  unsubscribers.push(
    session.on('stats', (stats) => {
      const view = findView(sessionId)
      if (view) {
        view.stats = stats
        view.omittedFrames = session.logOmittedFrames
      }
    }),
  )

  unsubscribers.push(
    session.on('protocol', (protocol) => {
      const view = findView(sessionId)
      if (view) view.protocol = protocol
    }),
  )

  unsubscribers.push(
    session.on('tasks', (tasks) => {
      const view = findView(sessionId)
      if (view) view.tasks = tasks
    }),
  )

  unsubscribers.push(
    session.on('signals', (signals) => {
      const view = findView(sessionId)
      if (view) view.signals = signals
    }),
  )

  unsubscribers.push(
    session.on('logPolicy', (policy) => {
      const view = findView(sessionId)
      if (view) {
        view.logPolicy = policy
        view.omittedFrames = 0
      }
    }),
  )

  unsubscribers.push(
    session.on('settings', (settings) => {
      const view = findView(sessionId)
      if (view) view.settings = settings
      // 组包选项随会话变化时记入设备记忆（工具层补充）。
      saveDeviceCompose(session.transport.deviceKey, session.compose)
    }),
  )

  subscriptions.set(sessionId, unsubscribers)
}

/** 清空已释放会话的订阅与 Pane 绑定。 */
function purgeMissingSessions(presentIds: ReadonlySet<string>): void {
  for (const [sessionId, unsubscribers] of [...subscriptions]) {
    if (presentIds.has(sessionId)) continue
    for (const unsubscribe of unsubscribers) unsubscribe()
    subscriptions.delete(sessionId)
  }
  for (const index of [0, 1] as const) {
    const bound = serialSessions.panes[index]
    if (bound !== null && !presentIds.has(bound)) serialSessions.panes[index] = null
  }
  purgeDrafts(presentIds)
}

/** 会话列表变化时同步视图，并尽量让 Pane 保持有会话。 */
function syncSessions(sessions: LinkSession[]): void {
  const presentIds = new Set(sessions.map((session) => session.id))
  purgeMissingSessions(presentIds)

  const nextViews: SessionView[] = []
  for (const session of sessions) {
    const existing = findView(session.id)
    const view = existing ?? createSessionView(session)
    refreshScalarFields(view, session)
    if (!subscriptions.has(session.id)) subscribeSession(session)
    nextViews.push(view)
  }
  serialSessions.views = nextViews
  ensurePaneBinding()
}

/** 为空的 Pane 绑定一个尚未显示的会话。 */
function ensurePaneBinding(): void {
  const views = serialSessions.views
  if (views.length === 0) {
    if (serialSessions.panes[0] !== null) serialSessions.panes[0] = null
    if (serialSessions.panes[1] !== null) serialSessions.panes[1] = null
    return
  }

  const focused = serialSessions.focusedPane
  const other: 0 | 1 = focused === 0 ? 1 : 0
  const unbound = views.filter((view) => !isDisplayedAnywhere(view.id))

  if (serialSessions.panes[focused] === null) {
    const candidate = unbound[0]
    if (candidate) {
      serialSessions.panes[focused] = candidate.id
      clearUnread(candidate.id)
      return
    }
  }

  // 单 Pane 模式下，如果正在使用的 Pane 为空而另一个 Pane 绑定了会话，把它移过来，
  // 避免关闭标签后主区域空白。
  if (
    serialLayout.split === 'off' &&
    serialSessions.panes[0] === null &&
    serialSessions.panes[1] !== null
  ) {
    serialSessions.panes[0] = serialSessions.panes[1]
    serialSessions.panes[1] = null
    return
  }

  if (serialSessions.panes[focused] === null && serialSessions.panes[other] === null) {
    const first = views[0]
    if (first) {
      serialSessions.panes[focused] = first.id
      clearUnread(first.id)
    }
  }
}

/** 把工具设置里的日志上限套用到会话的日志缓冲。 */
function applyLogLimits(session: LinkSession): void {
  const limits = logLimitsFromSettings()
  session.log.maxEntries = limits.maxEntries
  session.log.maxBytes = limits.maxBytes
}

/** 开启分屏后重新为空的 Pane 分配会话（供 SessionTabs 调用）。 */
export function ensurePanesHaveSessions(): void {
  ensurePaneBinding()
}

/** 把工具层记录的组包选项套用到新会话（领域设备记忆不含 compose）。 */
function applyDeviceCompose(session: LinkSession): void {
  const stored = getDeviceCompose(session.transport.deviceKey)
  if (stored !== undefined) session.compose = stored
}

/** 把新会话绑定到焦点 Pane。 */
function bindNewSession(session: LinkSession): void {
  applyLogLimits(session)
  applyDeviceCompose(session)
  applyDefaultLogPolicy(session)
  serialSessions.panes[serialSessions.focusedPane] = session.id
  clearUnread(session.id)
  noteTerminalSessionShown(serialSessions.focusedPane, session.id)
}

/** 通过提供者请求一个新通道（串口会弹出浏览器选择框，演示端口直接创建）。 */
export async function requestProvider(kind: string): Promise<void> {
  try {
    const session = await manager.request(kind)
    if (session === null) return
    bindNewSession(session)
  } catch (error) {
    toast.show({ type: 'error', message: `打开通道失败：${errorMessage(error)}` })
  }
}

/** 打开一个已授权的端口；已有会话时聚焦它。 */
export async function openAuthorizedEntry(entry: LinkManagerAuthorizedEntry): Promise<void> {
  if (entry.sessionId !== null) {
    selectSession(serialSessions.focusedPane, entry.sessionId)
    return
  }
  try {
    const session = manager.createFrom(entry.transport, { providerKind: entry.provider.kind })
    bindNewSession(session)
  } catch (error) {
    toast.show({ type: 'error', message: `打开端口失败：${errorMessage(error)}` })
  }
}

/** 把一个已存在的会话显示到指定 Pane，并把它设为焦点 Pane。 */
export function selectSession(paneIndex: number, sessionId: string | null): void {
  const index: 0 | 1 = paneIndex === 1 ? 1 : 0
  const view = getSessionView(sessionId)
  if (sessionId !== null && !view) return
  serialSessions.panes[index] = sessionId
  serialSessions.focusedPane = index
  if (sessionId !== null) {
    clearUnread(sessionId)
    if (serialLayout.panes[index]?.view !== 'dashboard') noteTerminalSessionShown(index, sessionId)
  }
}

/** 切换焦点 Pane。 */
export function setFocusedPane(paneIndex: number): void {
  serialSessions.focusedPane = paneIndex === 1 ? 1 : 0
}

/**
 * 记录会话的显示模式（plan §8.4 / §6.6）。
 *
 * Pane 的显示模式同时写入 layout（界面状态）与会话（设备记忆/预设依赖）；
 * 调用方负责写入 layout。
 */
export function setSessionDisplayMode(
  sessionId: string | null | undefined,
  mode: DisplayMode,
): void {
  const session = getSessionInstance(sessionId)
  if (!session) return
  if (session.displayMode !== mode) session.displayMode = mode
}

/** 关闭通道：日志非空时先确认，然后释放会话。 */
export async function closeSession(sessionId: string): Promise<void> {
  const session = manager.get(sessionId)
  if (!session) {
    if (serialSessions.panes[0] === sessionId) serialSessions.panes[0] = null
    if (serialSessions.panes[1] === sessionId) serialSessions.panes[1] = null
    ensurePaneBinding()
    return
  }
  if (session.log.size > 0) {
    const confirmed = await confirm({
      title: '关闭通道',
      message: '关闭后该通道的日志将丢失，是否继续？',
      confirmText: '关闭',
      danger: true,
    })
    if (!confirmed) return
  }
  await session.dispose()
  if (serialSessions.panes[0] === sessionId) serialSessions.panes[0] = null
  if (serialSessions.panes[1] === sessionId) serialSessions.panes[1] = null
  ensurePaneBinding()
}

/** 重命名会话（标签页与侧栏共用）。 */
export function renameSession(sessionId: string, name: string): void {
  const trimmed = name.trim()
  if (trimmed.length === 0) return
  const session = manager.get(sessionId)
  const view = findView(sessionId)
  if (!session) return
  session.name = trimmed
  if (view) view.name = trimmed
}

/** 清空会话日志，并让当前会话套用最新的日志上限（plan §8.8）。 */
export function clearSessionLog(sessionId: string): void {
  const session = manager.get(sessionId)
  if (!session) return
  session.clearLog()
  applyLogLimits(session)
}

/** 新会话使用的日志上限；导出给测试与后续阶段复用。 */
export function applySettingsLogLimits(sessionId: string): void {
  const session = manager.get(sessionId)
  if (session) applyLogLimits(session)
}

/** 断开当前会话（标签页菜单使用）。 */
export async function disconnectSession(sessionId: string): Promise<void> {
  const session = manager.get(sessionId)
  if (!session) return
  try {
    await session.close()
  } catch (error) {
    toast.show({ type: 'error', message: `断开失败：${errorMessage(error)}` })
  }
}

function errorMessage(error: unknown): string {
  if (error instanceof Error && error.message.length > 0) return error.message
  if (typeof error === 'string') return error
  return String(error)
}

// 首次加载时同步已经存在的会话（应用内单例 manager），随后跟随会话列表事件。
syncSessions(manager.sessions())
manager.on('sessions', syncSessions)

/** 供后续阶段（预设 / 设备记忆）复用的会话数量快照。 */
export function sessionCount(): number {
  return serialSessions.views.length
}

/* ------------------------------------------------------------------------- */
/* 日志策略（plan §8.4 / §8.8）                                                */
/* ------------------------------------------------------------------------- */

/**
 * 把工具设置里的「日志自动抽样」写入会话的默认 `LogPolicy.auto`。
 *
 * 只调整 `auto`，保留会话已有的模式；手动切换模式时 link 领域会把 `auto` 置为 false
 * （见 `LinkSession.logPolicy` setter），这里只在新建会话时套用默认值。
 */
function applyDefaultLogPolicy(session: LinkSession): void {
  const auto = serialSettings.logAutoSample
  if (session.logPolicy.auto === auto) return
  session.applyLogPolicy({ ...session.logPolicy, auto })
}

/** 手动修改日志策略；模式变化时 `auto` 自动关闭（由 link 领域保证）。 */
export function setSessionLogPolicy(
  sessionId: string | null | undefined,
  patch: Partial<LogPolicy>,
): void {
  const session = getSessionInstance(sessionId)
  if (!session) return
  session.logPolicy = { ...session.logPolicy, ...patch }
}

/** 当前会话的日志策略快照（找不到时返回 `null`）。 */
export function getSessionLogPolicy(sessionId: string | null | undefined): LogPolicy | null {
  return getSessionView(sessionId)?.logPolicy ?? null
}

/* ------------------------------------------------------------------------- */
/* 仪表盘辅助：会话绑定、预设 extras（plan §8.10 / §8.13）                      */
/* ------------------------------------------------------------------------- */

/** 可绑定到仪表盘数据源的会话摘要。 */
export interface BindableSession {
  id: string
  name: string
  state: SessionState
  deviceKey: string
  providerKind: string
}

/** 列出可绑定到仪表盘数据源的会话（含 deviceKey，用于 match 自动绑定）。 */
export function listBindableSessions(): BindableSession[] {
  const result: BindableSession[] = []
  for (const view of serialSessions.views) {
    const session = manager.get(view.id)
    if (!session) continue
    result.push({
      id: view.id,
      name: view.name,
      state: view.state,
      deviceKey: session.transport.deviceKey,
      providerKind: view.providerKind,
    })
  }
  return result
}

/** 读取一个会话的 deviceKey（找不到时返回 `undefined`）。 */
export function sessionDeviceKey(sessionId: string | null | undefined): string | undefined {
  if (!sessionId) return undefined
  return manager.get(sessionId)?.transport.deviceKey
}

/**
 * 按 `DashboardSource.match` 找到第一个匹配的会话（plan §8.10）。
 *
 * `match` 为空或没有匹配时返回 `undefined`；`virtual` 也按 deviceKey 匹配。
 */
export function findSessionByMatch(
  match: { deviceKey?: string; providerKind?: string } | undefined,
): BindableSession | undefined {
  if (!match || (match.deviceKey === undefined && match.providerKind === undefined)) {
    return undefined
  }
  const sessions = listBindableSessions()
  return sessions.find((session) => {
    if (match.deviceKey !== undefined && session.deviceKey !== match.deviceKey) return false
    if (match.providerKind !== undefined && session.providerKind !== match.providerKind)
      return false
    return true
  })
}

/**
 * 记录「某个 Pane 最近显示过的终端会话」。
 *
 * 仪表盘第一个数据源的自动绑定会优先使用它（plan §8.10）。Pane 切换到仪表盘视图时
 * 仍然保留这份记录。
 */
const recentTerminalSessions: [string | null, string | null] = [null, null]

/** 由终端视图的 Pane 在显示会话时调用，用于仪表盘的自动绑定回退。 */
export function noteTerminalSessionShown(
  paneIndex: number,
  sessionId: string | null | undefined,
): void {
  const index: 0 | 1 = paneIndex === 1 ? 1 : 0
  if (!sessionId) return
  if (!getSessionView(sessionId)) return
  recentTerminalSessions[index] = sessionId
}

/** 指定 Pane 最近显示过的终端会话 id。 */
export function recentTerminalSessionId(paneIndex: number): string | null {
  return recentTerminalSessions[paneIndex === 1 ? 1 : 0]
}

/**
 * 构造预设套用目标（plan §6.6 / §8.13）。
 *
 * `LinkSession` 本身满足大部分字段，但它没有工具层的 `extras`；这里用访问器包装，
 * 让 `PresetStore.apply` 能写入 `extras`（如 `dashboardId`），同时保留
 * `applyLogPolicy` 的「不关闭 auto」语义。
 */
export function createPresetApplyTarget(session: LinkSession): PresetApplyTarget {
  const target: PresetApplyTarget = {
    get providerKind() {
      return session.providerKind
    },
    get state() {
      return session.state
    },
    get rxOptions() {
      return session.rxOptions
    },
    set rxOptions(value) {
      session.rxOptions = value
    },
    get displayMode() {
      return session.displayMode
    },
    set displayMode(value) {
      session.displayMode = value
    },
    get compose() {
      return session.compose
    },
    set compose(value) {
      session.compose = { ...value }
    },
    get logPolicy() {
      return session.logPolicy
    },
    set logPolicy(value) {
      session.logPolicy = value
    },
    extras: {},
    updateSettings: (patch) => {
      session.updateSettings(patch)
    },
    stageSettings: (patch) => {
      session.stageSettings(patch)
    },
    setProtocol: (id) => session.setProtocol(id),
    applyLogPolicy: (policy) => {
      session.applyLogPolicy(policy)
    },
  }
  return target
}

/* ------------------------------------------------------------------------- */
/* 演示端口 format ↔ interval 联动（工具层 UI 规则，plan §6.6）                 */
/* ------------------------------------------------------------------------- */

/** 传感器帧格式的默认上报间隔（与 provider 的 schema 默认值一致）。 */
export const DEMO_SENSOR_FORMAT = 'sensor-a5'
export const DEMO_SENSOR_INTERVAL_DEFAULT = 1000
export const DEMO_SENSOR_INTERVAL_MIN = 100
export const DEMO_OTHER_INTERVAL_DEFAULT = 10
export const DEMO_INTERVAL_MIN = 1
export const DEMO_INTERVAL_MAX = 10000

/**
 * 切换演示端口的数据格式时给出建议的上报间隔（plan §6.6）。
 *
 * 切到 `sensor-a5` 时使用其默认值 1000ms（最小 100ms）；切到其他格式时使用 10ms。
 * 这里只是工具层 UI 联动，不修改 provider 代码。
 */
export function demoIntervalForFormat(format: unknown): number {
  if (format === DEMO_SENSOR_FORMAT) return DEMO_SENSOR_INTERVAL_DEFAULT
  return DEMO_OTHER_INTERVAL_DEFAULT
}

/** 按格式夹取间隔值（`sensor-a5` 最小 100ms，其他格式最小 1ms）。 */
export function clampDemoInterval(format: unknown, interval: number): number {
  const min = format === DEMO_SENSOR_FORMAT ? DEMO_SENSOR_INTERVAL_MIN : DEMO_INTERVAL_MIN
  const value = Number.isFinite(interval) ? Math.round(interval) : min
  return Math.min(DEMO_INTERVAL_MAX, Math.max(min, value))
}
