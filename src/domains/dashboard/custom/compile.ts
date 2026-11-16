/**
 * 自定义控件编译与定义校验（plan §6.10）。
 *
 * 用户在站内编写一段 JS 函数体，运行时通过 `new Function('sdk', code)` 编译后调用，
 * 必须 `return` 一个 `CustomWidgetDefinition`。本模块只负责编译和**结构**校验，
 * 不执行 mount；执行保护见 `guard.ts`。
 */

import { createProtocolSdk } from '../../protocol/public'
import type { ComposeOptions } from '../../link/public'
import {
  MAX_CUSTOM_WIDGET_CODE_LENGTH,
  MAX_WIDGET_H,
  MAX_WIDGET_W,
  MIN_WIDGET_H,
  MIN_WIDGET_W,
  type CommandSpec,
  type CustomWidgetDefinition,
  type CustomWidgetGroup,
  type Threshold,
  type VarRef,
  type WidgetPropField,
  type WidgetPropTab,
  type Zone,
} from '../types'

/** 编译成功。 */
export interface CustomWidgetCompileSuccess {
  ok: true
  definition: CustomWidgetDefinition
}

/** 编译失败；`line` 为尽量从 V8 错误信息中提取的代码行号（1 起）。 */
export interface CustomWidgetCompileFailure {
  ok: false
  error: string
  line?: number
}

export type CustomWidgetCompileResult = CustomWidgetCompileSuccess | CustomWidgetCompileFailure

const PROP_TABS: readonly WidgetPropTab[] = ['data', 'style', 'behavior']
const WIDGET_GROUPS: readonly CustomWidgetGroup[] = ['chart', 'value', 'control']
const PROP_TYPES = [
  'number',
  'text',
  'textarea',
  'select',
  'checkbox',
  'color',
  'range',
  'variable',
  'variables',
  'thresholds',
  'zones',
  'options',
  'command',
  'expression',
] as const

/** `new Function` 在函数体前多包了 `function anonymous(sdk\n) {\n` 两行。 */
const FUNCTION_WRAPPER_LINE_OFFSET = 2

const THRESHOLD_OPS: readonly Threshold['op'][] = ['>', '>=', '<', '<=', '==', '!=']

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

function isInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value)
}

function isGridSize(value: unknown): value is { w: number; h: number } {
  return (
    isRecord(value) &&
    isInteger(value.w) &&
    isInteger(value.h) &&
    value.w >= MIN_WIDGET_W &&
    value.w <= MAX_WIDGET_W &&
    value.h >= MIN_WIDGET_H &&
    value.h <= MAX_WIDGET_H
  )
}

function describeSize(value: unknown): string {
  if (!isRecord(value)) return String(value)
  return `${String(value.w)}×${String(value.h)}`
}

/* ------------------------------------------------------------------------- */
/* 属性描述校验                                                                */
/* ------------------------------------------------------------------------- */

function validateVariableRef(value: unknown, path: string, errors: string[]): void {
  if (!isRecord(value)) {
    errors.push(`${path} 必须是变量引用对象`)
    return
  }
  if (typeof value.source !== 'string' || value.source === '') {
    errors.push(`${path}.source 必须是非空字符串`)
  }
  if (typeof value.key !== 'string' || value.key === '') {
    errors.push(`${path}.key 必须是非空字符串`)
  }
}

function validateOptions(
  value: unknown,
  path: string,
  errors: string[],
): Array<{ label: string; value: string | number }> | undefined {
  if (!Array.isArray(value)) {
    errors.push(`${path} 必须是数组`)
    return undefined
  }
  const result: Array<{ label: string; value: string | number }> = []
  value.forEach((item, index) => {
    const itemPath = `${path}[${index}]`
    if (!isRecord(item)) {
      errors.push(`${itemPath} 必须是对象`)
      return
    }
    if (typeof item.label !== 'string') errors.push(`${itemPath}.label 必须是字符串`)
    if (typeof item.value !== 'string' && typeof item.value !== 'number') {
      errors.push(`${itemPath}.value 必须是字符串或数字`)
    }
    if (
      typeof item.label === 'string' &&
      (typeof item.value === 'string' || typeof item.value === 'number')
    ) {
      result.push({ label: item.label, value: item.value })
    }
  })
  return result
}

