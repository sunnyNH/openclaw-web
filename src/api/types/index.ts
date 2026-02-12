export * from './rpc'
export * from './session'
export * from './channel'
export * from './config'

export interface Skill {
  name: string
  description?: string
  version?: string
  source: 'bundled' | 'managed' | 'workspace' | 'extra'
  installed: boolean
  eligible?: boolean
  disabled?: boolean
  bundled?: boolean
  skillKey?: string
  hasUpdate?: boolean
}

export interface Tool {
  name: string
  description: string
  category: string
  enabled: boolean
}

export interface DeviceNode {
  id: string
  name: string
  platform: string
  connected: boolean
  capabilities: string[]
  lastSeen?: string
}

export interface NodeInvokeParams {
  nodeId: string
  action: string
  params?: Record<string, unknown>
}

export interface AgentParams {
  sessionKey: string
  message: string
  idempotencyKey?: string
  model?: string
  elevated?: boolean
  thinkingLevel?: 'off' | 'low' | 'high'
}

export interface AgentIdentity {
  name?: string
  theme?: string
  emoji?: string
  avatar?: string
  avatarUrl?: string
}

export interface AgentInfo {
  id: string
  name?: string
  identity?: AgentIdentity
}

export interface AgentsListResult {
  defaultId?: string
  mainKey?: string
  scope?: string
  agents: AgentInfo[]
}

export interface AgentFileEntry {
  name: string
  path: string
  missing: boolean
  size?: number
  updatedAtMs?: number
  content?: string
}

export interface AgentFilesListResult {
  agentId: string
  workspace: string
  files: AgentFileEntry[]
}

export interface AgentFilesGetResult {
  agentId: string
  workspace: string
  file: AgentFileEntry
}

export interface AgentFilesSetResult {
  ok: boolean
  agentId: string
  workspace: string
  file: AgentFileEntry
}

export interface AgentEvent {
  event: string
  payload: unknown
  seq?: number
  timestamp: number
}

export interface SendParams {
  channelId: string
  recipient: string
  content: string
}

export interface ChatMessage {
  id?: string
  role: 'user' | 'assistant' | 'tool' | 'system'
  content: string
  timestamp?: string
  name?: string
}

export interface ChatSendParams {
  sessionKey: string
  message: string
  model?: string
  idempotencyKey?: string
}

export type CronSchedule =
  | {
      kind: 'at'
      at: string
    }
  | {
      kind: 'every'
      everyMs: number
      anchorMs?: number
    }
  | {
      kind: 'cron'
      expr: string
      tz?: string
    }

export type CronPayload =
  | {
      kind: 'systemEvent'
      text: string
    }
  | {
      kind: 'agentTurn'
      message: string
      model?: string
      thinking?: string
      timeoutSeconds?: number
      allowUnsafeExternalContent?: boolean
      deliver?: boolean
      channel?: string
      to?: string
      bestEffortDeliver?: boolean
    }

export interface CronDelivery {
  mode: 'none' | 'announce'
  channel?: string
  to?: string
  bestEffort?: boolean
}

export interface CronJobState {
  nextRunAtMs?: number
  runningAtMs?: number
  lastRunAtMs?: number
  lastStatus?: 'ok' | 'error' | 'skipped'
  lastError?: string
  lastDurationMs?: number
  consecutiveErrors?: number
}

export interface CronJob {
  id: string
  agentId?: string
  name: string
  description?: string
  enabled: boolean
  deleteAfterRun?: boolean
  createdAtMs?: number
  updatedAtMs?: number
  scheduleObj?: CronSchedule
  sessionTarget?: 'main' | 'isolated'
  wakeMode?: 'next-heartbeat' | 'now'
  payload?: CronPayload
  delivery?: CronDelivery
  state?: CronJobState

  // Backward-compatible display fields
  schedule: string
  command?: string
  timezone?: string
  nextRun?: string
  lastRun?: string
}

export interface CronStatus {
  enabled: boolean
  jobs: number
  running?: number
  nextWakeAtMs?: number
}

export interface CronRunLogEntry {
  ts: number
  jobId: string
  action?: 'finished'
  status?: 'ok' | 'error' | 'skipped'
  error?: string
  summary?: string
  sessionId?: string
  sessionKey?: string
  runAtMs?: number
  durationMs?: number
  nextRunAtMs?: number
}

export interface CronUpsertParams {
  id?: string
  name?: string
  agentId?: string | null
  description?: string
  enabled?: boolean
  deleteAfterRun?: boolean
  schedule?: CronSchedule
  sessionTarget?: 'main' | 'isolated'
  wakeMode?: 'next-heartbeat' | 'now'
  payload?: CronPayload
  delivery?: CronDelivery
  // Legacy compatibility
  command?: string
  timezone?: string
  scheduleText?: string
}

export interface ModelInfo {
  id: string
  label?: string
  provider?: string
  family?: string
  enabled?: boolean
  available?: boolean
  description?: string
  contextWindow?: number
  capabilities?: string[]
}

export interface SessionsUsageParams {
  key?: string
  startDate?: string
  endDate?: string
  limit?: number
  includeContextWeight?: boolean
}

export interface SessionsUsageTotals {
  input: number
  output: number
  cacheRead: number
  cacheWrite: number
  totalTokens: number
  totalCost: number
  inputCost: number
  outputCost: number
  cacheReadCost: number
  cacheWriteCost: number
  missingCostEntries: number
}

export interface SessionsUsageModelItem {
  provider?: string
  model?: string
  count: number
  totals: SessionsUsageTotals
}

export interface SessionsUsageDailyItem {
  date: string
  tokens: number
  cost: number
  messages: number
  toolCalls: number
  errors: number
}

export interface SessionsUsageSession {
  key: string
  label?: string
  sessionId?: string
  updatedAt?: number
  agentId?: string
  channel?: string
  chatType?: string
  modelProvider?: string
  model?: string
  usage: {
    input: number
    output: number
    cacheRead: number
    cacheWrite: number
    totalTokens: number
    totalCost: number
    messageCounts?: {
      total: number
      user: number
      assistant: number
      toolCalls: number
      toolResults: number
      errors: number
    }
    toolUsage?: {
      totalCalls: number
      uniqueTools: number
      tools: Array<{ name: string; count: number }>
    }
    dailyBreakdown?: Array<{ date: string; tokens: number; cost: number }>
  } | null
}

export interface SessionsUsageResult {
  updatedAt: number
  startDate: string
  endDate: string
  sessions: SessionsUsageSession[]
  totals: SessionsUsageTotals
  aggregates: {
    messages: {
      total: number
      user: number
      assistant: number
      toolCalls: number
      toolResults: number
      errors: number
    }
    tools: {
      totalCalls: number
      uniqueTools: number
      tools: Array<{ name: string; count: number }>
    }
    byModel: SessionsUsageModelItem[]
    byProvider: SessionsUsageModelItem[]
    byAgent: Array<{ agentId: string; totals: SessionsUsageTotals }>
    byChannel: Array<{ channel: string; totals: SessionsUsageTotals }>
    daily: SessionsUsageDailyItem[]
  }
}

export interface CostUsageDailyEntry extends SessionsUsageTotals {
  date: string
}

export interface CostUsageSummary {
  updatedAt: number
  days: number
  daily: CostUsageDailyEntry[]
  totals: SessionsUsageTotals
}
