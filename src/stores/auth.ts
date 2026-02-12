import { ref, computed } from 'vue'
import { defineStore } from 'pinia'

const STORAGE_KEY = 'openclaw_auth'

export const useAuthStore = defineStore('auth', () => {
  const token = ref<string>(localStorage.getItem(STORAGE_KEY) || '')
  const gatewayUrl = ref<string>(
    localStorage.getItem('openclaw_gateway_url') || import.meta.env.VITE_WS_URL || 'ws://127.0.0.1:18789'
  )

  const isAuthenticated = computed(() => !!token.value)

  function setToken(newToken: string) {
    token.value = newToken
    localStorage.setItem(STORAGE_KEY, newToken)
  }

  function setGatewayUrl(url: string) {
    gatewayUrl.value = url
    localStorage.setItem('openclaw_gateway_url', url)
  }

  function logout() {
    token.value = ''
    localStorage.removeItem(STORAGE_KEY)
  }

  return {
    token,
    gatewayUrl,
    isAuthenticated,
    setToken,
    setGatewayUrl,
    logout,
  }
})
