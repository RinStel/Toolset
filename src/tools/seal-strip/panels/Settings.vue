<!-- eslint-disable vue/multi-word-component-names -->
<script setup lang="ts">
import { computed } from 'vue'

import SettingForm from '@/shared/ui/components/SettingForm.vue'
import UiButton from '@/shared/ui/components/UiButton.vue'

import {
  resetSealStripSettings,
  sealStripSettings,
  SETTINGS_FIELDS,
  updateSealStripSettings,
  type SealStripSettings,
} from '../stores/settings'

const fields = SETTINGS_FIELDS
const values = computed<Record<string, unknown>>(() => ({ ...sealStripSettings }))

function onChange(key: string, value: unknown): void {
  updateSealStripSettings({ [key]: value } as Partial<SealStripSettings>)
}
</script>

<template>
  <div class="seal-settings-panel">
    <SettingForm :fields="fields" :model-value="values" @change="onChange" />
    <div>
      <UiButton size="sm" data-testid="seal-strip-settings-reset" @click="resetSealStripSettings">
        恢复默认值
      </UiButton>
    </div>
  </div>
</template>

<style scoped>
.seal-settings-panel {
  display: flex;
  flex-direction: column;
  gap: 12px;
  min-width: 0;
}
</style>
