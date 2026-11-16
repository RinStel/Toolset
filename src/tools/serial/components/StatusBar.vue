<script setup lang="ts">
/**
 * 单个 Pane 的状态栏（plan §8.2 / §8.4）。
 *
 * 协议名 / 任务 / 转发字段为后续阶段预留：链接领域已经提供了对应状态，这里先如实
 * 显示，等协议与转发界面接入后无需改结构。
 */

import { computed } from 'vue'

import { formatBytes } from '@/shared/lib/format'

import { bridgeStatusText } from '../stores/bridge'
import { getSessionInstance, getSessionView, serialSessions } from '../stores/sessions'

const props = defineProps<{ sessionId: string | null }>()

const view = computed(() => getSessionView(props.sessionId))
const instance = computed(() => getSessionInstance(props.sessionId))

const STATE_LABELS: Record<string, string> = {
  idle: '未连接',
  opening: '正在连接…',
  open: '已连接',
  closed: '已断开',
  closing: '正在断开…',
  error: '连接错误',
}

const stateLabel = computed(() => STATE_LABELS[view.value?.state ?? 'idle'] ?? '未知状态')

const paramSummary = computed(() => {
  const settings = view.value?.settings
  if (!settings) return ''
  const baudRate = settings.baudRate
  if (typeof baudRate === 'number') {
    const dataBits = settings.dataBits ?? 8
    const stopBits = settings.stopBits ?? 1
    const parity = settings.parity === 'even' ? 'E' : settings.parity === 'odd' ? 'O' : 'N'
    return `${baudRate} ${String(dataBits)}${parity}${String(stopBits)}`
  }
  const interval = settings.interval
  if (typeof interval === 'number') return `间隔 ${String(interval)}ms`
  return ''
})

const protocolText = computed(() => {
  const protocol = view.value?.protocol
  if (!protocol) return '无协议'
  if (protocol.status === 'disabled') return `${protocol.name}（已禁用）`
  if (protocol.error !== undefined) return `${protocol.name}（错误：${protocol.error}）`
  return protocol.name
})

const protocolLine = computed(() => `协议：${protocolText.value}`)

const protocolTone = computed(() => {
  const protocol = view.value?.protocol
  if (!protocol) return 'is-muted'
  return protocol.status === 'disabled' ? 'is-warn' : 'is-ok'
})

const taskText = computed(() => {
  const tasks = view.value?.tasks
  if (!tasks) return '无任务'
  if (tasks.repeat) {
    const total = tasks.repeat.count === null ? '∞' : String(tasks.repeat.count)
    return `定时发送 ${String(tasks.repeat.sent)}/${total}`
  }
  if (tasks.macro) return `宏：${tasks.macro.name}`
  return '无任务'
})

function sessionName(id: string): string {
  return serialSessions.views.find((item) => item.id === id)?.name ?? id
}

const bridgeText = computed(() => bridgeStatusText(props.sessionId, (id) => sessionName(id)))

const logCount = computed(() => {
  // 依赖日志事件计数：LogBuffer 的 size / bytes 不是响应式数据。
  void view.value?.logVersion
  return instance.value?.log.size ?? 0
})

const bufferPercent = computed(() => {
  void view.value?.logVersion
  const buffer = instance.value?.log
  if (!buffer || buffer.maxBytes <= 0) return '0'
  return ((buffer.bytes / buffer.maxBytes) * 100).toFixed(1)
})

const stats = computed(() => view.value?.stats)
const overflowBytes = computed(() => {
  void view.value?.stats
  return instance.value?.protocolOverflowBytes ?? 0
})
</script>

<template>
  <div class="status-bar" data-testid="status-bar">
    <span
      class="status-bar__item status-bar__item--state"
      :class="`status-bar__state--${view?.state ?? 'idle'}`"
    >
      {{ stateLabel }}
    </span>
    <span v-if="paramSummary" class="status-bar__item status-bar__item--mono">
      {{ paramSummary }}
    </span>
    <span
      class="status-bar__item"
      :class="protocolTone"
      data-testid="status-protocol"
      v-text="protocolLine"
    />
    <span class="status-bar__item status-bar__item--mono">
      RX {{ formatBytes(stats?.rxBytes ?? 0) }}
    </span>
    <span class="status-bar__item status-bar__item--mono">
      TX {{ formatBytes(stats?.txBytes ?? 0) }}
    </span>
    <span class="status-bar__item status-bar__item--mono">
      日志 {{ logCount }} 条 · {{ bufferPercent }}%
    </span>
    <span
      v-if="(stats?.droppedBytes ?? 0) > 0"
      class="status-bar__item status-bar__item--warn status-bar__item--mono"
      data-testid="status-dropped"
    >
      丢弃 {{ formatBytes(stats?.droppedBytes ?? 0) }}
    </span>
    <span class="status-bar__item" data-testid="status-task">{{ taskText }}</span>
    <span class="status-bar__item" data-testid="status-bridge">转发：{{ bridgeText }}</span>
    <span
      v-if="overflowBytes > 0"
      class="status-bar__item status-bar__item--warn"
      data-testid="status-overflow"
    >
      协议处理跟不上，已丢弃 {{ overflowBytes }} 字节
    </span>
  </div>
</template>

<style scoped>
.status-bar {
  display: flex;
  align-items: center;
  flex: none;
  gap: 0;
  min-height: 30px;
  padding: 0 var(--space-2);
  overflow-x: auto;
  border-top: 1px solid var(--border);
  background: var(--bg-elev);
  box-shadow: var(--panel-highlight);
  color: var(--text-dim);
  font-size: 11px;
  white-space: nowrap;
}

.status-bar__item {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  flex: none;
  height: 30px;
  padding: 0 10px;
  font-family: var(--font-mono);
}

.status-bar__item:first-child {
  padding-left: 2px;
}

.status-bar__item + .status-bar__item {
  border-left: 1px solid var(--border);
}

.status-bar__item--state {
  gap: 6px;
}

.status-bar__item--state::before {
  content: '';
  display: inline-block;
  flex: none;
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--text-faint);
}

.status-bar__state--open::before {
  background: var(--ok);
}

.status-bar__state--opening::before,
.status-bar__state--closing::before {
  background: var(--warn);
}

.status-bar__state--error::before {
  background: var(--danger);
}

.status-bar__item--mono {
  font-family: var(--font-mono);
}

.status-bar__item--warn {
  color: var(--warn);
}

.status-bar__item.is-warn {
  color: var(--warn);
}

.status-bar__item.is-ok {
  color: var(--ok);
}

.status-bar__item.is-muted {
  color: var(--text-dim);
}

.status-bar__state--open {
  color: var(--ok);
}

.status-bar__state--opening,
.status-bar__state--closing {
  color: var(--warn);
}

.status-bar__state--error {
  color: var(--danger);
}
</style>
