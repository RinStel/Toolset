import { describe, expect, it } from 'vitest'

import {
  PRESET_DEFERRED_MESSAGE,
  PRESET_EXPORT_FILE_NAME,
  createPresetStore,
  type PresetApplyTarget,
  type PresetInput,
} from '../../../src/domains/link/presets/presets'
import {
  MAX_DEVICE_MEMORIES,
  createDeviceMemoryStore,
} from '../../../src/domains/link/presets/devices'
import { DEFAULT_LOG_POLICY, type LogPolicy } from '../../../src/domains/link/log/policy'
import { defaultComposeOptions, type ComposeOptions } from '../../../src/domains/link/send/compose'
import type { RxOptions } from '../../../src/domains/link/session/rx-framer'
import type { DisplayMode, SessionState } from '../../../src/domains/link/session/state'

const RX_OPTIONS: RxOptions = { framing: 'idle', idleMs: 30, encoding: 'gbk' }
const COMPOSE: ComposeOptions = { ...defaultComposeOptions(), mode: 'hex', eol: 'lf' }

function presetInput(overrides: Partial<PresetInput> = {}): PresetInput {
  return {
    name: '预设 1',
    providerKind: 'virtual',
    settings: { interval: 500 },
    protocolId: 'builtin:sensor-a5',
    rxOptions: { ...RX_OPTIONS },
    displayMode: 'decoded',
    compose: { ...COMPOSE },
    quickGroupId: null,
    ...overrides,
  }
}

class FakeTarget implements PresetApplyTarget {
  providerKind = 'virtual'
  state: SessionState = 'idle'
  rxOptions: RxOptions = { framing: 'line', idleMs: 20, encoding: 'utf-8' }
  displayMode: DisplayMode = 'both'
  compose: ComposeOptions = defaultComposeOptions()
  logPolicy: LogPolicy = { ...DEFAULT_LOG_POLICY }
  extras: Record<string, unknown> = {}

  updateCalls: Array<Record<string, unknown>> = []
  stageCalls: Array<Record<string, unknown>> = []
  protocols: Array<string | null> = []

  updateSettings(patch: Record<string, unknown>): void {
    this.updateCalls.push(patch)
  }

  stageSettings(patch: Record<string, unknown>): void {
    this.stageCalls.push(patch)
  }

  async setProtocol(id: string | null): Promise<void> {
    this.protocols.push(id)
  }
}

