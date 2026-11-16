<script setup lang="ts">
/**
 * 组件空状态（plan §8.11 公共约定 / §9）。
 *
 * 三种文案由调用方通过 `text` 传入：未绑定变量 / 等待数据… / 数据源未连接。
 */

defineOptions({ name: 'WidgetEmptyState' })

defineProps<{
  text: string
  /** 是否在空状态上方显示一个小图标。 */
  icon?: boolean
}>()
</script>

<template>
  <div class="widget-empty" data-empty-state role="status">
    <span v-if="icon" class="widget-empty__icon" aria-hidden="true">◌</span>
    <span class="widget-empty__text">{{ text }}</span>
  </div>
</template>

<style scoped>
.widget-empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 4px;
  width: 100%;
  height: 100%;
  min-width: 0;
  min-height: 0;
  color: var(--text-faint);
  font-size: 11px;
  line-height: 1.4;
  text-align: center;
  user-select: none;
}

.widget-empty__icon {
  color: var(--border-strong);
  font-size: 16px;
}

.widget-empty__text {
  max-width: 100%;
  overflow-wrap: anywhere;
}
</style>
