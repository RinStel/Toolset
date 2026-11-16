<!-- eslint-disable vue/multi-word-component-names -->
<script setup lang="ts">
import { computed } from 'vue'

import SettingForm from '@/shared/ui/components/SettingForm.vue'
import UiButton from '@/shared/ui/components/UiButton.vue'

import {
  pcbCalcSettings,
  resetPcbCalcSettings,
  SETTINGS_FIELDS,
  updatePcbCalcSettings,
  type PcbCalcSettings,
} from '../stores/settings'

const fields = SETTINGS_FIELDS
const values = computed<Record<string, unknown>>(() => ({ ...pcbCalcSettings }))

function onChange(key: string, value: unknown): void {
  updatePcbCalcSettings({ [key]: value } as Partial<PcbCalcSettings>)
}
</script>

<template>
  <div class="pcb-settings-panel">
    <SettingForm :fields="fields" :model-value="values" @change="onChange" />
    <div>
      <UiButton size="sm" data-testid="pcb-calc-settings-reset" @click="resetPcbCalcSettings">
        恢复默认值
      </UiButton>
    </div>
  </div>
</template>

<style scoped>
.pcb-settings-panel {
  display: flex;
  flex-direction: column;
  gap: 12px;
  min-width: 0;
}
</style>
