import { describe, expect, it, vi } from 'vitest'

import {
  CUSTOM_WIDGET_TEMPLATES,
  compileCustomWidget,
  createCallGuard,
  isSafeModeUrl,
  SAFE_MODE_PENDING_KEY,
} from '../../../src/domains/dashboard/public'
import type {
  CallGuardDisabledReason,
  CallGuardErrorInfo,
} from '../../../src/domains/dashboard/public'
import {
  createSafeMode,
  SAFE_MODE_BLOCKED_KEY,
} from '../../../src/domains/dashboard/custom/safe-mode'
import type { SafeModeStorage } from '../../../src/domains/dashboard/custom/safe-mode'

interface FakeClock {
  now: () => number
  advance: (milliseconds: number) => void
}

function fakeClock(start = 0): FakeClock {
  let current = start
  return {
    now: () => current,
    advance(milliseconds: number) {
      current += milliseconds
    },
  }
}

function storageStub(): SafeModeStorage & { entries: Map<string, string> } {
  const entries = new Map<string, string>()
  return {
    entries,
    getItem(key: string): string | null {
      return entries.get(key) ?? null
    },
    setItem(key: string, value: string): void {
      entries.set(key, value)
    },
    removeItem(key: string): void {
      entries.delete(key)
    },
  }
}

const VALID_CODE = `// 最小自定义控件
return {
  apiVersion: 1,
  meta: { name: '测试控件' },
  size: { default: { w: 4, h: 3 }, min: { w: 2, h: 2 } },
  props: [
    { key: 'fontSize', label: '字号', tab: 'style', type: 'number', min: 8, max: 72, step: 1, default: 16 },
  ],
  variables: { min: 1, max: 2 },
  mount(el, ctx) {
    el.textContent = ctx.latest(0) === undefined ? '--' : String(ctx.latest(0))
  },
}`

function compileError(code: unknown, fragment: string): void {
  const result = compileCustomWidget(code)
  expect(result.ok, `期望编译失败：${fragment}`).toBe(false)
  if (result.ok) return
  expect(result.error).toContain(fragment)
}

