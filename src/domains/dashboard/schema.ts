/**
 * 仪表盘校验、默认值与版本迁移（plan §6.9）。
 *
 * `validateDashboard` 只做类型/范围校验，并把缺失的可选字段补成默认值；
 * 越界的布局（x/y 越界、组件重叠）不视为错误，由 `layout.normalize` 在加载时修正。
 */

import { isValidVariableKey } from '../protocol/public'
import type { ComputedVariable } from '../series/public'
import { uuid } from '../../shared/lib/id'
import {
  DEFAULT_ROW_HEIGHT,
  DEFAULT_SOURCE_ALIAS,
  DASHBOARD_SCHEMA_VERSION,
  MAX_ROW_HEIGHT,
  MAX_WIDGET_STATE_BYTES,
  MIN_ROW_HEIGHT,
  SOURCE_ALIAS_PATTERN,
  type CommonProps,
  type Dashboard,
  type DashboardSource,
  type VariableMetaOverride,
  type WidgetInstance,
} from './types'

/** `validateDashboard` 的成功结果。 */
export interface ValidateDashboardSuccess {
  ok: true
  dashboard: Dashboard
}

/** `validateDashboard` 的失败结果；`errors` 非空。 */
export interface ValidateDashboardFailure {
  ok: false
  errors: string[]
}

export type ValidateDashboardResult = ValidateDashboardSuccess | ValidateDashboardFailure

/** `migrateDashboard` 的成功结果；调用方仍需调用 `validateDashboard`。 */
export interface MigrateDashboardSuccess {
  ok: true
  dashboard: Dashboard
}

/** `migrateDashboard` 的失败结果。 */
export interface MigrateDashboardFailure {
  ok: false
  error: string
}

export type MigrateDashboardResult = MigrateDashboardSuccess | MigrateDashboardFailure

/** `createEmptyDashboard` 的参数。 */
export interface CreateDashboardOptions {
  /** 仪表盘名称，默认「未命名仪表盘」。 */
  name?: string
  /** 注入 id（测试用）；默认 `uuid()`。 */
  id?: string
  /** 默认数据源的 alias，默认 `main`。 */
  alias?: string
  /** 默认数据源的显示名，默认与 alias 相同。 */
  label?: string
  /** 网格行高，默认 28；越界时会被夹取。 */
  rowHeight?: number
  /** 注入时间戳（测试用）；默认 `Date.now()`。 */
  now?: number
}

/* ------------------------------------------------------------------------- */
/* 校验工具                                                                    */
/* ------------------------------------------------------------------------- */

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

function isInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value)
}

function jsonByteLength(value: unknown): number | undefined {
  let text: string
  try {
    const serialized = JSON.stringify(value)
    if (typeof serialized !== 'string') return undefined
    text = serialized
  } catch {
    return undefined
  }
  if (typeof TextEncoder === 'function') return new TextEncoder().encode(text).length
  return text.length
}

function readString(
  value: unknown,
  path: string,
  errors: string[],
  { allowEmpty = false, required = false }: { allowEmpty?: boolean; required?: boolean } = {},
): string | undefined {
  if (value === undefined) {
    if (required) {
      errors.push(allowEmpty ? `${path} 必须是字符串` : `${path} 必须是非空字符串`)
    }
    return undefined
  }
  if (typeof value !== 'string') {
    errors.push(`${path} 必须是字符串`)
    return undefined
  }
  if (!allowEmpty && value.trim() === '') {
    errors.push(`${path} 不能为空字符串`)
    return undefined
  }
  return value
}

function readOptionalString(value: unknown, path: string, errors: string[]): string | undefined {
  return readString(value, path, errors, { allowEmpty: true })
}

function readFiniteNumber(value: unknown, path: string, errors: string[]): number | undefined {
  if (value === undefined) return undefined
  if (!isFiniteNumber(value)) {
    errors.push(`${path} 必须是有限数`)
    return undefined
  }
  return value
}

