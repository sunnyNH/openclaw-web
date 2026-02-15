<script setup lang="ts">
import { computed, ref } from 'vue'
import { useRouter, useRoute } from 'vue-router'
import { NCard, NInput, NButton, NSpace, NText, NAlert } from 'naive-ui'
import { useI18n } from 'vue-i18n'
import { useAuthStore } from '@/stores/auth'
import { OpenClawWebSocket } from '@/api/websocket'

const router = useRouter()
const route = useRoute()
const authStore = useAuthStore()
const { t } = useI18n()

const token = ref(authStore.token)
const gatewayUrl = ref(authStore.gatewayUrl)
const loading = ref(false)
const error = ref('')

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

async function handleLogin() {
  if (!token.value.trim()) {
    error.value = t('pages.login.inputTokenRequired')
    return
  }

  if (gatewaySchemeHint.value) {
    error.value = gatewaySchemeHint.value
    return
  }

  loading.value = true
  error.value = ''

  try {
    // 复用同一套握手逻辑（connect.challenge -> connect(device signature)）
    const probe = new OpenClawWebSocket({
      reconnect: false,
      maxReconnectAttempts: 0,
    })

    await new Promise<void>((resolve, reject) => {
      let settled = false
      const timer = setTimeout(() => {
        if (settled) return
        settled = true
        probe.disconnect()
        reject(new Error(t('pages.login.connectTimeout')))
      }, 8000)

      const cleanup = () => {
        clearTimeout(timer)
        offConnected()
        offFailed()
        offDisconnected()
        probe.disconnect()
      }

      const offConnected = probe.on('connected', () => {
        if (settled) return
        settled = true
        cleanup()
        resolve()
      })

      const offFailed = probe.on('failed', (reason: unknown) => {
        if (settled) return
        settled = true
        cleanup()
        reject(new Error(String(reason || t('pages.login.tokenInvalid'))))
      })

      const offDisconnected = probe.on('disconnected', (code: unknown, reason: unknown) => {
        if (settled) return
        settled = true
        cleanup()
        const message =
          typeof reason === 'string' && reason.trim()
            ? reason
            : t('pages.login.connectionClosedWithCode', { code: String(code) })
        reject(new Error(message))
      })

      probe.connect(gatewayUrl.value, token.value)
    })

    authStore.setToken(token.value)
    authStore.setGatewayUrl(gatewayUrl.value)

    const redirect = (route.query.redirect as string) || '/'
    router.push(redirect)
  } catch (e) {
    error.value = (e as Error).message
  } finally {
    loading.value = false
  }
}
</script>

<template>
  <div style="min-height: 100vh; display: flex; align-items: center; justify-content: center; background: var(--bg-secondary); padding: 20px;">
    <NCard
      style="max-width: 420px; width: 100%; border-radius: var(--radius-lg);"
      :bordered="true"
    >
      <div style="text-align: center; margin-bottom: 32px;">
        <span style="font-size: 48px; display: block; margin-bottom: 12px;">🦞</span>
        <NText strong style="font-size: 24px; letter-spacing: -0.5px;">
          OpenClaw Admin
        </NText>
        <div style="margin-top: 8px;">
          <NText depth="3" style="font-size: 14px;">
            {{ t('pages.login.subtitle') }}
          </NText>
        </div>
      </div>

      <NSpace vertical :size="16">
        <div>
          <NText depth="3" style="font-size: 13px; margin-bottom: 6px; display: block;">
            {{ t('pages.login.gatewayUrlLabel') }}
          </NText>
          <NInput
            v-model:value="gatewayUrl"
            :placeholder="t('pages.login.gatewayUrlPlaceholder')"
            :disabled="loading"
          />
          <NAlert v-if="gatewaySchemeHint" type="warning" :bordered="false" style="margin-top: 10px;">
            {{ gatewaySchemeHint }}
          </NAlert>
        </div>

        <div>
          <NText depth="3" style="font-size: 13px; margin-bottom: 6px; display: block;">
            {{ t('pages.login.tokenLabel') }}
          </NText>
          <NInput
            v-model:value="token"
            type="password"
            show-password-on="click"
            :placeholder="t('pages.login.tokenPlaceholder')"
            :disabled="loading"
            @keydown.enter="handleLogin"
          />
          <NText depth="3" style="font-size: 12px; margin-top: 4px; display: block;">
            {{ t('pages.login.tokenHintPrefix') }}
            <code style="background: var(--bg-secondary); padding: 1px 4px; border-radius: 3px;">openclaw config get gateway.auth.token</code>
            {{ t('pages.login.tokenHintSuffix') }}
          </NText>
        </div>

        <NAlert v-if="error" type="error" :bordered="false">
          {{ error }}
        </NAlert>

        <NButton
          type="primary"
          block
          :loading="loading"
          size="large"
          style="border-radius: 8px;"
          @click="handleLogin"
        >
          {{ t('pages.login.connect') }}
        </NButton>
      </NSpace>
    </NCard>
  </div>
</template>
