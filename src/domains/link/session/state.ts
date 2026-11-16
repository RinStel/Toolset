/**
 * Session state machine and shared error texts (plan §6.6 / §9).
 */

/** State of one `LinkSession`. */
export type SessionState = 'idle' | 'opening' | 'open' | 'closing' | 'closed' | 'error'

/** Where sent bytes come from. */
export type Origin =
  'manual' | 'quick' | 'repeat' | 'macro' | 'protocol' | 'bridge' | 'widget' | 'device'

/** How decoded frames are displayed by the serial tool. */
export type DisplayMode = 'raw' | 'decoded' | 'both'

/** Transitions accepted by the state machine. */
export type SessionEvent =
  'open' | 'opened' | 'openFailed' | 'close' | 'closed' | 'fatal' | 'disconnected'

const TRANSITIONS: Record<SessionState, Partial<Record<SessionEvent, SessionState>>> = {
  idle: { open: 'opening' },
  closed: { open: 'opening' },
  error: { open: 'opening' },
  opening: { opened: 'open', openFailed: 'error', close: 'closing' },
  open: { close: 'closing', fatal: 'error', disconnected: 'error' },
  closing: { closed: 'closed' },
}

/** Raised for a transition that is not in the state machine table. */
export class IllegalStateError extends Error {
  readonly state: SessionState
  readonly event: SessionEvent

  constructor(state: SessionState, event: SessionEvent, message?: string) {
    super(message ?? `当前状态 ${state} 不允许 ${event}`)
    this.name = 'IllegalStateError'
    this.state = state
    this.event = event
  }
}

/**
 * Applies one state machine event.
 *
 * @throws IllegalStateError when the transition is not defined.
 */
export function transition(state: SessionState, event: SessionEvent): SessionState {
  const next = TRANSITIONS[state][event]
  if (next === undefined) throw new IllegalStateError(state, event)
  return next
}

/** Returns the error name of a thrown value (`Error`, DOMException, …). */
export function errorName(error: unknown): string {
  if (typeof error === 'object' && error !== null) {
    const name = (error as { name?: unknown }).name
    if (typeof name === 'string' && name.length > 0) return name
  }
  return 'UnknownError'
}

/** Returns a human readable message of a thrown value. */
export function errorMessage(error: unknown): string {
  if (error instanceof Error && error.message.length > 0) return error.message
  if (typeof error === 'string') return error
  const name = errorName(error)
  return name === 'UnknownError' ? String(error) : name
}

/** Localized open failure texts (plan §9). */
export function mapOpenError(error: unknown): string {
  const name = errorName(error)
  if (name === 'InvalidStateError') {
    return '端口已被打开，可能正在其他标签页或程序中使用。请关闭占用后重试。'
  }
  if (name === 'NetworkError') {
    return '无法打开端口，可能被其他程序占用或设备已断开。请检查连接后重试。'
  }
  return `打开端口失败：${errorMessage(error)}`
}

/** Text of the system log written when a write fails (plan §9). */
export function writeFailureText(error: unknown): string {
  return `发送失败：${errorMessage(error)}。已停止自动发送任务。`
}

export const DEVICE_DISCONNECTED_TEXT = '设备已断开'

export function protocolLoadFailureText(error: unknown): string {
  return `协议加载失败：${errorMessage(error)}。已切换为无协议模式。`
}

export function protocolTimeoutText(): string {
  return '协议执行超时（可能存在死循环），已禁用该会话的协议。'
}

export function decodeErrorText(error: unknown): string {
  return `协议解码出错：${errorMessage(error)}`
}

export function protocolEncodeFailureText(error: unknown): string {
  return `协议编码失败：${errorMessage(error)}`
}

/** True for read errors that only interrupt the current read, not the channel. */
export function isRecoverableReadError(error: unknown): boolean {
  const name = errorName(error)
  return (
    name === 'BreakError' ||
    name === 'FramingError' ||
    name === 'ParityError' ||
    name === 'BufferOverrunError'
  )
}