function readBoolean(value: unknown, path: string, errors: string[]): boolean | undefined {
  if (value === undefined) return undefined
  if (typeof value !== 'boolean') {
    errors.push(`${path} 必须是布尔值`)
    return undefined
  }
  return value
}

/* ------------------------------------------------------------------------- */
/* 校验与默认值                                                                */
/* ------------------------------------------------------------------------- */

function parseSources(value: unknown, errors: string[]): DashboardSource[] {
  if (!Array.isArray(value) || value.length === 0) {
    errors.push('sources 至少需要 1 个数据源')
    return []
  }
  const seen = new Set<string>()
  const sources: DashboardSource[] = []
  value.forEach((raw, index) => {
    const path = `sources[${index}]`
    if (!isRecord(raw)) {
      errors.push(`${path} 必须是对象`)
      return
    }
    const alias = readString(raw.alias, `${path}.alias`, errors, { required: true })
    if (alias !== undefined) {
      if (!SOURCE_ALIAS_PATTERN.test(alias)) {
        errors.push(`${path}.alias「${alias}」必须匹配 /^[a-z][a-z0-9_]{0,15}$/`)
      } else if (seen.has(alias)) {
        errors.push(`数据源 alias「${alias}」重复`)
      } else {
        seen.add(alias)
      }
    }
    const label = readString(raw.label, `${path}.label`, errors, { required: true })
    const source: DashboardSource = { alias: alias ?? '', label: label ?? '' }
    if (raw.match !== undefined) {
      if (!isRecord(raw.match)) {
        errors.push(`${path}.match 必须是对象`)
      } else {
        const match: NonNullable<DashboardSource['match']> = {}
        const deviceKey = readOptionalString(raw.match.deviceKey, `${path}.match.deviceKey`, errors)
        if (deviceKey !== undefined) match.deviceKey = deviceKey
        const providerKind = readOptionalString(
          raw.match.providerKind,
          `${path}.match.providerKind`,
          errors,
        )
        if (providerKind !== undefined) match.providerKind = providerKind
        source.match = match
      }
    }
    sources.push(source)
  })
  return sources
}

function parseVariableMeta(value: unknown, errors: string[]): Record<string, VariableMetaOverride> {
  if (value === undefined) return {}
  if (!isRecord(value)) {
    errors.push('variableMeta 必须是对象')
    return {}
  }
  const result: Record<string, VariableMetaOverride> = {}
  for (const [key, raw] of Object.entries(value)) {
    const path = `variableMeta["${key}"]`
    const slash = key.indexOf('/')
    if (slash <= 0) {
      errors.push(`variableMeta 键「${key}」必须为「<alias>/<key>」格式`)
      continue
    }
    const alias = key.slice(0, slash)
    const variableKey = key.slice(slash + 1)
    if (!SOURCE_ALIAS_PATTERN.test(alias)) {
      errors.push(`variableMeta 键「${key}」的数据源 alias 不合法`)
    }
    if (!isValidVariableKey(variableKey)) {
      errors.push(`variableMeta 键「${key}」的变量名不合法`)
    }
    if (!isRecord(raw)) {
      errors.push(`${path} 必须是对象`)
      continue
    }
    const override: VariableMetaOverride = {}
    const label = readOptionalString(raw.label, `${path}.label`, errors)
    if (label !== undefined) override.label = label
    const unit = readOptionalString(raw.unit, `${path}.unit`, errors)
    if (unit !== undefined) override.unit = unit
    const color = readOptionalString(raw.color, `${path}.color`, errors)
    if (color !== undefined) override.color = color
    const scale = readFiniteNumber(raw.scale, `${path}.scale`, errors)
    if (scale !== undefined) override.scale = scale
    const offset = readFiniteNumber(raw.offset, `${path}.offset`, errors)
    if (offset !== undefined) override.offset = offset
    if (raw.decimals !== undefined) {
      if (!isInteger(raw.decimals) || raw.decimals < 0) {
        errors.push(`${path}.decimals 必须是大于等于 0 的整数`)
      } else {
        override.decimals = raw.decimals
      }
    }
    result[key] = override
  }
  return result
}