describe('preset store', () => {
  it('saves, lists, updates and removes presets', () => {
    const store = createPresetStore()
    const first = store.save(presetInput())
    expect(store.list()).toHaveLength(1)
    expect(store.get(first.id)?.name).toBe('预设 1')

    const second = store.save(presetInput({ name: '预设 2', providerKind: 'web-serial' }))
    const updated = store.save({ ...presetInput(), id: second.id, name: '改名' })
    expect(updated.id).toBe(second.id)
    expect(store.list().map((preset) => preset.name)).toEqual(['预设 1', '改名'])

    expect(store.remove(first.id)).toBe(true)
    expect(store.remove(first.id)).toBe(false)
    expect(store.list().map((preset) => preset.name)).toEqual(['改名'])
  })

  it('emits change events', () => {
    const store = createPresetStore()
    const changes: number[] = []
    store.on('change', (presets) => changes.push(presets.length))
    store.save(presetInput())
    expect(changes).toEqual([1])
  })

  it('exports toolset-presets.json and merges imports by id', () => {
    const store = createPresetStore()
    const first = store.save(presetInput({ name: '导出预设' }))
    const file = store.exportFile()
    expect(file.fileName).toBe(PRESET_EXPORT_FILE_NAME)
    expect(JSON.parse(file.text).presets).toHaveLength(1)

    const target = createPresetStore()
    const payload = {
      version: 1,
      presets: [
        { ...presetInput({ name: '新预设' }), id: 'p-new' },
        { ...presetInput(), id: first.id, name: '导入覆盖' },
      ],
    }
    const result = target.importJson(JSON.stringify(payload))
    expect(result).toEqual({ ok: true, added: 2, updated: 0 })
    expect(target.list().map((preset) => preset.name)).toEqual(['新预设', '导入覆盖'])

    const secondImport = target.importJson(file.text)
    expect(secondImport).toEqual({ ok: true, added: 0, updated: 1 })
    expect(target.list().map((preset) => preset.name)).toEqual(['新预设', '导出预设'])
  })

  it('rejects malformed preset files', () => {
    const store = createPresetStore()
    const invalidJson = store.importJson('{oops')
    expect(invalidJson.ok).toBe(false)
    if (invalidJson.ok) return
    expect(invalidJson.error).toContain('不是合法的 JSON')

    const wrongShape = store.importJson('{"foo":1}')
    expect(wrongShape.ok).toBe(false)

    const invalidItem = store.importJson('{"presets":[{"id":"x"}]}')
    expect(invalidItem.ok).toBe(false)
    if (invalidItem.ok) return
    expect(invalidItem.error).toContain('第 1 项无效')
  })

  it('applies everything immediately when the session is not open', async () => {
    const store = createPresetStore()
    const preset = store.save(presetInput())
    const target = new FakeTarget()

    const result = await store.apply(preset, target)
    expect(result).toEqual({ ok: true, deferred: false })
    expect(target.updateCalls).toEqual([{ interval: 500 }])
    expect(target.stageCalls).toEqual([])
    expect(target.protocols).toEqual(['builtin:sensor-a5'])
    expect(target.rxOptions).toEqual(RX_OPTIONS)
    expect(target.displayMode).toBe('decoded')
    expect(target.compose).toEqual(COMPOSE)
    expect(target.logPolicy).toEqual({ ...DEFAULT_LOG_POLICY })
    expect(target.extras).toEqual({})
  })

  it('defers connection settings while open and still applies protocol/rx/display/compose', async () => {
    const store = createPresetStore()
    const preset = store.save(presetInput())
    const target = new FakeTarget()
    target.state = 'open'

    const result = await store.apply(preset, target)
    expect(result).toEqual({
      ok: true,
      deferred: true,
      message: PRESET_DEFERRED_MESSAGE,
    })
    expect(target.updateCalls).toEqual([])
    expect(target.stageCalls).toEqual([{ interval: 500 }])
    expect(target.protocols).toEqual(['builtin:sensor-a5'])
    expect(target.rxOptions).toEqual(RX_OPTIONS)
    expect(target.displayMode).toBe('decoded')
    expect(target.compose).toEqual(COMPOSE)
    expect(target.logPolicy).toEqual({ ...DEFAULT_LOG_POLICY })
    expect(target.extras).toEqual({})
  })

  it('rejects presets of another provider kind', async () => {
    const store = createPresetStore()
    const preset = store.save(presetInput({ providerKind: 'web-serial' }))
    const target = new FakeTarget()
    const result = await store.apply(preset, target)
    expect(result).toEqual({ ok: false, error: '预设只能套用到相同类型的通道' })
    expect(target.updateCalls).toEqual([])
    expect(target.stageCalls).toEqual([])
  })

  it('stores logPolicy and extras and applies them to the target', async () => {
    const store = createPresetStore()
    const preset = store.save(
      presetInput({
        logPolicy: { mode: 'sampled', maxPerSecond: 5, auto: false },
        extras: { dashboardId: 'd1' },
      }),
    )
    expect(preset.logPolicy).toEqual({ mode: 'sampled', maxPerSecond: 5, auto: false })
    expect(preset.extras).toEqual({ dashboardId: 'd1' })

    const target = new FakeTarget()
    target.state = 'open'
    const result = await store.apply(preset, target)
    expect(result.ok && result.deferred).toBe(true)
    expect(target.logPolicy).toEqual({ mode: 'sampled', maxPerSecond: 5, auto: false })
    expect(target.extras).toEqual({ dashboardId: 'd1' })
  })

  it('applies the preset log policy verbatim through applyLogPolicy (keeps auto)', async () => {
    class PolicyTarget extends FakeTarget {
      applied: LogPolicy[] = []

      applyLogPolicy(policy: LogPolicy): void {
        this.applied.push(policy)
        this.logPolicy = policy
      }
    }
    const store = createPresetStore()
    const preset = store.save(
      presetInput({ logPolicy: { mode: 'sampled', maxPerSecond: 3, auto: true } }),
    )
    const target = new PolicyTarget()
    const result = await store.apply(preset, target)
    expect(result.ok).toBe(true)
    expect(target.applied).toHaveLength(1)
    expect(target.logPolicy).toEqual({ mode: 'sampled', maxPerSecond: 3, auto: true })
  })

  it('fills defaults for presets saved before logPolicy/extras existed', () => {
    const store = createPresetStore()
    // Legacy presets have neither `logPolicy` nor `extras`.
    const legacy = { ...presetInput({ name: '旧预设' }), id: 'legacy' }
    const result = store.importJson(JSON.stringify({ version: 1, presets: [legacy] }))
    expect(result).toEqual({ ok: true, added: 1, updated: 0 })
    expect(store.get('legacy')?.logPolicy).toEqual({ ...DEFAULT_LOG_POLICY })
    expect(store.get('legacy')?.extras).toEqual({})
  })

  it('exports logPolicy and extras in toolset-presets.json', () => {
    const store = createPresetStore()
    store.save(
      presetInput({
        logPolicy: { mode: 'none', maxPerSecond: 20, auto: false },
        extras: { dashboardId: 'd2' },
      }),
    )
    const parsed = JSON.parse(store.exportFile().text) as {
      presets: Array<{ logPolicy: LogPolicy; extras: Record<string, unknown> }>
    }
    expect(parsed.presets[0]?.logPolicy).toEqual({ mode: 'none', maxPerSecond: 20, auto: false })
    expect(parsed.presets[0]?.extras).toEqual({ dashboardId: 'd2' })
  })
})

