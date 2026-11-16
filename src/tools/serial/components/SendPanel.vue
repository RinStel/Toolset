<script setup lang="ts">
/**
 * 发送面板（plan §8.5）。
 *
 * 四个标签页：手动 / 快捷 / 宏 / 协议；协议标签只在当前协议提供 `sendForm` 时可用。
 */

import { computed, ref } from 'vue'

import UiTabs from '@/shared/ui/components/UiTabs.vue'

import { getSessionView } from '../stores/sessions'
import MacroPanel from './MacroPanel.vue'
import ManualSend from './ManualSend.vue'
import ProtocolSendForm from './ProtocolSendForm.vue'
import QuickSend from './QuickSend.vue'

const props = defineProps<{ sessionId: string | null }>()

const activeTab = ref('manual')

const view = computed(() => getSessionView(props.sessionId))

const hasProtocolSendForm = computed(() => {
  const protocol = view.value?.protocol
  if (protocol === null || protocol === undefined) return false
  if (protocol.status !== 'active') return false
  return (protocol.sendForm?.length ?? 0) > 0
})

const tabs = computed(() => [
  { key: 'manual', label: '手动' },
  { key: 'quick', label: '快捷' },
  { key: 'macro', label: '宏' },
  {
    key: 'protocol',
    label: '协议',
    disabled: !hasProtocolSendForm.value,
    title: hasProtocolSendForm.value ? '协议表单发送' : '当前协议没有发送表单',
  },
])
</script>

<template>
  <div class="send-panel">
    <UiTabs v-model="activeTab" :tabs="tabs" size="sm" aria-label="发送方式" />
    <div class="send-panel__body">
      <ManualSend v-if="activeTab === 'manual'" :session-id="sessionId" />
      <QuickSend v-else-if="activeTab === 'quick'" :session-id="sessionId" />
      <MacroPanel v-else-if="activeTab === 'macro'" :session-id="sessionId" />
      <ProtocolSendForm v-else :session-id="sessionId" />
    </div>
  </div>
</template>

<style scoped>
.send-panel {
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 0;
  border-top: 1px solid var(--border);
  background: var(--bg-elev);
}

.send-panel :deep(.ui-tabs__tab) {
  height: 34px;
  padding: 0 14px;
  font-size: 12.5px;
}

.send-panel__body {
  flex: 1 1 auto;
  min-height: 0;
  display: flex;
  flex-direction: column;
}

.send-panel__body > * {
  flex: 1 1 auto;
  min-height: 0;
}
</style>
