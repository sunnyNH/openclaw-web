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
import { useI18n } from 'vue-i18n'
import { useAuthStore } from '@/stores/auth'
import { useThemeStore, type ThemeMode } from '@/stores/theme'
import { useWebSocketStore } from '@/stores/websocket'
import { ConnectionState } from '@/api/types'

const authStore = useAuthStore()
const themeStore = useThemeStore()
const wsStore = useWebSocketStore()
const message = useMessage()
const { t } = useI18n()

const gatewayUrl = ref(authStore.gatewayUrl)
const token = ref(authStore.token)
const savingConnection = ref(false)
const isHttpsPage = computed(() => {
  if (typeof window === 'undefined') return false
  return window.location.protocol === 'https:'
})
const gatewaySchemeHint = computed(() => {
  const url = gatewayUrl.value.trim()
  if (!url) return ''
  if (!isHttpsPage.value) return ''
  if (!url.toLowerCase().startsWith('ws://')) return ''
  return t('common.httpsWsBlocked')
})

const themeOptions = computed(() => ([
  { label: t('pages.settings.themeLight'), value: 'light' },
  { label: t('pages.settings.themeDark'), value: 'dark' },
]))

const connectionStatus = computed(() => {
  switch (wsStore.state) {
    case ConnectionState.CONNECTED: return { text: t('pages.settings.statusConnected'), type: 'success' as const }
    case ConnectionState.CONNECTING: return { text: t('pages.settings.statusConnecting'), type: 'info' as const }
    case ConnectionState.RECONNECTING: return { text: t('pages.settings.statusReconnecting', { count: wsStore.reconnectAttempts }), type: 'warning' as const }
    case ConnectionState.FAILED: return { text: t('pages.settings.statusFailed'), type: 'error' as const }
    default: return { text: t('pages.settings.statusDisconnected'), type: 'error' as const }
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
      reject(new Error(String(reason || t('pages.settings.connectionFailed'))))
    }

    cleanups.push(wsStore.subscribe('connected', onSuccess))
    cleanups.push(wsStore.subscribe('failed', onFailure))
    cleanups.push(wsStore.subscribe('error', onFailure))

    timer = setTimeout(() => {
      onFailure(t('pages.settings.reconnectTimeout'))
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
    message.success(t('pages.settings.savedAndReconnected'))
  } catch (error) {
    message.error((error as Error).message || t('pages.settings.connectionFailed'))
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
    <NCard :title="t('pages.settings.connectionSettings')" class="app-card">
      <NAlert :type="connectionStatus.type" :bordered="false" style="margin-bottom: 16px;">
        {{ t('pages.settings.currentStatus', { status: connectionStatus.text }) }}
        <span v-if="wsStore.lastError">（{{ wsStore.lastError }}）</span>
      </NAlert>

      <NForm label-placement="left" label-width="120" style="max-width: 500px;">
        <NFormItem :label="t('pages.settings.gatewayUrlLabel')">
          <NInput v-model:value="gatewayUrl" :placeholder="t('pages.settings.gatewayUrlPlaceholder')" />
        </NFormItem>
        <NAlert v-if="gatewaySchemeHint" type="warning" :bordered="false" style="margin: -8px 0 16px;">
          {{ gatewaySchemeHint }}
        </NAlert>
        <NFormItem :label="t('pages.settings.tokenLabel')">
          <NInput v-model:value="token" type="password" show-password-on="click" :placeholder="t('pages.settings.tokenPlaceholder')" />
        </NFormItem>
        <NFormItem>
          <NButton type="primary" :loading="savingConnection" @click="saveConnectionSettings">
            <template #icon><NIcon :component="SaveOutline" /></template>
            {{ t('pages.settings.saveAndReconnect') }}
          </NButton>
        </NFormItem>
      </NForm>
    </NCard>

    <NCard :title="t('pages.settings.appearanceSettings')" class="app-card">
      <NForm label-placement="left" label-width="120" style="max-width: 500px;">
        <NFormItem :label="t('pages.settings.themeMode')">
          <NSelect
            :value="themeStore.mode"
            :options="themeOptions"
            @update:value="handleThemeChange"
          />
        </NFormItem>
      </NForm>
    </NCard>

    <NCard :title="t('pages.settings.about')" class="app-card">
      <NSpace vertical :size="8">
        <NText>OpenClaw Admin v0.1.0</NText>
        <NText depth="3" style="font-size: 13px;">
          {{ t('pages.settings.aboutLine1') }}
        </NText>
        <NText depth="3" style="font-size: 13px;">
          {{ t('pages.settings.aboutLine2') }}
        </NText>
      </NSpace>
    </NCard>
  </NSpace>
</template>