function validateThresholds(
  value: unknown,
  path: string,
  errors: string[],
): Threshold[] | undefined {
  if (!Array.isArray(value)) {
    errors.push(`${path} 必须是数组`)
    return undefined
  }
  const result: Threshold[] = []
  value.forEach((item, index) => {
    const itemPath = `${path}[${index}]`
    if (!isRecord(item)) {
      errors.push(`${itemPath} 必须是对象`)
      return
    }
    if (!THRESHOLD_OPS.includes(item.op as Threshold['op'])) {
      errors.push(`${itemPath}.op 必须是 >、>=、<、<=、== 或 !=`)
    }
    if (!isFiniteNumber(item.value)) errors.push(`${itemPath}.value 必须是有限数`)
    if (typeof item.color !== 'string' || item.color === '') {
      errors.push(`${itemPath}.color 必须是非空字符串`)
    }
    if (item.label !== undefined && typeof item.label !== 'string') {
      errors.push(`${itemPath}.label 必须是字符串`)
    }
    result.push({
      op: (item.op as Threshold['op']) ?? '>',
      value: isFiniteNumber(item.value) ? item.value : 0,
      color: typeof item.color === 'string' ? item.color : '',
      ...(typeof item.label === 'string' ? { label: item.label } : {}),
    })
  })
  return result
}

function validateZones(value: unknown, path: string, errors: string[]): Zone[] | undefined {
  if (!Array.isArray(value)) {
    errors.push(`${path} 必须是数组`)
    return undefined
  }
  const result: Zone[] = []
  value.forEach((item, index) => {
    const itemPath = `${path}[${index}]`
    if (!isRecord(item)) {
      errors.push(`${itemPath} 必须是对象`)
      return
    }
    if (!isFiniteNumber(item.from)) errors.push(`${itemPath}.from 必须是有限数`)
    if (!isFiniteNumber(item.to)) errors.push(`${itemPath}.to 必须是有限数`)
    if (typeof item.color !== 'string' || item.color === '') {
      errors.push(`${itemPath}.color 必须是非空字符串`)
    }
    result.push({
      from: isFiniteNumber(item.from) ? item.from : 0,
      to: isFiniteNumber(item.to) ? item.to : 0,
      color: typeof item.color === 'string' ? item.color : '',
    })
  })
  return result
}

function validateCommandSpec(
  value: unknown,
  path: string,
  errors: string[],
): CommandSpec | undefined {
  if (!isRecord(value)) {
    errors.push(`${path} 必须是命令对象`)
    return undefined
  }
  const kind = value.kind
  if (typeof value.source !== 'string' || value.source === '') {
    errors.push(`${path}.source 必须是非空字符串`)
  }
  switch (kind) {
    case 'template': {
      if (value.mode !== 'text' && value.mode !== 'hex') {
        errors.push(`${path}.mode 必须是 'text' 或 'hex'`)
      }
      if (typeof value.template !== 'string') errors.push(`${path}.template 必须是字符串`)
      if (!isRecord(value.options)) errors.push(`${path}.options 必须是对象`)
      return {
        kind: 'template',
        source: typeof value.source === 'string' ? value.source : '',
        mode: value.mode === 'hex' ? 'hex' : 'text',
        template: typeof value.template === 'string' ? value.template : '',
        options: (isRecord(value.options) ? value.options : {}) as Omit<ComposeOptions, 'mode'>,
      }
    }
    case 'protocol': {
      if (!isRecord(value.values)) {
        errors.push(`${path}.values 必须是对象`)
      } else {
        for (const [key, item] of Object.entries(value.values)) {
          if (typeof item !== 'string' && typeof item !== 'number' && typeof item !== 'boolean') {
            errors.push(`${path}.values["${key}"] 必须是字符串、数字或布尔值`)
          }
        }
      }
      return {
        kind: 'protocol',
        source: typeof value.source === 'string' ? value.source : '',
        values: (isRecord(value.values) ? value.values : {}) as Record<
          string,
          string | number | boolean
        >,
      }
    }
    case 'signal': {
      for (const key of ['dtr', 'rts', 'brk'] as const) {
        if (value[key] !== undefined && typeof value[key] !== 'boolean') {
          errors.push(`${path}.${key} 必须是布尔值`)
        }
      }
      const result: Extract<CommandSpec, { kind: 'signal' }> = {
        kind: 'signal',
        source: typeof value.source === 'string' ? value.source : '',
      }
      if (typeof value.dtr === 'boolean') result.dtr = value.dtr
      if (typeof value.rts === 'boolean') result.rts = value.rts
      if (typeof value.brk === 'boolean') result.brk = value.brk
      return result
    }
    case 'quick': {
      if (typeof value.quickItemId !== 'string' || value.quickItemId === '') {
        errors.push(`${path}.quickItemId 必须是非空字符串`)
      }
      return {
        kind: 'quick',
        source: typeof value.source === 'string' ? value.source : '',
        quickItemId: typeof value.quickItemId === 'string' ? value.quickItemId : '',
      }
    }
    default:
      errors.push(`${path}.kind 必须是 template、protocol、signal 或 quick`)
      return undefined
  }
}

