/**
 * 协议领域的公共入口（plan §6.7）。
 *
 * 工具与 `domains/link` 只能通过本文件使用协议领域，不得深入内部模块。
 */

import type { ProtocolTemplate } from './types'
import { IDLE_TEMPLATE } from './templates/idle'
import { LENGTH_CRC_TEMPLATE } from './templates/length-crc'
import { LINE_TEMPLATE } from './templates/line'
import { MINIMAL_TEMPLATE } from './templates/minimal'
import { VARIABLES_TEMPLATE } from './templates/variables'

export { getProtocolRepository } from './repository'
export type { ProtocolExportFile, ProtocolRepository, ProtocolSaveInput } from './repository'

export { createProtocolRuntime } from './runtime/client'
export type {
  ProtocolFatalEvent,
  ProtocolLogEvent,
  ProtocolRuntime,
  ProtocolRuntimeEvents,
  ProtocolRuntimeOptions,
  ProtocolWorkerLike,
} from './runtime/client'

export { validateDefinition } from './validate'
export type { ValidationError, ValidationResult } from './validate'

export { createProtocolSdk, DEFAULT_ASSERT_MESSAGE } from './sdk'
export type { PluginSdk, PluginSdkChecksum, ProtocolSdk, SdkBytesInput, SdkChecksum } from './sdk'

export {
  BUILTIN_PROTOCOLS,
  FIREWATER_PROTOCOL_ID,
  JUSTFLOAT_PROTOCOL_ID,
  KV_TEXT_PROTOCOL_ID,
  SENSOR_A5_PROTOCOL_ID,
  isBuiltinProtocol,
} from './builtin'

export { isValidVariableKey, MAX_DECODE_VARIABLES, VARIABLE_KEY_PATTERN } from './types'
export type {
  DecodeContext,
  DecodeDirection,
  DecodeField,
  DecodeLevel,
  DecodeResult,
  DelimiterFramingSpec,
  EncodeContext,
  FixedFramingSpec,
  FramingSpec,
  IdleFramingSpec,
  LengthField,
  LengthFramingSpec,
  LineFramingSpec,
  ProtocolDefinition,
  ProtocolDiscardEvent,
  ProtocolDiscardReason,
  ProtocolFrame,
  ProtocolLogLevel,
  ProtocolMeta,
  ProtocolRecord,
  ProtocolRuntimeInfo,
  ProtocolSendForm,
  ProtocolSummary,
  ProtocolTemplate,
  SendField,
  SendFieldType,
  SendValue,
  VariableMeta,
} from './types'

/** 协议管理器「新建」菜单里的 5 个模板（plan §6.5 / §8.6）。 */
export const TEMPLATES: readonly ProtocolTemplate[] = [
  MINIMAL_TEMPLATE,
  LINE_TEMPLATE,
  LENGTH_CRC_TEMPLATE,
  IDLE_TEMPLATE,
  VARIABLES_TEMPLATE,
]
