/**
 * 设备级组包选项记忆。
 *
 * `domains/link` 的设备记忆只保存连接参数、协议、接收分帧与显示模式（见
 * `DeviceMemory`），没有 `compose` 字段，而预设/设备记忆又需要恢复组包选项。
 * 因此串口工具在 `toolset/tool/serial/device-compose.v1` 里按 `deviceKey` 额外
 * 记录一份组包选项；打开设备时优先使用它。
 *
 * 这是工具层的补充存储，不修改领域接口；如后续领域扩展 `DeviceMemory`，应改为
 * 直接使用领域记忆。
 */

import { reactive, readonly } from 'vue'

import type { ComposeOptions } from '@/domains/link/public'
import { createToolStorage } from '@/shared/lib/storage/namespace'

import { normalizeComposeOptions } from '../composables/composeOptions'

/** deviceKey → 组包选项。 */
export type DeviceComposeMap = Record<string, ComposeOptions>

/** 最多保存的设备数，与领域设备记忆的 LRU 上限一致。 */
const MAX_DEVICES = 50

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function normalizeMap(raw: unknown): DeviceComposeMap {
  if (!isRecord(raw)) return {}
  const map: DeviceComposeMap = {}
  let count = 0
  for (const [key, value] of Object.entries(raw)) {
    if (count >= MAX_DEVICES) break
    if (key.length === 0) continue
    map[key] = normalizeComposeOptions(isRecord(value) ? (value as Partial<ComposeOptions>) : {})
    count += 1
  }
  return map
}

const store = createToolStorage('serial').local<DeviceComposeMap>('device-compose', {
  version: 1,
  defaults: () => ({}),
  migrate: (raw) => normalizeMap(raw),
})

const state = reactive<DeviceComposeMap>(normalizeMap(store.get()))

store.subscribe((value) => {
  for (const key of Object.keys(state)) delete state[key]
  Object.assign(state, normalizeMap(value))
})

/** 当前设备组包记忆（只读）。 */
export const deviceComposeMap = readonly(state)

/** 读取一个设备的组包选项。 */
export function getDeviceCompose(deviceKey: string): ComposeOptions | undefined {
  if (deviceKey.length === 0) return undefined
  const value = state[deviceKey]
  return value === undefined ? undefined : { ...value }
}

/** 记录一个设备的组包选项。 */
export function saveDeviceCompose(deviceKey: string, compose: ComposeOptions): void {
  if (deviceKey.length === 0) return
  const next: DeviceComposeMap = { ...state, [deviceKey]: normalizeComposeOptions(compose) }
  const keys = Object.keys(next)
  // 简单 LRU：超出上限时删除最早插入的键（对象键顺序即插入顺序）。
  while (keys.length > MAX_DEVICES) {
    const oldest = keys.shift()
    if (oldest !== undefined) delete next[oldest]
  }
  for (const key of Object.keys(state)) delete state[key]
  Object.assign(state, next)
  store.set(next)
}
