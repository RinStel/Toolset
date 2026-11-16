/**
 * 控件的发送反馈（plan §8.11）：`data-sent-count` 计数与边框闪烁。
 *
 * `WidgetFrame` 的 `ctx.send` 已经负责「失败弹 Toast + 外框闪烁」；控件自身再闪烁
 * 一次自己的边框，让用户看清是哪个控件发出的命令。
 */

import { computed, onScopeDispose, ref, type ComputedRef, type Ref } from 'vue'

import type { CommandSpec, WidgetInstance } from '@/domains/dashboard/public'

import type { WidgetContext } from './types'

export type SendFlash = 'ok' | 'danger' | ''

export interface SendState {
  /** 成功发送次数；渲染在根元素的 `data-sent-count` 上（plan §11.4）。 */
  sentCount: Ref<number>
  flash: Ref<SendFlash>
  flashClass: ComputedRef<string>
  /** 成功发送：计数 +1，闪烁 `--ok`。 */
  markSent(): void
  /** 发送失败：闪烁 `--danger`（Toast 由 `ctx.send` 负责）。 */
  markFailed(): void
}

const FLASH_DURATION_MS = 620

/** 创建一份发送反馈状态；卸载时清掉定时器。 */
export function useSendState(): SendState {
  const sentCount = ref(0)
  const flash = ref<SendFlash>('')
  let timer: ReturnType<typeof setTimeout> | null = null

  function setFlash(kind: SendFlash): void {
    flash.value = kind
    if (timer !== null) clearTimeout(timer)
    timer = setTimeout(() => {
      flash.value = ''
      timer = null
    }, FLASH_DURATION_MS)
  }

  onScopeDispose(() => {
    if (timer !== null) clearTimeout(timer)
    timer = null
  })

  return {
    sentCount,
    flash,
    flashClass: computed(() => {
      if (flash.value === 'ok') return 'is-flash-ok'
      if (flash.value === 'danger') return 'is-flash-danger'
      return ''
    }),
    markSent: () => {
      sentCount.value += 1
      setFlash('ok')
    },
    markFailed: () => setFlash('danger'),
  }
}

/** 控件是否处于可发送状态：运行模式、配置了命令、数据源 open。 */
export function canSendCommand(
  mode: 'edit' | 'run',
  ctx: WidgetContext,
  command: CommandSpec | null | undefined,
): boolean {
  if (mode !== 'run') return false
  if (!command) return false
  return ctx.sourceState(command.source) === 'open'
}

/** 未连接时的悬停提示（plan §9）。 */
export function sourceTooltipOf(
  ctx: WidgetContext,
  command: CommandSpec | null | undefined,
  alias?: string,
): string | undefined {
  const source = command?.source ?? alias
  const state = ctx.sourceState(source)
  if (state === 'open') return undefined
  if (state === 'unbound') return source ? `数据源 ${source} 未连接` : '数据源未连接'
  return source ? `数据源 ${source} 未连接` : '数据源未连接'
}

/** 执行一条命令并返回是否成功；失败时由 `ctx.send` 弹出 Toast。 */
export async function sendCommandValue(
  ctx: WidgetContext,
  command: CommandSpec | null | undefined,
  value: number | boolean | string | undefined,
): Promise<boolean> {
  if (!command) return false
  try {
    await ctx.send(command, value)
    return true
  } catch {
    return false
  }
}

/** 仪表盘标题，用于导出文件名（`instance.common.title` 或回退到组件类型）。 */
export function widgetTitleOf(instance: WidgetInstance, fallback: string): string {
  const title = instance.common.title.trim()
  return title.length > 0 ? title : fallback
}

/** 文件名安全化：去掉 Windows 非法字符。 */
export function safeFileName(value: string): string {
  const cleaned = value.replace(/[\\/:*?"<>|]+/g, '_').trim()
  return cleaned.length > 0 ? cleaned.slice(0, 80) : 'widget'
}

/** `YYYYMMDD-HHmmss` 时间戳（导出文件名）。 */
export function timestampSuffix(date = new Date()): string {
  const pad = (value: number): string => String(value).padStart(2, '0')
  return `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}-${pad(
    date.getHours(),
  )}${pad(date.getMinutes())}${pad(date.getSeconds())}`
}