function parseComputed(value: unknown, errors: string[]): Record<string, ComputedVariable[]> {
  if (value === undefined) return {}
  if (!isRecord(value)) {
    errors.push('computed 必须是对象')
    return {}
  }
  const result: Record<string, ComputedVariable[]> = {}
  for (const [alias, raw] of Object.entries(value)) {
    const path = `computed["${alias}"]`
    if (!SOURCE_ALIAS_PATTERN.test(alias)) {
      errors.push(`${path} 的键必须是合法数据源 alias`)
    }
    if (!Array.isArray(raw)) {
      errors.push(`${path} 必须是数组`)
      continue
    }
    const list: ComputedVariable[] = []
    raw.forEach((item, index) => {
      const itemPath = `${path}[${index}]`
      if (!isRecord(item)) {
        errors.push(`${itemPath} 必须是对象`)
        return
      }
      const key = readString(item.key, `${itemPath}.key`, errors, { required: true })
      const expr = readString(item.expr, `${itemPath}.expr`, errors, { required: true })
      const computed: ComputedVariable = { key: key ?? '', expr: expr ?? '' }
      const unit = readOptionalString(item.unit, `${itemPath}.unit`, errors)
      if (unit !== undefined) computed.unit = unit
      const label = readOptionalString(item.label, `${itemPath}.label`, errors)
      if (label !== undefined) computed.label = label
      list.push(computed)
    })
    result[alias] = list
  }
  return result
}

function parseCommon(
  value: unknown,
  widgetType: string,
  path: string,
  errors: string[],
): CommonProps {
  const defaults: CommonProps = {
    title: widgetType,
    showTitle: true,
    titleAlign: 'left',
    background: 'default',
    border: true,
    padding: 8,
    fontScale: 1,
  }
  if (value === undefined) return defaults
  if (!isRecord(value)) {
    errors.push(`${path} 必须是对象`)
    return defaults
  }

  const title = readOptionalString(value.title, `${path}.title`, errors)
  const showTitle = readBoolean(value.showTitle, `${path}.showTitle`, errors)
  let titleAlign: CommonProps['titleAlign'] = 'left'
  if (value.titleAlign !== undefined) {
    if (value.titleAlign === 'left' || value.titleAlign === 'center') {
      titleAlign = value.titleAlign
    } else {
      errors.push(`${path}.titleAlign 必须是 'left' 或 'center'`)
    }
  }
  let background: CommonProps['background'] = 'default'
  if (value.background !== undefined) {
    if (typeof value.background === 'string') background = value.background
    else errors.push(`${path}.background 必须是字符串`)
  }
  const border = readBoolean(value.border, `${path}.border`, errors)
  let padding: CommonProps['padding'] = 8
  if (value.padding !== undefined) {
    if (value.padding === 0 || value.padding === 4 || value.padding === 8 || value.padding === 12) {
      padding = value.padding
    } else {
      errors.push(`${path}.padding 必须是 0、4、8 或 12`)
    }
  }
  let fontScale = 1
  if (value.fontScale !== undefined) {
    if (isFiniteNumber(value.fontScale) && value.fontScale >= 0.75 && value.fontScale <= 2) {
      fontScale = value.fontScale
    } else {
      errors.push(`${path}.fontScale 必须是 0.75–2 之间的数`)
    }
  }

  return {
    title: title ?? defaults.title,
    showTitle: showTitle ?? defaults.showTitle,
    titleAlign,
    background,
    border: border ?? defaults.border,
    padding,
    fontScale,
  }
}

