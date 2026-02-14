import { ref } from 'vue'
import { defineStore } from 'pinia'
import { useWebSocketStore } from './websocket'
import type { ChatMessage } from '@/api/types'

type AgentPhase =
  | 'idle'
  | 'sending'
  | 'waiting'
  | 'thinking'
  | 'tool'
  | 'replying'
  | 'aborting'
  | 'done'
  | 'aborted'
  | 'error'

interface AgentStatus {
  phase: AgentPhase
  runId: string | null
  detail: string | null
  updatedAtMs: number
  sinceMs: number
}

interface AgentStep {
  ts: number
  phase: AgentPhase
  label: string
}

interface ToolProgress {
  toolCallId: string
  name: string
  phase: 'start' | 'update' | 'result'
  meta: string | null
  isError: boolean | null
  argsPreview: string | null
  partialPreview: string | null
  resultPreview: string | null
  startedAtMs: number
  updatedAtMs: number
}

const MAX_AGENT_STEPS = 30
const TOOL_PREVIEW_MAX_CHARS = 6000
const FINALIZED_RUN_TTL_MS = 5 * 60 * 1000

export const useChatStore = defineStore('chat', () => {
  const sessionKey = ref('')
  const messages = ref<ChatMessage[]>([])
  const loading = ref(false)
  const syncing = ref(false)
  const sending = ref(false)
  const lastError = ref<string | null>(null)
  const lastSyncedAt = ref<number | null>(null)
  const agentStatus = ref<AgentStatus>({
    phase: 'idle',
    runId: null,
    detail: null,
    updatedAtMs: Date.now(),
    sinceMs: Date.now(),
  })
  const agentSteps = ref<AgentStep[]>([])
  const toolProgress = ref<ToolProgress | null>(null)
  let refreshTimer: ReturnType<typeof setTimeout> | null = null
  let pollTimers: Array<ReturnType<typeof setTimeout>> = []
  let streamFlushRaf: number | null = null
  let pendingStreamMessages: ChatMessage[] = []
  let lastToolPreviewUpdateAtMs = 0
  const finalizedRuns = new Map<string, number>()

  const wsStore = useWebSocketStore()

  function markRunFinal(runId: string) {
    const normalized = runId.trim()
    if (!normalized) return

    const now = Date.now()
    finalizedRuns.set(normalized, now)

    for (const [key, ts] of finalizedRuns) {
      if (now - ts > FINALIZED_RUN_TTL_MS) {
        finalizedRuns.delete(key)
      }
    }
  }

  function isRunFinalized(runId: string): boolean {
    const normalized = runId.trim()
    if (!normalized) return false

    const ts = finalizedRuns.get(normalized)
    if (!ts) return false

    const now = Date.now()
    if (now - ts > FINALIZED_RUN_TTL_MS) {
      finalizedRuns.delete(normalized)
      return false
    }
    return true
  }

  function truncatePreview(value: string, maxChars = TOOL_PREVIEW_MAX_CHARS): string {
    const text = value.trim()
    if (text.length <= maxChars) return text
    return `${text.slice(0, maxChars)}...`
  }

  function redactSensitive(value: unknown, depth = 0): unknown {
    if (depth > 4) return value
    if (!value) return value
    if (typeof value !== 'object') return value

    if (Array.isArray(value)) {
      return value.map((item) => redactSensitive(item, depth + 1))
    }

    const row = value as Record<string, unknown>
    const next: Record<string, unknown> = {}
    for (const [key, raw] of Object.entries(row)) {
      if (/token|password|secret|api[_-]?key|authorization|cookie/i.test(key)) {
        next[key] = '[REDACTED]'
        continue
      }
      next[key] = redactSensitive(raw, depth + 1)
    }
    return next
  }

  function toJsonPreview(value: unknown): string | null {
    if (value === undefined || value === null) return null
    if (typeof value === 'string') {
      const trimmed = value.trim()
      return trimmed ? truncatePreview(trimmed) : null
    }

    try {
      const redacted = redactSensitive(value)
      const json = JSON.stringify(redacted, null, 2)
      return json ? truncatePreview(json) : null
    } catch {
      const fallback = String(value)
      return fallback.trim() ? truncatePreview(fallback) : null
    }
  }

  function stepLabel(phase: AgentPhase, detail: string | null): string {
    if (phase === 'sending') return '消息发送中'
    if (phase === 'waiting') return '等待响应'
    if (phase === 'thinking') return detail?.trim() ? detail.trim() : '思考中'
    if (phase === 'tool') return detail?.trim() ? `调用工具：${detail.trim()}` : '调用工具中'
    if (phase === 'replying') return '回复中'
    if (phase === 'aborting') return '停止中...'
    if (phase === 'done') return '本轮完成'
    if (phase === 'aborted') return '已停止'
    if (phase === 'error') return detail?.trim() ? `错误：${detail.trim()}` : '错误'
    return '空闲'
  }

  function appendAgentStep(phase: AgentPhase, detail: string | null) {
    if (phase === 'idle') return

    const label = stepLabel(phase, detail)
    const now = Date.now()
    const last = agentSteps.value[agentSteps.value.length - 1]
    if (last && last.phase === phase && last.label === label) {
      return
    }

    agentSteps.value = [...agentSteps.value, { ts: now, phase, label }].slice(-MAX_AGENT_STEPS)
  }

  function resetAgentProgress() {
    agentSteps.value = []
    toolProgress.value = null
    lastToolPreviewUpdateAtMs = 0
  }

  function setAgentStatusPhase(phase: AgentPhase, patch?: { runId?: string | null; detail?: string | null }) {
    const now = Date.now()
    const prev = agentStatus.value
    const next: AgentStatus = {
      ...prev,
      phase,
      runId: patch?.runId === undefined ? prev.runId : patch.runId,
      detail: patch?.detail === undefined ? prev.detail : patch.detail,
      updatedAtMs: now,
      sinceMs: prev.phase === phase ? prev.sinceMs : now,
    }

    const unchanged =
      prev.phase === next.phase &&
      prev.runId === next.runId &&
      prev.detail === next.detail
    if (unchanged) return

    agentStatus.value = next

    const phaseChanged = prev.phase !== next.phase
    const detailChanged = prev.detail !== next.detail
    if (
      phaseChanged ||
      (next.phase === 'tool' && detailChanged) ||
      (next.phase === 'thinking' && detailChanged && !!next.detail)
    ) {
      appendAgentStep(next.phase, next.detail)
    }
  }

  function touchAgentStatus() {
    const now = Date.now()
    if (!agentStatus.value.updatedAtMs || now - agentStatus.value.updatedAtMs >= 50) {
      agentStatus.value = {
        ...agentStatus.value,
        updatedAtMs: now,
      }
    }
  }

  function resolveChatEventState(normalizedEvent: string, payloadRow?: Record<string, unknown> | null): string {
    const direct = asString(payloadRow?.state || payloadRow?.status || payloadRow?.phase).trim().toLowerCase()
    if (direct) return direct

    if (normalizedEvent === 'chat.delta' || normalizedEvent.endsWith('.delta')) return 'delta'
    if (normalizedEvent === 'chat.final' || normalizedEvent.endsWith('.final') || normalizedEvent === 'chat.done') return 'final'
    if (normalizedEvent === 'chat.aborted' || normalizedEvent.endsWith('.aborted') || normalizedEvent === 'chat.stop') return 'aborted'
    if (normalizedEvent === 'chat.error' || normalizedEvent.endsWith('.error')) return 'error'
    return ''
  }

  function resetAgentStatus() {
    agentStatus.value = {
      phase: 'idle',
      runId: null,
      detail: null,
      updatedAtMs: Date.now(),
      sinceMs: Date.now(),
    }
  }

  function setSessionKey(key: string) {
    sessionKey.value = key.trim()
    resetAgentStatus()
    resetAgentProgress()
    finalizedRuns.clear()
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

  function asString(value: unknown): string {
    if (typeof value === 'string') return value
    if (typeof value === 'number' || typeof value === 'boolean') return String(value)
    return ''
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

  function extractRunId(payload: unknown): string {
    const row = asRecord(payload)
    if (!row) return ''
    const runId = asString(row.runId).trim()
    if (runId) return runId
    return ''
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

  function handleAgentStatusEvent(eventName: string, payload: unknown) {
    if (!sessionKey.value.trim()) return
    const normalizedEvent = eventName.trim().toLowerCase()
    if (!normalizedEvent) return

    const keyInEvent = extractSessionKey(payload)
    if (keyInEvent && keyInEvent.trim() !== sessionKey.value) {
      return
    }

    const runIdInEvent = extractRunId(payload)
    const activeRunId = agentStatus.value.runId

    const payloadRow = asRecord(payload)

    if (normalizedEvent === 'chat' || normalizedEvent.startsWith('chat.')) {
      const state = resolveChatEventState(normalizedEvent, payloadRow)
      const isTerminal = state === 'final' || state === 'done' || state === 'aborted' || state === 'error'
      if (!isTerminal && runIdInEvent && isRunFinalized(runIdInEvent)) {
        return
      }
      if (activeRunId && runIdInEvent && runIdInEvent !== activeRunId && !isTerminal) {
        return
      }
      if (state === 'delta') {
        touchAgentStatus()
        if (agentStatus.value.phase !== 'replying') {
          setAgentStatusPhase('replying', {
            runId: activeRunId || runIdInEvent || null,
            detail: null,
          })
        }
        return
      }
      if (state === 'final' || state === 'done') {
        if (runIdInEvent) markRunFinal(runIdInEvent)
        setAgentStatusPhase('done', { runId: null, detail: null })
        return
      }
      if (state === 'aborted') {
        if (runIdInEvent) markRunFinal(runIdInEvent)
        setAgentStatusPhase('aborted', { runId: null, detail: null })
        return
      }
      if (state === 'error') {
        if (runIdInEvent) markRunFinal(runIdInEvent)
        const errorMessage = asString(payloadRow?.errorMessage).trim() || null
        setAgentStatusPhase('error', { runId: null, detail: errorMessage })
        return
      }
      return
    }

    if (normalizedEvent === 'agent' || normalizedEvent.startsWith('agent.')) {
      if (activeRunId && runIdInEvent && runIdInEvent !== activeRunId) {
        return
      }
      // 新版 gateway 统一用 event=agent，payload.stream=lifecycle|assistant|tool|compaction
      if (normalizedEvent === 'agent') {
        const stream = asString(payloadRow?.stream).trim().toLowerCase()
        const data = asRecord(payloadRow?.data) || {}
        if (runIdInEvent && isRunFinalized(runIdInEvent) && stream !== 'lifecycle') {
          return
        }
        if (stream === 'lifecycle') {
          const phase = asString(data.phase).trim().toLowerCase()
          if (phase === 'start') {
            const prevPhase = agentStatus.value.phase
            if (prevPhase === 'idle' || prevPhase === 'done' || prevPhase === 'aborted' || prevPhase === 'error') {
              resetAgentProgress()
            }
            if (agentStatus.value.phase !== 'thinking') {
              setAgentStatusPhase('thinking', { runId: activeRunId || runIdInEvent || null, detail: null })
            }
            return
          }
          if (phase === 'end') {
            if (runIdInEvent) markRunFinal(runIdInEvent)
            setAgentStatusPhase('done', { runId: null, detail: null })
            return
          }
          if (phase === 'error') {
            if (runIdInEvent) markRunFinal(runIdInEvent)
            const errorText = asText(data.error).trim() || null
            setAgentStatusPhase('error', { runId: null, detail: errorText })
            return
          }
        }

        if (stream === 'tool') {
          touchAgentStatus()
          const toolName = asString(data.name || data.tool || data.toolName).trim()
          const toolCallId = asString(data.toolCallId || data.callId || data.id).trim()
          const toolPhase = asString(data.phase || data.state).trim().toLowerCase()

          if (toolName && toolCallId) {
            const now = Date.now()
            if (toolPhase === 'start') {
              toolProgress.value = {
                toolCallId,
                name: toolName,
                phase: 'start',
                meta: null,
                isError: null,
                argsPreview: toJsonPreview(data.args),
                partialPreview: null,
                resultPreview: null,
                startedAtMs: now,
                updatedAtMs: now,
              }
            } else if (toolPhase === 'update') {
              if (now - lastToolPreviewUpdateAtMs >= 120) {
                lastToolPreviewUpdateAtMs = now
                const partialPreview = toJsonPreview(data.partialResult)
                const prevProgress = toolProgress.value
                toolProgress.value = {
                  toolCallId,
                  name: toolName,
                  phase: 'update',
                  meta: prevProgress?.meta || null,
                  isError: prevProgress?.isError ?? null,
                  argsPreview: prevProgress?.argsPreview || null,
                  partialPreview: partialPreview || prevProgress?.partialPreview || null,
                  resultPreview: null,
                  startedAtMs: prevProgress?.startedAtMs || now,
                  updatedAtMs: now,
                }
              }
            } else if (toolPhase === 'result') {
              const prevProgress = toolProgress.value
              toolProgress.value = {
                toolCallId,
                name: toolName,
                phase: 'result',
                meta: asString(data.meta).trim() || prevProgress?.meta || null,
                isError: typeof data.isError === 'boolean' ? data.isError : prevProgress?.isError ?? null,
                argsPreview: prevProgress?.argsPreview || null,
                partialPreview: prevProgress?.partialPreview || null,
                resultPreview: toJsonPreview(data.result),
                startedAtMs: prevProgress?.startedAtMs || now,
                updatedAtMs: now,
              }
            }
          }

          if (toolPhase === 'start' || toolPhase === 'update') {
            if (agentStatus.value.phase !== 'tool' || agentStatus.value.detail !== (toolName || null)) {
              setAgentStatusPhase('tool', {
                runId: activeRunId || runIdInEvent || null,
                detail: toolName || null,
              })
            }
            return
          }
          if (toolPhase === 'result') {
            // 工具结束后通常会继续思考/生成；这里只做一次轻量状态回落
            if (agentStatus.value.phase === 'tool') {
              setAgentStatusPhase('thinking', { runId: activeRunId || runIdInEvent || null, detail: toolName ? `工具完成：${toolName}` : null })
            }
            return
          }
        }

        if (stream === 'compaction') {
          const phase = asString((data as Record<string, unknown>).phase).trim().toLowerCase()
          if (phase === 'start') {
            setAgentStatusPhase('thinking', { runId: activeRunId || runIdInEvent || null, detail: '上下文压缩中...' })
            return
          }
          if (phase === 'end') {
            if (agentStatus.value.phase === 'thinking' && agentStatus.value.detail === '上下文压缩中...') {
              setAgentStatusPhase('thinking', { runId: activeRunId || runIdInEvent || null, detail: null })
            }
            return
          }
        }

        if (stream === 'assistant') {
          touchAgentStatus()
          if (agentStatus.value.phase !== 'replying' && agentStatus.value.phase !== 'tool') {
            // chat delta 可能因节流略晚于 agent assistant stream，这里做兜底提示
            setAgentStatusPhase('replying', { runId: activeRunId || runIdInEvent || null, detail: null })
          }
          return
        }

        return
      }

      // 旧版/兼容事件名：agent.started / agent.thinking / agent.done
      if (normalizedEvent === 'agent.started') {
        setAgentStatusPhase('thinking', { runId: activeRunId || runIdInEvent || null, detail: null })
        return
      }
      if (normalizedEvent === 'agent.thinking') {
        setAgentStatusPhase('thinking', { runId: activeRunId || runIdInEvent || null, detail: null })
        return
      }
      if (normalizedEvent === 'agent.done') {
        setAgentStatusPhase('done', { runId: null, detail: null })
        return
      }
    }

    if (normalizedEvent.startsWith('tool.')) {
      if (normalizedEvent === 'tool.call') {
        const data = asRecord(payloadRow?.payload ?? payloadRow) || {}
        const toolName = asString(data.name || data.tool || data.toolName).trim() || null
        setAgentStatusPhase('tool', { runId: activeRunId || runIdInEvent || null, detail: toolName })
        return
      }
      if (normalizedEvent === 'tool.result') {
        setAgentStatusPhase('thinking', { runId: activeRunId || runIdInEvent || null, detail: null })
        return
      }
      return
    }

    if (normalizedEvent.startsWith('model.')) {
      if (normalizedEvent === 'model.streaming') {
        if (agentStatus.value.phase !== 'replying') {
          setAgentStatusPhase('replying', { runId: activeRunId || runIdInEvent || null, detail: null })
        }
      }
    }
  }

  async function sendMessage(content: string, model?: string) {
    const text = content.trim()
    if (!text) return
    if (!sessionKey.value.trim()) {
      throw new Error('请先填写会话 Key')
    }

    const idempotencyKey = `web-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`
    resetAgentProgress()
    setAgentStatusPhase('sending', { runId: idempotencyKey, detail: null })
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
      if (agentStatus.value.phase === 'sending' && agentStatus.value.runId === idempotencyKey) {
        setAgentStatusPhase('waiting', { runId: idempotencyKey, detail: null })
      }
    } catch (error) {
      lastError.value = error instanceof Error ? error.message : String(error)
      messages.value = messages.value.filter((item) => item.id !== idempotencyKey)
      if (agentStatus.value.runId === idempotencyKey) {
        setAgentStatusPhase('error', { runId: null, detail: lastError.value })
      }
      throw error
    } finally {
      sending.value = false
    }
  }

  async function abortActiveRun() {
    if (!sessionKey.value.trim()) {
      throw new Error('请先填写会话 Key')
    }
    const phase = agentStatus.value.phase
    if (phase === 'idle' || phase === 'done' || phase === 'aborted' || phase === 'error') {
      return
    }

    setAgentStatusPhase('aborting', { detail: '停止中...' })
    try {
      await wsStore.rpc.abortChat(undefined, sessionKey.value.trim())
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error)
      setAgentStatusPhase('error', { runId: null, detail: reason })
      throw error
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
    agentStatus,
    agentSteps,
    toolProgress,
    setSessionKey,
    fetchHistory,
    handleRealtimeEvent,
    handleAgentStatusEvent,
    clearTimers,
    sendMessage,
    abortActiveRun,
  }
})