const RESERVED_PROP_KEY = 'variables'

function validatePropField(
  value: unknown,
  path: string,
  errors: string[],
  keys: Set<string>,
  depth: number,
): void {
  if (!isRecord(value)) {
    errors.push(`${path} 必须是对象`)
    return
  }
  if (depth > 5) {
    errors.push(`${path} 的属性嵌套过深`)
    return
  }

  const key = value.key
  if (typeof key !== 'string' || key === '') {
    errors.push(`${path}.key 必须是非空字符串`)
  } else {
    if (key === RESERVED_PROP_KEY) {
      errors.push(`${path}.key 不能使用保留名「${RESERVED_PROP_KEY}」`)
    } else if (keys.has(key)) {
      errors.push(`${path}.key「${key}」重复`)
    } else {
      keys.add(key)
    }
  }

  if (typeof value.label !== 'string') errors.push(`${path}.label 必须是字符串`)
  if (!PROP_TABS.includes(value.tab as WidgetPropTab)) {
    errors.push(`${path}.tab 必须是 data、style 或 behavior`)
  }
  if (value.help !== undefined && typeof value.help !== 'string') {
    errors.push(`${path}.help 必须是字符串`)
  }
  if (value.visibleWhen !== undefined) {
    if (!isRecord(value.visibleWhen)) {
      errors.push(`${path}.visibleWhen 必须是对象`)
    } else if (typeof value.visibleWhen.key !== 'string') {
      errors.push(`${path}.visibleWhen.key 必须是字符串`)
    }
  }

  const type = value.type
  if (typeof type !== 'string' || !(PROP_TYPES as readonly string[]).includes(type)) {
    errors.push(`${path}.type 必须是 ${PROP_TYPES.join('、')} 之一`)
    return
  }

  switch (type) {
    case 'number': {
      for (const field of ['min', 'max', 'step'] as const) {
        if (value[field] !== undefined && !isFiniteNumber(value[field])) {
          errors.push(`${path}.${field} 必须是有限数`)
        }
      }
      if (value.unit !== undefined && typeof value.unit !== 'string') {
        errors.push(`${path}.unit 必须是字符串`)
      }
      if (value.default !== undefined && !isFiniteNumber(value.default)) {
        errors.push(`${path}.default 必须是有限数`)
      }
      break
    }
    case 'text': {
      if (value.maxLength !== undefined && (!isInteger(value.maxLength) || value.maxLength < 0)) {
        errors.push(`${path}.maxLength 必须是大于等于 0 的整数`)
      }
      if (value.placeholder !== undefined && typeof value.placeholder !== 'string') {
        errors.push(`${path}.placeholder 必须是字符串`)
      }
      if (value.default !== undefined && typeof value.default !== 'string') {
        errors.push(`${path}.default 必须是字符串`)
      }
      break
    }
    case 'textarea': {
      if (value.rows !== undefined && (!isInteger(value.rows) || value.rows < 1)) {
        errors.push(`${path}.rows 必须是大于等于 1 的整数`)
      }
      if (value.default !== undefined && typeof value.default !== 'string') {
        errors.push(`${path}.default 必须是字符串`)
      }
      break
    }
    case 'select': {
      validateOptions(value.options, `${path}.options`, errors)
      if (
        value.default !== undefined &&
        !isFiniteNumber(value.default) &&
        typeof value.default !== 'string'
      ) {
        errors.push(`${path}.default 必须是字符串或数字`)
      }
      break
    }
    case 'checkbox': {
      if (value.default !== undefined && typeof value.default !== 'boolean') {
        errors.push(`${path}.default 必须是布尔值`)
      }
      break
    }
    case 'color': {
      if (value.default !== undefined && typeof value.default !== 'string') {
        errors.push(`${path}.default 必须是字符串`)
      }
      break
    }
    case 'range': {
      if (value.default !== undefined) {
        if (!isRecord(value.default)) {
          errors.push(`${path}.default 必须是 { min, max } 对象`)
        } else {
          for (const field of ['min', 'max'] as const) {
            const bound = value.default[field]
            if (bound !== null && !isFiniteNumber(bound)) {
              errors.push(`${path}.default.${field} 必须是有限数或 null`)
            }
          }
        }
      }
      break
    }
    case 'variable': {
      if (value.default !== undefined && value.default !== null) {
        validateVariableRef(value.default, `${path}.default`, errors)
      }
      break
    }
    case 'variables': {
      let min = 0
      let max = 16
      if (value.min !== undefined) {
        if (!isInteger(value.min) || value.min < 0 || value.min > 16) {
          errors.push(`${path}.min 必须是 0–16 之间的整数`)
        } else {
          min = value.min
        }
      }
      if (value.max !== undefined) {
        if (!isInteger(value.max) || value.max < 0 || value.max > 16) {
          errors.push(`${path}.max 必须是 0–16 之间的整数`)
        } else {
          max = value.max
        }
      }
      if (min > max) errors.push(`${path} 必须满足 min ≤ max`)
      if (value.itemFields !== undefined) {
        if (!Array.isArray(value.itemFields)) {
          errors.push(`${path}.itemFields 必须是数组`)
        } else {
          const itemKeys = new Set<string>()
          value.itemFields.forEach((item, index) => {
            validatePropField(item, `${path}.itemFields[${index}]`, errors, itemKeys, depth + 1)
          })
        }
      }
      break
    }
    case 'thresholds': {
      if (value.default !== undefined) validateThresholds(value.default, `${path}.default`, errors)
      break
    }
    case 'zones': {
      if (value.default !== undefined) validateZones(value.default, `${path}.default`, errors)
      break
    }
    case 'options': {
      if (value.default !== undefined) validateOptions(value.default, `${path}.default`, errors)
      break
    }
    case 'command': {
      if (value.default !== undefined && value.default !== null) {
        validateCommandSpec(value.default, `${path}.default`, errors)
      }
      break
    }
    case 'expression': {
      if (value.default !== undefined && typeof value.default !== 'string') {
        errors.push(`${path}.default 必须是字符串`)
      }
      break
    }
  }
}