function parseWidget(
  value: unknown,
  index: number,
  ids: Set<string>,
  errors: string[],
): WidgetInstance {
  const path = `widgets[${index}]`
  const placeholder: WidgetInstance = {
    id: '',
    type: '',
    version: 1,
    x: 0,
    y: 0,
    w: 1,
    h: 1,
    common: {
      title: '',
      showTitle: true,
      titleAlign: 'left',
      background: 'default',
      border: true,
      padding: 8,
      fontScale: 1,
    },
    props: {},
  }
  if (!isRecord(value)) {
    errors.push(`${path} 必须是对象`)
    return placeholder
  }

  const id = readString(value.id, `${path}.id`, errors, { required: true })
  if (id !== undefined) {
    if (ids.has(id)) errors.push(`组件 id「${id}」重复`)
    else ids.add(id)
  }
  const type = readString(value.type, `${path}.type`, errors, { required: true })

  let version = 1
  if (value.version !== undefined) {
    if (!isInteger(value.version) || value.version < 0) {
      errors.push(`${path}.version 必须是大于等于 0 的整数`)
    } else {
      version = value.version
    }
  }

  const layout: Record<'x' | 'y' | 'w' | 'h', number | undefined> = {
    x: undefined,
    y: undefined,
    w: undefined,
    h: undefined,
  }
  for (const field of ['x', 'y', 'w', 'h'] as const) {
    const raw = value[field]
    if (raw === undefined) {
      errors.push(`${path}.${field} 必须是整数`)
      continue
    }
    if (!isInteger(raw)) {
      errors.push(`${path}.${field} 必须是整数`)
      continue
    }
    if ((field === 'w' || field === 'h') && raw < 1) {
      errors.push(`${path}.${field} 必须大于等于 1`)
      continue
    }
    layout[field] = raw
  }
  // 超出网格的尺寸（w > COLS、x + w > COLS 等）由 normalize 修正，不算校验错误。

  const props = value.props
  let widgetProps: Record<string, unknown> = {}
  if (props !== undefined) {
    if (!isRecord(props)) errors.push(`${path}.props 必须是对象`)
    else widgetProps = { ...props }
  }

  let state: Record<string, unknown> | undefined
  if (value.state !== undefined) {
    if (!isRecord(value.state)) {
      errors.push(`${path}.state 必须是对象`)
    } else {
      const stateBytes = jsonByteLength(value.state)
      if (stateBytes === undefined) {
        errors.push(`${path}.state 必须是可 JSON 序列化的对象`)
      } else if (stateBytes > MAX_WIDGET_STATE_BYTES) {
        errors.push(`${path}.state 超过 64KB 上限`)
      } else {
        state = { ...value.state }
      }
    }
  }

  const widget: WidgetInstance = {
    id: id ?? '',
    type: type ?? '',
    version,
    x: layout.x ?? 0,
    y: layout.y ?? 0,
    w: layout.w ?? 1,
    h: layout.h ?? 1,
    common: parseCommon(value.common, type ?? '', `${path}.common`, errors),
    props: widgetProps,
  }
  if (state !== undefined) widget.state = state
  return widget
}

function parseWidgets(value: unknown, errors: string[]): WidgetInstance[] {
  if (value === undefined) return []
  if (!Array.isArray(value)) {
    errors.push('widgets 必须是数组')
    return []
  }
  const ids = new Set<string>()
  return value.map((raw, index) => parseWidget(raw, index, ids, errors))
}

/* ------------------------------------------------------------------------- */
/* 公共函数                                                                    */
/* ------------------------------------------------------------------------- */

/**
 * 校验未知输入并补齐默认值。
 *
 * 越界布局（x/y 越界、重叠）不报错，调用方应随后执行 `normalize(dashboard.widgets)`。
 */