describe('compileCustomWidget', () => {
  it('compiles a valid definition and fills defaults', () => {
    const result = compileCustomWidget(VALID_CODE)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.definition.apiVersion).toBe(1)
    expect(result.definition.meta.name).toBe('测试控件')
    expect(result.definition.meta.group).toBe('value')
    expect(result.definition.size).toEqual({ default: { w: 4, h: 3 }, min: { w: 2, h: 2 } })
    expect(result.definition.props).toHaveLength(1)
    expect(result.definition.variables).toEqual({ min: 1, max: 2 })
    expect(typeof result.definition.mount).toBe('function')
  })

  it('accepts every WidgetPropField type with valid defaults', () => {
    const code = `return {
  apiVersion: 1,
  meta: { name: '复杂属性', group: 'chart' },
  props: [
    { key: 'size', label: '尺寸', tab: 'style', type: 'number', min: 1, max: 10, step: 1, unit: 'px', default: 3 },
    { key: 'title', label: '标题', tab: 'style', type: 'text', maxLength: 10, placeholder: 'x', default: 'hi' },
    { key: 'notes', label: '备注', tab: 'style', type: 'textarea', rows: 3, default: 'a' },
    {
      key: 'mode',
      label: '模式',
      tab: 'data',
      type: 'select',
      options: [
        { label: 'A', value: 'a' },
        { label: 'B', value: 2 },
      ],
      default: 'a',
    },
    { key: 'flag', label: '开关', tab: 'style', type: 'checkbox', default: true },
    { key: 'color', label: '颜色', tab: 'style', type: 'color', default: 'auto' },
    { key: 'range', label: '范围', tab: 'data', type: 'range', default: { min: null, max: 100 } },
    { key: 'variable', label: '变量', tab: 'data', type: 'variable', default: { source: 'main', key: 'temp' } },
    {
      key: 'variableList',
      label: '变量组',
      tab: 'data',
      type: 'variables',
      min: 0,
      max: 4,
      itemFields: [{ key: 'color', label: '颜色', tab: 'style', type: 'color', default: 'auto' }],
    },
    {
      key: 'thresholds',
      label: '阈值',
      tab: 'style',
      type: 'thresholds',
      default: [{ op: '>=', value: 10, color: 'red', label: '高' }],
    },
    { key: 'zones', label: '分区', tab: 'style', type: 'zones', default: [{ from: 0, to: 50, color: '#0f0' }] },
    { key: 'options', label: '选项', tab: 'data', type: 'options', default: [{ label: 'A', value: 1 }] },
    {
      key: 'command',
      label: '命令',
      tab: 'behavior',
      type: 'command',
      default: {
        kind: 'template',
        source: 'main',
        mode: 'text',
        template: '{value}',
        options: { encoding: 'utf-8', eol: 'none', checksum: 'none', checksumEndian: 'le', checksumSkip: 0 },
      },
    },
    { key: 'expression', label: '表达式', tab: 'behavior', type: 'expression', default: 'value*2' },
  ],
  mount() {},
}`
    const result = compileCustomWidget(code)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.definition.props).toHaveLength(14)
    expect(result.definition.meta.group).toBe('chart')
  })

  it('fills default size and props when omitted', () => {
    const result = compileCustomWidget(
      `return { apiVersion: 1, meta: { name: '极简' }, mount() {} }`,
    )
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.definition.size).toEqual({ default: { w: 6, h: 6 }, min: { w: 2, h: 2 } })
    expect(result.definition.props).toEqual([])
    expect(result.definition.variables).toBeUndefined()
  })

  it('rejects non-string, empty and oversized code', () => {
    compileError(42, '代码必须是字符串')
    compileError('   ', '代码不能为空')
    compileError(`${' '.repeat(256 * 1024)}return {}`, '不能超过 256KB')
  })

  it('reports syntax errors', () => {
    compileError('return {', '语法错误')
    compileError('const = 1', '语法错误')
  })

  it('reports runtime errors at definition time with a line number', () => {
    const result = compileCustomWidget('const a = 1\nthrow new Error("boom")\n')
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error).toContain('代码执行出错')
    expect(result.error).toContain('boom')
    expect(result.line).toBe(2)
  })

  it('rejects a non-object return value', () => {
    compileError('return 42', '必须 return 一个自定义控件定义对象')
  })

  it('validates apiVersion, meta, mount and group', () => {
    compileError(`return { apiVersion: 2, meta: { name: 'x' }, mount() {} }`, 'apiVersion 必须为 1')
    compileError(`return { apiVersion: 1, mount() {} }`, 'meta 必须是对象')
    compileError(
      `return { apiVersion: 1, meta: { name: '   ' }, mount() {} }`,
      'meta.name 不能为空',
    )
    compileError(`return { apiVersion: 1, meta: { name: 'x' } }`, 'mount 必须是函数')
    compileError(
      `return { apiVersion: 1, meta: { name: 'x', group: 'other' }, mount() {} }`,
      'meta.group 必须是 chart、value 或 control',
    )
  })

  it('validates size against the grid', () => {
    compileError(
      `return { apiVersion: 1, meta: { name: 'x' }, size: { default: { w: 30, h: 6 } }, mount() {} }`,
      'size.default',
    )
    compileError(
      `return { apiVersion: 1, meta: { name: 'x' }, size: { default: { w: 6, h: 6 }, min: { w: 8, h: 2 } }, mount() {} }`,
      'size.min 不能大于 size.default',
    )
  })

  it('validates variables bounds', () => {
    compileError(
      `return { apiVersion: 1, meta: { name: 'x' }, variables: { min: 2, max: 1 }, mount() {} }`,
      'variables 必须满足 0 ≤ min ≤ max ≤ 16',
    )
    compileError(
      `return { apiVersion: 1, meta: { name: 'x' }, variables: { min: 0, max: 17 }, mount() {} }`,
      'variables 必须满足 0 ≤ min ≤ max ≤ 16',
    )
  })

  it('validates props: keys, tabs, types and type specific fields', () => {
    compileError(
      `return { apiVersion: 1, meta: { name: 'x' }, props: [
        { key: 'a', label: 'A', tab: 'data', type: 'number' },
        { key: 'a', label: 'B', tab: 'style', type: 'text' },
      ], mount() {} }`,
      '重复',
    )
    compileError(
      `return { apiVersion: 1, meta: { name: 'x' }, props: {} , mount() {} }`,
      'props 必须是数组',
    )
    compileError(
      `return { apiVersion: 1, meta: { name: 'x', description: 5 }, mount() {} }`,
      'meta.description 必须是字符串',
    )
    compileError(
      `return { apiVersion: 1, meta: { name: 'x' }, size: { min: { w: 2, h: 0 } }, mount() {} }`,
      'size.min 必须在网格范围内',
    )
    compileError(
      `return { apiVersion: 1, meta: { name: 'x' }, variables: { min: 1 }, mount() {} }`,
      'variables 必须满足 0 ≤ min ≤ max ≤ 16',
    )
    compileError(
      `return { apiVersion: 1, meta: { name: 'x' }, props: [
        { key: 'a', label: 'A', tab: 'data', type: 'number', visibleWhen: { key: 5 } },
      ], mount() {} }`,
      'visibleWhen.key 必须是字符串',
    )
    compileError(
      `return { apiVersion: 1, meta: { name: 'x' }, props: [
        { key: 'a', label: 'A', tab: 'data', type: 'range', default: { min: 'x', max: null } },
      ], mount() {} }`,
      'default.min 必须是有限数或 null',
    )
    compileError(
      `return { apiVersion: 1, meta: { name: 'x' }, props: [
        { key: 'a', label: 'A', tab: 'style', type: 'color', default: 5 },
      ], mount() {} }`,
      'default 必须是字符串',
    )
    compileError(
      `return { apiVersion: 1, meta: { name: 'x' }, props: [
        { key: 'variables', label: '变量', tab: 'data', type: 'variables' },
      ], mount() {} }`,
      '保留名',
    )
    compileError(
      `return { apiVersion: 1, meta: { name: 'x' }, props: [
        { key: 'a', label: 'A', tab: 'other', type: 'number' },
      ], mount() {} }`,
      'tab 必须是 data、style 或 behavior',
    )
    compileError(
      `return { apiVersion: 1, meta: { name: 'x' }, props: [
        { key: 'a', label: 'A', tab: 'data', type: 'unknown' },
      ], mount() {} }`,
      'type 必须是',
    )
    compileError(
      `return { apiVersion: 1, meta: { name: 'x' }, props: [
        { key: 'a', label: 'A', tab: 'data', type: 'select' },
      ], mount() {} }`,
      'options 必须是数组',
    )
    compileError(
      `return { apiVersion: 1, meta: { name: 'x' }, props: [
        { key: 'a', label: 'A', tab: 'data', type: 'thresholds', default: [{ op: '~', value: 1, color: 'red' }] },
      ], mount() {} }`,
      'op 必须是',
    )
    compileError(
      `return { apiVersion: 1, meta: { name: 'x' }, props: [
        { key: 'a', label: 'A', tab: 'data', type: 'expression', default: 5 },
      ], mount() {} }`,
      'default 必须是字符串',
    )
  })

  it('validates nested itemFields and command defaults', () => {
    compileError(
      `return { apiVersion: 1, meta: { name: 'x' }, props: [
        { key: 'vars', label: '变量', tab: 'data', type: 'variables', itemFields: [
          { key: 'color', label: '颜色', tab: 'style', type: 'color' },
          { key: 'color', label: '颜色2', tab: 'style', type: 'color' },
        ] },
      ], mount() {} }`,
      'itemFields[1].key「color」重复',
    )
    compileError(
      `return { apiVersion: 1, meta: { name: 'x' }, props: [
        { key: 'cmd', label: '命令', tab: 'behavior', type: 'command', default: { kind: 'nope', source: 'main' } },
      ], mount() {} }`,
      'kind 必须是 template、protocol、signal 或 quick',
    )
  })
})

