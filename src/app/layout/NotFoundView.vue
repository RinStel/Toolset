<script setup lang="ts">
import { RouterLink } from 'vue-router'
import { FileQuestion } from 'lucide-vue-next'

import UiButton from '@/shared/ui/components/UiButton.vue'
import UiEmpty from '@/shared/ui/components/UiEmpty.vue'
</script>

<template>
  <div class="not-found">
    <UiEmpty
      :icon="FileQuestion"
      title="页面不存在"
      description="你访问的页面不存在或已被移除，请检查地址，或返回首页。"
      data-testid="not-found"
    >
      <template #actions>
        <RouterLink class="not-found__home" to="/">
          <UiButton variant="primary">返回首页</UiButton>
        </RouterLink>
      </template>
    </UiEmpty>
  </div>
</template>

<style scoped>
.not-found {
  display: flex;
  align-items: center;
  justify-content: center;
  height: 100%;
  overflow: auto;
}

.not-found__home {
  text-decoration: none;
}
</style>
