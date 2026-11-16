/**
 * 协议列表的界面缓存（plan §8.6）。
 *
 * 仓库本身是异步 API；这里维护一份订阅了仓库变化的响应式快照，供协议选择器与
 * 管理器共享。工具只通过 `@/domains/protocol/public` 使用协议领域。
 */

import { shallowRef } from 'vue'

import { getProtocolRepository, type ProtocolSummary } from '@/domains/protocol/public'

const repository = getProtocolRepository()

/** 内置 + 自定义协议列表（内置在前）。 */
export const protocolSummaries = shallowRef<ProtocolSummary[]>([])

let loading: Promise<ProtocolSummary[]> | null = null
let subscribed = false

function apply(records: ProtocolSummary[]): void {
  protocolSummaries.value = records
}

/** 重新读取协议列表。 */
export function refreshProtocols(): Promise<ProtocolSummary[]> {
  if (loading === null) {
    loading = repository
      .list()
      .then((records) => {
        apply(records)
        return records
      })
      .finally(() => {
        loading = null
      })
  }
  return loading
}

/** 建立仓库订阅；重复调用无副作用。 */
export function watchProtocols(): void {
  if (subscribed) return
  subscribed = true
  repository.subscribe((records) => {
    apply(records)
  })
}

/** 按 id 查找协议摘要。 */
export function findProtocolSummary(id: string | null | undefined): ProtocolSummary | undefined {
  if (!id) return undefined
  return protocolSummaries.value.find((record) => record.id === id)
}

/** 按 id 查找协议名称（找不到时返回 id）。 */
export function protocolName(id: string | null | undefined): string {
  if (!id) return '无协议'
  return findProtocolSummary(id)?.name ?? id
}
