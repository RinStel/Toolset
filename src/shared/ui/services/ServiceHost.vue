<script setup lang="ts">
import type { Component } from 'vue'
import { CircleCheck, CircleX, Info, TriangleAlert, X } from 'lucide-vue-next'

import UiDialog from '../components/UiDialog.vue'
import UiIconButton from '../components/UiIconButton.vue'
import { confirmState, settleConfirm } from '../services/confirm'
import { toast, toasts, type ToastType } from '../services/toast'

const toastIcons: Record<ToastType, Component> = {
  info: Info,
  success: CircleCheck,
  warn: TriangleAlert,
  error: CircleX,
}
</script>

<template>
  <div class="service-host">
    <div class="service-host__toasts" aria-live="polite" aria-atomic="false">
      <div
        v-for="item in toasts"
        :key="item.id"
        class="service-toast"
        :class="`service-toast--${item.type}`"
        role="status"
      >
        <component
          :is="toastIcons[item.type]"
          class="service-toast__icon"
          :size="16"
          aria-hidden="true"
        />
        <span class="service-toast__message">{{ item.message }}</span>
        <UiIconButton label="关闭通知" size="sm" @click="toast.dismiss(item.id)">
          <X :size="14" />
        </UiIconButton>
      </div>
    </div>
    <UiDialog
      :model-value="confirmState.open"
      :z-index="3000"
      :title="confirmState.title"
      :danger="confirmState.danger"
      :confirm-text="confirmState.confirmText"
      :cancel-text="confirmState.cancelText"
      width="400px"
      @cancel="settleConfirm(false)"
      @confirm="settleConfirm(true)"
    >
      <p class="service-host__confirm-message">{{ confirmState.message }}</p>
    </UiDialog>
  </div>
</template>

<style scoped>
.service-host {
  display: contents;
}

.service-host__toasts {
  position: fixed;
  /* 头部高度以下：通知不应遮挡顶栏按钮（主题/设置/帮助）。 */
  top: calc(var(--app-header-height, 44px) + var(--space-3));
  right: var(--space-4);
  z-index: var(--z-toast, 3100);
  display: flex;
  flex-direction: column;
  gap: 6px;
  width: min(360px, calc(100vw - 32px));
  pointer-events: none;
}

.service-toast {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  padding: var(--space-2) var(--space-2) var(--space-2) var(--space-3);
  border: 1px solid var(--border);
  border-left-width: 3px;
  border-radius: var(--radius-sm);
  background: var(--bg-elev-2);
  box-shadow: var(--shadow-pop);
  color: var(--text);
  font-size: 12px;
  line-height: 1.5;
  pointer-events: auto;
  animation: service-toast-in 140ms ease;
}

.service-toast__icon {
  flex: none;
}

.service-toast__message {
  flex: 1 1 auto;
  min-width: 0;
  overflow-wrap: anywhere;
}

.service-toast--info {
  border-left-color: var(--accent);
}

.service-toast--info .service-toast__icon {
  color: var(--accent);
}

.service-toast--success {
  border-left-color: var(--ok);
}

.service-toast--success .service-toast__icon {
  color: var(--ok);
}

.service-toast--warn {
  border-left-color: var(--warn);
}

.service-toast--warn .service-toast__icon {
  color: var(--warn);
}

.service-toast--error {
  border-left-color: var(--danger);
}

.service-toast--error .service-toast__icon {
  color: var(--danger);
}

.service-host__confirm-message {
  margin: 0;
  color: var(--text);
  font-size: 12px;
  line-height: 1.7;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}

@keyframes service-toast-in {
  from {
    opacity: 0;
    transform: translateY(-4px);
  }
}
</style>
