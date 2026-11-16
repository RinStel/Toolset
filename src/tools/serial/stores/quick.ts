/**
 * 快捷发送（plan §8.5）：分组与按钮，持久化到 `toolset/tool/serial/quick.v1`。
 *
 * 数据结构与链路领域保持一致：数据项保存原文与 `ComposeOptions`，控制线项保存
 * 一串 `{ dtr?, rts?, brk?, delayMs? }` 步骤。执行逻辑放在 `QuickSend.vue`，
 * 本模块只负责编辑与持久化。
 */

import { reactive, readonly } from 'vue'

import { type ComposeOptions } from '@/domains/link/public'
import { uuid } from '@/shared/lib/id'
import { createToolStorage } from '@/shared/lib/storage/namespace'

import { createDefaultComposeOptions, normalizeComposeOptions } from '../composables/composeOptions'

/** 控制线序列中的一步：先应用控制线，再等待 `delayMs`。 */
export interface QuickSignalStep {
  dtr?: boolean
  rts?: boolean
  brk?: boolean
  delayMs?: number
}

/** 发送数据字节的快捷项。 */
export interface QuickDataItem {
  id: string
  name: string
  kind: 'data'
  input: string
  options: ComposeOptions
}

/** 发送控制线序列的快捷项。 */
export interface QuickSignalItem {
  id: string
  name: string
  kind: 'signal'
  steps: QuickSignalStep[]
}

export type QuickItem = QuickDataItem | QuickSignalItem

/** 一个分组。 */
export interface QuickGroup {
  id: string
  name: string
  items: QuickItem[]
}

/** 持久化结构（存储版本 1）。 */
export interface QuickState {
  groups: QuickGroup[]
  activeGroupId: string
}

/** 新建快捷项时使用的草稿（id 为空表示尚未保存）。 */
export type QuickItemDraft = Omit<QuickDataItem, 'id'> | Omit<QuickSignalItem, 'id'>

const DEFAULT_GROUP_ID = 'group-example'

function dataItem(
  id: string,
  name: string,
  input: string,
  options: Partial<ComposeOptions>,
): QuickDataItem {
  return {
    id,
    name,
    kind: 'data',
    input,
    options: normalizeComposeOptions({ ...createDefaultComposeOptions(), ...options }),
  }
}

