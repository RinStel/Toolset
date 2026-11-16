// @vitest-environment happy-dom
import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import { defineComponent, h, type PropType } from 'vue'

import type { VarRef } from '@/domains/dashboard/public'
import type {
  DashboardRuntime,
  DashboardSourceState,
  DashboardVariableMeta,
  WidgetFrameUpdate,
} from '@/tools/serial/dashboard/runtime/context'
import { DASHBOARD_RUNTIME_KEY } from '@/tools/serial/dashboard/runtime/injection-keys'
import {
  useWidgetData,
  type WidgetData,
  type WidgetDataOptions,
} from '@/tools/serial/dashboard/runtime/useWidgetData'

interface ReadCall {
  ref: VarRef
  query: unknown
}

/**
 * 一个只记录调用的假运行时：`read()` 返回按游标递增的 1 点切片，
 * `metaVersion` 可选以验证「运行时未提供版本」的兼容路径。
 */
function createRuntime(options: { withMetaVersion?: boolean } = {}): {
  runtime: DashboardRuntime
  reads: ReadCall[]
  metaCalls: VarRef[]
  latestCalls: VarRef[]
  emit(update: Partial<WidgetFrameUpdate>): void
} {
  const reads: ReadCall[] = []
  const metaCalls: VarRef[] = []
  const latestCalls: VarRef[] = []
  const subscriptions = new Set<{
    refs: () => readonly VarRef[]
    callback: (update: WidgetFrameUpdate) => void
  }>()
  let counter = 0
  let metaVersion = 0

  const meta = (ref: VarRef): DashboardVariableMeta => {
    metaCalls.push(ref)
    return {
      source: ref.source,
      key: ref.key,
      label: ref.key,
      unit: '',
      color: 'var(--series-1)',
      decimals: 2,
      scale: 1,
      offset: 0,
      computed: false,
    }
  }

  const latest = new Map<string, number | undefined>()

  const runtime: DashboardRuntime = {
    paneIndex: 0,
    mode: 'run',
    dashboard: () => null,
    defaultAlias: () => 'main',
    sourceState: (): DashboardSourceState => 'open',
    isSourceOpen: () => true,
    isSourceBound: () => true,
    session: () => undefined,
    series: () => undefined,
    variables: () => [],
    meta,
    rawLatest: (ref) => latest.get(ref.key),
    displayValue: (ref) => {
      latestCalls.push(ref)
      return latest.get(ref.key)
    },
    read: (ref, query) => {
      reads.push({ ref, query })
      counter += 1
      const id = counter
      return {
        idx: Float64Array.of(id),
        t: Float64Array.of(id),
        v: Float64Array.of(latest.get(ref.key) ?? 0),
      }
    },
    theme: () => '',
    onThemeChange: () => () => {},
    send: async () => 'sent',
    sendBytes: async () => 'sent',
    sendQuickItem: async () => 'sent',
    subscribeFrame: (refs, callback) => {
      const subscription = { refs, callback }
      subscriptions.add(subscription)
      return () => {
        subscriptions.delete(subscription)
      }
    },
    requestUpdate: () => {},
    tick: () => 0,
    syncComputed: () => {},
    boundAliases: () => ['main'],
    ...(options.withMetaVersion ? { metaVersion: () => metaVersion } : {}),
  }

  return {
    runtime,
    reads,
    metaCalls,
    latestCalls,
    emit: (update) => {
      if (update.metaVersion !== undefined) metaVersion = update.metaVersion
      for (const subscription of subscriptions) {
        const refs = subscription.refs()
        subscription.callback({
          now: update.now ?? 0,
          refs,
          latest: update.latest ?? refs.map((ref) => latest.get(ref.key)),
          changedAliases: update.changedAliases ?? ['main'],
          ...(update.metaVersion === undefined ? {} : { metaVersion: update.metaVersion }),
        })
      }
    },
  }
}

const REFS: readonly VarRef[] = [
  { source: 'main', key: 'ch0' },
  { source: 'main', key: 'ch1' },
]

