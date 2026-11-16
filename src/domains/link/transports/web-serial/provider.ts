/**
 * Web Serial provider (plan §6.6).
 *
 * The settings schema mirrors the Web Serial options table from the plan:
 * baudRate (custom allowed), dataBits, stopBits, parity, flowControl and the
 * advanced `bufferSize` extension.
 */

import type { SettingField } from '../../../../shared/contracts/settings'
import { webSerialSupport } from '../../../../shared/lib/support'
import type { TransportProvider, TransportSupport } from '../../transport/types'
import { getSerialApi, WebSerialTransport } from './transport'

/** Web Serial baud rates offered by the UI (custom values allowed). */
export const BAUDRATE_OPTIONS = [
  300, 1200, 2400, 4800, 9600, 19200, 38400, 57600, 115200, 230400, 460800, 921600, 1000000,
  1500000, 2000000,
] as const

/** Localized support reasons from plan §9. */
export const SERIAL_SUPPORT_REASONS = {
  insecure: '当前页面不是安全上下文（需要 HTTPS 或 localhost），无法使用串口。演示端口仍可使用。',
  unsupported:
    '当前浏览器不支持 Web Serial。请使用 Chrome、Edge 89+ 或 Firefox 151+ 桌面版。演示端口仍可使用。',
} as const

const SERIAL_SETTINGS_SCHEMA: SettingField[] = [
  {
    key: 'baudRate',
    label: '波特率',
    type: 'select',
    allowCustom: true,
    min: 1,
    max: 20_000_000,
    step: 1,
    default: 115200,
    options: BAUDRATE_OPTIONS.map((value) => ({ label: String(value), value })),
  },
  {
    key: 'dataBits',
    label: '数据位',
    type: 'select',
    default: 8,
    options: [
      { label: '7', value: 7 },
      { label: '8', value: 8 },
    ],
  },
  {
    key: 'stopBits',
    label: '停止位',
    type: 'select',
    default: 1,
    options: [
      { label: '1', value: 1 },
      { label: '2', value: 2 },
    ],
  },
  {
    key: 'parity',
    label: '校验位',
    type: 'select',
    default: 'none',
    options: [
      { label: '无', value: 'none' },
      { label: '偶校验', value: 'even' },
      { label: '奇校验', value: 'odd' },
    ],
  },
  {
    key: 'flowControl',
    label: '流控',
    type: 'select',
    default: 'none',
    options: [
      { label: '无', value: 'none' },
      { label: '硬件（RTS/CTS）', value: 'hardware' },
    ],
  },
  {
    key: 'bufferSize',
    label: '缓冲区大小',
    type: 'number',
    advanced: true,
    min: 255,
    max: 16_777_216,
    step: 1,
    default: 255,
    hint: '读取缓冲区字节数，仅 Chrome/Edge 支持',
  },
]

function checkSupport(): TransportSupport {
  const support = webSerialSupport()
  if (support.ok) return { ok: true }
  return { ok: false, reason: SERIAL_SUPPORT_REASONS[support.reason] }
}

function isNotFoundError(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    (error as { name?: unknown }).name === 'NotFoundError'
  )
}

/** Provider for real serial ports. */
export const provider: TransportProvider = {
  kind: 'web-serial',
  title: '串口',
  addLabel: '新增串口',
  order: 0,

  isSupported: checkSupport,

  async request() {
    const serial = getSerialApi()
    if (!serial) return null
    try {
      const port = await serial.requestPort()
      return new WebSerialTransport(port)
    } catch (error) {
      // Cancelling the picker is not an error (plan §9).
      if (isNotFoundError(error)) return null
      throw error
    }
  },

  async listAuthorized() {
    const serial = getSerialApi()
    if (!serial) return []
    try {
      const ports = await serial.getPorts()
      return ports.map((port) => new WebSerialTransport(port))
    } catch {
      return []
    }
  },

  onAvailabilityChange(callback: () => void): () => void {
    const serial = getSerialApi()
    if (!serial || typeof serial.addEventListener !== 'function') return () => {}
    serial.addEventListener('connect', callback)
    serial.addEventListener('disconnect', callback)
    return () => {
      serial.removeEventListener('connect', callback)
      serial.removeEventListener('disconnect', callback)
    }
  },

  settingsSchema: SERIAL_SETTINGS_SCHEMA,

  defaultSettings() {
    return {
      baudRate: 115200,
      dataBits: 8,
      stopBits: 1,
      parity: 'none',
      flowControl: 'none',
      bufferSize: 255,
    }
  },
}