export function validateDashboard(input: unknown): ValidateDashboardResult {
  const errors: string[] = []
  if (!isRecord(input)) {
    return { ok: false, errors: ['仪表盘必须是一个对象'] }
  }

  if (input.schema !== DASHBOARD_SCHEMA_VERSION) {
    errors.push(`schema 必须为 ${DASHBOARD_SCHEMA_VERSION}`)
  }
  const id = readString(input.id, 'id', errors, { required: true })
  const name = readString(input.name, 'name', errors, { required: true })

  const createdAt =
    input.createdAt === undefined
      ? Date.now()
      : readFiniteNumber(input.createdAt, 'createdAt', errors)
  if (createdAt !== undefined && createdAt < 0) {
    errors.push('createdAt 必须是大于等于 0 的有限数')
  }
  const updatedAt =
    input.updatedAt === undefined
      ? Date.now()
      : readFiniteNumber(input.updatedAt, 'updatedAt', errors)
  if (updatedAt !== undefined && updatedAt < 0) {
    errors.push('updatedAt 必须是大于等于 0 的有限数')
  }

  let rowHeight = DEFAULT_ROW_HEIGHT
  if (input.rowHeight !== undefined) {
    if (
      !isInteger(input.rowHeight) ||
      input.rowHeight < MIN_ROW_HEIGHT ||
      input.rowHeight > MAX_ROW_HEIGHT
    ) {
      errors.push(`rowHeight 必须是 ${MIN_ROW_HEIGHT}–${MAX_ROW_HEIGHT} 之间的整数`)
    } else {
      rowHeight = input.rowHeight
    }
  }

  const sources = parseSources(input.sources, errors)
  const variableMeta = parseVariableMeta(input.variableMeta, errors)
  const computed = parseComputed(input.computed, errors)
  const widgets = parseWidgets(input.widgets, errors)

  if (errors.length > 0) return { ok: false, errors }

  return {
    ok: true,
    dashboard: {
      schema: DASHBOARD_SCHEMA_VERSION,
      id: id ?? '',
      name: name ?? '',
      createdAt: createdAt ?? Date.now(),
      updatedAt: updatedAt ?? Date.now(),
      rowHeight,
      sources,
      variableMeta,
      computed,
      widgets,
    },
  }
}

/**
 * 版本迁移。v1 只需识别 `schema: 1`；升级完成后调用方仍需 `validateDashboard`。
 */
export function migrateDashboard(input: unknown): MigrateDashboardResult {
  if (!isRecord(input)) {
    return { ok: false, error: '不是有效的仪表盘文件：缺少 schema 版本号' }
  }
  const schema = input.schema
  if (schema === DASHBOARD_SCHEMA_VERSION) {
    return { ok: true, dashboard: input as unknown as Dashboard }
  }
  if (typeof schema === 'number' && schema > DASHBOARD_SCHEMA_VERSION) {
    return { ok: false, error: `仪表盘版本过新（schema ${schema}），请升级后再导入` }
  }
  return { ok: false, error: '不是有效的仪表盘文件：缺少 schema 版本号' }
}

/** 创建默认空仪表盘：rowHeight 28、一个数据源、没有组件。 */
export function createEmptyDashboard(options: CreateDashboardOptions = {}): Dashboard {
  const now = options.now ?? Date.now()
  const alias =
    options.alias !== undefined && SOURCE_ALIAS_PATTERN.test(options.alias)
      ? options.alias
      : DEFAULT_SOURCE_ALIAS
  const rowHeight =
    options.rowHeight !== undefined &&
    Number.isInteger(options.rowHeight) &&
    options.rowHeight >= MIN_ROW_HEIGHT &&
    options.rowHeight <= MAX_ROW_HEIGHT
      ? options.rowHeight
      : DEFAULT_ROW_HEIGHT
  const name =
    options.name !== undefined && options.name.trim() !== '' ? options.name : '未命名仪表盘'
  return {
    schema: DASHBOARD_SCHEMA_VERSION,
    id: options.id ?? uuid(),
    name,
    createdAt: now,
    updatedAt: now,
    rowHeight,
    sources: [{ alias, label: options.label ?? alias }],
    variableMeta: {},
    computed: {},
    widgets: [],
  }
}
