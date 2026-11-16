<script setup lang="ts">
import { ref, watch } from 'vue'

const props = defineProps<{
  svg: string
  ariaLabel?: string
}>()

const hostRef = ref<HTMLElement | null>(null)

watch(
  [hostRef, () => props.svg],
  ([el, markup]) => {
    if (!el) return
    el.innerHTML = markup
  },
  { immediate: true },
)
</script>

<template>
  <div ref="hostRef" class="seal-svg-stage" role="img" :aria-label="ariaLabel" />
</template>

<style scoped>
.seal-svg-stage {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 100%;
  min-width: 0;
}

.seal-svg-stage :deep(svg) {
  display: block;
  width: 100%;
  height: auto;
  border-radius: var(--radius-sm);
  box-shadow: var(--shadow-card);
}
</style>