describe('device memory store', () => {
  function memoryRecord(deviceKey: string, updatedAt: number) {
    return {
      deviceKey,
      settings: { baudRate: 9600 },
      protocolId: null,
      rxOptions: { ...RX_OPTIONS },
      displayMode: 'both' as DisplayMode,
      updatedAt,
    }
  }

  it('keeps at most 50 records and evicts the least recently used', () => {
    const store = createDeviceMemoryStore()
    for (let index = 0; index < MAX_DEVICE_MEMORIES + 1; index += 1) {
      store.save(memoryRecord(`device-${index}`, index))
    }
    expect(store.list()).toHaveLength(MAX_DEVICE_MEMORIES)
    expect(store.get('device-0')).toBeUndefined()
    expect(store.get('device-1')).toBeDefined()
    expect(store.list()[0]?.deviceKey).toBe(`device-${MAX_DEVICE_MEMORIES}`)
  })

  it('updates an existing record and moves it to the front', () => {
    const store = createDeviceMemoryStore()
    store.save(memoryRecord('a', 1))
    store.save(memoryRecord('b', 2))
    store.save({ ...memoryRecord('a', 3), displayMode: 'raw' })

    expect(store.list()).toHaveLength(2)
    expect(store.list()[0]?.deviceKey).toBe('a')
    expect(store.get('a')?.displayMode).toBe('raw')
  })

  it('removes and clears records and emits changes', () => {
    const store = createDeviceMemoryStore()
    const changes: number[] = []
    store.onChange((records) => changes.push(records.length))
    store.save(memoryRecord('a', 1))
    expect(store.remove('a')).toBe(true)
    expect(store.remove('a')).toBe(false)
    store.save(memoryRecord('b', 2))
    store.clear()
    expect(store.list()).toEqual([])
    expect(changes).toEqual([1, 0, 1, 0])
  })
})