describe('createCallGuard', () => {
  it('passes through successful calls', () => {
    const guard = createCallGuard()
    expect(guard.call('mount', () => 42)).toBe(42)
    const instance = { destroy: vi.fn() }
    guard.attach(instance)
    guard.call('propsChanged', () => undefined)
    expect(guard.disabled).toBe(false)
    guard.destroy()
    expect(instance.destroy).toHaveBeenCalledTimes(1)
  })

  it('guards every lifecycle kind', () => {
    const guard = createCallGuard()
    const failing = (): never => {
      throw new Error('boom')
    }
    guard.call('mount', failing)
    guard.call('propsChanged', failing)
    guard.call('resize', failing)
    expect(guard.disabled).toBe(true)
    expect(guard.disabledReason?.reason).toBe('errors')
  })

  it('disables after three exceptions inside the 10 second window', () => {
    const clock = fakeClock()
    const errors: CallGuardErrorInfo[] = []
    const reasons: CallGuardDisabledReason[] = []
    const guard = createCallGuard({
      now: clock.now,
      onError: (info) => errors.push(info),
      onDisabled: (reason) => reasons.push(reason),
    })
    const failing = (): never => {
      throw new Error('boom')
    }
    guard.call('update', failing)
    clock.advance(100)
    guard.call('update', failing)
    expect(guard.disabled).toBe(false)
    clock.advance(100)
    guard.call('update', failing)
    expect(guard.disabled).toBe(true)
    expect(guard.disabledReason).toEqual({ reason: 'errors', count: 3, at: 200 })
    expect(errors).toHaveLength(3)
    expect(errors[2]?.count).toBe(3)
    expect(reasons).toEqual([{ reason: 'errors', count: 3, at: 200 }])
    expect(guard.lastError?.message).toBe('boom')

    const spy = vi.fn()
    expect(guard.call('update', spy)).toBeUndefined()
    expect(spy).not.toHaveBeenCalled()
  })

  it('does not accumulate exceptions spread further apart than the window', () => {
    const clock = fakeClock()
    const guard = createCallGuard({ now: clock.now })
    const failing = (): never => {
      throw new Error('boom')
    }
    guard.call('update', failing)
    clock.advance(10_001)
    guard.call('update', failing)
    clock.advance(10)
    guard.call('update', failing)
    expect(guard.disabled).toBe(false)
  })

  it('disables a single call that runs longer than 200ms', () => {
    const clock = fakeClock()
    const guard = createCallGuard({ now: clock.now })
    guard.call('update', () => clock.advance(250))
    expect(guard.disabled).toBe(true)
    expect(guard.disabledReason).toMatchObject({ reason: 'slowCall', durationMs: 250 })
  })

  it('disables when the average update duration over 2s exceeds 16ms', () => {
    const clock = fakeClock()
    const guard = createCallGuard({ now: clock.now })
    guard.call('update', () => clock.advance(10))
    clock.advance(10)
    guard.call('update', () => clock.advance(10))
    expect(guard.disabled).toBe(false)
    clock.advance(10)
    guard.call('update', () => clock.advance(30))
    expect(guard.disabled).toBe(true)
    const reason = guard.disabledReason
    expect(reason?.reason).toBe('slowAverage')
    if (reason?.reason === 'slowAverage') {
      expect(reason.averageMs).toBeGreaterThan(16)
      expect(reason.count).toBe(3)
    }
  })

  it('rate limits send to 50 calls per second per instance', async () => {
    const clock = fakeClock()
    const guard = createCallGuard({ now: clock.now })
    for (let index = 0; index < 50; index += 1) {
      await expect(guard.send(() => index)).resolves.toBe(index)
    }
    await expect(guard.send(() => 1)).rejects.toThrow('发送过于频繁')
    clock.advance(1000)
    await expect(guard.send(() => 'ok')).resolves.toBe('ok')
  })

  it('destroys the attached instance when disabled and only once', () => {
    const clock = fakeClock()
    const guard = createCallGuard({ now: clock.now })
    const destroy = vi.fn()
    guard.attach({ destroy })
    const failing = (): never => {
      throw new Error('boom')
    }
    for (let index = 0; index < 3; index += 1) guard.call('update', failing)
    expect(guard.disabled).toBe(true)
    expect(destroy).toHaveBeenCalledTimes(1)
    guard.destroy()
    expect(destroy).toHaveBeenCalledTimes(1)
  })

  it('swallows exceptions thrown by destroy and reports them', () => {
    const errors: CallGuardErrorInfo[] = []
    const guard = createCallGuard({ onError: (info) => errors.push(info) })
    guard.attach({
      destroy() {
        throw new Error('destroy failed')
      },
    })
    expect(() => guard.destroy()).not.toThrow()
    expect(errors.at(-1)?.kind).toBe('destroy')
    expect(errors.at(-1)?.message).toBe('destroy failed')
  })

  it('can be re-enabled and starts from a clean state', () => {
    const clock = fakeClock()
    let enabled = 0
    const guard = createCallGuard({
      now: clock.now,
      onEnabled: () => {
        enabled += 1
      },
    })
    const failing = (): never => {
      throw new Error('boom')
    }
    for (let index = 0; index < 3; index += 1) guard.call('update', failing)
    expect(guard.disabled).toBe(true)

    guard.reset()
    expect(guard.disabled).toBe(false)
    expect(guard.disabledReason).toBeUndefined()
    expect(guard.lastError).toBeUndefined()
    expect(enabled).toBe(1)
    expect(guard.call('update', () => 'again')).toBe('again')

    // 异常计数已清零：再出错两次不会立即停用。
    guard.call('update', failing)
    guard.call('update', failing)
    expect(guard.disabled).toBe(false)
  })
})

