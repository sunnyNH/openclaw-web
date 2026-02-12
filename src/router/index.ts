import { createRouter, createWebHistory } from 'vue-router'
import { routes } from './routes'
import { useAuthStore } from '@/stores/auth'

const router = createRouter({
  history: createWebHistory(),
  routes,
})

router.beforeEach((to, _from, next) => {
  // Set page title
  const title = to.meta.title as string | undefined
  document.title = title ? `${title} - OpenClaw Admin` : 'OpenClaw Admin'

  // Auth guard
  if (to.meta.public) {
    next()
    return
  }

  const authStore = useAuthStore()
  if (!authStore.isAuthenticated) {
    next({ name: 'Login', query: { redirect: to.fullPath } })
    return
  }

  next()
})

export default router
