/**
 * 假 Web Serial 实现（plan.md §11.4）。
 *
 * 用法：
 * ```ts
 * import { installFakeSerial } from './fixtures/fake-serial'
 * await page.addInitScript(installFakeSerial)
 * const index = await page.evaluate(() => window.__fakeSerial.addPort({ usbVendorId: 0x1a86, usbProductId: 0x7523 }))
 * ```
 *
 * 该函数会被 Playwright 序列化后注入页面，因此函数体必须自包含（不能引用模块作用域变量）。
 *
 * `remove()` 会写入一个 localStorage 标记：同一次测试里刷新页面后，
 * `installFakeSerial` 看到标记就不再注入 `navigator.serial`，用来模拟
 * 「浏览器不支持 Web Serial」且刷新后仍然不支持（e2e 用例 10）。
 */

/** localStorage 中记录 `remove()` 已调用的键。 */
export const FAKE_SERIAL_REMOVED_KEY = 'toolset/e2e/fake-serial-removed'

export interface FakeSerialPortInfo {
  usbVendorId: number
  usbProductId: number
}

export interface FakeSerialSignals {
  dataTerminalReady?: boolean
  requestToSend?: boolean
  break?: boolean
}

export interface FakeSerialController {
  addPort(info: FakeSerialPortInfo): number
  setRequestBehavior(behavior: { select: number } | 'cancel'): void
  emit(index: number, bytes: number[]): void
  written(index: number): number[][]
  signals(index: number): FakeSerialSignals[]
  failNextOpen(index: number, name: 'InvalidStateError' | 'NetworkError'): void
  unplug(index: number): void
  remove(): void
  /**
   * 扩展：perf 用例用。关闭后 `written()` 不再累积字节，避免把测试自身记录的数据
   * 计入 `performance.memory` 的增长断言。
   */
  setWriteRecording(enabled: boolean): void
}

declare global {
  interface Window {
    __fakeSerial: FakeSerialController
  }
}

