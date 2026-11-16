<script setup lang="ts">
import { parseHex } from '../../domains/bytes/public'

export const bytes = parseHex('00')
</script>

<template>
  <div>{{ bytes }}</div>
</template>
