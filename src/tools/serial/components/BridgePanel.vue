<script setup lang="ts">
/**
 * 转发规则面板（plan §6.6 / §8.2）。
 *
 * 规则列表显示两端会话、方向、字节数与丢弃数，并支持暂停 / 恢复 / 删除；新建表单
 * 选择会话 A、B 与方向。拒绝原因（自身、重复、环路）直接显示在表单下方。
 */

import { computed, ref } from 'vue'
import { ChevronDown, ChevronRight, Plus, Trash2 } from 'lucide-vue-next'

import type { BridgeMode, BridgeRule } from '@/domains/link/public'
import { formatBytes } from '@/shared/lib/format'
import UiBadge from '@/shared/ui/components/UiBadge.vue'
import UiButton from '@/shared/ui/components/UiButton.vue'
import UiFormField from '@/shared/ui/components/UiFormField.vue'
import UiIconButton from '@/shared/ui/components/UiIconButton.vue'

import { addBridgeRule, bridgeRules, removeBridgeRule, setBridgeRulePaused } from '../stores/bridge'
import { serialSessions } from '../stores/sessions'

const props = withDefaults(
  defineProps<{
    sessionId: string | null
    /** Sidebar groups collapse the bridge by default; direct usage stays open. */
    defaultExpanded?: boolean
  }>(),
  { defaultExpanded: true },
)

const expanded = ref(props.defaultExpanded)
const sourceId = ref('')
const targetId = ref('')
const mode = ref<BridgeMode>('oneway')
const rejection = ref('')

const sessions = computed(() =>
  serialSessions.views.map((view) => ({ id: view.id, name: view.name, state: view.state })),
)

const modeOptions = [
  { label: '单向（A → B）', value: 'oneway' },
  { label: '双向（A ⇄ B）', value: 'duplex' },
]

function sessionName(id: string): string {
  return sessions.value.find((session) => session.id === id)?.name ?? id
}

function directionText(rule: BridgeRule): string {
  return rule.mode === 'duplex'
    ? `${sessionName(rule.a)} ⇄ ${sessionName(rule.b)}`
    : `${sessionName(rule.a)} → ${sessionName(rule.b)}`
}

function readSelect(event: Event): string {
  return (event.target as HTMLSelectElement).value
}

function onSourceChange(event: Event): void {
  sourceId.value = readSelect(event)
}

function onTargetChange(event: Event): void {
  targetId.value = readSelect(event)
}

function onModeChange(event: Event): void {
  mode.value = readSelect(event) === 'duplex' ? 'duplex' : 'oneway'
}

function addRule(): void {
  rejection.value = ''
  if (sourceId.value.length === 0 || targetId.value.length === 0) {
    rejection.value = '请选择转发的源会话与目标会话'
    return
  }
  const result = addBridgeRule(sourceId.value, targetId.value, mode.value)
  if (!result.ok) {
    rejection.value = result.error
    return
  }
  sourceId.value = ''
  targetId.value = ''
}

function togglePause(rule: BridgeRule): void {
  setBridgeRulePaused(rule.id, !rule.paused)
}

function removeRule(rule: BridgeRule): void {
  removeBridgeRule(rule.id)
}
</script>

