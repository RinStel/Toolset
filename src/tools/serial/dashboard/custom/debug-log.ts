/**
 * 自定义控件调试输出（plan §6.10 `ctx.log` / §8.12「调试输出」）。
 *
 * 宿主把 `ctx.log` 的输出、未捕获的异常与调用保护给出的停用原因写入这里；编辑器
 * 调试标签页按控件 id 显示最近 100 行。数据仅存在内存中，不持久化。
 */

import { reactive, ref } from 'vue'

/** 每个控件的调试输出上限（plan §8.12）。 */
export const CUSTOM_WIDGET_LOG_LIMIT = 100

const logs = reactive<Record<string, string[]>>({})

/** 调试输出版本号；组件用 `computed(() => { void version.value; ... })` 订阅。 */
export const customWidgetLogVersion = ref(0)

function formatArgument(value: unknown): string {
  if (typeof value === 'string') return value
  if (value instanceof Error) return value.message
  try {
    const json = JSON.stringify(value)
    return json === undefined ? String(value) : json
  } catch {
    return String(value)
  }
}

/** 把任意参数拼成一行调试输出。 */
export function formatCustomWidgetLogArguments(args: readonly unknown[]): string {
  return args.map(formatArgument).join(' ')
}

/** 追加一行（自动截断到最近 100 行）。 */
export function appendCustomWidgetLog(id: string, text: string): void {
  const line = text.length > 2000 ? `${text.slice(0, 2000)}…` : text
  logs[id] = [...(logs[id] ?? []), line].slice(-CUSTOM_WIDGET_LOG_LIMIT)
  customWidgetLogVersion.value += 1
}

/** 读取一个控件的调试输出。 */
export function customWidgetLogs(id: string): string[] {
  return logs[id] ?? []
}

/** 清空一个控件的调试输出。 */
export function clearCustomWidgetLog(id: string): void {
  logs[id] = []
  customWidgetLogVersion.value += 1
}
