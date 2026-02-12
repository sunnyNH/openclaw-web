<script setup lang="ts">
import { computed } from 'vue'
import { NTag } from 'naive-ui'
import { useWebSocketStore } from '@/stores/websocket'
import { ConnectionState } from '@/api/types'

const wsStore = useWebSocketStore()

const statusMap: Record<ConnectionState, { label: string; type: 'success' | 'warning' | 'error' | 'info' }> = {
  [ConnectionState.CONNECTED]: { label: '已连接', type: 'success' },
  [ConnectionState.CONNECTING]: { label: '连接中...', type: 'info' },
  [ConnectionState.RECONNECTING]: { label: '重连中...', type: 'warning' },
  [ConnectionState.DISCONNECTED]: { label: '已断开', type: 'error' },
  [ConnectionState.FAILED]: { label: '连接失败', type: 'error' },
}

const status = computed(() => statusMap[wsStore.state])
</script>

<template>
  <NTag
    :type="status.type"
    round
    size="small"
    :bordered="false"
  >
    <template #icon>
      <span
        style="display: inline-block; width: 6px; height: 6px; border-radius: 50%; margin-right: 4px;"
        :style="{
          backgroundColor: status.type === 'success' ? '#18a058' : status.type === 'warning' ? '#f0a020' : status.type === 'error' ? '#d03050' : '#2080f0'
        }"
      />
    </template>
    {{ status.label }}
  </NTag>
</template>