/** 默认「示例」分组（plan §8.5）。 */
export function createDefaultQuickState(): QuickState {
  return {
    activeGroupId: DEFAULT_GROUP_ID,
    groups: [
      {
        id: DEFAULT_GROUP_ID,
        name: '示例',
        items: [
          dataItem('sample-at', 'AT', 'AT', { mode: 'text', eol: 'crlf' }),
          dataItem('sample-hex', 'HEX 读取', '01 03 00 00 00 01', {
            mode: 'hex',
            checksum: 'crc16-modbus',
            checksumEndian: 'le',
          }),
          {
            id: 'sample-esp32',
            name: 'ESP32 下载模式',
            kind: 'signal',
            steps: [
              { dtr: false, rts: true, delayMs: 100 },
              { dtr: true, rts: false, delayMs: 50 },
              { dtr: false },
            ],
          },
        ],
      },
    ],
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function clampDelay(value: unknown): number | undefined {
  if (typeof value !== 'number' || !Number.isFinite(value)) return undefined
  return Math.min(600_000, Math.max(0, Math.round(value)))
}

function normalizeStep(value: unknown): QuickSignalStep | null {
  if (!isRecord(value)) return null
  const step: QuickSignalStep = {}
  if (typeof value.dtr === 'boolean') step.dtr = value.dtr
  if (typeof value.rts === 'boolean') step.rts = value.rts
  if (typeof value.brk === 'boolean') step.brk = value.brk
  const delay = clampDelay(value.delayMs)
  if (delay !== undefined) step.delayMs = delay
  if (step.dtr === undefined && step.rts === undefined && step.brk === undefined) {
    if (delay === undefined) return null
  }
  return step
}

function normalizeItem(value: unknown): QuickItem | null {
  if (!isRecord(value)) return null
  const id = typeof value.id === 'string' && value.id.length > 0 ? value.id : uuid()
  const name =
    typeof value.name === 'string' && value.name.trim().length > 0 ? value.name : '未命名'
  if (value.kind === 'signal') {
    const rawSteps = Array.isArray(value.steps) ? value.steps : []
    const steps: QuickSignalStep[] = []
    for (const rawStep of rawSteps) {
      const step = normalizeStep(rawStep)
      if (step !== null) steps.push(step)
    }
    return { id, name, kind: 'signal', steps }
  }
  return {
    id,
    name,
    kind: 'data',
    input: typeof value.input === 'string' ? value.input : '',
    options: normalizeComposeOptions(
      isRecord(value.options) ? (value.options as Partial<ComposeOptions>) : {},
    ),
  }
}

function normalizeGroup(value: unknown, index: number): QuickGroup | null {
  if (!isRecord(value)) return null
  const id = typeof value.id === 'string' && value.id.length > 0 ? value.id : `group-${index + 1}`
  const name =
    typeof value.name === 'string' && value.name.trim().length > 0
      ? value.name
      : `分组 ${index + 1}`
  const rawItems = Array.isArray(value.items) ? value.items : []
  const items: QuickItem[] = []
  for (const rawItem of rawItems) {
    const item = normalizeItem(rawItem)
    if (item !== null) items.push(item)
  }
  return { id, name, items }
}

/** 把任意来源的数据收敛为合法的快捷发送状态。 */
export function normalizeQuickState(raw: unknown): QuickState {
  const defaults = createDefaultQuickState()
  const source = isRecord(raw) ? raw : {}
  const rawGroups = Array.isArray(source.groups) ? source.groups : []
  const groups: QuickGroup[] = []
  for (let index = 0; index < rawGroups.length; index += 1) {
    const group = normalizeGroup(rawGroups[index], index)
    if (group !== null) groups.push(group)
  }
  if (groups.length === 0) return defaults
  const active =
    typeof source.activeGroupId === 'string' &&
    groups.some((group) => group.id === source.activeGroupId)
      ? source.activeGroupId
      : (groups[0]?.id ?? defaults.activeGroupId)
  return { groups, activeGroupId: active }
}

const store = createToolStorage('serial').local<QuickState>('quick', {
  version: 1,
  defaults: createDefaultQuickState,
  migrate: (raw) => normalizeQuickState(raw),
})

const state = reactive<QuickState>(normalizeQuickState(store.get()))

store.subscribe((value) => {
  Object.assign(state, normalizeQuickState(value))
})

/** 当前快捷发送状态（只读快照）。 */
export const serialQuick = readonly(state)

function commit(next: QuickState): void {
  const normalized = normalizeQuickState(next)
  Object.assign(state, normalized)
  store.set(normalized)
}

function findGroup(groupId: string): QuickGroup | undefined {
  return state.groups.find((group) => group.id === groupId)
}

/** 切换当前分组。 */
export function setQuickActiveGroup(groupId: string): void {
  if (!state.groups.some((group) => group.id === groupId)) return
  commit({ groups: state.groups, activeGroupId: groupId })
}

/** 新增分组并切换过去。 */
export function addQuickGroup(name: string): QuickGroup {
  const group: QuickGroup = { id: uuid(), name: name.trim() || '新分组', items: [] }
  commit({ groups: [...state.groups, group], activeGroupId: group.id })
  return group
}

/** 重命名分组。 */
export function renameQuickGroup(groupId: string, name: string): void {
  const trimmed = name.trim()
  if (trimmed.length === 0) return
  const groups = state.groups.map((group) =>
    group.id === groupId ? { ...group, name: trimmed } : group,
  )
  commit({ groups, activeGroupId: state.activeGroupId })
}

/** 删除分组（至少保留一个）。 */
export function removeQuickGroup(groupId: string): void {
  if (state.groups.length <= 1) return
  const groups = state.groups.filter((group) => group.id !== groupId)
  const activeGroupId =
    state.activeGroupId === groupId ? (groups[0]?.id ?? '') : state.activeGroupId
  commit({ groups, activeGroupId })
}

function withGroupItems(groupId: string, items: QuickItem[]): QuickGroup[] {
  return state.groups.map((group) => (group.id === groupId ? { ...group, items } : group))
}

/** 新增快捷项。 */
export function addQuickItem(groupId: string, draft: QuickItemDraft): QuickItem | null {
  const group = findGroup(groupId)
  if (!group) return null
  const item: QuickItem =
    draft.kind === 'data'
      ? { ...draft, id: uuid(), options: normalizeComposeOptions(draft.options) }
      : { ...draft, id: uuid(), steps: draft.steps.map((step) => ({ ...step })) }
  commit({ groups: withGroupItems(groupId, [...group.items, item]), activeGroupId: groupId })
  return item
}

/** 更新快捷项。 */
export function updateQuickItem(groupId: string, item: QuickItem): void {
  const group = findGroup(groupId)
  if (!group) return
  const normalized = normalizeItem(item)
  if (normalized === null) return
  commit({
    groups: withGroupItems(
      groupId,
      group.items.map((existing) => (existing.id === item.id ? normalized : existing)),
    ),
    activeGroupId: state.activeGroupId,
  })
}

/** 删除快捷项。 */
export function removeQuickItem(groupId: string, itemId: string): void {
  const group = findGroup(groupId)
  if (!group) return
  commit({
    groups: withGroupItems(
      groupId,
      group.items.filter((item) => item.id !== itemId),
    ),
    activeGroupId: state.activeGroupId,
  })
}

/** 上移 / 下移快捷项（`delta` 为 -1 或 1）。 */
export function moveQuickItem(groupId: string, itemId: string, delta: number): void {
  const group = findGroup(groupId)
  if (!group) return
  const index = group.items.findIndex((item) => item.id === itemId)
  const target = index + delta
  if (index < 0 || target < 0 || target >= group.items.length) return
  const items = [...group.items]
  const [moved] = items.splice(index, 1)
  if (!moved) return
  items.splice(target, 0, moved)
  commit({ groups: withGroupItems(groupId, items), activeGroupId: state.activeGroupId })
}

/** 复制快捷项。 */
export function duplicateQuickItem(groupId: string, itemId: string): void {
  const group = findGroup(groupId)
  if (!group) return
  const item = group.items.find((candidate) => candidate.id === itemId)
  if (!item) return
  const copy: QuickItem =
    item.kind === 'data'
      ? { ...item, id: uuid(), name: `${item.name} 副本`, options: { ...item.options } }
      : { ...item, id: uuid(), name: `${item.name} 副本`, steps: item.steps.map((s) => ({ ...s })) }
  commit({
    groups: withGroupItems(groupId, [...group.items, copy]),
    activeGroupId: state.activeGroupId,
  })
}
