import { createRouter, createWebHistory } from 'vue-router'
import { routes } from './routes'
import { useAuthStore } from '@/stores/auth'

const router = createRouter({
  history: createWebHistory(),
  routes,
})

function applyAuthFromUrl(authStore: ReturnType<typeof useAuthStore>): void {
  if (typeof window === 'undefined') return
  if (!window.location.search && !window.location.hash) return

  const url = new URL(window.location.href)
  const params = new URLSearchParams(url.search)
  const hashParams = new URLSearchParams(url.hash.startsWith('#') ? url.hash.slice(1) : url.hash)
  const tokenRaw = params.get('token') ?? hashParams.get('token')
  const gatewayUrlRaw = params.get('gatewayUrl') ?? hashParams.get('gatewayUrl')

  let shouldCleanUrl = false

  if (tokenRaw != null) {
    const token = tokenRaw.trim()
    if (token && token !== authStore.token) {
      authStore.setToken(token)
    }
    params.delete('token')
    hashParams.delete('token')
    shouldCleanUrl = true
  }

  if (gatewayUrlRaw != null) {
    const gatewayUrl = gatewayUrlRaw.trim()
    if (gatewayUrl && gatewayUrl !== authStore.gatewayUrl) {
      authStore.setGatewayUrl(gatewayUrl)
    }
    params.delete('gatewayUrl')
    hashParams.delete('gatewayUrl')
    shouldCleanUrl = true
  }

  if (!shouldCleanUrl) return

  url.search = params.toString()
  const nextHash = hashParams.toString()
  url.hash = nextHash ? `#${nextHash}` : ''
  window.history.replaceState({}, '', url.toString())
}

router.beforeEach((to, _from, next) => {
  const authStore = useAuthStore()
  applyAuthFromUrl(authStore)

  // Auth guard
  if (to.meta.public) {
    if (to.name === 'Login' && authStore.isAuthenticated) {
      const redirect = typeof to.query.redirect === 'string' ? to.query.redirect : '/'
      next(redirect)
      return
    }
    next()
    return
  }

  if (!authStore.isAuthenticated) {
    next({ name: 'Login', query: { redirect: to.fullPath } })
    return
  }

  next()
})

export default router