describe('safe mode', () => {
  it('writes and clears the pending marker synchronously', () => {
    const storage = storageStub()
    const mode = createSafeMode({ storage, now: () => 123, registerPageHide: false })
    mode.writePending('cw1', '姿态')
    expect(JSON.parse(storage.entries.get(SAFE_MODE_PENDING_KEY) ?? '')).toEqual({
      customId: 'cw1',
      name: '姿态',
      at: 123,
    })
    expect(mode.readPending()).toEqual({ customId: 'cw1', name: '姿态', at: 123 })
    mode.clearPending()
    expect(storage.entries.has(SAFE_MODE_PENDING_KEY)).toBe(false)
    expect(mode.readPending()).toBeNull()
  })

  it('moves a pending widget into blocked on startup and returns banner info', () => {
    const storage = storageStub()
    const mode = createSafeMode({ storage, registerPageHide: false })
    mode.writePending('cw1', '姿态')

    expect(mode.checkStartup()).toEqual({ customId: 'cw1', name: '姿态' })
    expect(storage.entries.has(SAFE_MODE_PENDING_KEY)).toBe(false)
    expect(mode.isBlocked('cw1')).toBe(true)
    expect(mode.listBlocked()).toEqual(['cw1'])
    expect(JSON.parse(storage.entries.get(SAFE_MODE_BLOCKED_KEY) ?? '')).toEqual(['cw1'])

    // 再次启动检查没有 pending，不再返回横幅信息。
    expect(mode.checkStartup()).toBeNull()
  })

  it('keeps existing blocked ids and does not duplicate', () => {
    const storage = storageStub()
    storage.setItem(SAFE_MODE_BLOCKED_KEY, JSON.stringify(['other', 'cw1']))
    const mode = createSafeMode({ storage, registerPageHide: false })
    mode.writePending('cw1', '姿态')
    expect(mode.checkStartup()?.customId).toBe('cw1')
    expect(mode.listBlocked()).toEqual(['other', 'cw1'])
  })

  it('drops a corrupt pending marker', () => {
    const storage = storageStub()
    storage.setItem(SAFE_MODE_PENDING_KEY, 'not json')
    const mode = createSafeMode({ storage, registerPageHide: false })
    expect(mode.checkStartup()).toBeNull()
    expect(storage.entries.has(SAFE_MODE_PENDING_KEY)).toBe(false)
    expect(mode.listBlocked()).toEqual([])
  })

  it('blocks, unblocks and lists widgets', () => {
    const storage = storageStub()
    const mode = createSafeMode({ storage, registerPageHide: false })
    expect(mode.isBlocked('a')).toBe(false)
    mode.block('a')
    mode.block('a')
    mode.block('b')
    expect(mode.listBlocked()).toEqual(['a', 'b'])
    expect(mode.isBlocked('a')).toBe(true)
    mode.unblock('a')
    expect(mode.listBlocked()).toEqual(['b'])
    mode.unblock('missing')
    expect(mode.listBlocked()).toEqual(['b'])
  })

  it('degrades gracefully without storage', () => {
    const mode = createSafeMode({ storage: null, registerPageHide: false })
    expect(() => mode.writePending('a', 'A')).not.toThrow()
    expect(mode.readPending()).toBeNull()
    expect(mode.checkStartup()).toBeNull()
    expect(mode.listBlocked()).toEqual([])
    expect(mode.isBlocked('a')).toBe(false)
    expect(() => mode.block('a')).not.toThrow()
  })

  it('recognises safe=1 in query strings and hash routes', () => {
    expect(isSafeModeUrl('?safe=1')).toBe(true)
    expect(isSafeModeUrl('#/tools/serial?safe=1')).toBe(true)
    expect(isSafeModeUrl('http://localhost:5173/#/tools/serial?safe=1')).toBe(true)
    expect(isSafeModeUrl('?safe=true')).toBe(true)
    expect(isSafeModeUrl('?safe=0')).toBe(false)
    expect(isSafeModeUrl('?foo=1&safe=1')).toBe(true)
    expect(isSafeModeUrl('?safe=1#/other')).toBe(true)
    expect(isSafeModeUrl('')).toBe(false)
    expect(isSafeModeUrl('#/tools/serial')).toBe(false)
  })

  it('disposes the pagehide listener without throwing', () => {
    const mode = createSafeMode({ storage: storageStub(), registerPageHide: false })
    expect(() => mode.dispose()).not.toThrow()
  })
})

