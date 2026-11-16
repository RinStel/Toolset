/**
 * Demo port provider (plan §6.6 / §8.7).
 *
 * Demo ports are created on demand and never persisted; every instance gets an
 * incrementing label and shares the `virtual` device key.
 */

import type { SettingField } from '../../../../shared/contracts/settings'
import type { TransportProvider } from '../../transport/types'
import {
  DEMO_CHANNELS_DEFAULT,
  DEMO_CHANNELS_MAX,
  DEMO_CHANNELS_MIN,
  DEMO_FORMAT_DEFAULT,
  DEMO_INTERVAL_DEFAULT,
  DEMO_INTERVAL_MAX,
  DEMO_INTERVAL_MIN,
  VirtualTransport,
} from './device'

let createdCount = 0

/** Format options shown by the settings form (labels from plan §6.5 / §6.6). */
export const DEMO_FORMAT_OPTIONS = [
  { label: '传感器帧（A5 5A）', value: 'sensor-a5' },
  { label: 'FireWater（VOFA+）', value: 'firewater' },
  { label: 'JustFloat（VOFA+）', value: 'justfloat' },
  { label: '键值文本', value: 'kv-text' },
] as const

const VIRTUAL_SETTINGS_SCHEMA: SettingField[] = [
  {
    key: 'format',
    label: '数据格式',
    type: 'select',
    options: DEMO_FORMAT_OPTIONS.map((option) => ({ ...option })),
    default: DEMO_FORMAT_DEFAULT,
  },
  {
    key: 'interval',
    label: '上报间隔',
    type: 'number',
    min: DEMO_INTERVAL_MIN,
    max: DEMO_INTERVAL_MAX,
    step: 1,
    default: DEMO_INTERVAL_DEFAULT,
    unit: 'ms',
    hint: '传感器帧格式最小 100ms；其他格式切换到 10ms',
  },
  {
    key: 'channels',
    label: '变量数',
    type: 'number',
    min: DEMO_CHANNELS_MIN,
    max: DEMO_CHANNELS_MAX,
    step: 1,
    default: DEMO_CHANNELS_DEFAULT,
    hint: '仅 FireWater 和 JustFloat 格式生效',
  },
]

/** Creates the next demo port, labelled 「演示端口 N」. */
export function createVirtualTransport(): VirtualTransport {
  createdCount += 1
  return new VirtualTransport(`演示端口 ${createdCount}`)
}

/** Provider for demo ports. */
export const provider: TransportProvider = {
  kind: 'virtual',
  title: '演示端口',
  addLabel: '新增演示端口',
  order: 10,

  isSupported() {
    return { ok: true }
  },

  async request() {
    return createVirtualTransport()
  },

  async listAuthorized() {
    return []
  },

  settingsSchema: VIRTUAL_SETTINGS_SCHEMA,

  defaultSettings() {
    return {
      format: DEMO_FORMAT_DEFAULT,
      interval: DEMO_INTERVAL_DEFAULT,
      channels: DEMO_CHANNELS_DEFAULT,
    }
  },
}