function mountWidgetData(
  runtime: DashboardRuntime,
  options: WidgetDataOptions,
  refs: readonly VarRef[] = REFS,
): WidgetData {
  let data: WidgetData | null = null
  const Host = defineComponent({
    props: {
      refs: {
        type: Array as PropType<readonly VarRef[]>,
        required: true,
      },
    },
    setup(props) {
      data = useWidgetData(() => props.refs, options)
      return () => h('div')
    },
  })

  mount(Host, {
    props: { refs },
    global: { provide: { [DASHBOARD_RUNTIME_KEY]: runtime } },
  })

  if (data === null) throw new Error('useWidgetData 未初始化')
  return data
}

describe('useWidgetData 性能契约', () => {
  it('未访问 slices/appended 时不读取 series（惰性）', () => {
    const fake = createRuntime()
    const data = mountWidgetData(fake.runtime, { history: { last: 100 } })
    expect(fake.reads.length).toBe(0)

    fake.emit({ now: 1000, latest: [1, 2] })
    expect(fake.reads.length).toBe(0)
    expect(data.latest.value).toEqual([1, 2])
  })

  it('historyRefreshMs 内重复访问返回同一缓存，超过间隔才重新读取', () => {
    const fake = createRuntime()
    const data = mountWidgetData(fake.runtime, {
      history: { last: 100 },
      historyRefreshMs: 100,
    })
    fake.emit({ now: 1000, latest: [1, 2] })
    const first = data.slices.value
    expect(first.length).toBe(2)
    expect(fake.reads.length).toBe(2)

    fake.emit({ now: 1050, latest: [3, 4] })
    expect(data.slices.value).toBe(first)
    expect(fake.reads.length).toBe(2)

    fake.emit({ now: 1120, latest: [5, 6] })
    expect(data.slices.value).not.toBe(first)
    expect(fake.reads.length).toBe(4)
  })

  it('appended 只在实际访问时读取，并推进 sinceIdx 游标', () => {
    const fake = createRuntime()
    const data = mountWidgetData(fake.runtime, { maxAppended: 32 })
    fake.emit({ now: 1000, latest: [1, 2] })
    expect(fake.reads.length).toBe(0)

    void data.appended.value
    expect(fake.reads.length).toBe(2)
    expect(fake.reads[0]?.query).toEqual({ sinceIdx: 0, limit: 32 })

    fake.emit({ now: 1034, latest: [3, 4] })
    void data.appended.value
    expect(fake.reads.length).toBe(4)
    // 第一次访问后游标推进到 fake 返回的 idx（1），第二次从 2 开始。
    expect(fake.reads[2]?.query).toEqual({ sinceIdx: 2, limit: 32 })
  })

  it('元信息只在 metaVersion 变化时重新解析（数据帧不触发）', () => {
    const fake = createRuntime({ withMetaVersion: true })
    const data = mountWidgetData(fake.runtime, { history: { last: 10 } })
    expect(data.variables.value.map((item) => item.label)).toEqual(['ch0', 'ch1'])
    const callsAfterFirst = fake.metaCalls.length

    fake.emit({ now: 1000, latest: [1, 2], metaVersion: 0 })
    void data.variables.value
    expect(fake.metaCalls.length).toBe(callsAfterFirst)

    fake.emit({ now: 2000, latest: [3, 4], metaVersion: 1 })
    void data.variables.value
    expect(fake.metaCalls.length).toBe(callsAfterFirst + 2)
  })

  it('运行时未提供 metaVersion 时保持兼容（每帧不重算元信息）', () => {
    const fake = createRuntime()
    const data = mountWidgetData(fake.runtime, { history: { last: 10 } })
    void data.variables.value
    const callsAfterFirst = fake.metaCalls.length
    fake.emit({ now: 1000, latest: [1, 2] })
    void data.variables.value
    expect(fake.metaCalls.length).toBe(callsAfterFirst)
  })
})
