<script setup lang="ts">
import { computed, defineAsyncComponent, type Component } from 'vue'

import type { ToolManifest } from '@/shared/contracts/tool'
import UiDrawer from '@/shared/ui/components/UiDrawer.vue'

import { tools } from '../registry'

const props = withDefaults(defineProps<{ modelValue?: boolean }>(), { modelValue: false })

const emit = defineEmits<{
  'update:modelValue': [value: boolean]
}>()

interface ToolHelpPanel {
  tool: ToolManifest
  component: Component
}

/** Help components are imported only when the drawer opens (plan §7.2). */
const toolPanels = computed<ToolHelpPanel[]>(() =>
  tools
    .map((tool) => {
      const loader = tool.help
      if (!loader) return null
      return { tool, component: defineAsyncComponent(loader) }
    })
    .filter((panel): panel is ToolHelpPanel => panel !== null),
)

const shortcuts = [
  { keys: 'Esc', description: '关闭弹窗、下拉菜单或抽屉' },
  { keys: 'Ctrl / ⌘ + Enter', description: '发送当前串口输入' },
  { keys: 'Alt + 1…9', description: '切换串口会话标签页' },
]

function onModelUpdate(value: boolean): void {
  emit('update:modelValue', value)
}
</script>

<template>
  <UiDrawer
    :model-value="props.modelValue"
    title="帮助"
    width="380px"
    @update:model-value="onModelUpdate"
  >
    <div class="help-panel" data-testid="help-panel">
      <section class="help-panel__group" data-testid="help-shell">
        <h3 class="help-panel__heading">环境与快捷键</h3>
        <p class="help-panel__text">
          通过 HTTPS 或 localhost / 127.0.0.1 使用 Chrome / Edge 89+
          连接真实串口；演示端口在任意桌面浏览器可用。
        </p>
        <ul class="help-panel__shortcuts">
          <li v-for="shortcut in shortcuts" :key="shortcut.keys" class="help-panel__shortcut">
            <kbd class="help-panel__kbd">{{ shortcut.keys }}</kbd>
            <span class="help-panel__text">{{ shortcut.description }}</span>
          </li>
        </ul>
      </section>

      <section
        v-for="panel in toolPanels"
        :key="panel.tool.id"
        class="help-panel__group"
        :data-testid="`tool-help-${panel.tool.id}`"
      >
        <h3 class="help-panel__heading">{{ panel.tool.title }}</h3>
        <component :is="panel.component" />
      </section>
    </div>
  </UiDrawer>
</template>

<style scoped>
.help-panel {
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
}

.help-panel__group {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.help-panel__group + .help-panel__group {
  padding-top: var(--space-3);
  border-top: 1px solid var(--border);
}

.help-panel__heading {
  display: flex;
  align-items: center;
  gap: 10px;
  margin: 0;
  color: var(--text-faint);
  font-size: 11px;
  font-weight: 500;
  letter-spacing: 0.08em;
  text-transform: uppercase;
}

.help-panel__heading::after {
  content: '';
  flex: 1 1 auto;
  height: 1px;
  background: var(--border);
}

.help-panel__text {
  margin: 0;
  color: var(--text-dim);
  font-size: 12px;
  line-height: 1.6;
}

.help-panel__shortcuts {
  display: flex;
  flex-direction: column;
  gap: 6px;
  margin: 0;
  padding: 0;
  list-style: none;
}

.help-panel__shortcut {
  display: flex;
  align-items: baseline;
  gap: var(--space-2);
}

.help-panel__kbd {
  flex: none;
  min-width: 112px;
  padding: 1px var(--space-1);
  border: 1px solid var(--border);
  border-radius: 2px;
  background: var(--bg-sunken);
  color: var(--text);
  font-family: var(--font-mono);
  font-size: 10px;
  text-align: center;
}
</style>
