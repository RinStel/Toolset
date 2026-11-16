/**
 * Byte transport contracts (plan §6.6).
 *
 * A transport is one openable byte channel (Web Serial port, demo port, …).
 * Providers create transports and describe their settings form; the session layer
 * only knows the contracts in this file.
 */

import type { SettingField } from '../../../shared/contracts/settings'

/** Features a transport may or may not support. */
export interface TransportCapabilities {
  /** Line parameters (baud rate, data bits, …) can be configured. */
  lineSettings: boolean
  /** DTR/RTS can be set through `setSignals`. */
  signals: boolean
  /** The break signal can be asserted through `setSignals`. */
  break: boolean
}

/** Signal values passed to `ByteTransport.setSignals`. */
export interface TransportSignals {
  dtr?: boolean
  rts?: boolean
  brk?: boolean
}

/** One transport instance; created by a `TransportProvider`. */
export interface ByteTransport {
  readonly kind: string
  /** Used for device memory, e.g. `serial:1A86:7523`, `serial:unknown`, `virtual`. */
  readonly deviceKey: string
  /** User facing label, e.g. `USB 串口 (1A86:7523)` or `演示端口 1`. */
  readonly label: string
  readonly capabilities: TransportCapabilities
  open(settings: Record<string, unknown>): Promise<void>
  close(): Promise<void>
  readonly readable: ReadableStream<Uint8Array> | null
  readonly writable: WritableStream<Uint8Array> | null
  setSignals?(signals: TransportSignals): Promise<void>
  /** Subscribes to disconnect events of the underlying device; returns unsubscribe. */
  onDisconnect(callback: () => void): () => void
  /** True when both transports address the same physical device. */
  isSameDevice(other: ByteTransport): boolean
}

/** Result of `TransportProvider.isSupported()`. */
export interface TransportSupport {
  ok: boolean
  /** Chinese explanation shown by the UI when `ok` is false. */
  reason?: string
}

/** Factory/descriptor of one transport kind. */
export interface TransportProvider {
  readonly kind: string
  readonly title: string
  readonly addLabel: string
  readonly order: number
  isSupported(): TransportSupport
  /** Lets the user pick a device; returns `null` when the user cancels. */
  request(): Promise<ByteTransport | null>
  listAuthorized(): Promise<ByteTransport[]>
  onAvailabilityChange?(callback: () => void): () => void
  readonly settingsSchema: SettingField[]
  defaultSettings(): Record<string, unknown>
}
