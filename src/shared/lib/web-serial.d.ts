/**
 * Minimal Web Serial API typings (plan §5).
 *
 * The DOM lib shipped with TypeScript does not include Web Serial yet, so the app
 * declares the subset it uses. The exported interfaces are also useful for the e2e
 * fake serial fixture; the `Navigator` augmentation makes `navigator.serial`
 * available everywhere type checking includes this file.
 */

export interface SerialPortInfo {
  usbVendorId?: number
  usbProductId?: number
  [key: string]: unknown
}

export interface SerialOptions {
  baudRate: number
  dataBits?: number
  stopBits?: number
  parity?: 'none' | 'even' | 'odd'
  bufferSize?: number
  flowControl?: 'none' | 'hardware'
}

export interface SerialInputSignals {
  dataCarrierDetect: boolean
  clearToSend: boolean
  ringIndicator: boolean
  dataSetReady: boolean
}

export interface SerialOutputSignals {
  dataTerminalReady?: boolean
  requestToSend?: boolean
  break?: boolean
}

export interface SerialPortRequestOptions {
  filters?: SerialPortFilter[]
}

export interface SerialPortFilter {
  usbVendorId?: number
  usbProductId?: number
}

export interface SerialPort extends EventTarget {
  readonly readable: ReadableStream<Uint8Array> | null
  readonly writable: WritableStream<Uint8Array> | null
  readonly connected?: boolean
  open(options: SerialOptions): Promise<void>
  close(): Promise<void>
  forget?(): Promise<void>
  getInfo(): SerialPortInfo
  setSignals(signals?: SerialOutputSignals): Promise<void>
  getSignals(): Promise<SerialInputSignals>
}

export type SerialConnectEvent = Event & { target: SerialPort }
export type SerialDisconnectEvent = Event & { target: SerialPort }

export interface Serial extends EventTarget {
  onconnect: ((event: SerialConnectEvent) => void) | null
  ondisconnect: ((event: SerialDisconnectEvent) => void) | null
  getPorts(): Promise<SerialPort[]>
  requestPort(options?: SerialPortRequestOptions): Promise<SerialPort>
}

declare global {
  interface Navigator {
    /** Present only in secure contexts of browsers implementing Web Serial. */
    readonly serial?: Serial
  }
}
