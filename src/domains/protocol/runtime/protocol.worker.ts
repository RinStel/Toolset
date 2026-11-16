/**
 * 协议 Worker 入口（plan §6.5）。
 *
 * 本文件只做消息收发与请求路由：编译、分帧、解码、编码都在 `compile.ts` /
 * `framing/` 中实现，便于在 Worker 外做单元测试。
 */

import { createFramer } from '../framing'
import type {
  Framer,
  ProtocolFrame,
  ProtocolWorkerInMessage,
  ProtocolWorkerOutMessage,
  WorkerDiscardMessage,
  WorkerEncodeMessage,
  WorkerFeedMessage,
  WorkerInitMessage,
} from '../types'
import {
  compileProtocol,
  createProtocolExecutor,
  errorMessage,
  type ProtocolExecutor,
} from './compile'
import { formatValidationErrors } from '../validate'

interface WorkerScope {
  postMessage(message: ProtocolWorkerOutMessage): void
  onmessage: ((event: MessageEvent<ProtocolWorkerInMessage>) => void) | null
}

const scope = self as unknown as WorkerScope

let framer: Framer | undefined
let executor: ProtocolExecutor | undefined
let lastByteAt: number | undefined

function send(message: ProtocolWorkerOutMessage): void {
  scope.postMessage(message)
}

function logSink(level: 'log' | 'warn' | 'error', text: string): void {
  send({ t: 'log', level, text })
}

function decodeFrame(bytes: Uint8Array, direction: 'rx' | 'tx', at: number): ProtocolFrame {
  const frame: ProtocolFrame = { bytes, at, direction, results: [] }
  if (executor === undefined) {
    frame.error = '协议尚未初始化'
    return frame
  }
  const outcome = executor.decodeFrame(bytes, direction, at)
  frame.results = outcome.results
  if (outcome.error !== undefined) frame.error = outcome.error
  return frame
}

function handleInit(message: WorkerInitMessage): void {
  const compiled = compileProtocol(message.code, { onLog: logSink })
  if (!compiled.ok) {
    send({ t: 'initError', error: formatValidationErrors(compiled.errors) })
    return
  }
  try {
    framer = createFramer(
      compiled.definition.framing,
      message.maxFrameLength === undefined ? {} : { maxFrameLength: message.maxFrameLength },
    )
  } catch (error) {
    send({ t: 'initError', error: `分帧配置无效：${errorMessage(error)}` })
    return
  }
  executor = createProtocolExecutor(compiled.definition, { onLog: logSink })
  lastByteAt = undefined
  send({
    t: 'ready',
    meta: compiled.definition.meta,
    ...(compiled.definition.sendForm === undefined
      ? {}
      : { sendForm: compiled.definition.sendForm }),
    framing: compiled.definition.framing,
  })
}

function handleFeed(message: WorkerFeedMessage): void {
  if (framer === undefined) {
    send({ t: 'frames', id: message.id, frames: [] })
    send({ t: 'done', id: message.id })
    return
  }
  const frames: ProtocolFrame[] = []
  const discards: WorkerDiscardMessage[] = []
  for (const chunk of message.chunks) {
    const output = framer.feed(chunk.bytes, chunk.at)
    for (const frame of output.frames) {
      frames.push(decodeFrame(frame.bytes, 'rx', frame.at))
    }
    for (const discard of output.discards) {
      discards.push({
        t: 'discard',
        id: message.id,
        bytes: discard.bytes,
        at: discard.at,
        reason: discard.reason,
      })
    }
    lastByteAt = chunk.at
  }
  if (frames.length > 0) send({ t: 'frames', id: message.id, frames })
  for (const discardMessage of discards) send(discardMessage)
  send({ t: 'done', id: message.id })
}

function handleFlush(id: number): void {
  if (framer === undefined) {
    send({ t: 'done', id })
    return
  }
  const at = lastByteAt ?? Date.now()
  const output = framer.flush(at)
  const frames = output.frames.map((frame) => decodeFrame(frame.bytes, 'rx', frame.at))
  if (frames.length > 0) send({ t: 'frames', id, frames })
  for (const discard of output.discards) {
    send({
      t: 'discard',
      id,
      bytes: discard.bytes,
      at: discard.at,
      reason: discard.reason,
    })
  }
  send({ t: 'done', id })
}

function handleEncode(message: WorkerEncodeMessage): void {
  if (executor === undefined) {
    send({ t: 'encodeError', id: message.id, error: '协议尚未初始化' })
    send({ t: 'done', id: message.id })
    return
  }
  const outcome = executor.encode(message.values)
  if (outcome.ok) send({ t: 'encoded', id: message.id, bytes: outcome.bytes })
  else send({ t: 'encodeError', id: message.id, error: outcome.error })
  send({ t: 'done', id: message.id })
}

scope.onmessage = (event: MessageEvent<ProtocolWorkerInMessage>): void => {
  const message = event.data
  try {
    switch (message.t) {
      case 'init':
        handleInit(message)
        break
      case 'feed':
        handleFeed(message)
        break
      case 'flush':
        handleFlush(message.id)
        break
      case 'decodeTx': {
        const frame = decodeFrame(message.bytes, 'tx', message.at)
        send({ t: 'frames', id: message.id, frames: [frame] })
        send({ t: 'done', id: message.id })
        break
      }
      case 'encode':
        handleEncode(message)
        break
      case 'reset':
        framer?.reset()
        executor?.reset()
        lastByteAt = undefined
        break
      default:
        break
    }
  } catch (error) {
    // 内部异常也必须回复 done，避免主线程看门狗把整个运行时判死。
    send({ t: 'log', level: 'error', text: `协议 Worker 内部错误：${errorMessage(error)}` })
    if ('id' in message && typeof message.id === 'number') {
      send({ t: 'done', id: message.id })
    }
  }
}
