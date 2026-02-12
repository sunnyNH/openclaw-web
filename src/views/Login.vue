<script setup lang="ts">
import { ref } from 'vue'
import { useRouter, useRoute } from 'vue-router'
import { NCard, NInput, NButton, NSpace, NText, NAlert } from 'naive-ui'
import { useAuthStore } from '@/stores/auth'
import { useTheme } from '@/composables/useTheme'
import { NConfigProvider, NMessageProvider } from 'naive-ui'
import { buildConnectParams } from '@/api/connect'

const router = useRouter()
const route = useRoute()
const authStore = useAuthStore()
const { theme } = useTheme()

const token = ref(authStore.token)
const gatewayUrl = ref(authStore.gatewayUrl)
const loading = ref(false)
const error = ref('')

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
    error.value = '请输入 Gateway Token'
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
        reject(new Error('连接超时，请检查 Gateway 地址'))
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
            reject(new Error(res.error?.message || 'Token 验证失败'))
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
          reject(new Error(event.reason || `连接已关闭 (code ${event.code})`))
        } else {
          reject(new Error('连接已关闭'))
        }
      }

      ws.onerror = () => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        reject(new Error('连接失败，请检查 Gateway 地址'))
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
  <NConfigProvider :theme="theme">
    <NMessageProvider>
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
                连接到 OpenClaw Gateway 管理你的 AI 助手
              </NText>
            </div>
          </div>

          <NSpace vertical :size="16">
            <div>
              <NText depth="3" style="font-size: 13px; margin-bottom: 6px; display: block;">
                Gateway 地址
              </NText>
              <NInput
                v-model:value="gatewayUrl"
                placeholder="ws://127.0.0.1:18789"
                :disabled="loading"
              />
            </div>

            <div>
              <NText depth="3" style="font-size: 13px; margin-bottom: 6px; display: block;">
                Gateway Token
              </NText>
              <NInput
                v-model:value="token"
                type="password"
                show-password-on="click"
                placeholder="输入你的 Gateway Token"
                :disabled="loading"
                @keydown.enter="handleLogin"
              />
              <NText depth="3" style="font-size: 12px; margin-top: 4px; display: block;">
                运行 <code style="background: var(--bg-secondary); padding: 1px 4px; border-radius: 3px;">openclaw config get gateway.auth.token</code> 获取 Token
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
              连接
            </NButton>
          </NSpace>
        </NCard>
      </div>
    </NMessageProvider>
  </NConfigProvider>
</template>
