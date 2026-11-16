/**
 * 从 `DecodeResult` 提取变量样本（plan §6.5 变量提取规则）。
 *
 * 规则：
 * 1. 有 `variables` 时只使用 `variables`；值必须是有限数，NaN/Infinity 丢弃并计入
 *    `invalidSamples`。
 * 2. 没有 `variables` 且 `noVariables !== true` 时，从 `fields` 自动提取：number 字段
 *    以 `key ?? label` 为变量名，boolean 字段记为 0/1；名称不符合变量名规则时把非法
 *    字符替换为 `_`，开头不是字母或下划线时加前缀 `v_`。
 * 3. `level === 'error'` 的结果不提取变量。
 */

import { isValidVariableKey } from '../protocol/public'
import type { DecodeField, DecodeResult } from '../protocol/public'

/** 从一帧（可能含多个解码结果）提取出的单个变量样本。 */
export interface ExtractedVariable {
  key: string
  value: number
  label?: string
  unit?: string
}

/** 一帧的提取结果。 */
export interface ExtractOutcome {
  /** 有限数值的样本，按变量首次出现顺序；同一帧内重复的变量以后到的值为准。 */
  variables: ExtractedVariable[]
  /** 非有限数值（NaN/Infinity）等无效样本的数量。 */
  invalid: number
  /** 本帧涉及的变量名数量（包含值无效的变量）；大于 0 表示该帧“含有变量”。 */
  candidates: number
}

const ILLEGAL_KEY_CHARS = /[^A-Za-z0-9_.]/g

/**
 * 把任意文本改写为合法的变量名（plan §6.5 变量提取规则 2）。
 *
 * 合法名称原样返回，保证 `variables` 与 `fields.key` 中已有的键不被改写。
 */
export function normalizeVariableKey(raw: string): string {
  let name = raw.replace(ILLEGAL_KEY_CHARS, '_')
  if (name.length === 0) name = '_'
  if (!/^[A-Za-z_]/.test(name)) name = `v_${name}`
  if (name.length > 64) name = name.slice(0, 64)
  return name
}

interface SampleDraft {
  key: string
  value: number
  label?: string
  unit?: string
}

function mergeSample(map: Map<string, SampleDraft>, draft: SampleDraft): void {
  const existing = map.get(draft.key)
  if (existing === undefined) {
    map.set(draft.key, draft)
    return
  }
  existing.value = draft.value
  if (draft.label !== undefined) existing.label = draft.label
  if (draft.unit !== undefined) existing.unit = draft.unit
}

function extractVariablesResult(
  result: DecodeResult,
  map: Map<string, SampleDraft>,
  candidateKeys: Set<string>,
): number {
  if (result.level === 'error') return 0
  if (result.variables !== undefined) {
    let invalid = 0
    for (const key of Object.keys(result.variables)) {
      if (!isValidVariableKey(key)) continue
      candidateKeys.add(key)
      const value: unknown = result.variables[key]
      if (typeof value !== 'number' || !Number.isFinite(value)) {
        invalid += 1
        continue
      }
      const draft: SampleDraft = { key, value }
      const meta = result.variableMeta?.[key]
      if (meta?.label !== undefined) draft.label = meta.label
      if (meta?.unit !== undefined) draft.unit = meta.unit
      mergeSample(map, draft)
    }
    return invalid
  }
  if (result.noVariables === true || result.fields === undefined) return 0

  let invalid = 0
  for (const field of result.fields) {
    const value: unknown = field.value
    if (typeof value === 'boolean') {
      const key = fieldVariableKey(field)
      candidateKeys.add(key)
      mergeSample(map, {
        key,
        value: value ? 1 : 0,
        label: field.label,
        ...(field.unit === undefined ? {} : { unit: field.unit }),
      })
      continue
    }
    if (typeof value !== 'number') continue
    const key = fieldVariableKey(field)
    candidateKeys.add(key)
    if (!Number.isFinite(value)) {
      invalid += 1
      continue
    }
    mergeSample(map, {
      key,
      value,
      label: field.label,
      ...(field.unit === undefined ? {} : { unit: field.unit }),
    })
  }
  return invalid
}

function fieldVariableKey(field: DecodeField): string {
  const base = field.key !== undefined && field.key.length > 0 ? field.key : field.label
  return normalizeVariableKey(base)
}

/** 从一帧的所有解码结果提取变量样本。 */
export function extractVariables(results: readonly DecodeResult[]): ExtractOutcome {
  const map = new Map<string, SampleDraft>()
  const candidateKeys = new Set<string>()
  let invalid = 0
  for (const result of results) {
    invalid += extractVariablesResult(result, map, candidateKeys)
  }
  const variables: ExtractedVariable[] = []
  for (const sample of map.values()) variables.push(sample)
  return { variables, invalid, candidates: candidateKeys.size }
}

/** 判断一帧是否可能含有变量（`SeriesHub` 据此惰性创建数据源，避免重复提取）。 */
export function frameHasVariables(frame: {
  direction: 'rx' | 'tx'
  results: readonly DecodeResult[]
}): boolean {
  if (frame.direction !== 'rx') return false
  for (const result of frame.results) {
    if (result.level === 'error') continue
    if (result.variables !== undefined) {
      for (const key of Object.keys(result.variables)) {
        if (isValidVariableKey(key)) return true
      }
      continue
    }
    if (result.noVariables === true || result.fields === undefined) continue
    for (const field of result.fields) {
      if (typeof field.value === 'number' || typeof field.value === 'boolean') return true
    }
  }
  return false
}
