/**
 * 宏（plan §8.5）：名称、循环开关与步骤列表，持久化到
 * `toolset/tool/serial/macros.v1`。
 *
 * 运行交给 `LinkSession.startMacro()`；本模块只保存定义并提供编辑动作。
 */

import { reactive, readonly } from 'vue'

import { type ComposeOptions, type Macro, type MacroStep } from '@/domains/link/public'
import { uuid } from '@/shared/lib/id'
import { createToolStorage } from '@/shared/lib/storage/namespace'

import { createDefaultComposeOptions, normalizeComposeOptions } from '../composables/composeOptions'

/** 持久化结构（存储版本 1）。 */
export interface MacroState {
  macros: Macro[]
}

/** 宏步骤上限（plan §6.6）。 */
export const MAX_MACRO_STEPS = 100
/** 延时步骤的取值范围（plan §6.6）。 */
export const MACRO_DELAY_MIN = 10
export const MACRO_DELAY_MAX = 600_000

/** 新建宏/步骤时使用的默认值。 */
export function createDefaultMacroStep(type: MacroStep['type']): MacroStep {
  if (type === 'delay') return { type: 'delay', ms: 500 }
  if (type === 'signal') return { type: 'signal', dtr: true, rts: false }
  return {
    type: 'send',
    input: 'AT',
    options: { ...createDefaultComposeOptions(), eol: 'crlf' },
  }
}

/** 默认提供一个示例宏，方便直接体验运行与停止。 */
export function createDefaultMacroState(): MacroState {
  return {
    macros: [
      {
        id: 'sample-macro',
        name: '示例宏',
        loop: true,
        steps: [
          {
            type: 'send',
            input: 'AT',
            options: { ...createDefaultComposeOptions(), eol: 'crlf' },
          },
          { type: 'delay', ms: 1000 },
        ],
      },
    ],
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function clampDelay(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return 500
  return Math.min(MACRO_DELAY_MAX, Math.max(MACRO_DELAY_MIN, Math.round(value)))
}

function normalizeStep(value: unknown): MacroStep | null {
  if (!isRecord(value)) return null
  if (value.type === 'delay') return { type: 'delay', ms: clampDelay(value.ms) }
  if (value.type === 'signal') {
    const step: MacroStep = { type: 'signal' }
    if (typeof value.dtr === 'boolean') step.dtr = value.dtr
    if (typeof value.rts === 'boolean') step.rts = value.rts
    if (typeof value.brk === 'boolean') step.brk = value.brk
    if (step.dtr === undefined && step.rts === undefined && step.brk === undefined) {
      step.dtr = true
    }
    return step
  }
  if (value.type === 'send') {
    return {
      type: 'send',
      input: typeof value.input === 'string' ? value.input : '',
      options: normalizeComposeOptions(
        isRecord(value.options) ? (value.options as Partial<ComposeOptions>) : {},
      ),
    }
  }
  return null
}

function normalizeMacro(value: unknown): Macro | null {
  if (!isRecord(value)) return null
  const id = typeof value.id === 'string' && value.id.length > 0 ? value.id : uuid()
  const name =
    typeof value.name === 'string' && value.name.trim().length > 0 ? value.name : '未命名宏'
  const rawSteps = Array.isArray(value.steps) ? value.steps : []
  const steps: MacroStep[] = []
  for (const rawStep of rawSteps) {
    if (steps.length >= MAX_MACRO_STEPS) break
    const step = normalizeStep(rawStep)
    if (step !== null) steps.push(step)
  }
  return { id, name, loop: value.loop === true, steps }
}

/** 把任意来源的数据收敛为合法的宏状态。 */
export function normalizeMacroState(raw: unknown): MacroState {
  const defaults = createDefaultMacroState()
  const source = isRecord(raw) ? raw : {}
  const rawMacros = Array.isArray(source.macros) ? source.macros : []
  const macros: Macro[] = []
  for (const rawMacro of rawMacros) {
    const macro = normalizeMacro(rawMacro)
    if (macro !== null) macros.push(macro)
  }
  return { macros: macros.length > 0 ? macros : defaults.macros }
}

const store = createToolStorage('serial').local<MacroState>('macros', {
  version: 1,
  defaults: createDefaultMacroState,
  migrate: (raw) => normalizeMacroState(raw),
})

const state = reactive<MacroState>(normalizeMacroState(store.get()))

store.subscribe((value) => {
  Object.assign(state, normalizeMacroState(value))
})

/** 当前宏列表（只读快照）。 */
export const serialMacros = readonly(state)

function commit(next: MacroState): void {
  const normalized = normalizeMacroState(next)
  Object.assign(state, normalized)
  store.set(normalized)
}

/** 宏的只读视图（组件读取 store 中的 DeepReadonly 数据时使用）。 */
export interface MacroLike {
  readonly id: string
  readonly name: string
  readonly loop: boolean
  readonly steps: readonly MacroStep[]
}

/** 生成一份可用于编辑的宏副本。 */
export function cloneMacro(macro: MacroLike): Macro {
  const steps: MacroStep[] = macro.steps.map((step) =>
    step.type === 'send' ? { ...step, options: { ...step.options } } : { ...step },
  )
  return { id: macro.id, name: macro.name, loop: macro.loop, steps }
}

/** 新增宏。 */
export function addMacro(macro: Omit<Macro, 'id'>): Macro {
  const record: Macro = { ...cloneMacro({ ...macro, id: uuid() }) }
  commit({ macros: [...state.macros, record] })
  return record
}

/** 更新宏。 */
export function updateMacro(macro: Macro): void {
  const normalized = normalizeMacro(macro)
  if (normalized === null) return
  commit({
    macros: state.macros.map((existing) => (existing.id === macro.id ? normalized : existing)),
  })
}

/** 删除宏。 */
export function removeMacro(macroId: string): void {
  const macros = state.macros.filter((macro) => macro.id !== macroId)
  if (macros.length === 0) {
    commit(createDefaultMacroState())
    return
  }
  commit({ macros })
}

/** 复制宏。 */
export function duplicateMacro(macroId: string): Macro | null {
  const macro = state.macros.find((candidate) => candidate.id === macroId)
  if (!macro) return null
  const copy = cloneMacro({ ...macro, id: uuid(), name: `${macro.name} 副本` })
  commit({ macros: [...state.macros, copy] })
  return copy
}
