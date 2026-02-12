import { ref } from 'vue'
import { defineStore } from 'pinia'
import { useWebSocketStore } from './websocket'
import type { ChatMessage } from '@/api/types'

export const useChatStore = defineStore('chat', () => {
  const sessionKey = ref('')
  const messages = ref<ChatMessage[]>([])
  const loading = ref(false)
  const syncing = ref(false)
  const sending = ref(false)
  const lastError = ref<string | null>(null)
  const lastSyncedAt = ref<number | null>(null)
  let refreshTimer: ReturnType<typeof setTimeout> | null = null
  let pollTimers: Array<ReturnType<typeof setTimeout>> = []
  let streamFlushRaf: number | null = null
  let pendingStreamMessages: ChatMessage[] = []

  const wsStore = useWebSocketStore()

  function setSessionKey(key: string) {
    sessionKey.value = key.trim()
    pendingStreamMessages = []
    if (streamFlushRaf !== null) {
      cancelAnimationFrame(streamFlushRaf)
      streamFlushRaf = null
    }
  }

  async function fetchHistory(
    key = sessionKey.value,
    options?: {
      silent?: boolean
      clearError?: boolean
    }
  ) {
    if (!key.trim()) {
      messages.value = []
      return
    }

    const silent = options?.silent ?? false
    const clearError = options?.clearError ?? !silent
    if (silent && syncing.value) {
      return
    }

    if (silent) {
      syncing.value = true
    } else {
      loading.value = true
    }
    if (clearError) {
      lastError.value = null
    }

    try {
      const normalizedKey = key.trim()
      sessionKey.value = normalizedKey
      messages.value = await wsStore.rpc.listChatHistory(normalizedKey)
      lastSyncedAt.value = Date.now()
    } catch (error) {
      if (!silent || clearError) {
        lastError.value = error instanceof Error ? error.message : String(error)
      }
      console.error('[ChatStore] fetchHistory failed:', error)
    } finally {
      if (silent) {
        syncing.value = false
      } else {
        loading.value = false
      }
    }
  }

  function clearTimers() {
    if (refreshTimer) {
      clearTimeout(refreshTimer)
      refreshTimer = null
    }
    for (const timer of pollTimers) {
      clearTimeout(timer)
    }
    pollTimers = []
    if (streamFlushRaf !== null) {
      cancelAnimationFrame(streamFlushRaf)
      streamFlushRaf = null
    }
    pendingStreamMessages = []
  }

  function scheduleHistoryRefresh(delay = 250) {
    if (!sessionKey.value.trim()) return
    if (refreshTimer) {
      clearTimeout(refreshTimer)
      refreshTimer = null
    }
    refreshTimer = setTimeout(() => {
      fetchHistory(sessionKey.value, { silent: true, clearError: false })
    }, delay)
  }

  function schedulePostSendRefreshes() {
    if (!sessionKey.value.trim()) return
    clearTimers()
    // 发送后做低频兜底刷新，避免高频回拉导致列表抖动
    for (const delay of [1400, 4200]) {
      const timer = setTimeout(() => {
        fetchHistory(sessionKey.value, { silent: true, clearError: false })
      }, delay)
      pollTimers.push(timer)
    }
  }

  function extractSessionKey(payload: unknown): string {
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return ''
    const row = payload as Record<string, unknown>
    if (typeof row.sessionKey === 'string') return row.sessionKey
    if (typeof row.key === 'string') return row.key
    if (row.session && typeof row.session === 'object' && !Array.isArray(row.session)) {
      const session = row.session as Record<string, unknown>
      if (typeof session.key === 'string') return session.key
      if (typeof session.sessionKey === 'string') return session.sessionKey
    }
    return ''
  }

  function asRecord(value: unknown): Record<string, unknown> | null {
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      return value as Record<string, unknown>
    }
    return null
  }

  function asText(value: unknown): string {
    if (typeof value === 'string') return value
    if (typeof value === 'number' || typeof value === 'boolean') return String(value)
    if (Array.isArray(value)) {
      return value
        .map((item) => asText(item))
        .filter((item) => item.trim().length > 0)
        .join('\n')
    }
    const row = asRecord(value)
    if (!row) return ''

    if ('text' in row) return asText(row.text)
    if ('content' in row) return asText(row.content)
    if ('message' in row) return asText(row.message)
    if ('output' in row) return asText(row.output)
    if ('delta' in row) return asText(row.delta)
    return ''
  }

  function normalizeRole(value: unknown): ChatMessage['role'] {
    if (value === 'user' || value === 'assistant' || value === 'tool' || value === 'system') return value
    if (value === 'toolResult') return 'tool'
    return 'assistant'
  }

  function normalizeRealtimeMessage(value: unknown): ChatMessage | null {
    const row = asRecord(value)
    if (!row) return null

    const content = asText(
      row.content ?? row.text ?? row.message ?? row.output ?? row.delta ?? row.payload ?? row.input
    ).trim()
    if (!content) return null

    const id = typeof row.id === 'string' ? row.id : typeof row.messageId === 'string' ? row.messageId : undefined
    const timestamp =
      typeof row.timestamp === 'string'
        ? row.timestamp
        : typeof row.createdAt === 'string'
          ? row.createdAt
          : typeof row.time === 'string'
            ? row.time
            : undefined
    const name =
      typeof row.name === 'string' ? row.name : typeof row.model === 'string' ? row.model : undefined

    return {
      id,
      role: normalizeRole(row.role ?? row.type),
      content,
      timestamp,
      name,
    }
  }

  function extractRealtimeMessages(payload: unknown): ChatMessage[] {
    const rawItems: unknown[] = []

    if (Array.isArray(payload)) {
      rawItems.push(...payload)
    } else {
      const row = asRecord(payload)
      if (!row) return []

      if (Array.isArray(row.messages)) rawItems.push(...row.messages)
      if (Array.isArray(row.items)) rawItems.push(...row.items)
      if (Array.isArray(row.transcript)) rawItems.push(...row.transcript)
      if (Array.isArray(row.history)) rawItems.push(...row.history)

      if (row.message) rawItems.push(row.message)
      if (row.item) rawItems.push(row.item)

      if (row.role || row.type || row.content || row.text || row.message || row.output || row.delta) {
        rawItems.push(row)
      }
    }

    return rawItems.map((item) => normalizeRealtimeMessage(item)).filter((item): item is ChatMessage => !!item)
  }

  function mergeRealtimeMessages(
    nextMessages: ChatMessage[],
    options?: {
      streaming?: boolean
    }
  ) {
    if (nextMessages.length === 0) return

    const streaming = options?.streaming ?? false
    const list = [...messages.value]
    for (const next of nextMessages) {
      if (next.id) {
        const existingIndex = list.findIndex((item) => item.id && item.id === next.id)
        if (existingIndex >= 0) {
          const existing = list[existingIndex]
          if (!existing) continue
          list[existingIndex] =
            next.content.length >= existing.content.length
              ? { ...existing, ...next }
              : existing
          continue
        }
      }

      const last = list[list.length - 1]
      if (last && last.role === next.role && last.content === next.content) {
        const lastId = last.id || ''
        if (lastId.startsWith('web-') || lastId.startsWith('local-')) {
          list[list.length - 1] = { ...last, ...next }
          continue
        }
      }
      if (streaming && last && last.role === next.role) {
        if (next.content.startsWith(last.content)) {
          list[list.length - 1] = { ...last, ...next }
          continue
        }
        if (last.content.endsWith(next.content)) {
          continue
        }
        list[list.length - 1] = {
          ...last,
          ...next,
          content: `${last.content}${next.content}`,
        }
        continue
      }

      if (!next.id && last && !last.id && last.role === next.role) {
        if (next.content.startsWith(last.content)) {
          list[list.length - 1] = { ...last, ...next }
          continue
        }
      }

      list.push(next)
    }

    messages.value = list
  }

  function handleRealtimeEvent(
    payload: unknown,
    options?: {
      refreshHistory?: boolean
      streaming?: boolean
    }
  ) {
    if (!sessionKey.value.trim()) return
    const keyInEvent = extractSessionKey(payload)
    if (keyInEvent && keyInEvent !== sessionKey.value) {
      return
    }

    const realtimeMessages = extractRealtimeMessages(payload)
    if (options?.streaming) {
      pendingStreamMessages.push(...realtimeMessages)
      if (streamFlushRaf === null) {
        // 对齐浏览器绘制帧合并流式增量，减少滚动“抖动/跳帧”观感
        streamFlushRaf = requestAnimationFrame(() => {
          streamFlushRaf = null
          if (pendingStreamMessages.length === 0) return
          const batch = pendingStreamMessages
          pendingStreamMessages = []
          mergeRealtimeMessages(batch, { streaming: true })
        })
      }
    } else {
      mergeRealtimeMessages(realtimeMessages, { streaming: false })
    }

    if (options?.refreshHistory ?? true) {
      scheduleHistoryRefresh(200)
    }
  }

  async function sendMessage(content: string, model?: string) {
    const text = content.trim()
    if (!text) return
    if (!sessionKey.value.trim()) {
      throw new Error('请先填写会话 Key')
    }

    const idempotencyKey = `web-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`
    const localMessage: ChatMessage = {
      id: idempotencyKey,
      role: 'user',
      content: text,
      timestamp: new Date().toISOString(),
    }
    messages.value = [...messages.value, localMessage]

    sending.value = true
    lastError.value = null
    try {
      await wsStore.rpc.sendChatMessage({
        sessionKey: sessionKey.value.trim(),
        message: text,
        model: model?.trim() || undefined,
        idempotencyKey,
      })
    } catch (error) {
      lastError.value = error instanceof Error ? error.message : String(error)
      messages.value = messages.value.filter((item) => item.id !== idempotencyKey)
      throw error
    } finally {
      sending.value = false
    }
  }

  return {
    sessionKey,
    messages,
    loading,
    syncing,
    sending,
    lastError,
    lastSyncedAt,
    setSessionKey,
    fetchHistory,
    handleRealtimeEvent,
    clearTimers,
    sendMessage,
  }
})
