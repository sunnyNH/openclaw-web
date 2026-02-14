<script setup lang="ts">
import { computed, ref } from 'vue'
import { useRouter, useRoute } from 'vue-router'
import { NCard, NInput, NButton, NSpace, NText, NAlert } from 'naive-ui'
import { useI18n } from 'vue-i18n'
import { useAuthStore } from '@/stores/auth'
import { buildConnectParams } from '@/api/connect'

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

function buildGatewayUrl(url: string, tokenValue: string): string {
  try {
    const parsed = new URL(url, window.location.href)
    if (tokenValue.trim()) {
      parsed.searchParams.set('auth', tokenValue)
    } else {
      parsed.searchParams.delete('auth')
    }
    return parsed.toString()
  } catch {
    return url
  }
}

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
    // Test connection
    const ws = new WebSocket(buildGatewayUrl(gatewayUrl.value, token.value))
    const connectId = `connect-${Date.now()}`

    await new Promise<void>((resolve, reject) => {
      let settled = false
      const timer = setTimeout(() => {
        if (settled) return
        settled = true
        ws.close()
        reject(new Error(t('pages.login.connectTimeout')))
      }, 8000)

      ws.onopen = () => {
        // Gateway 要求第一条消息必须是 connect 握手
        const connectFrame = {
          type: 'req',
          id: connectId,
          method: 'connect',
          params: buildConnectParams(token.value),
        }
        ws.send(JSON.stringify(connectFrame))
      }

      ws.onmessage = (event) => {
        try {
          const res = JSON.parse(event.data) as { type?: string; id?: string; ok?: boolean; error?: { message?: string } }
          if (res.type !== 'res' || res.id !== connectId) {
            return
          }

          clearTimeout(timer)
          if (settled) return
          settled = true

          if (res.ok) {
            ws.close()
            resolve()
          } else {
            ws.close()
            reject(new Error(res.error?.message || t('pages.login.tokenInvalid')))
          }
        } catch {
          // 只忽略非 JSON 消息，继续等待 connect 响应
        }
      }

      ws.onclose = (event) => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        if (event.code !== 1000) {
          reject(new Error(event.reason || t('pages.login.connectionClosedWithCode', { code: event.code })))
        } else {
          reject(new Error(t('pages.login.connectionClosed')))
        }
      }

      ws.onerror = () => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        reject(new Error(t('pages.login.connectFailed')))
      }
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
