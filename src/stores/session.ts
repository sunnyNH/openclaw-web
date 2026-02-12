import { ref } from 'vue'
import { defineStore } from 'pinia'
import { useWebSocketStore } from './websocket'
import type { Session, SessionDetail, SessionExport } from '@/api/types'

export const useSessionStore = defineStore('session', () => {
  const sessions = ref<Session[]>([])
  const currentSession = ref<SessionDetail | null>(null)
  const loading = ref(false)

  const wsStore = useWebSocketStore()

  async function fetchSessions() {
    loading.value = true
    try {
      sessions.value = await wsStore.rpc.listSessions()
    } catch (error) {
      sessions.value = []
      console.error('[SessionStore] fetchSessions failed:', error)
    } finally {
      loading.value = false
    }
  }

  async function fetchSession(key: string) {
    loading.value = true
    try {
      currentSession.value = await wsStore.rpc.getSession(key)
    } catch (error) {
      currentSession.value = null
      console.error('[SessionStore] fetchSession failed:', error)
    } finally {
      loading.value = false
    }
  }

  async function resetSession(key: string) {
    await wsStore.rpc.resetSession(key)
    await fetchSessions()
  }

  async function deleteSession(key: string) {
    await wsStore.rpc.deleteSession(key)
    sessions.value = sessions.value.filter((s) => s.key !== key)
  }

  async function exportSession(key: string): Promise<SessionExport> {
    return await wsStore.rpc.exportSession(key)
  }

  return {
    sessions,
    currentSession,
    loading,
    fetchSessions,
    fetchSession,
    resetSession,
    deleteSession,
    exportSession,
  }
})
