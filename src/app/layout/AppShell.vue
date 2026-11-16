<script setup lang="ts">
import { ref } from 'vue'
import { RouterView } from 'vue-router'

import ServiceHost from '@/shared/ui/services/ServiceHost.vue'

import { APP_HEADER_HEIGHT } from '../config/app'
import AppHeader from './AppHeader.vue'
import HelpPanel from './HelpPanel.vue'
import SettingsDrawer from './SettingsDrawer.vue'

const settingsOpen = ref(false)
const helpOpen = ref(false)
</script>

<template>
  <div class="app-shell" :style="{ '--app-header-height': `${APP_HEADER_HEIGHT}px` }">
    <AppHeader @open-settings="settingsOpen = true" @open-help="helpOpen = true" />
    <main class="app-shell__main">
      <RouterView />
    </main>
    <SettingsDrawer v-model="settingsOpen" />
    <HelpPanel v-model="helpOpen" />
    <ServiceHost />
  </div>
</template>

<style scoped>
.app-shell {
  display: flex;
  flex-direction: column;
  height: 100%;
  background: var(--bg);
}

.app-shell__main {
  flex: 1 1 auto;
  min-height: 0;
  overflow: hidden;
}
</style>
