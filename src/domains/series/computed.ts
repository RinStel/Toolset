/**
 * 计算变量（plan §6.8）：表达式编译与求值。
 *
 * 用户表达式按 plan 规定的方式用 `new Function('v', 't', 'dt', 'prev', 'lib', …)`
 * 编译；表达式在主线程执行，属于用户可信代码（安全说明见 plan §6.10）。
 * 编译错误通过返回值报告，不抛异常。
 */

import { isValidVariableKey } from '../protocol/public'
import { COMPUTED_KEY_PREFIX, MAX_COMPUTED_EXPR_LENGTH, type ComputedVariable } from './types'

/** 表达式可用的数学库；参数名与 plan §6.8 一致。 */
export interface ComputedLibrary {
  abs: (x: number) => number
  sqrt: (x: number) => number
  pow: (x: number, y: number) => number
  exp: (x: number) => number
  log: (x: number) => number
  log10: (x: number) => number
  sin: (x: number) => number
  cos: (x: number) => number
  tan: (x: number) => number
  asin: (x: number) => number
  acos: (x: number) => number
  atan: (x: number) => number
  atan2: (y: number, x: number) => number
  min: (...values: number[]) => number
  max: (...values: number[]) => number
  floor: (x: number) => number
  ceil: (x: number) => number
  round: (x: number) => number
  sign: (x: number) => number
  hypot: (...values: number[]) => number
  PI: number
  E: number
  clamp: (x: number, lo: number, hi: number) => number
}

/** `v` 参数：该源所有变量的最新值，键为完整变量名（计算变量带 `fx.` 前缀）。 */
export type ComputedEnvironment = Record<string, number>

/** `clamp(x, lo, hi)`，由 lib 提供（plan §6.8）。 */
export function clamp(x: number, lo: number, hi: number): number {
  return Math.min(Math.max(x, lo), hi)
}

/** 计算变量表达式可用的数学库（单例，避免每帧重建）。 */
export const COMPUTED_LIBRARY: ComputedLibrary = {
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
  clamp,
}

/** 编译后的计算变量。 */
export interface CompiledComputedVariable {
  /** 存储用的变量名（已加 `fx.` 前缀）。 */
  key: string
  /** 定义里的变量名（不含前缀）。 */
  name: string
  unit?: string
  label?: string
  /** 求值；表达式抛出异常时向上传播，由调用方停用该计算变量。 */
  evaluate(environment: ComputedEnvironment, t: number, dt: number, prev: number): unknown
}

/** `setComputed()` 的编译错误；`key` 为定义中提供的键。 */
export interface ComputedCompileError {
  key: string
  error: string
}

export interface ComputedCompileResult {
  compiled: CompiledComputedVariable[]
  errors: ComputedCompileError[]
}

type CompiledFunction = (
  environment: ComputedEnvironment,
  t: number,
  dt: number,
  prev: number,
  lib: ComputedLibrary,
) => unknown

function errorText(error: unknown): string {
  if (error instanceof Error) return error.message
  return String(error)
}

function buildSource(expr: string): string {
  return (
    `"use strict"; const { abs, sqrt, pow, exp, log, log10, sin, cos, tan, asin, acos, atan, ` +
    `atan2, min, max, floor, ceil, round, sign, hypot, PI, E, clamp } = lib; return (${expr});`
  )
}

/**
 * 编译计算变量定义（plan §6.8）。
 *
 * @param defs 定义列表；键不含 `fx.` 前缀。
 * @param reservedKeys 已被占用的变量名（`setComputed` 替换时只包含非计算变量），
 *   用于报告重名错误。
 */
export function compileComputedVariables(
  defs: readonly ComputedVariable[],
  reservedKeys: ReadonlySet<string> = new Set<string>(),
): ComputedCompileResult {
  const compiled: CompiledComputedVariable[] = []
  const errors: ComputedCompileError[] = []
  const seen = new Set<string>()

  for (const def of defs) {
    const name = typeof def?.key === 'string' ? def.key : ''
    if (!isValidVariableKey(name)) {
      errors.push({ key: name, error: '变量名不合法：必须匹配 /^[A-Za-z_][A-Za-z0-9_.]{0,63}$/' })
      continue
    }
    if (typeof def.expr !== 'string' || def.expr.trim().length === 0) {
      errors.push({ key: name, error: '表达式不能为空' })
      continue
    }
    if (def.expr.length > MAX_COMPUTED_EXPR_LENGTH) {
      errors.push({ key: name, error: `表达式长度不能超过 ${MAX_COMPUTED_EXPR_LENGTH} 个字符` })
      continue
    }
    const key = `${COMPUTED_KEY_PREFIX}${name}`
    if (reservedKeys.has(key) || seen.has(key)) {
      errors.push({ key: name, error: '变量名重复：已有同名变量' })
      continue
    }

    let fn: CompiledFunction
    try {
      fn = new Function('v', 't', 'dt', 'prev', 'lib', buildSource(def.expr)) as CompiledFunction
    } catch (error) {
      errors.push({ key: name, error: `表达式语法错误：${errorText(error)}` })
      continue
    }

    seen.add(key)
    const entry: CompiledComputedVariable = {
      key,
      name,
      evaluate: (environment, t, dt, prev) => fn(environment, t, dt, prev, COMPUTED_LIBRARY),
    }
    if (def.unit !== undefined) entry.unit = def.unit
    if (def.label !== undefined) entry.label = def.label
    compiled.push(entry)
  }

  return { compiled, errors }
}
