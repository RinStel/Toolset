/**
 * Web Serial transport (plan §6.6).
 *
 * Wraps one `SerialPort`. The provider creates these; sessions never touch the
 * Serial API directly so fake transports can be used in tests.
 */

import type {
  Serial,
  SerialDisconnectEvent,
  SerialOptions,
  SerialOutputSignals,
  SerialPort,
} from '../../../../shared/lib/web-serial'
import type { ByteTransport, TransportCapabilities, TransportSignals } from '../../transport/types'

/** Capabilities of a Web Serial port. */
export const WEB_SERIAL_CAPABILITIES: TransportCapabilities = {
  lineSettings: true,
  signals: true,
  break: true,
}

function has(settings: Record<string, unknown>, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(settings, key)
}

function numberSetting(settings: Record<string, unknown>, key: string, fallback: number): number {
  const value = settings[key]
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback
}

function paritySetting(settings: Record<string, unknown>): SerialOptions['parity'] {
  const value = settings.parity
  return value === 'even' || value === 'odd' ? value : 'none'
}

function flowControlSetting(settings: Record<string, unknown>): SerialOptions['flowControl'] {
  return settings.flowControl === 'hardware' ? 'hardware' : 'none'
}

/** Returns the Web Serial API when the current runtime exposes it. */
export function getSerialApi(): Serial | undefined {
  if (typeof navigator === 'undefined') return undefined
  return navigator.serial
}

/**
 * Device memory key for a port: `serial:VID:PID` with upper-case hex ids, or
 * `serial:unknown` when the port does not report USB ids.
 */
export function deviceKeyForPort(port: SerialPort): string {
  let info: ReturnType<SerialPort['getInfo']>
  try {
    info = port.getInfo()
  } catch {
    return 'serial:unknown'
  }
  const vendorId = info.usbVendorId
  const productId = info.usbProductId
  if (
    typeof vendorId !== 'number' ||
    typeof productId !== 'number' ||
    !Number.isInteger(vendorId) ||
    !Number.isInteger(productId) ||
    vendorId < 0 ||
    productId < 0
  ) {
    return 'serial:unknown'
  }
  const format = (value: number): string => value.toString(16).toUpperCase().padStart(4, '0')
  return `serial:${format(vendorId)}:${format(productId)}`
}

/** Human readable label, e.g. `USB 串口 (1A86:7523)`. */
export function labelForPort(port: SerialPort): string {
  const key = deviceKeyForPort(port)
  if (key === 'serial:unknown') return 'USB 串口'
  return `USB 串口 (${key.slice('serial:'.length)})`
}

/** `ByteTransport` backed by one `SerialPort`. */
export class WebSerialTransport implements ByteTransport {
  readonly kind = 'web-serial'
  readonly deviceKey: string
  readonly label: string
  readonly capabilities: TransportCapabilities = WEB_SERIAL_CAPABILITIES

  constructor(readonly port: SerialPort) {
    this.deviceKey = deviceKeyForPort(port)
    this.label = labelForPort(port)
  }

  get readable(): ReadableStream<Uint8Array> | null {
    return this.port.readable
  }

  get writable(): WritableStream<Uint8Array> | null {
    return this.port.writable
  }

  async open(settings: Record<string, unknown>): Promise<void> {
    const options: SerialOptions = {
      baudRate: numberSetting(settings, 'baudRate', 115200),
    }
    if (has(settings, 'dataBits')) options.dataBits = numberSetting(settings, 'dataBits', 8)
    if (has(settings, 'stopBits')) options.stopBits = numberSetting(settings, 'stopBits', 1)
    if (has(settings, 'parity')) options.parity = paritySetting(settings)
    if (has(settings, 'flowControl')) options.flowControl = flowControlSetting(settings)
    // `bufferSize` is a browser extension; only pass it when the provider schema has it.
    if (has(settings, 'bufferSize')) {
      options.bufferSize = numberSetting(settings, 'bufferSize', 255)
    }
    await this.port.open(options)
  }

  async close(): Promise<void> {
    try {
      await this.port.close()
    } catch {
      // Closing an already closed / disconnected port is not actionable here.
    }
  }

  async setSignals(signals: TransportSignals): Promise<void> {
    const output: SerialOutputSignals = {}
    if (signals.dtr !== undefined) output.dataTerminalReady = signals.dtr
    if (signals.rts !== undefined) output.requestToSend = signals.rts
    if (signals.brk !== undefined) output.break = signals.brk
    await this.port.setSignals(output)
  }

  onDisconnect(callback: () => void): () => void {
    const serial = getSerialApi()
    if (!serial || typeof serial.addEventListener !== 'function') return () => {}
    const handler = (event: Event): void => {
      const target = (event as SerialDisconnectEvent).target
      if (target === this.port) callback()
    }
    serial.addEventListener('disconnect', handler)
    return () => {
      serial.removeEventListener('disconnect', handler)
    }
  }

  isSameDevice(other: ByteTransport): boolean {
    return other instanceof WebSerialTransport && other.port === this.port
  }
}