export function installFakeSerial(): void {
  const REMOVED_KEY = 'toolset/e2e/fake-serial-removed'

  // `remove()` 之后刷新页面：保持「不支持 Web Serial」的状态。
  let removedBefore = false
  try {
    removedBefore = localStorage.getItem(REMOVED_KEY) === '1'
  } catch {
    removedBefore = false
  }
  if (removedBefore) {
    try {
      Object.defineProperty(navigator, 'serial', { value: undefined, configurable: true })
    } catch {
      /* 无法覆盖时保持原样；此时支持状态检测可能仍然通过，测试会明确失败。 */
    }
    return
  }

  const states: Array<{
    info: FakeSerialPortInfo
    connected: boolean
    opening: boolean
    failOpenName: string | null
    readableController: ReadableStreamDefaultController<Uint8Array> | null
    pendingChunks: Uint8Array[]
    signals: FakeSerialSignals[]
    writes: number[][]
    readableClosed: boolean
    writerClosed: boolean
  }> = []

  let requestBehavior: { select: number } | 'cancel' = { select: 0 }
  let recordWrites = true

  function makeDomException(message: string, name: string): Error {
    const DOMExceptionCtor = (
      globalThis as { DOMException?: new (message: string, name: string) => Error }
    ).DOMException
    if (DOMExceptionCtor) return new DOMExceptionCtor(message, name)
    const error = new Error(message)
    error.name = name
    return error
  }

  const listeners = new Map<string, Set<(event: Event) => void>>()

  function dispatch(type: string, port: unknown): void {
    const handlers = listeners.get(type)
    if (!handlers) return
    for (const handler of handlers) {
      // `WebSerialTransport.onDisconnect` 通过 `event.target === this.port` 判断来源。
      handler({ type, port, target: port } as unknown as Event)
    }
  }

  class FakeSerialPort extends EventTarget {
    readonly index: number

    constructor(index: number) {
      super()
      this.index = index
    }

    private get state() {
      return states[this.index]!
    }

    getInfo(): FakeSerialPortInfo {
      return { ...this.state.info }
    }

    async open(): Promise<void> {
      const state = this.state
      if (state.opening || (state.readableController && !state.readableClosed)) {
        throw makeDomException('The port is already open.', 'InvalidStateError')
      }
      const failName = state.failOpenName
      state.failOpenName = null
      if (failName) {
        throw makeDomException(
          failName === 'InvalidStateError'
            ? 'The port is already open.'
            : 'Failed to open the serial port.',
          failName,
        )
      }
      if (!state.connected) {
        throw makeDomException('The device has been lost.', 'NetworkError')
      }
      state.opening = true
      await Promise.resolve()
      state.opening = false
      state.readableClosed = false
      state.writerClosed = false
      state.readableController = null
      state.pendingChunks = []
    }

    get readable(): ReadableStream<Uint8Array> | null {
      const state = this.state
      if (!state.connected) return null
      return new ReadableStream<Uint8Array>({
        start: (controller) => {
          state.readableController = controller
          const pending = state.pendingChunks
          state.pendingChunks = []
          for (const chunk of pending) controller.enqueue(chunk)
        },
        cancel: () => {
          state.readableController = null
          state.readableClosed = true
        },
      })
    }

    get writable(): WritableStream<Uint8Array> | null {
      const state = this.state
      if (!state.connected) return null
      return new WritableStream<Uint8Array>({
        write: (chunk) => {
          if (recordWrites) state.writes.push(Array.from(chunk))
        },
        close: () => {
          state.writerClosed = true
        },
      })
    }

    async close(): Promise<void> {
      const state = this.state
      if (state.readableController) {
        try {
          state.readableController.close()
        } catch {
          /* already closed */
        }
      }
      state.readableController = null
      state.readableClosed = true
      state.writerClosed = true
    }

    async setSignals(signals: FakeSerialSignals): Promise<void> {
      this.state.signals.push({ ...signals })
    }

    async forget(): Promise<void> {
      /* no-op */
    }

    async getSignals(): Promise<{
      dataCarrierDetect: boolean
      clearToSend: boolean
      ringIndicator: boolean
    }> {
      return { dataCarrierDetect: false, clearToSend: false, ringIndicator: false }
    }
  }

  const ports: FakeSerialPort[] = states.map((_state, index) => new FakeSerialPort(index))

  class FakeSerial {
    onconnect: ((event: Event) => void) | null = null
    ondisconnect: ((event: Event) => void) | null = null

    async requestPort(): Promise<FakeSerialPort> {
      if (requestBehavior === 'cancel') {
        throw makeDomException('No port selected by the user.', 'NotFoundError')
      }
      const port = ports[requestBehavior.select]
      if (!port) throw makeDomException('No port selected by the user.', 'NotFoundError')
      return port
    }

    async getPorts(): Promise<FakeSerialPort[]> {
      return ports.slice()
    }

    addEventListener(type: string, listener: (event: Event) => void): void {
      const handlers = listeners.get(type) ?? new Set()
      handlers.add(listener)
      listeners.set(type, handlers)
    }

    removeEventListener(type: string, listener: (event: Event) => void): void {
      listeners.get(type)?.delete(listener)
    }
  }

  const serial = new FakeSerial()

  function refreshPorts(): void {
    while (ports.length < states.length) {
      ports.push(new FakeSerialPort(ports.length))
    }
  }

  const controller: FakeSerialController = {
    addPort(info) {
      states.push({
        info: { ...info },
        connected: true,
        opening: false,
        failOpenName: null,
        readableController: null,
        pendingChunks: [],
        signals: [],
        writes: [],
        readableClosed: true,
        writerClosed: true,
      })
      refreshPorts()
      return states.length - 1
    },
    setRequestBehavior(behavior) {
      requestBehavior = behavior
    },
    emit(index, bytes) {
      const state = states[index]
      if (!state) throw new Error(`fake serial port ${index} does not exist`)
      const chunk = Uint8Array.from(bytes)
      if (state.readableController && !state.readableClosed) {
        state.readableController.enqueue(chunk)
      } else {
        state.pendingChunks.push(chunk)
      }
    },
    written(index) {
      return (states[index]?.writes ?? []).map((chunk) => chunk.slice())
    },
    signals(index) {
      return (states[index]?.signals ?? []).map((signal) => ({ ...signal }))
    },
    failNextOpen(index, name) {
      const state = states[index]
      if (!state) throw new Error(`fake serial port ${index} does not exist`)
      state.failOpenName = name
    },
    unplug(index) {
      const state = states[index]
      if (!state) return
      state.connected = false
      if (state.readableController) {
        try {
          state.readableController.error(
            makeDomException('The device has been lost.', 'NetworkError'),
          )
        } catch {
          /* already closed */
        }
        state.readableController = null
      }
      dispatch('disconnect', ports[index])
      serial.ondisconnect?.({ type: 'disconnect', port: ports[index] } as unknown as Event)
    },
    remove() {
      try {
        localStorage.setItem(REMOVED_KEY, '1')
      } catch {
        /* localStorage 不可用时至少让当前页面立即失去 Web Serial。 */
      }
      try {
        Object.defineProperty(navigator, 'serial', { value: undefined, configurable: true })
      } catch {
        /* 忽略：当前页面仍然可以继续用假串口完成其余断言。 */
      }
    },
    setWriteRecording(enabled) {
      recordWrites = enabled
    },
  }

  try {
    Object.defineProperty(navigator, 'serial', {
      value: serial,
      configurable: true,
    })
  } catch {
    // 少数环境里 navigator.serial 是不可配置的访问器；退化为赋值。
    ;(navigator as unknown as { serial: FakeSerial }).serial = serial
  }
  ;(window as unknown as { __fakeSerial: FakeSerialController }).__fakeSerial = controller
}
