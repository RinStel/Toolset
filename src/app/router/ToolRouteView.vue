<script setup lang="ts">
import { computed, onBeforeUnmount, onErrorCaptured, ref } from 'vue'
import { RouterView, useRoute, useRouter } from 'vue-router'

import type { ToolManifest } from '@/shared/contracts/tool'

import ToolErrorView from './ToolErrorView.vue'

/** Delay before the loading overlay becomes visible (plan §7.1). */
const LOADING_INDICATOR_DELAY = 200

const route = useRoute()
const router = useRouter()

const tool = computed<ToolManifest | undefined>(() => route.meta.tool as ToolManifest | undefined)
const toolId = computed<string>(() => tool.value?.id ?? String(route.meta.toolId ?? ''))
const layout = computed<'workspace' | 'page'>(() => tool.value?.layout ?? 'page')
const keepAlive = computed<boolean>(() => Boolean(tool.value?.keepAlive))

const errorTitle = ref('该工具出现错误')
const errorMessage = ref('')
const reloadKey = ref(0)

const pending = ref(false)
const spinnerVisible = ref(false)
let revealTimer: ReturnType<typeof setTimeout> | undefined

function startLoading(): void {
  pending.value = true
  if (revealTimer !== undefined) return
  revealTimer = setTimeout(() => {
    revealTimer = undefined
    if (pending.value) spinnerVisible.value = true
  }, LOADING_INDICATOR_DELAY)
}

function stopLoading(): void {
  pending.value = false
  spinnerVisible.value = false
  if (revealTimer !== undefined) {
    clearTimeout(revealTimer)
    revealTimer = undefined
  }
}

function errorToMessage(error: unknown): string {
  if (error instanceof Error) return error.message || error.name
  if (typeof error === 'string') return error
  try {
    return JSON.stringify(error)
  } catch {
    return String(error)
  }
}

function showRenderError(error: unknown): void {
  console.error('[tool-route]', error)
  errorTitle.value = '该工具出现错误'
  errorMessage.value = errorToMessage(error)
  stopLoading()
}

onErrorCaptured((error) => {
  if (!errorMessage.value) showRenderError(error)
  // The error is presented by `ToolErrorView`; do not let it escape the shell.
  return false
})

const removeBeforeResolve = router.beforeResolve((to) => {
  const target = to.meta.tool as ToolManifest | undefined
  if (target?.id === toolId.value && to.fullPath !== route.fullPath) startLoading()
})

const removeAfterEach = router.afterEach(() => {
  stopLoading()
})

const removeOnError = router.onError((error) => {
  console.error('[tool-route]', error)
  errorTitle.value = '该工具出现错误'
  errorMessage.value = '工具加载失败，请检查网络或刷新页面'
  stopLoading()
})

onBeforeUnmount(() => {
  stopLoading()
  removeBeforeResolve()
  removeAfterEach()
  removeOnError()
})

function reloadTool(): void {
  errorMessage.value = ''
  errorTitle.value = '该工具出现错误'
  reloadKey.value += 1
}

function goHome(): void {
  void router.push('/')
}
</script>

<template>
  <div
    class="tool-route"
    :class="[`tool-route--${layout}`]"
    :aria-busy="spinnerVisible || undefined"
  >
    <ToolErrorView
      v-if="errorMessage"
      :title="errorTitle"
      :message="errorMessage"
      @reload="reloadTool"
      @home="goHome"
    />
    <div v-else class="tool-route__content">
      <RouterView v-slot="{ Component, route: currentRoute }">
        <template v-if="Component">
          <KeepAlive v-if="keepAlive">
            <component :is="Component" :key="`${toolId}-${reloadKey}`" />
          </KeepAlive>
          <component v-else :is="Component" :key="`${currentRoute.fullPath}-${reloadKey}`" />
        </template>
      </RouterView>
    </div>
    <div
      v-if="spinnerVisible"
      class="tool-route__loading"
      data-testid="tool-loading"
      role="status"
      aria-live="polite"
    >
      <span class="tool-route__spinner" aria-hidden="true" />
      <span>正在加载…</span>
    </div>
  </div>
</template>

<style scoped>
.tool-route {
  position: relative;
  height: calc(100vh - var(--app-header-height, 44px));
}

.tool-route--workspace {
  overflow: hidden;
}

.tool-route--page {
  overflow: auto;
}

.tool-route__content {
  min-width: 0;
  min-height: 0;
}

.tool-route--workspace .tool-route__content {
  height: 100%;
}

.tool-route--page .tool-route__content {
  max-width: 1200px;
  margin: 0 auto;
  padding: var(--space-4);
}

.tool-route__loading {
  position: absolute;
  inset: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: var(--space-2);
  background: var(--bg);
  color: var(--text-dim);
  font-size: 12px;
  z-index: 10;
}

.tool-route__spinner {
  width: 20px;
  height: 20px;
  border: 2px solid var(--border-strong);
  border-top-color: var(--accent);
  border-radius: 50%;
  animation: tool-route-spin 700ms linear infinite;
}

@keyframes tool-route-spin {
  to {
    transform: rotate(360deg);
  }
}
</style>
