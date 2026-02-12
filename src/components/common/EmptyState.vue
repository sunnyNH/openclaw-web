<script setup lang="ts">
import { NEmpty } from 'naive-ui'

defineProps<{
  description?: string
}>()
</script>

<template>
  <div style="display: flex; justify-content: center; align-items: center; padding: 60px 0;">
    <NEmpty :description="description || '暂无数据'">
      <template v-if="$slots.extra" #extra>
        <slot name="extra" />
      </template>
    </NEmpty>
  </div>
</template>
