<script setup lang="ts">
/**
 * color 属性编辑器（plan §8.10）。
 *
 * 支持 `auto`：勾选「自动」时写入 `'auto'`（按变量颜色或主题色），取消勾选时退回
 * 上一个具体颜色。
 */
import { computed, ref, watch } from 'vue'

import UiCheckbox from '@/shared/ui/components/UiCheckbox.vue'
import UiColorInput from '@/shared/ui/components/UiColorInput.vue'

import { asString, type PropEditorContext, type PropEditorEmits, type PropFieldOf } from './types'

const props = defineProps<{
  field: PropFieldOf<'color'>
  value: unknown
  context: PropEditorContext
}>()

const emit = defineEmits<PropEditorEmits>()

const FALLBACK_COLOR = '#3b82f6'

const isAuto = computed(() => props.value === 'auto')
const lastColor = ref(FALLBACK_COLOR)

watch(
  () => props.value,
  (value) => {
    if (typeof value === 'string' && value !== 'auto' && value.startsWith('#')) {
      lastColor.value = value
    }
  },
  { immediate: true },
)

const color = computed(() =>
  isAuto.value ? lastColor.value : asString(props.value, props.field.default ?? FALLBACK_COLOR),
)

function onAutoChange(auto: boolean): void {
  emit('update', auto ? 'auto' : lastColor.value)
}

function onColorChange(value: string): void {
  lastColor.value = value
  emit('update', value)
}
</script>

<template>
  <div class="prop-color">
    <UiCheckbox
      :model-value="isAuto"
      label="自动"
      size="sm"
      :data-testid="`prop-color-auto-${field.key}`"
      @update:model-value="onAutoChange"
    />
    <div class="prop-color__body" :class="{ 'is-auto': isAuto }">
      <UiColorInput
        :model-value="color"
        :disabled="isAuto"
        :aria-label="field.label"
        :data-testid="`prop-color-${field.key}`"
        @update:model-value="onColorChange"
      />
    </div>
  </div>
</template>

<style scoped>
.prop-color {
  display: flex;
  flex-direction: column;
  gap: 4px;
  min-width: 0;
}

.prop-color__body.is-auto {
  opacity: 0.55;
}
</style>
