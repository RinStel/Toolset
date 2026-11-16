import { describe, expect, it } from 'vitest'
import type { Component } from 'vue'
import type { ToolManifest, ToolRoutes } from '@/shared/contracts/tool'

import { buildRegistry } from '@/app/registry/validate'

const icon = { name: 'FakeIcon' } as unknown as Component
const view = { name: 'FakeView' } as unknown as Component

function makeManifest(id: string, overrides: Partial<ToolManifest> = {}): ToolManifest {
  return {
    id,
    title: `工具-${id}`,
    summary: `摘要-${id}`,
    category: 'other',
    icon,
    layout: 'page',
    ...overrides,
  }
}

function makeRoutes(path = ''): ToolRoutes {
  return [{ path, component: view } as unknown as ToolRoutes[number]]
}

function manifestMap(entries: Record<string, ToolManifest>): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(entries).map(([directory, manifest]) => [
      `/src/tools/${directory}/manifest.ts`,
      manifest,
    ]),
  )
}

function routeMap(entries: Record<string, ToolRoutes>): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(entries).map(([directory, routes]) => [
      `/src/tools/${directory}/routes.ts`,
      routes,
    ]),
  )
}

function collectErrors() {
  const errors: string[] = []
  return { errors, onError: (message: string) => errors.push(message) }
}

describe('buildRegistry', () => {
  it('跳过只有 manifest、没有 routes 的工具', () => {
    const { errors, onError } = collectErrors()
    const result = buildRegistry(manifestMap({ probe: makeManifest('probe') }), routeMap({}), {
      onError,
    })
    expect(result.tools).toHaveLength(0)
    expect(result.routes).toHaveLength(0)
    expect(errors.some((message) => message.includes('缺少 routes.ts'))).toBe(true)
  })

  it('跳过只有 routes、没有 manifest 的工具', () => {
    const { errors, onError } = collectErrors()
    const result = buildRegistry(manifestMap({}), routeMap({ probe: makeRoutes() }), { onError })
    expect(result.tools).toHaveLength(0)
    expect(errors.some((message) => message.includes('缺少 manifest.ts'))).toBe(true)
  })

  it('开发模式对成对检查失败抛出错误', () => {
    expect(() =>
      buildRegistry(manifestMap({ probe: makeManifest('probe') }), {}, { dev: true }),
    ).toThrow(/缺少 routes\.ts/)
  })

  it('id 与目录名不一致时跳过工具', () => {
    const { errors, onError } = collectErrors()
    const result = buildRegistry(
      manifestMap({ probe: makeManifest('other') }),
      routeMap({ probe: makeRoutes() }),
      { onError },
    )
    expect(result.tools).toHaveLength(0)
    expect(errors.some((message) => message.includes('目录名不一致'))).toBe(true)
  })

  it('id 不符合命名规则时跳过工具', () => {
    const { errors, onError } = collectErrors()
    const result = buildRegistry(
      manifestMap({ Probe: makeManifest('Probe') }),
      routeMap({ Probe: makeRoutes() }),
      { onError },
    )
    expect(result.tools).toHaveLength(0)
    expect(errors.some((message) => message.includes('id 不合法'))).toBe(true)
  })

  it('重复 id 只保留一个并报错', () => {
    const { errors, onError } = collectErrors()
    const result = buildRegistry(
      {
        '/src/tools/probe/manifest.ts': makeManifest('probe'),
        'src/tools/probe/manifest.ts': makeManifest('probe'),
      },
      routeMap({ probe: makeRoutes() }),
      { onError },
    )
    expect(result.tools).toHaveLength(0)
    expect(errors.some((message) => message.includes('重复'))).toBe(true)
  })

  it('开发模式对重复 id 抛出错误', () => {
    expect(() =>
      buildRegistry(
        {
          '/src/tools/probe/manifest.ts': makeManifest('probe'),
          'src/tools/probe/manifest.ts': makeManifest('probe'),
        },
        routeMap({ probe: makeRoutes() }),
        { dev: true },
      ),
    ).toThrow(/重复/)
  })

  it('非法 layout 时跳过工具', () => {
    const { errors, onError } = collectErrors()
    const invalid = { ...makeManifest('probe'), layout: 'grid' } as unknown as ToolManifest
    const result = buildRegistry(
      manifestMap({ probe: invalid }),
      routeMap({ probe: makeRoutes() }),
      { onError },
    )
    expect(result.tools).toHaveLength(0)
    expect(errors.some((message) => message.includes('layout'))).toBe(true)
  })

  it('未知分类回退到 other 并给出警告', () => {
    const result = buildRegistry(
      manifestMap({ mystery: makeManifest('mystery', { category: 'unknown' }) }),
      routeMap({ mystery: makeRoutes() }),
    )
    expect(result.tools).toHaveLength(1)
    expect(result.tools[0]?.category).toBe('other')
    expect(result.warnings.some((warning) => warning.includes('未知分类'))).toBe(true)
  })

  it('routes 的 path 不得以 / 开头', () => {
    const { errors, onError } = collectErrors()
    const result = buildRegistry(
      manifestMap({ probe: makeManifest('probe') }),
      routeMap({ probe: makeRoutes('/sub') }),
      { onError },
    )
    expect(result.tools).toHaveLength(0)
    expect(errors.some((message) => message.includes('不得以 / 开头'))).toBe(true)
  })

  it('按分类 order、工具 order（默认 100）、标题排序', () => {
    const result = buildRegistry(
      manifestMap({
        'comm-late': makeManifest('comm-late', {
          title: '通信晚',
          category: 'comm',
          order: 20,
        }),
        'comm-default': makeManifest('comm-default', {
          title: '通信默认',
          category: 'comm',
          order: 100,
        }),
        'comm-early': makeManifest('comm-early', {
          title: '通信早',
          category: 'comm',
          order: 10,
        }),
        'comm-alpha': makeManifest('comm-alpha', {
          title: 'Alpha',
          category: 'comm',
          order: 30,
        }),
        'comm-beta': makeManifest('comm-beta', {
          title: 'Beta',
          category: 'comm',
          order: 30,
        }),
        'calc-only': makeManifest('calc-only', { title: '计算', category: 'calc', order: 1 }),
        'other-only': makeManifest('other-only', { title: '其他', category: 'other' }),
      }),
      routeMap({
        'comm-late': makeRoutes(),
        'comm-default': makeRoutes(),
        'comm-early': makeRoutes(),
        'comm-alpha': makeRoutes(),
        'comm-beta': makeRoutes(),
        'calc-only': makeRoutes(),
        'other-only': makeRoutes(),
      }),
    )

    expect(result.tools.map((tool) => tool.id)).toEqual([
      'comm-early',
      'comm-late',
      'comm-alpha',
      'comm-beta',
      'comm-default',
      'calc-only',
      'other-only',
    ])
  })

  it('导出的 routes 与 tools 顺序一致', () => {
    const result = buildRegistry(
      manifestMap({
        b: makeManifest('b', { category: 'calc', title: 'B' }),
        a: makeManifest('a', { category: 'comm', title: 'A' }),
      }),
      routeMap({ a: makeRoutes(), b: makeRoutes() }),
    )
    expect(result.tools.map((tool) => tool.id)).toEqual(['a', 'b'])
    expect(result.routes.map((registration) => registration.tool.id)).toEqual(['a', 'b'])
  })
})
