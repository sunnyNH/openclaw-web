import { ref } from 'vue'
import { defineStore } from 'pinia'
import { useWebSocketStore } from './websocket'
import type { Session, SessionDetail, SessionExport } from '@/api/types'

export const useSessionStore = defineStore('session', () => {
  const sessions = ref<Session[]>([])
  const currentSession = ref<SessionDetail | null>(null)
  const loading = ref(false)

  const wsStore = useWebSocketStore()

  function mergeMessageCountsFromUsage(baseSessions: Session[], usage: unknown): Session[] {
    if (!Array.isArray(baseSessions) || baseSessions.length === 0) return baseSessions
    if (!usage || typeof usage !== 'object') return baseSessions

    const usageRow = usage as { sessions?: unknown[] }
    const usageList = Array.isArray(usageRow.sessions) ? usageRow.sessions : []
    if (usageList.length === 0) return baseSessions

    const usageCountMap = new Map<string, number>()
    for (const item of usageList) {
      if (!item || typeof item !== 'object') continue
      const row = item as {
        key?: unknown
        usage?: { messageCounts?: { total?: unknown } }
      }
      const key = typeof row.key === 'string' ? row.key.trim() : ''
      if (!key) continue

      const totalRaw = row.usage?.messageCounts?.total
      let total = 0
      if (typeof totalRaw === 'number' && Number.isFinite(totalRaw)) {
        total = Math.max(0, Math.floor(totalRaw))
      } else if (typeof totalRaw === 'string' && totalRaw.trim()) {
        const parsed = Number(totalRaw)
        total = Number.isFinite(parsed) ? Math.max(0, Math.floor(parsed)) : 0
      }

      if (total > 0) {
        usageCountMap.set(key, total)
      }
    }

    if (usageCountMap.size === 0) return baseSessions

    return baseSessions.map((session) => {
      const usageCount = usageCountMap.get(session.key)
      if (usageCount === undefined || usageCount <= 0) return session
      if (session.messageCount >= usageCount) return session
      return {
        ...session,
        messageCount: usageCount,
      }
    })
  }

  async function fetchSessions() {
    loading.value = true
    try {
      const list = await wsStore.rpc.listSessions()
      const hasMessageCount = list.some((item) => item.messageCount > 0)
      if (hasMessageCount || list.length === 0) {
        sessions.value = list
        return
      }

      try {
        const usage = await wsStore.rpc.getSessionsUsage({
          limit: Math.max(200, list.length * 4),
        })
        sessions.value = mergeMessageCountsFromUsage(list, usage)
      } catch {
        sessions.value = list
      }
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
