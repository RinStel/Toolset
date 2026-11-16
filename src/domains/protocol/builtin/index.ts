/**
 * 内置协议汇总（plan §6.5 / §8.6）。
 *
 * 4 个内置协议都是只读的插件代码字符串，实现方式与用户插件完全相同；它们不写入
 * 插件仓库，id 以 `builtin:` 开头。列表顺序与 plan §6.5「内置数据格式」表一致。
 */

import type { ProtocolRecord } from '../types'
import { FIREWATER_PROTOCOL, FIREWATER_PROTOCOL_ID, FIREWATER_PROTOCOL_NAME } from './firewater'
import { JUSTFLOAT_PROTOCOL, JUSTFLOAT_PROTOCOL_ID, JUSTFLOAT_PROTOCOL_NAME } from './justfloat'
import { KV_TEXT_PROTOCOL, KV_TEXT_PROTOCOL_ID, KV_TEXT_PROTOCOL_NAME } from './kv-text'
import { SENSOR_A5_PROTOCOL, SENSOR_A5_PROTOCOL_ID, SENSOR_A5_PROTOCOL_NAME } from './sensor-a5'

export {
  FIREWATER_PROTOCOL,
  FIREWATER_PROTOCOL_ID,
  FIREWATER_PROTOCOL_NAME,
  JUSTFLOAT_PROTOCOL,
  JUSTFLOAT_PROTOCOL_ID,
  JUSTFLOAT_PROTOCOL_NAME,
  KV_TEXT_PROTOCOL,
  KV_TEXT_PROTOCOL_ID,
  KV_TEXT_PROTOCOL_NAME,
  SENSOR_A5_PROTOCOL,
  SENSOR_A5_PROTOCOL_ID,
  SENSOR_A5_PROTOCOL_NAME,
}

/** 全部内置协议（只读，不进入仓库存储）。 */
export const BUILTIN_PROTOCOLS: readonly ProtocolRecord[] = [
  FIREWATER_PROTOCOL,
  JUSTFLOAT_PROTOCOL,
  KV_TEXT_PROTOCOL,
  SENSOR_A5_PROTOCOL,
]

export function isBuiltinProtocol(id: string): boolean {
  return BUILTIN_PROTOCOLS.some((record) => record.id === id)
}