function validatePropList(value: unknown, errors: string[]): WidgetPropField[] {
  if (value === undefined) return []
  if (!Array.isArray(value)) {
    errors.push('props 必须是数组')
    return []
  }
  const keys = new Set<string>()
  value.forEach((item, index) => {
    validatePropField(item, `props[${index}]`, errors, keys, 0)
  })
  return value as WidgetPropField[]
}

/* ------------------------------------------------------------------------- */
/* 行号提取                                                                    */
/* ------------------------------------------------------------------------- */

function extractLine(error: unknown): number | undefined {
  if (error instanceof Error && typeof error.stack === 'string') {
    const evalFrame = /<anonymous>:(\d+):\d+/.exec(error.stack)
    if (evalFrame) {
      const reported = Number(evalFrame[1]) - FUNCTION_WRAPPER_LINE_OFFSET
      if (reported > 0) return reported
    }
  }
  const message = error instanceof Error ? error.message : String(error)
  const lineMatch = /\bline\s+(\d+)/i.exec(message)
  if (lineMatch) {
    const line = Number(lineMatch[1])
    return line > 0 ? line : undefined
  }
  return undefined
}

function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message
  return String(error)
}

/* ------------------------------------------------------------------------- */
/* 定义校验                                                                    */
/* ------------------------------------------------------------------------- */