<template>
  <section class="bridge-panel" data-testid="bridge-panel">
    <button
      class="bridge-panel__toggle"
      type="button"
      :aria-expanded="expanded"
      data-testid="bridge-panel-toggle"
      @click="expanded = !expanded"
    >
      <ChevronDown v-if="expanded" :size="13" aria-hidden="true" />
      <ChevronRight v-else :size="13" aria-hidden="true" />
      <span>转发规则</span>
      <UiBadge v-if="bridgeRules.length > 0" tone="accent">{{ bridgeRules.length }}</UiBadge>
    </button>

    <div v-if="expanded" class="bridge-panel__body">
      <div class="bridge-panel__list">
        <div
          v-for="rule in bridgeRules"
          :key="rule.id"
          class="bridge-panel__rule"
          :class="{ 'is-paused': rule.paused }"
          :data-testid="`bridge-rule-${rule.id}`"
        >
          <div class="bridge-panel__rule-main">
            <span class="bridge-panel__direction">{{ directionText(rule) }}</span>
            <UiBadge v-if="rule.paused" tone="warn">已暂停</UiBadge>
            <UiBadge v-if="rule.mode === 'duplex'" tone="accent">双向</UiBadge>
          </div>
          <div class="bridge-panel__stats">
            {{ sessionName(rule.a) }}→{{ sessionName(rule.b) }}：{{ formatBytes(rule.stats.aToB)
            }}<template v-if="rule.mode === 'duplex'">
              · {{ sessionName(rule.b) }}→{{ sessionName(rule.a) }}：{{
                formatBytes(rule.stats.bToA)
              }}</template
            >
            · 丢弃 {{ formatBytes(rule.stats.dropped) }}
          </div>
          <div class="bridge-panel__rule-actions">
            <UiButton size="sm" variant="ghost" @click="togglePause(rule)">
              {{ rule.paused ? '恢复' : '暂停' }}
            </UiButton>
            <UiIconButton label="删除规则" size="sm" variant="danger" @click="removeRule(rule)">
              <Trash2 :size="12" aria-hidden="true" />
            </UiIconButton>
          </div>
        </div>
        <p v-if="bridgeRules.length === 0" class="bridge-panel__hint">还没有转发规则。</p>
      </div>

      <div class="bridge-panel__form">
        <UiFormField label="源会话 A">
          <select
            class="bridge-panel__select"
            :value="sourceId"
            aria-label="源会话"
            data-testid="bridge-source"
            @change="onSourceChange"
          >
            <option value="">选择会话</option>
            <option v-for="session in sessions" :key="session.id" :value="session.id">
              {{ session.name }}
            </option>
          </select>
        </UiFormField>
        <UiFormField label="目标会话 B">
          <select
            class="bridge-panel__select"
            :value="targetId"
            aria-label="目标会话"
            data-testid="bridge-target"
            @change="onTargetChange"
          >
            <option value="">选择会话</option>
            <option v-for="session in sessions" :key="session.id" :value="session.id">
              {{ session.name }}
            </option>
          </select>
        </UiFormField>
        <UiFormField label="方向">
          <select
            class="bridge-panel__select"
            :value="mode"
            aria-label="转发方向"
            data-testid="bridge-mode"
            @change="onModeChange"
          >
            <option v-for="option in modeOptions" :key="option.value" :value="option.value">
              {{ option.label }}
            </option>
          </select>
        </UiFormField>
        <UiButton size="sm" variant="primary" data-testid="bridge-add" @click="addRule">
          <Plus :size="12" aria-hidden="true" />
          添加规则
        </UiButton>
        <p v-if="rejection" class="bridge-panel__error" role="alert" data-testid="bridge-error">
          {{ rejection }}
        </p>
        <p v-if="sessions.length < 2" class="bridge-panel__hint">
          至少需要两个会话才能建立转发规则。
        </p>
      </div>
    </div>
  </section>
</template>

<style scoped>
.bridge-panel {
  display: flex;
  flex-direction: column;
  gap: 4px;
  min-width: 0;
}

.bridge-panel__toggle {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  height: var(--control-h);
  padding: 0 8px;
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  background: var(--bg-elev-2);
  color: var(--text-dim);
  font-size: 12px;
  font-weight: 500;
  letter-spacing: 0.06em;
  text-align: left;
}

.bridge-panel__toggle:hover {
  border-color: var(--border-strong);
  background: var(--bg-hover);
  color: var(--text);
}

.bridge-panel__toggle:focus-visible {
  outline: none;
  box-shadow: var(--focus-ring);
}

.bridge-panel__toggle :deep(.ui-badge) {
  margin-left: auto;
}

.bridge-panel__body {
  display: flex;
  flex-direction: column;
  gap: 8px;
  min-width: 0;
}

.bridge-panel__list {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.bridge-panel__rule {
  display: flex;
  flex-direction: column;
  gap: 3px;
  padding: 6px 8px;
  border: 1px solid var(--border);
  border-left: 2px solid var(--accent);
  border-radius: var(--radius-sm);
  background: var(--bg-sunken);
}

.bridge-panel__rule.is-paused {
  border-left-color: var(--warn);
}

.bridge-panel__rule-main {
  display: flex;
  align-items: center;
  gap: 4px;
  flex-wrap: wrap;
}

.bridge-panel__direction {
  min-width: 0;
  overflow: hidden;
  color: var(--text);
  font-size: 11px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.bridge-panel__stats {
  color: var(--text-faint);
  font-family: var(--font-mono);
  font-size: 10px;
  line-height: 1.4;
  overflow-wrap: anywhere;
}

.bridge-panel__rule-actions {
  display: flex;
  align-items: center;
  gap: 2px;
  margin-left: auto;
}

.bridge-panel__form {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding-top: 8px;
  border-top: 1px solid var(--border);
}

.bridge-panel__select {
  width: 100%;
  height: var(--control-h-sm);
  padding: 0 6px;
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  background: var(--bg-sunken);
  color: var(--text);
  font-family: var(--font-ui);
  font-size: 11px;
}

.bridge-panel__select:hover {
  border-color: var(--border-strong);
}

.bridge-panel__select:focus {
  border-color: var(--accent);
}

.bridge-panel__select:focus-visible {
  outline: none;
  box-shadow: var(--focus-ring);
}

.bridge-panel__hint {
  margin: 0;
  color: var(--text-faint);
  font-size: 11px;
  line-height: 1.5;
}

.bridge-panel__error {
  margin: 0;
  color: var(--danger);
  font-size: 11px;
  line-height: 1.5;
}
</style>
