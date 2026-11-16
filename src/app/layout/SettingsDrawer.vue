<script setup lang="ts">
import { computed, defineAsyncComponent, type Component } from 'vue'
import { RotateCcw } from 'lucide-vue-next'

import type { ToolManifest } from '@/shared/contracts/tool'
import UiButton from '@/shared/ui/components/UiButton.vue'
import UiDrawer from '@/shared/ui/components/UiDrawer.vue'
import UiFormField from '@/shared/ui/components/UiFormField.vue'
import UiNumberInput from '@/shared/ui/components/UiNumberInput.vue'
import UiSegmented from '@/shared/ui/components/UiSegmented.vue'

import { tools } from '../registry'
import {
  appearance,
  FONT_SIZE_MAX,
  FONT_SIZE_MIN,
  resetAppearance,
  setDensity,
  setFontSize,
  setTheme,
  setUiStyle,
  themeLabel,
  UI_STYLE_PRESETS,
  type Density,
  type ThemeMode,
  type UiStyleId,
} from '../stores/appearance'

const props = withDefaults(defineProps<{ modelValue?: boolean }>(), { modelValue: false })

const emit = defineEmits<{
  'update:modelValue': [value: boolean]
}>()

interface ToolSettingsPanel {
  tool: ToolManifest
  component: Component
}

const themeOptions = [
  { label: themeLabel('dark'), value: 'dark' },
  { label: themeLabel('light'), value: 'light' },
  { label: themeLabel('system'), value: 'system' },
]

const styleOptions = UI_STYLE_PRESETS.map((preset) => ({
  label: preset.label,
  value: preset.id,
  title: preset.description,
}))

const densityOptions = [
  { label: '紧凑', value: 'compact' },
  { label: '标准', value: 'comfortable' },
]

/**
 * One lazily loaded settings panel per tool. `defineAsyncComponent` only triggers
 * the dynamic import when the drawer actually renders the drawer body, keeping the
 * entry bundle free of tool panels (plan §7.2).
 */
const toolPanels = computed<ToolSettingsPanel[]>(() =>
  tools
    .map((tool) => {
      const loader = tool.settings
      if (!loader) return null
      return { tool, component: defineAsyncComponent(loader) }
    })
    .filter((panel): panel is ToolSettingsPanel => panel !== null),
)

/**
 * The 「数据」 group is lazy as well: backup code only loads when the drawer opens
 * (plan §7.2), keeping it out of the entry chunk.
 */
const dataPanel = defineAsyncComponent(() => import('./DataSettings.vue'))

function onModelUpdate(value: boolean): void {
  emit('update:modelValue', value)
}

function onThemeChange(value: string | number): void {
  setTheme(value as ThemeMode)
}

function onStyleChange(value: string | number): void {
  setUiStyle(value as UiStyleId)
}

function onDensityChange(value: string | number): void {
  setDensity(value as Density)
}

function onFontSizeChange(value: number | null): void {
  if (value !== null) setFontSize(value)
}

function onResetAppearance(): void {
  resetAppearance()
}
</script>

<template>
  <UiDrawer
    :model-value="props.modelValue"
    title="设置"
    width="420px"
    @update:model-value="onModelUpdate"
  >
    <div class="settings-drawer" data-testid="settings-drawer">
      <section class="settings-drawer__group" data-testid="appearance-settings">
        <h3 class="settings-drawer__heading">外观</h3>
        <p class="settings-drawer__hint">外观设置会立即生效，并保存在当前浏览器中。</p>
        <div class="settings-drawer__appearance">
          <UiFormField label="主题" layout="horizontal" data-testid="appearance-theme">
            <UiSegmented
              :model-value="appearance.theme"
              :options="themeOptions"
              aria-label="主题"
              @update:model-value="onThemeChange"
            />
          </UiFormField>
          <UiFormField label="风格" layout="horizontal" data-testid="appearance-style">
            <UiSegmented
              :model-value="appearance.style"
              :options="styleOptions"
              aria-label="风格"
              @update:model-value="onStyleChange"
            />
          </UiFormField>
          <UiFormField
            label="字号"
            hint="可调范围 12–18px，默认 13px"
            layout="horizontal"
            data-testid="appearance-font-size"
          >
            <UiNumberInput
              :model-value="appearance.fontSize"
              :min="FONT_SIZE_MIN"
              :max="FONT_SIZE_MAX"
              :step="1"
              unit="px"
              aria-label="字号"
              @update:model-value="onFontSizeChange"
            />
          </UiFormField>
          <UiFormField label="界面密度" layout="horizontal" data-testid="appearance-density">
            <UiSegmented
              :model-value="appearance.density"
              :options="densityOptions"
              aria-label="界面密度"
              @update:model-value="onDensityChange"
            />
          </UiFormField>
        </div>
        <div class="settings-drawer__reset">
          <UiButton size="sm" data-testid="appearance-reset" @click="onResetAppearance">
            <RotateCcw :size="13" aria-hidden="true" />
            重置外观
          </UiButton>
        </div>
      </section>

      <section
        v-for="panel in toolPanels"
        :key="panel.tool.id"
        class="settings-drawer__group"
        :data-testid="`tool-settings-${panel.tool.id}`"
      >
        <h3 class="settings-drawer__heading">{{ panel.tool.title }}</h3>
        <component :is="panel.component" />
      </section>

      <section class="settings-drawer__group" data-testid="data-settings-group">
        <h3 class="settings-drawer__heading">数据</h3>
        <component :is="dataPanel" />
      </section>
    </div>
  </UiDrawer>
</template>

<style scoped>
.settings-drawer {
  display: flex;
  flex-direction: column;
  gap: var(--space-5);
}

.settings-drawer__group {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.settings-drawer__group + .settings-drawer__group {
  padding-top: var(--space-4);
  border-top: 1px solid var(--border);
}

.settings-drawer__heading {
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

.settings-drawer__heading::after {
  content: '';
  flex: 1 1 auto;
  height: 1px;
  background: var(--border);
}

.settings-drawer__hint {
  margin: 0;
  color: var(--text-dim);
  font-size: 11px;
  line-height: 1.6;
}

.settings-drawer__appearance {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.settings-drawer__appearance :deep(.ui-form-field--horizontal) {
  grid-template-columns: 64px minmax(0, 1fr);
}

.settings-drawer__reset {
  display: flex;
  justify-content: flex-start;
  padding-top: 2px;
}
</style>
