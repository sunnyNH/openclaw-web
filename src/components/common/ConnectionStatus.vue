<script setup lang="ts">
import { computed } from 'vue'
import { NTag } from 'naive-ui'
import { useI18n } from 'vue-i18n'
import { useWebSocketStore } from '@/stores/websocket'
import { ConnectionState } from '@/api/types'

const wsStore = useWebSocketStore()
const { t } = useI18n()

const status = computed(() => {
  switch (wsStore.state) {
    case ConnectionState.CONNECTED:
      return { label: t('components.connectionStatus.connected'), type: 'success' as const }
    case ConnectionState.CONNECTING:
      return { label: t('components.connectionStatus.connecting'), type: 'info' as const }
    case ConnectionState.RECONNECTING:
      return { label: t('components.connectionStatus.reconnecting'), type: 'warning' as const }
    case ConnectionState.FAILED:
      return { label: t('components.connectionStatus.failed'), type: 'error' as const }
    case ConnectionState.DISCONNECTED:
    default:
      return { label: t('components.connectionStatus.disconnected'), type: 'error' as const }
  }
})
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
