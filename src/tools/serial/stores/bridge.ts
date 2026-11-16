/**
 * 转发规则状态（plan §6.6 / §8.2）。
 *
 * `BridgeService` 是领域单例，这里把它的规则列表镜像成响应式数据，并提供按会话
 * 汇总转发状态的辅助函数。转发规则不持久化，页面刷新后清空。
 */

import { shallowRef } from 'vue'

import {
  getBridgeService,
  type BridgeAddResult,
  type BridgeMode,
  type BridgeRule,
} from '@/domains/link/public'

const service = getBridgeService()

/** 当前全部转发规则。 */
export const bridgeRules = shallowRef<BridgeRule[]>(service.list())

service.on('change', (rules) => {
  bridgeRules.value = rules
})

/** 新建转发规则；失败时返回中文原因。 */
export function addBridgeRule(
  sessionA: string,
  sessionB: string,
  mode: BridgeMode,
): BridgeAddResult {
  return service.add(sessionA, sessionB, mode)
}

/** 暂停或恢复规则。 */
export function setBridgeRulePaused(ruleId: string, paused: boolean): void {
  service.setPaused(ruleId, paused)
}

/** 删除规则。 */
export function removeBridgeRule(ruleId: string): void {
  service.remove(ruleId)
}

/** 与一个会话相关的规则。 */
export function bridgeRulesForSession(sessionId: string | null | undefined): BridgeRule[] {
  if (!sessionId) return []
  return bridgeRules.value.filter((rule) => rule.a === sessionId || rule.b === sessionId)
}

/**
 * 状态栏用的转发摘要：
 * - 未参与规则时返回「未启用」；
 * - 有规则时描述方向，并在暂停时标注。
 */
export function bridgeStatusText(
  sessionId: string | null | undefined,
  nameOf: (id: string) => string,
): string {
  const rules = bridgeRulesForSession(sessionId)
  if (rules.length === 0) return '未启用'
  const parts: string[] = []
  let paused = false
  for (const rule of rules) {
    if (rule.paused) paused = true
    if (rule.mode === 'duplex') {
      parts.push(`双向 ⇄ ${nameOf(rule.a)} / ${nameOf(rule.b)}`)
      continue
    }
    if (rule.a === sessionId) parts.push(`→ ${nameOf(rule.b)}`)
    else parts.push(`← ${nameOf(rule.a)}`)
  }
  const text = parts.join('，')
  return paused ? `${text}（已暂停）` : text
}