describe('CUSTOM_WIDGET_TEMPLATES', () => {
  it('offers four compilable templates with comments', () => {
    expect(CUSTOM_WIDGET_TEMPLATES).toHaveLength(4)
    const ids = CUSTOM_WIDGET_TEMPLATES.map((template) => template.id)
    expect(new Set(ids).size).toBe(4)
    for (const template of CUSTOM_WIDGET_TEMPLATES) {
      expect(template.code).toContain('//')
      const result = compileCustomWidget(template.code)
      expect(result.ok, `${template.name} 编译失败：${result.ok ? '' : result.error}`).toBe(true)
      if (!result.ok) continue
      expect(result.definition.meta.name).toBe(template.name)
      expect(result.definition.mount).toBeTypeOf('function')
      expect(result.definition.size?.default).toBeDefined()
      expect(result.definition.size?.min).toBeDefined()
    }
  })

  it('declares the variables promised by each template', () => {
    const compiled = CUSTOM_WIDGET_TEMPLATES.map((template) => compileCustomWidget(template.code))
    const variables = compiled.map((result) =>
      result.ok ? result.definition.variables : undefined,
    )
    expect(variables[0]).toEqual({ min: 1, max: 1 })
    expect(variables[1]).toEqual({ min: 1, max: 1 })
    expect(variables[2]).toBeUndefined()
    expect(variables[3]).toEqual({ min: 2, max: 2 })
  })
})
