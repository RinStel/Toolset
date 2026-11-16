<script setup lang="ts">
/**
 * 协议选择器（plan §8.6 / §8.2）。
 *
 * 原生 `<select>` 列出「无协议 / 内置 / 自定义」，选中后调用 `session.setProtocol()`；
 * 「管理」按钮打开全屏协议管理器。内置协议只读，但仍可选中使用。
 */

import { computed, onMounted, ref } from 'vue'
import { Settings2 } from 'lucide-vue-next'

import UiBadge from '@/shared/ui/components/UiBadge.vue'
import UiButton from '@/shared/ui/components/UiButton.vue'

import { getSessionInstance, getSessionView } from '../stores/sessions'
import { protocolSummaries, refreshProtocols, watchProtocols } from '../stores/protocols'
import ProtocolManager from './ProtocolManager.vue'

const props = defineProps<{ sessionId: string | null }>()

const managerOpen = ref(false)
const changing = ref(false)

const view = computed(() => getSessionView(props.sessionId))
const currentId = computed(() => view.value?.protocol?.id ?? '')
const builtins = computed(() => protocolSummaries.value.filter((record) => record.builtin))
const customs = computed(() => protocolSummaries.value.filter((record) => !record.builtin))

const statusText = computed(() => {
  const protocol = view.value?.protocol
  if (!protocol) return ''
  if (protocol.status === 'disabled') {
    return protocol.error === undefined ? '已禁用' : `已禁用：${protocol.error}`
  }
  return ''
})

onMounted(() => {
  watchProtocols()
  void refreshProtocols()
})

async function onSelect(event: Event): Promise<void> {
  const session = getSessionInstance(props.sessionId)
  if (!session) return
  const value = (event.target as HTMLSelectElement).value
  changing.value = true
  try {
    await session.setProtocol(value.length > 0 ? value : null)
  } finally {
    changing.value = false
  }
}

function onManagerClosed(): void {
  void refreshProtocols()
}
</script>

<template>
  <section class="protocol-picker">
    <div class="protocol-picker__row">
      <select
        class="protocol-picker__select"
        :value="currentId"
        :disabled="!view || changing"
        aria-label="协议"
        data-testid="protocol-select"
        @change="onSelect"
      >
        <option value="">无协议</option>
        <optgroup v-if="builtins.length > 0" label="内置">
          <option v-for="record in builtins" :key="record.id" :value="record.id">
            {{ record.name }}
          </option>
        </optgroup>
        <optgroup v-if="customs.length > 0" label="自定义">
          <option v-for="record in customs" :key="record.id" :value="record.id">
            {{ record.name }}
          </option>
        </optgroup>
      </select>
      <UiButton
        size="sm"
        variant="ghost"
        data-testid="protocol-manager-open"
        :disabled="!view"
        @click="managerOpen = true"
      >
        <Settings2 :size="12" aria-hidden="true" />
        管理
      </UiButton>
    </div>
    <p v-if="statusText" class="protocol-picker__status" role="status">
      <UiBadge tone="warn">{{ view?.protocol?.name }}</UiBadge>
      {{ statusText }}
    </p>

    <ProtocolManager
      v-model="managerOpen"
      :session-id="props.sessionId"
      @update:model-value="onManagerClosed"
    />
  </section>
</template>

<style scoped>
.protocol-picker {
  display: flex;
  flex-direction: column;
  gap: 6px;
  min-width: 0;
}

.protocol-picker__head {
  display: none;
}

.protocol-picker__row {
  display: flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
}

.protocol-picker__select {
  flex: 1 1 auto;
  min-width: 0;
  height: var(--control-h-sm);
  padding: 0 6px;
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  background: var(--bg-sunken);
  color: var(--text);
  font-family: var(--font-ui);
  font-size: 11px;
}

.protocol-picker__select:hover {
  border-color: var(--border-strong);
}

.protocol-picker__select:focus {
  border-color: var(--accent);
}

.protocol-picker__select:focus-visible {
  outline: none;
  box-shadow: var(--focus-ring);
}

.protocol-picker__status {
  display: flex;
  align-items: center;
  gap: 6px;
  margin: 0;
  color: var(--warn);
  font-size: 11px;
  line-height: 1.5;
}
</style>
