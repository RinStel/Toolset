/**
 * 协议发送表单的取值转换（plan §8.5 / §6.5）。
 *
 * 表单控件使用「原始值」（`number | null | string | boolean`），真正调用
 * `encode` 前再按 `SendField` 类型转换成 `SendValue`：`hex` 字段解析成
 * `Uint8Array`，`number` 字段校验范围。
 */

import { parseHex } from '@/domains/bytes/public'
import type { SendField, SendValue } from '@/domains/protocol/public'

/** 表单控件的原始值。 */
export type RawSendValue = number | string | boolean | null

/** 表单的原始值集合。 */
export type RawSendValues = Record<string, RawSendValue>

/** 按字段创建默认值（plan §6.5 的 `default`）。 */
export function createRawSendValues(fields: readonly SendField[]): RawSendValues {
  const values: RawSendValues = {}
  for (const field of fields) {
    switch (field.type) {
      case 'number':
        values[field.key] = field.default ?? field.min ?? 0
        break
      case 'text':
        values[field.key] = field.default ?? ''
        break
      case 'select':
        values[field.key] = field.default ?? field.options[0]?.value ?? ''
        break
      case 'checkbox':
        values[field.key] = field.default ?? false
        break
      case 'hex':
        values[field.key] = field.default ?? ''
        break
    }
  }
  return values
}

export type SendValueResult =
  { ok: true; values: Record<string, SendValue> } | { ok: false; error: string }

/** 把原始值转换为 `encode` 需要的 `SendValue`；非法 HEX / 数字会返回中文错误。 */
export function toSendValues(fields: readonly SendField[], raw: RawSendValues): SendValueResult {
  const values: Record<string, SendValue> = {}
  for (const field of fields) {
    const value = raw[field.key]
    switch (field.type) {
      case 'number': {
        if (typeof value !== 'number' || !Number.isFinite(value)) {
          return { ok: false, error: `字段「${field.label}」必须是数字` }
        }
        if (field.min !== undefined && value < field.min) {
          return { ok: false, error: `字段「${field.label}」不能小于 ${field.min}` }
        }
        if (field.max !== undefined && value > field.max) {
          return { ok: false, error: `字段「${field.label}」不能大于 ${field.max}` }
        }
        values[field.key] = value
        break
      }
      case 'text': {
        values[field.key] = typeof value === 'string' ? value : ''
        break
      }
      case 'select': {
        if (typeof value !== 'string' && typeof value !== 'number') {
          return { ok: false, error: `字段「${field.label}」未选择` }
        }
        values[field.key] = value
        break
      }
      case 'checkbox': {
        values[field.key] = value === true
        break
      }
      case 'hex': {
        const text = typeof value === 'string' ? value : ''
        const parsed = parseHex(text)
        if (!parsed.ok) {
          return {
            ok: false,
            error: `字段「${field.label}」HEX 格式错误：${parsed.error}`,
          }
        }
        values[field.key] = parsed.bytes
        break
      }
    }
  }
  return { ok: true, values }
}

/** 把 `Uint8Array` 渲染成表单预览用的大写 HEX。 */
export function hexPreview(bytes: Uint8Array, maxBytes = 64): string {
  const slice = bytes.subarray(0, maxBytes)
  const text = [...slice].map((byte) => byte.toString(16).padStart(2, '0').toUpperCase()).join(' ')
  return bytes.length > maxBytes ? `${text} …` : text
}
