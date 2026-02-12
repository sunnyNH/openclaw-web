<script setup lang="ts">
import { ref, computed } from 'vue'
import {
  NCard,
  NSpace,
  NButton,
  NIcon,
  NForm,
  NFormItem,
  NInput,
  NSelect,
  NText,
  NDivider,
  NAlert,
  useMessage,
} from 'naive-ui'
import { SaveOutline } from '@vicons/ionicons5'
import { useAuthStore } from '@/stores/auth'
import { useThemeStore, type ThemeMode } from '@/stores/theme'
import { useWebSocketStore } from '@/stores/websocket'
import { ConnectionState } from '@/api/types'

const authStore = useAuthStore()
const themeStore = useThemeStore()
const wsStore = useWebSocketStore()
const message = useMessage()

const gatewayUrl = ref(authStore.gatewayUrl)
const token = ref(authStore.token)
const savingConnection = ref(false)

const themeOptions = [
  { label: '浅色模式', value: 'light' },
  { label: '深色模式', value: 'dark' },
]

const connectionStatus = computed(() => {
  switch (wsStore.state) {
    case ConnectionState.CONNECTED: return { text: '已连接', type: 'success' as const }
    case ConnectionState.CONNECTING: return { text: '连接中...', type: 'info' as const }
    case ConnectionState.RECONNECTING: return { text: `重连中 (第 ${wsStore.reconnectAttempts} 次)`, type: 'warning' as const }
    case ConnectionState.FAILED: return { text: '连接失败', type: 'error' as const }
    default: return { text: '已断开', type: 'error' as const }
  }
})

function waitForReconnect(timeout = 12000): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    const cleanups: Array<() => void> = []
    let timer: ReturnType<typeof setTimeout> | null = null

    const cleanupAll = () => {
      cleanups.forEach((cleanup) => cleanup())
      if (timer) {
        clearTimeout(timer)
        timer = null
      }
    }

    const onSuccess = () => {
      cleanupAll()
      resolve()
    }

    const onFailure = (reason: unknown) => {
      cleanupAll()
      reject(new Error(String(reason || '连接失败')))
    }

    cleanups.push(wsStore.subscribe('connected', onSuccess))
    cleanups.push(wsStore.subscribe('failed', onFailure))
    cleanups.push(wsStore.subscribe('error', onFailure))

    timer = setTimeout(() => {
      onFailure('重连超时')
    }, timeout)
  })
}

async function saveConnectionSettings() {
  if (savingConnection.value) return
  savingConnection.value = true

  authStore.setGatewayUrl(gatewayUrl.value)
  authStore.setToken(token.value)

  const reconnectPromise = waitForReconnect()
  wsStore.disconnect()
  wsStore.connect(gatewayUrl.value, token.value)

  try {
    await reconnectPromise
    message.success('连接设置已保存并重连成功')
  } catch (error) {
    message.error((error as Error).message || '连接失败')
  } finally {
    savingConnection.value = false
  }
}

function handleThemeChange(mode: ThemeMode) {
  themeStore.setMode(mode)
}
</script>

<template>
  <NSpace vertical :size="16">
    <NCard title="连接设置" class="app-card">
      <NAlert :type="connectionStatus.type" :bordered="false" style="margin-bottom: 16px;">
        当前状态：{{ connectionStatus.text }}
        <span v-if="wsStore.lastError">（{{ wsStore.lastError }}）</span>
      </NAlert>

      <NForm label-placement="left" label-width="120" style="max-width: 500px;">
        <NFormItem label="Gateway 地址">
          <NInput v-model:value="gatewayUrl" placeholder="ws://127.0.0.1:18789" />
        </NFormItem>
        <NFormItem label="Token">
          <NInput v-model:value="token" type="password" show-password-on="click" placeholder="Gateway Token" />
        </NFormItem>
        <NFormItem>
          <NButton type="primary" :loading="savingConnection" @click="saveConnectionSettings">
            <template #icon><NIcon :component="SaveOutline" /></template>
            保存并重连
          </NButton>
        </NFormItem>
      </NForm>
    </NCard>

    <NCard title="外观设置" class="app-card">
      <NForm label-placement="left" label-width="120" style="max-width: 500px;">
        <NFormItem label="主题模式">
          <NSelect
            :value="themeStore.mode"
            :options="themeOptions"
            @update:value="handleThemeChange"
          />
        </NFormItem>
      </NForm>
    </NCard>

    <NCard title="关于" class="app-card">
      <NSpace vertical :size="8">
        <NText>OpenClaw Admin v0.1.0</NText>
        <NText depth="3" style="font-size: 13px;">
          OpenClaw Gateway 管理后台
        </NText>
        <NText depth="3" style="font-size: 13px;">
          基于 Vue 3 + Naive UI 构建
        </NText>
      </NSpace>
    </NCard>
  </NSpace>
</template>
