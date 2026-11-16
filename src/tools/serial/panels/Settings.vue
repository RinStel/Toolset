<!-- eslint-disable vue/multi-word-component-names -->
<script setup lang="ts">
/**
 * 串口助手设置面板（plan §8.8）。
 *
 * 由应用外壳的「设置」抽屉挂载，修改后立即写入 `toolset/tool/serial/settings.v1`；
 * 颜色项写入工具根元素的 CSS 变量。日志上限只对新建会话生效，当前会话在下次清空
 * 日志时套用（见 sessions store 的 `clearSessionLog`）。
 */

import { computed, ref } from 'vue'

import UiButton from '@/shared/ui/components/UiButton.vue'
import UiColorInput from '@/shared/ui/components/UiColorInput.vue'
import UiFormField from '@/shared/ui/components/UiFormField.vue'
import SettingForm from '@/shared/ui/components/SettingForm.vue'

import {
  LOG_COLOR_FIELDS,
  SETTINGS_FIELDS,
  estimateSeriesMemoryMb,
  resetSerialColor,
  resetSerialSettings,
  resolveThemeLogColors,
  serialSettings,
  updateSerialSettings,
  type SerialColorKey,
  type SerialToolSettings,
} from '../stores/settings'

const themeColors = ref(resolveThemeLogColors())

const fields = SETTINGS_FIELDS

const values = computed<Record<string, unknown>>(() => ({ ...serialSettings }))

/** 样本缓冲的内存估算（plan §8.8）：样本数 × 变量上限 × 24 字节。 */
const memoryEstimate = computed(() =>
  estimateSeriesMemoryMb(serialSettings.seriesCapacity, serialSettings.maxVariablesPerSource),
)

function onChange(key: string, value: unknown): void {
  updateSerialSettings({ [key]: value } as Partial<SerialToolSettings>)
}

function effectiveColor(key: SerialColorKey, cssVar: string): string {
  const stored = serialSettings[key]
  if (stored !== null) return stored
  return themeColors.value[cssVar] ?? '#000000'
}

function onColorChange(key: SerialColorKey, value: string): void {
  updateSerialSettings({ [key]: value } as Partial<SerialToolSettings>)
}

function isThemeColor(key: SerialColorKey): boolean {
  return serialSettings[key] === null
}
</script>

<template>
  <div class="serial-settings-panel">
    <p class="serial-settings-panel__hint">
      设置保存在当前浏览器中。修改日志上限后只对新建会话生效，当前会话在下次清空日志时套用。
    </p>

    <SettingForm :fields="fields" :model-value="values" @change="onChange" />

    <p class="serial-settings-panel__hint" data-testid="series-memory-estimate">
      样本缓冲内存估算：{{ serialSettings.seriesCapacity }} 样本 ×
      {{ serialSettings.maxVariablesPerSource }} 变量 ≈
      {{ memoryEstimate }} MB（最大）。样本数与变量上限 修改后只对之后新建的变量生效。
    </p>

    <section class="serial-settings-panel__colors">
      <h3 class="serial-settings-panel__heading">日志颜色</h3>
      <p class="serial-settings-panel__hint">
        未覆盖时使用主题默认色；「恢复默认」即清除自定义颜色。
      </p>
      <UiFormField
        v-for="color in LOG_COLOR_FIELDS"
        :key="color.key"
        :label="color.label"
        :data-testid="`setting-${color.key}`"
      >
        <div class="serial-settings-panel__color-row">
          <UiColorInput
            :model-value="effectiveColor(color.key, color.cssVar)"
            :aria-label="color.label"
            @update:model-value="onColorChange(color.key, $event)"
          />
          <UiButton
            size="sm"
            variant="ghost"
            :disabled="isThemeColor(color.key)"
            @click="resetSerialColor(color.key)"
          >
            恢复默认
          </UiButton>
        </div>
      </UiFormField>
    </section>

    <div>
      <UiButton size="sm" data-testid="serial-settings-reset" @click="resetSerialSettings">
        恢复全部默认值
      </UiButton>
    </div>
  </div>
</template>

<style scoped>
.serial-settings-panel {
  display: flex;
  flex-direction: column;
  gap: 12px;
  min-width: 0;
}

.serial-settings-panel__hint {
  margin: 0;
  color: var(--text-faint);
  font-size: 11px;
  line-height: 1.6;
}

.serial-settings-panel__colors {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding-top: 12px;
  border-top: 1px solid var(--border);
}

.serial-settings-panel__heading {
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

.serial-settings-panel__heading::after {
  content: '';
  flex: 1 1 auto;
  height: 1px;
  background: var(--border);
}

.serial-settings-panel__color-row {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
}
</style>