function validateDefinition(raw: unknown): CustomWidgetCompileResult {
  const errors: string[] = []
  if (!isRecord(raw)) {
    return { ok: false, error: '代码必须 return 一个自定义控件定义对象' }
  }

  if (raw.apiVersion !== 1) {
    errors.push('apiVersion 必须为 1')
  }

  let meta: CustomWidgetDefinition['meta'] = { name: '' }
  if (!isRecord(raw.meta)) {
    errors.push('meta 必须是对象')
  } else {
    if (typeof raw.meta.name !== 'string' || raw.meta.name.trim() === '') {
      errors.push('meta.name 不能为空')
    }
    if (raw.meta.description !== undefined && typeof raw.meta.description !== 'string') {
      errors.push('meta.description 必须是字符串')
    }
    if (raw.meta.version !== undefined && typeof raw.meta.version !== 'string') {
      errors.push('meta.version 必须是字符串')
    }
    if (
      raw.meta.group !== undefined &&
      !WIDGET_GROUPS.includes(raw.meta.group as CustomWidgetGroup)
    ) {
      errors.push('meta.group 必须是 chart、value 或 control')
    }
    meta = {
      name: typeof raw.meta.name === 'string' ? raw.meta.name : '',
      ...(typeof raw.meta.description === 'string' ? { description: raw.meta.description } : {}),
      ...(typeof raw.meta.version === 'string' ? { version: raw.meta.version } : {}),
      group: WIDGET_GROUPS.includes(raw.meta.group as CustomWidgetGroup)
        ? (raw.meta.group as CustomWidgetGroup)
        : 'value',
    }
  }

  if (typeof raw.mount !== 'function') {
    errors.push('mount 必须是函数')
  }

  let size: NonNullable<CustomWidgetDefinition['size']> = {
    default: { w: 6, h: 6 },
    min: { w: 2, h: 2 },
  }
  if (raw.size !== undefined) {
    if (!isRecord(raw.size)) {
      errors.push('size 必须是对象')
    } else {
      const defaultSize = raw.size.default ?? { w: 6, h: 6 }
      const minSize = raw.size.min ?? { w: 2, h: 2 }
      if (!isGridSize(defaultSize)) {
        errors.push(
          `size.default 必须在网格范围内（w 1–24、h 1–64），当前为 ${describeSize(defaultSize)}`,
        )
      }
      if (!isGridSize(minSize)) {
        errors.push(`size.min 必须在网格范围内（w 1–24、h 1–64），当前为 ${describeSize(minSize)}`)
      }
      if (isGridSize(defaultSize) && isGridSize(minSize)) {
        if (minSize.w > defaultSize.w || minSize.h > defaultSize.h) {
          errors.push('size.min 不能大于 size.default')
        }
        size = {
          default: { w: defaultSize.w, h: defaultSize.h },
          min: { w: minSize.w, h: minSize.h },
        }
      } else if (isGridSize(defaultSize)) {
        size = { default: { w: defaultSize.w, h: defaultSize.h }, min: size.min }
      }
    }
  }

  const props = validatePropList(raw.props, errors)

  let variables: CustomWidgetDefinition['variables']
  if (raw.variables !== undefined) {
    if (!isRecord(raw.variables)) {
      errors.push('variables 必须是 { min, max } 对象')
    } else {
      const min = raw.variables.min
      const max = raw.variables.max
      if (!isInteger(min) || !isInteger(max) || min < 0 || max > 16 || min > max) {
        errors.push('variables 必须满足 0 ≤ min ≤ max ≤ 16')
      } else {
        variables = { min, max }
      }
    }
  }

  if (errors.length > 0) return { ok: false, error: errors[0] ?? '自定义控件定义不合法' }

  const definition: CustomWidgetDefinition = {
    ...(raw as unknown as CustomWidgetDefinition),
    apiVersion: 1,
    meta,
    size,
    props,
    ...(variables ? { variables } : {}),
    mount: raw.mount as CustomWidgetDefinition['mount'],
  }
  return { ok: true, definition }
}

/* ------------------------------------------------------------------------- */
/* 编译入口                                                                    */
/* ------------------------------------------------------------------------- */

/**
 * 编译自定义控件代码并校验返回的定义。
 *
 * @param code 一个 JS 函数体字符串（`new Function('sdk', code)`）
 * @returns 成功时返回补齐默认值后的定义；失败时返回中文错误与尽量提取到的行号
 */
export function compileCustomWidget(code: unknown): CustomWidgetCompileResult {
  if (typeof code !== 'string') {
    return { ok: false, error: '自定义控件代码必须是字符串' }
  }
  if (code.length > MAX_CUSTOM_WIDGET_CODE_LENGTH) {
    return { ok: false, error: '自定义控件代码不能超过 256KB' }
  }
  if (code.trim() === '') {
    return { ok: false, error: '自定义控件代码不能为空' }
  }

  let factory: (sdk: ReturnType<typeof createProtocolSdk>) => unknown
  try {
    factory = new Function('sdk', code) as (sdk: ReturnType<typeof createProtocolSdk>) => unknown
  } catch (error) {
    return {
      ok: false,
      error: `语法错误：${errorMessage(error)}`,
      ...(extractLine(error) !== undefined ? { line: extractLine(error) } : {}),
    }
  }

  let raw: unknown
  try {
    raw = factory(createProtocolSdk())
  } catch (error) {
    return {
      ok: false,
      error: `代码执行出错：${errorMessage(error)}`,
      ...(extractLine(error) !== undefined ? { line: extractLine(error) } : {}),
    }
  }

  return validateDefinition(raw)
}
