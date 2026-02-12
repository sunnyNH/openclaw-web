<script setup lang="ts">
import { computed, h, onMounted, onUnmounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import {
  NAlert,
  NButton,
  NCard,
  NDataTable,
  NGrid,
  NGridItem,
  NIcon,
  NInput,
  NSpace,
  NSpin,
  NTag,
  NText,
} from 'naive-ui'
import {
  CalendarOutline,
  ChatbubblesOutline,
  ChatboxEllipsesOutline,
  ExtensionPuzzleOutline,
  FlashOutline,
  RefreshOutline,
  SparklesOutline,
} from '@vicons/ionicons5'
import StatCard from '@/components/common/StatCard.vue'
import { useWebSocketStore } from '@/stores/websocket'
import { formatRelativeTime, parseSessionKey, truncate } from '@/utils/format'
import type {
  AgentEvent,
  CostUsageSummary,
  CronJob,
  ModelInfo,
  OpenClawConfig,
  Session,
  SessionsUsageResult,
  SessionsUsageSession,
  SessionsUsageTotals,
  Skill,
} from '@/api/types'

const EVENT_LIMIT = 40

type RangePreset = 'today' | '7d' | '30d' | 'custom'
type UsageMode = 'tokens' | 'cost'

const router = useRouter()
const wsStore = useWebSocketStore()
const loading = ref(true)
const refreshing = ref(false)
const usageError = ref<string | null>(null)
const lastUpdatedAt = ref<number | null>(null)
const eventKeyword = ref('')
const activeSessionKey = ref('')
const rangePreset = ref<RangePreset>('7d')
const usageMode = ref<UsageMode>('tokens')
const usageStartDate = ref('')
const usageEndDate = ref('')

const stats = ref({
  sessionCount: 0,
  cronCount: 0,
  modelCount: 0,
  installedSkills: 0,
})

const recentSessions = ref<Session[]>([])
const recentEvents = ref<AgentEvent[]>([])
const sessionsUsageResult = ref<SessionsUsageResult | null>(null)
const usageCostSummary = ref<CostUsageSummary | null>(null)

let cleanupEvents: (() => void) | null = null
let cleanupStateChange: (() => void) | null = null
let retryAfterFirstConnect = false

const ZERO_USAGE_TOTALS: SessionsUsageTotals = {
  input: 0,
  output: 0,
  cacheRead: 0,
  cacheWrite: 0,
  totalTokens: 0,
  totalCost: 0,
  inputCost: 0,
  outputCost: 0,
  cacheReadCost: 0,
  cacheWriteCost: 0,
  missingCostEntries: 0,
}

const connectionLabel = computed(() => {
  if (wsStore.state === 'connected') return '网关已连接'
  if (wsStore.state === 'connecting') return '网关连接中'
  if (wsStore.state === 'reconnecting') return '网关重连中'
  if (wsStore.state === 'failed') return '网关连接失败'
  return '网关未连接'
})

const connectionType = computed<'success' | 'warning' | 'error' | 'default'>(() => {
  if (wsStore.state === 'connected') return 'success'
  if (wsStore.state === 'connecting' || wsStore.state === 'reconnecting') return 'warning'
  if (wsStore.state === 'failed') return 'error'
  return 'default'
})

const lastUpdatedText = computed(() => {
  if (!lastUpdatedAt.value) return '尚未同步'
  return `上次同步 ${formatRelativeTime(lastUpdatedAt.value)}`
})

const usageTotals = computed(() =>
  sessionsUsageResult.value?.totals || usageCostSummary.value?.totals || ZERO_USAGE_TOTALS
)

const usageSessions = computed(() => sessionsUsageResult.value?.sessions || [])

const usageSessionMap = computed(() => {
  const map: Record<string, SessionsUsageSession> = {}
  for (const item of usageSessions.value) {
    map[item.key] = item
  }
  return map
})

const usageCoverageText = computed(() => {
  const total = usageSessions.value.length
  const withUsage = usageSessions.value.filter((item) => item.usage && item.usage.totalTokens > 0).length
  if (total === 0) return '当前范围暂无 usage 会话'
  return `有 usage 数据 ${withUsage}/${total} 个会话`
})

const tokenTotalDisplay = computed(() => formatCompactNumber(usageTotals.value.totalTokens))
const costTotalDisplay = computed(() => formatUsd(usageTotals.value.totalCost))

const usageSegments = computed(() => {
  const totals = usageTotals.value
  if (usageMode.value === 'tokens') {
    return [
      { key: 'input', label: '输入', value: totals.input, color: '#2a7fff' },
      { key: 'output', label: '输出', value: totals.output, color: '#18a058' },
      { key: 'cacheRead', label: '缓存读', value: totals.cacheRead, color: '#13c2c2' },
      { key: 'cacheWrite', label: '缓存写', value: totals.cacheWrite, color: '#f0a020' },
    ]
  }

  return [
    { key: 'inputCost', label: '输入成本', value: totals.inputCost, color: '#2a7fff' },
    { key: 'outputCost', label: '输出成本', value: totals.outputCost, color: '#18a058' },
    { key: 'cacheReadCost', label: '缓存读成本', value: totals.cacheReadCost, color: '#13c2c2' },
    { key: 'cacheWriteCost', label: '缓存写成本', value: totals.cacheWriteCost, color: '#f0a020' },
  ]
})

const segmentTotal = computed(() => {
  const sum = usageSegments.value.reduce((acc, item) => acc + item.value, 0)
  return sum > 0 ? sum : 1
})

const dailyUsage = computed(() => {
  const fromSessions = sessionsUsageResult.value?.aggregates?.daily || []
  if (fromSessions.length > 0) return fromSessions

  const fromCost = usageCostSummary.value?.daily || []
  return fromCost.map((item) => ({
    date: item.date,
    tokens: item.totalTokens,
    cost: item.totalCost,
    messages: 0,
    toolCalls: 0,
    errors: 0,
  }))
})

const dailyUsageVisible = computed(() => dailyUsage.value.slice(-14))

const trendSeries = computed(() =>
  dailyUsageVisible.value.map((item) => ({
    date: item.date,
    value: usageMode.value === 'tokens' ? item.tokens : item.cost,
    messages: item.messages,
    errors: item.errors,
  }))
)

const trendGeometry = computed(() => {
  const width = 760
  const height = 240
  const left = 56
  const right = 18
  const top = 18
  const bottom = 44
  const series = trendSeries.value
  const usableWidth = width - left - right
  const usableHeight = height - top - bottom
  const maxValue = Math.max(...series.map((item) => item.value), 0, 1)

  const points = series.map((item, index) => {
    const x =
      series.length === 1
        ? left + usableWidth / 2
        : left + (index / (series.length - 1)) * usableWidth
    const y = top + usableHeight - (item.value / maxValue) * usableHeight
    return {
      ...item,
      x,
      y,
    }
  })

  const polyline = points.map((point) => `${point.x},${point.y}`).join(' ')
  const areaPath = points.length
    ? `M ${left} ${top + usableHeight} L ${points.map((point) => `${point.x} ${point.y}`).join(' L ')} L ${left + usableWidth} ${top + usableHeight} Z`
    : ''
  const guides = [0, 0.25, 0.5, 0.75, 1].map((ratio) => ({
    ratio,
    y: top + usableHeight - usableHeight * ratio,
    value: maxValue * ratio,
  }))

  return {
    width,
    height,
    left,
    right,
    top,
    bottom,
    usableWidth,
    usableHeight,
    maxValue,
    points,
    polyline,
    areaPath,
    guides,
  }
})

const trendAxisLabels = computed(() => {
  if (trendSeries.value.length === 0) {
    return { start: '-', mid: '-', end: '-' }
  }
  const start = trendSeries.value[0]
  const mid = trendSeries.value[Math.floor((trendSeries.value.length - 1) / 2)]
  const end = trendSeries.value[trendSeries.value.length - 1]
  return {
    start: start?.date.slice(5) || '-',
    mid: mid?.date.slice(5) || '-',
    end: end?.date.slice(5) || '-',
  }
})

const usageKpis = computed(() => {
  const totals = usageTotals.value
  const rows = dailyUsage.value

  const totalMessages = rows.reduce((acc, item) => acc + (item.messages || 0), 0)
  const totalToolCalls = rows.reduce((acc, item) => acc + (item.toolCalls || 0), 0)
  const totalErrors = rows.reduce((acc, item) => acc + (item.errors || 0), 0)
  const activeDays = rows.filter((item) => {
    if (usageMode.value === 'tokens') return item.tokens > 0
    return item.cost > 0
  }).length

  const avgTokensPerMessage = totalMessages > 0 ? totals.totalTokens / totalMessages : 0
  const errorRate = totalMessages > 0 ? (totalErrors / totalMessages) * 100 : 0
  const cacheReadRatio = totals.input > 0 ? (totals.cacheRead / totals.input) * 100 : 0

  return [
    {
      key: 'messages',
      label: '消息总量',
      value: formatCompactNumber(totalMessages),
      hint: totalMessages > 0 ? `范围内 ${rows.length} 天` : '暂无消息数据',
    },
    {
      key: 'tool-calls',
      label: '工具调用',
      value: formatCompactNumber(totalToolCalls),
      hint: totalToolCalls > 0 ? `Top 工具 ${topTools.value[0]?.name || '-'}` : '暂无工具调用',
    },
    {
      key: 'error-rate',
      label: '错误率',
      value: `${errorRate.toFixed(errorRate >= 1 ? 1 : 2)}%`,
      hint: `${formatCompactNumber(totalErrors)} 错误 / ${formatCompactNumber(totalMessages)} 消息`,
    },
    {
      key: 'avg-token',
      label: '平均每条消息 Token',
      value: avgTokensPerMessage > 0 ? formatCompactNumber(avgTokensPerMessage) : '0',
      hint: '用总 Token / 消息总量计算',
    },
    {
      key: 'cache-read-ratio',
      label: '缓存读取占比',
      value: `${cacheReadRatio.toFixed(cacheReadRatio >= 10 ? 1 : 2)}%`,
      hint: `${formatCompactNumber(totals.cacheRead)} / ${formatCompactNumber(totals.input)} 输入`,
    },
    {
      key: 'active-days',
      label: '活跃天数',
      value: String(activeDays),
      hint: `已选范围 ${rows.length} 天`,
    },
  ]
})

const topModels = computed(() => {
  const list = sessionsUsageResult.value?.aggregates?.byModel || []
  const key = usageMode.value === 'tokens' ? 'totalTokens' : 'totalCost'
  return [...list]
    .sort((a, b) => (b.totals[key] || 0) - (a.totals[key] || 0))
    .slice(0, 5)
})

const topProviders = computed(() => {
  const list = sessionsUsageResult.value?.aggregates?.byProvider || []
  const key = usageMode.value === 'tokens' ? 'totalTokens' : 'totalCost'
  return [...list]
    .sort((a, b) => (b.totals[key] || 0) - (a.totals[key] || 0))
    .slice(0, 5)
})

const topTools = computed(() => {
  const list = sessionsUsageResult.value?.aggregates?.tools?.tools || []
  return [...list].sort((a, b) => b.count - a.count).slice(0, 6)
})

const topModelMax = computed(() =>
  Math.max(...topModels.value.map((item) => usageMetric(item.totals)), 0)
)

const topProviderMax = computed(() =>
  Math.max(...topProviders.value.map((item) => usageMetric(item.totals)), 0)
)

const topToolMax = computed(() =>
  Math.max(...topTools.value.map((item) => item.count || 0), 0)
)

const filteredEvents = computed(() => {
  const keyword = eventKeyword.value.trim().toLowerCase()
  if (!keyword) return recentEvents.value
  return recentEvents.value.filter((event) => event.event.toLowerCase().includes(keyword))
})

const eventStats = computed(() => {
  const result = {
    chat: 0,
    agent: 0,
    tool: 0,
    system: 0,
  }

  for (const item of recentEvents.value) {
    const name = item.event.toLowerCase()
    if (name.startsWith('chat')) result.chat += 1
    else if (name.startsWith('agent')) result.agent += 1
    else if (name.startsWith('tool')) result.tool += 1
    else result.system += 1
  }

  return result
})

const activeSession = computed(() =>
  recentSessions.value.find((session) => session.key === activeSessionKey.value) || null
)

const activeSessionUsage = computed(() => {
  if (!activeSession.value) return null
  return usageSessionMap.value[activeSession.value.key]?.usage || null
})

const sessionColumns = [
  {
    title: '频道',
    key: 'channel',
    width: 100,
    render(row: Session) {
      const parsed = parseSessionKey(row.key)
      return h(NTag, { size: 'small', round: true, bordered: false }, { default: () => parsed.channel })
    },
  },
  {
    title: '对话方',
    key: 'peer',
    ellipsis: { tooltip: true },
    render(row: Session) {
      const parsed = parseSessionKey(row.key)
      return parsed.peer || '-'
    },
  },
  {
    title: '消息数',
    key: 'messageCount',
    width: 84,
  },
  {
    title: '用量',
    key: 'usage',
    width: 116,
    render(row: Session) {
      const usage = usageSessionMap.value[row.key]?.usage
      if (!usage) return '-'
      return usageMode.value === 'tokens'
        ? formatCompactNumber(usage.totalTokens)
        : formatUsd(usage.totalCost)
    },
  },
  {
    title: '最近活动',
    key: 'lastActivity',
    width: 132,
    render(row: Session) {
      return row.lastActivity ? formatRelativeTime(row.lastActivity) : '-'
    },
  },
]

onMounted(async () => {
  applyRangePreset('7d', false)
  retryAfterFirstConnect = wsStore.state !== 'connected'

  cleanupStateChange = wsStore.subscribe('stateChange', () => {
    maybeRetryAfterConnect()
  })
  await refreshDashboard()
  maybeRetryAfterConnect()

  cleanupEvents = wsStore.subscribe('event', (evt: unknown) => {
    const event = evt as { event: string; payload: unknown; seq?: number }
    recentEvents.value.unshift({
      event: event.event,
      payload: event.payload,
      seq: event.seq,
      timestamp: Date.now(),
    })
    if (recentEvents.value.length > EVENT_LIMIT) {
      recentEvents.value.length = EVENT_LIMIT
    }
  })
})

onUnmounted(() => {
  cleanupStateChange?.()
  cleanupStateChange = null
  cleanupEvents?.()
  cleanupEvents = null
})

function maybeRetryAfterConnect() {
  if (!retryAfterFirstConnect) return
  if (wsStore.state !== 'connected') return
  if (refreshing.value) return

  retryAfterFirstConnect = false
  void refreshDashboard()
}

async function refreshDashboard() {
  if (refreshing.value) return

  refreshing.value = true
  usageError.value = null

  try {
    const [sessionsRes, cronsRes, modelsRes, skillsRes, configRes, usageRes, usageCostRes] = await Promise.allSettled([
      wsStore.rpc.listSessions(),
      wsStore.rpc.listCrons(),
      wsStore.rpc.listModels(),
      wsStore.rpc.listSkills(),
      wsStore.rpc.getConfig(),
      wsStore.rpc.getSessionsUsage({
        startDate: usageStartDate.value,
        endDate: usageEndDate.value,
        limit: 1000,
      }),
      wsStore.rpc.getUsageCost({
        startDate: usageStartDate.value,
        endDate: usageEndDate.value,
      }),
    ])

    const sessionList = sessionsRes.status === 'fulfilled' ? sessionsRes.value : []
    const cronList = cronsRes.status === 'fulfilled' ? cronsRes.value : []
    const modelList = modelsRes.status === 'fulfilled' ? modelsRes.value : []
    const skillList = skillsRes.status === 'fulfilled' ? skillsRes.value : []
    const config = configRes.status === 'fulfilled' ? configRes.value : null
    const sortedSessions = [...sessionList].sort(
      (a, b) => parseTime(b.lastActivity) - parseTime(a.lastActivity)
    )

    stats.value = {
      sessionCount: sessionList.length,
      cronCount: cronList.filter((job: CronJob) => job.enabled).length,
      modelCount: resolveConfiguredModelCount(config, modelList),
      installedSkills: skillList.filter((s: Skill) => s.installed).length,
    }

    recentSessions.value = sortedSessions.slice(0, 12)
    if (!activeSessionKey.value || !recentSessions.value.some((item) => item.key === activeSessionKey.value)) {
      activeSessionKey.value = recentSessions.value[0]?.key || ''
    }

    if (usageRes.status === 'fulfilled') {
      sessionsUsageResult.value = usageRes.value
    } else {
      sessionsUsageResult.value = null
      usageError.value = usageRes.reason instanceof Error ? usageRes.reason.message : String(usageRes.reason)
    }

    if (usageCostRes.status === 'fulfilled') {
      usageCostSummary.value = usageCostRes.value
    } else {
      usageCostSummary.value = null
      if (!usageError.value) {
        usageError.value = usageCostRes.reason instanceof Error
          ? usageCostRes.reason.message
          : String(usageCostRes.reason)
      }
    }

    lastUpdatedAt.value = Date.now()
  } finally {
    loading.value = false
    refreshing.value = false
  }
}

function applyRangePreset(preset: Exclude<RangePreset, 'custom'>, refresh = true) {
  rangePreset.value = preset
  const today = new Date()
  const end = formatYmd(today)

  if (preset === 'today') {
    usageStartDate.value = end
    usageEndDate.value = end
  } else if (preset === '7d') {
    usageStartDate.value = formatYmd(addDays(today, -6))
    usageEndDate.value = end
  } else {
    usageStartDate.value = formatYmd(addDays(today, -29))
    usageEndDate.value = end
  }

  if (refresh) {
    void refreshDashboard()
  }
}

function handleDateRangeChanged() {
  rangePreset.value = 'custom'
}

function addDays(base: Date, offset: number): Date {
  const next = new Date(base)
  next.setDate(next.getDate() + offset)
  return next
}

function formatYmd(date: Date): string {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

function toRecord(value: unknown): Record<string, unknown> | null {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return value as Record<string, unknown>
  }
  return null
}

function splitModelRef(value: string): { providerId: string; modelId: string } | null {
  const modelRef = value.trim()
  const slashIndex = modelRef.indexOf('/')
  if (slashIndex <= 0 || slashIndex >= modelRef.length - 1) return null

  const providerId = modelRef.slice(0, slashIndex).trim()
  const modelId = modelRef.slice(slashIndex + 1).trim()
  if (!providerId || !modelId) return null

  return { providerId, modelId }
}

function collectConfiguredModelRefs(input: unknown, refs: Set<string>) {
  if (!input) return

  if (typeof input === 'string') {
    const parsed = splitModelRef(input)
    if (parsed) refs.add(`${parsed.providerId}/${parsed.modelId}`)
    return
  }

  if (Array.isArray(input)) {
    for (const item of input) {
      collectConfiguredModelRefs(item, refs)
    }
    return
  }

  const row = toRecord(input)
  if (!row) return

  for (const candidate of [row.id, row.model, row.ref, row.primary]) {
    if (typeof candidate === 'string') {
      const parsed = splitModelRef(candidate)
      if (parsed) refs.add(`${parsed.providerId}/${parsed.modelId}`)
    }
  }

  for (const [key, value] of Object.entries(row)) {
    const keyParsed = splitModelRef(key)
    if (keyParsed) refs.add(`${keyParsed.providerId}/${keyParsed.modelId}`)
    if (typeof value === 'string') {
      const valueParsed = splitModelRef(value)
      if (valueParsed) refs.add(`${valueParsed.providerId}/${valueParsed.modelId}`)
    }
  }
}

function collectProviderModelIds(provider: unknown, modelIds: Set<string>) {
  const row = toRecord(provider)
  if (!row) return

  const extract = (value: unknown) => {
    if (!value) return

    if (Array.isArray(value)) {
      for (const item of value) {
        if (typeof item === 'string' && item.trim()) {
          modelIds.add(item.trim())
          continue
        }
        const itemRow = toRecord(item)
        if (!itemRow) continue
        const id =
          (typeof itemRow.id === 'string' && itemRow.id.trim()) ||
          (typeof itemRow.name === 'string' && itemRow.name.trim()) ||
          ''
        if (id) modelIds.add(id)
      }
      return
    }

    const mapRow = toRecord(value)
    if (!mapRow) return
    for (const [key, item] of Object.entries(mapRow)) {
      const normalizedKey = key.trim()
      if (!normalizedKey) continue
      if (typeof item === 'string' && item.trim()) {
        modelIds.add(item.trim())
        continue
      }
      const itemRow = toRecord(item)
      if (itemRow) {
        const id =
          (typeof itemRow.id === 'string' && itemRow.id.trim()) ||
          (typeof itemRow.name === 'string' && itemRow.name.trim()) ||
          normalizedKey
        if (id) modelIds.add(id)
      } else {
        modelIds.add(normalizedKey)
      }
    }
  }

  extract(row.models)
  extract(row.modelIds)
  extract(row.availableModels)
  extract(row.whitelist)
}

function resolveConfiguredModelCount(config: OpenClawConfig | null, fallbackModels: ModelInfo[]): number {
  const refs = new Set<string>()
  const defaultsRaw = toRecord(config?.agents?.defaults)
  const defaultsModelRaw = toRecord(defaultsRaw?.model)
  collectConfiguredModelRefs(config?.models?.primary, refs)
  collectConfiguredModelRefs(config?.models?.fallback, refs)
  collectConfiguredModelRefs(defaultsRaw?.models, refs)
  collectConfiguredModelRefs(defaultsModelRaw?.primary, refs)
  collectConfiguredModelRefs(defaultsModelRaw?.fallback, refs)
  collectConfiguredModelRefs(defaultsModelRaw?.fallbacks, refs)

  if (refs.size > 0) return refs.size

  const providerModelIds = new Set<string>()
  const providers = toRecord(config?.models?.providers)
  if (providers) {
    for (const provider of Object.values(providers)) {
      collectProviderModelIds(provider, providerModelIds)
    }
  }
  if (providerModelIds.size > 0) return providerModelIds.size

  const fallbackIds = new Set(
    fallbackModels
      .filter((model) => model.available !== false)
      .map((model) => model.id)
      .filter((id) => !!id)
  )
  return fallbackIds.size
}

function parseTime(value?: string): number {
  if (!value) return 0
  const timestamp = new Date(value).getTime()
  return Number.isFinite(timestamp) ? timestamp : 0
}

function formatCompactNumber(value: number): string {
  return new Intl.NumberFormat('zh-CN', {
    notation: 'compact',
    maximumFractionDigits: 1,
  }).format(value)
}

function formatUsd(value: number): string {
  return new Intl.NumberFormat('zh-CN', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: value > 0 && value < 0.01 ? 4 : 2,
    maximumFractionDigits: value > 0 && value < 0.01 ? 4 : 2,
  }).format(value)
}

function formatEventPayload(payload: unknown): string {
  if (payload === null || payload === undefined) return '-'
  if (typeof payload === 'string') return truncate(payload.replace(/\s+/g, ' '), 100)
  if (typeof payload === 'number' || typeof payload === 'boolean') return String(payload)
  try {
    return truncate(JSON.stringify(payload), 120)
  } catch {
    return '[payload 无法序列化]'
  }
}

function formatUsageValue(value: number): string {
  return usageMode.value === 'tokens' ? formatCompactNumber(value) : formatUsd(value)
}

function usageMetric(totals: SessionsUsageTotals): number {
  return usageMode.value === 'tokens' ? totals.totalTokens : totals.totalCost
}

function topBarWidth(value: number, max: number): string {
  if (max <= 0 || value <= 0) return '0%'
  return `${Math.max((value / max) * 100, 8)}%`
}

function sessionRowProps(row: Session) {
  return {
    onClick: () => {
      activeSessionKey.value = row.key
    },
    style: 'cursor: pointer;',
  }
}

function sessionRowClassName(row: Session) {
  return row.key === activeSessionKey.value ? 'dashboard-row-active' : ''
}

function viewSessions() {
  router.push({ name: 'Sessions' })
}

function viewSessionDetail(session: Session) {
  router.push({ name: 'SessionDetail', params: { key: encodeURIComponent(session.key) } })
}

function viewChat() {
  router.push({ name: 'Chat' })
}

function viewCron() {
  router.push({ name: 'Cron' })
}

function viewModels() {
  router.push({ name: 'Models' })
}
</script>

<template>
  <NSpin :show="loading">
    <div class="dashboard-page">
      <NCard class="dashboard-hero" :bordered="false">
        <div class="dashboard-hero-top">
          <div>
            <div class="dashboard-hero-title">OpenClaw 运行总览</div>
            <div class="dashboard-hero-subtitle">
              用官方 Usage 聚合数据看 token/cost、活跃会话、错误分布，再进入具体会话处理。
            </div>
          </div>
          <NSpace :size="8" wrap>
            <NTag :type="connectionType" round :bordered="false">{{ connectionLabel }}</NTag>
            <NTag type="info" round :bordered="false">{{ usageCoverageText }}</NTag>
            <NTag round :bordered="false">{{ lastUpdatedText }}</NTag>
          </NSpace>
        </div>

        <NSpace :size="8" wrap class="dashboard-filters-row">
          <NButton size="small" :type="rangePreset === 'today' ? 'primary' : 'default'" secondary @click="applyRangePreset('today')">Today</NButton>
          <NButton size="small" :type="rangePreset === '7d' ? 'primary' : 'default'" secondary @click="applyRangePreset('7d')">7d</NButton>
          <NButton size="small" :type="rangePreset === '30d' ? 'primary' : 'default'" secondary @click="applyRangePreset('30d')">30d</NButton>

          <input
            v-model="usageStartDate"
            class="usage-date-input"
            type="date"
            @change="handleDateRangeChanged"
          />
          <span class="usage-date-sep">到</span>
          <input
            v-model="usageEndDate"
            class="usage-date-input"
            type="date"
            @change="handleDateRangeChanged"
          />

          <NButton size="small" :type="usageMode === 'tokens' ? 'primary' : 'default'" secondary @click="usageMode = 'tokens'">Tokens</NButton>

          <NButton type="primary" :loading="refreshing" @click="refreshDashboard">
            <template #icon><NIcon :component="RefreshOutline" /></template>
            刷新
          </NButton>
          <NButton secondary @click="viewChat">
            <template #icon><NIcon :component="ChatboxEllipsesOutline" /></template>
            在线对话
          </NButton>
          <NButton secondary @click="viewCron">Cron 管理</NButton>
          <NButton secondary @click="viewModels">Model 管理</NButton>
        </NSpace>

        <NAlert v-if="usageError" type="warning" :bordered="false" style="margin-top: 10px;">
          Usage 接口读取失败：{{ usageError }}
        </NAlert>
      </NCard>

      <NGrid cols="1 s:2 m:3 l:5" responsive="screen" :x-gap="12" :y-gap="12">
        <NGridItem>
          <StatCard title="总会话数" :value="stats.sessionCount" :icon="ChatbubblesOutline" color="#18a058" />
        </NGridItem>
        <NGridItem>
          <StatCard title="启用任务" :value="stats.cronCount" :icon="CalendarOutline" color="#f0a020" />
        </NGridItem>
        <NGridItem>
          <StatCard title="已配置模型" :value="stats.modelCount" :icon="SparklesOutline" color="#2080f0" />
        </NGridItem>
        <NGridItem>
          <StatCard title="已安装技能" :value="stats.installedSkills" :icon="ExtensionPuzzleOutline" color="#8b5cf6" />
        </NGridItem>
        <NGridItem>
          <StatCard title="总 Token" :value="tokenTotalDisplay" :icon="FlashOutline" color="#d03050" />
        </NGridItem>
      </NGrid>

      <NCard title="Usage 关键指标" class="dashboard-card">
        <div class="kpi-grid">
          <div v-for="kpi in usageKpis" :key="kpi.key" class="kpi-card">
            <NText depth="3">{{ kpi.label }}</NText>
            <div class="kpi-value">{{ kpi.value }}</div>
            <NText depth="3" style="font-size: 12px;">{{ kpi.hint }}</NText>
          </div>
        </div>
      </NCard>

      <NGrid cols="1 l:3" responsive="screen" :x-gap="12" :y-gap="12">
        <NGridItem :span="2" class="usage-trend-item">
          <NCard title="Token 趋势（官方 Usage）" class="dashboard-card usage-trend-card">
            <template #header-extra>
              <NSpace :size="8" align="center">
                <NTag size="small" :bordered="false" round type="info">
                  {{ usageStartDate }} ~ {{ usageEndDate }}
                </NTag>
                <NTag size="small" :bordered="false" round>
                  {{ usageMode === 'tokens' ? tokenTotalDisplay : costTotalDisplay }}
                </NTag>
              </NSpace>
            </template>

            <div class="trend-chart-panel">
              <template v-if="trendGeometry.points.length">
                <svg
                  class="trend-chart-svg"
                  :viewBox="`0 0 ${trendGeometry.width} ${trendGeometry.height}`"
                  preserveAspectRatio="none"
                >
                  <g v-for="guide in trendGeometry.guides" :key="`guide-${guide.ratio}`">
                    <line
                      :x1="trendGeometry.left"
                      :y1="guide.y"
                      :x2="trendGeometry.left + trendGeometry.usableWidth"
                      :y2="guide.y"
                      class="trend-grid-line"
                    />
                    <text
                      x="4"
                      :y="guide.y + 4"
                      class="trend-grid-label"
                    >
                      {{ formatUsageValue(guide.value) }}
                    </text>
                  </g>

                  <path
                    v-if="trendGeometry.areaPath"
                    class="trend-area"
                    :d="trendGeometry.areaPath"
                  />
                  <polyline
                    v-if="trendGeometry.polyline"
                    class="trend-line"
                    :points="trendGeometry.polyline"
                  />
                  <circle
                    v-for="point in trendGeometry.points"
                    :key="`point-${point.date}`"
                    class="trend-point"
                    :cx="point.x"
                    :cy="point.y"
                    r="3.5"
                  >
                    <title>
                      {{ point.date }} · {{ formatUsageValue(point.value) }} · 消息 {{ point.messages }} · 错误 {{ point.errors }}
                    </title>
                  </circle>
                </svg>

                <div class="trend-axis-note">
                  <span>{{ trendAxisLabels.start }}</span>
                  <span>{{ trendAxisLabels.mid }}</span>
                  <span>{{ trendAxisLabels.end }}</span>
                </div>
              </template>
              <div v-else class="daily-empty">当前范围暂无趋势数据</div>
            </div>
          </NCard>
        </NGridItem>

        <NGridItem :span="1" class="usage-structure-item">
          <NCard title="Usage 结构" class="dashboard-card usage-structure-card">
            <NSpace justify="space-between" align="center" style="margin-bottom: 8px;">
              <NText depth="3">{{ usageMode === 'tokens' ? '总 Token' : '总 Cost' }}</NText>
              <NText strong>{{ usageMode === 'tokens' ? tokenTotalDisplay : costTotalDisplay }}</NText>
            </NSpace>

            <div class="segment-track">
              <div
                v-for="segment in usageSegments"
                :key="segment.key"
                class="segment-item"
                :style="{
                  width: `${Math.max((segment.value / segmentTotal) * 100, segment.value > 0 ? 4 : 0)}%`,
                  background: segment.color,
                }"
              />
            </div>

            <div class="segment-list">
              <div v-for="segment in usageSegments" :key="`${segment.key}-row`" class="segment-row">
                <div class="segment-row-label">
                  <span class="segment-dot" :style="{ background: segment.color }" />
                  <span>{{ segment.label }}</span>
                </div>
                <NText>{{ formatUsageValue(segment.value) }}</NText>
              </div>
            </div>

            <NText depth="3" style="display: block; margin-top: 8px; font-size: 12px;">
              缺失成本条目：{{ usageTotals.missingCostEntries }}
            </NText>
          </NCard>
        </NGridItem>
      </NGrid>

      <NCard title="Top 分布" class="dashboard-card">
        <NGrid cols="1 m:3" responsive="screen" :x-gap="12" :y-gap="12">
          <NGridItem>
            <div class="top-pane-card">
              <div class="top-title">Top Models</div>
              <div v-if="topModels.length" class="top-list">
                <div v-for="item in topModels" :key="`${item.provider || '-'}:${item.model || '-'}`" class="top-row">
                  <div class="top-row-main">
                    <span>{{ item.provider ? `${item.provider}/${item.model || '-'}` : item.model || '-' }}</span>
                    <span>{{ usageMode === 'tokens' ? formatCompactNumber(item.totals.totalTokens) : formatUsd(item.totals.totalCost) }}</span>
                  </div>
                  <div class="top-row-bar">
                    <div
                      class="top-row-bar-inner top-row-bar-inner-model"
                      :style="{ width: topBarWidth(usageMetric(item.totals), topModelMax) }"
                    />
                  </div>
                </div>
              </div>
              <div v-else class="top-empty">暂无数据</div>
            </div>
          </NGridItem>

          <NGridItem>
            <div class="top-pane-card">
              <div class="top-title">Top Providers</div>
              <div v-if="topProviders.length" class="top-list">
                <div v-for="item in topProviders" :key="item.provider || 'unknown-provider'" class="top-row">
                  <div class="top-row-main">
                    <span>{{ item.provider || '-' }}</span>
                    <span>{{ usageMode === 'tokens' ? formatCompactNumber(item.totals.totalTokens) : formatUsd(item.totals.totalCost) }}</span>
                  </div>
                  <div class="top-row-bar">
                    <div
                      class="top-row-bar-inner top-row-bar-inner-provider"
                      :style="{ width: topBarWidth(usageMetric(item.totals), topProviderMax) }"
                    />
                  </div>
                </div>
              </div>
              <div v-else class="top-empty">暂无数据</div>
            </div>
          </NGridItem>

          <NGridItem>
            <div class="top-pane-card">
              <div class="top-title">Top Tools</div>
              <div v-if="topTools.length" class="top-list">
                <div v-for="item in topTools" :key="item.name" class="top-row">
                  <div class="top-row-main">
                    <span>{{ item.name }}</span>
                    <span>{{ item.count }}</span>
                  </div>
                  <div class="top-row-bar">
                    <div
                      class="top-row-bar-inner top-row-bar-inner-tool"
                      :style="{ width: topBarWidth(item.count, topToolMax) }"
                    />
                  </div>
                </div>
              </div>
              <div v-else class="top-empty">暂无数据</div>
            </div>
          </NGridItem>
        </NGrid>
      </NCard>

      <NGrid cols="1 l:3" responsive="screen" :x-gap="12" :y-gap="12">
        <NGridItem :span="2">
          <NCard title="会话概览（带用量）" class="dashboard-card">
            <template #header-extra>
              <NButton text @click="viewSessions">查看全部</NButton>
            </template>

            <NDataTable
              :columns="sessionColumns"
              :data="recentSessions"
              :bordered="false"
              size="small"
              :pagination="false"
              :row-key="(row: Session) => row.key"
              :row-props="sessionRowProps"
              :row-class-name="sessionRowClassName"
            />

            <div v-if="activeSession" class="dashboard-session-focus">
              <NSpace justify="space-between" align="center">
                <div>
                  <NText strong>{{ activeSession.key }}</NText>
                  <NText depth="3" style="display: block; margin-top: 4px;">
                    模型：{{ activeSession.model || '-' }}，消息：{{ activeSession.messageCount }}，最近：
                    {{ activeSession.lastActivity ? formatRelativeTime(activeSession.lastActivity) : '-' }}
                  </NText>
                </div>
                <div style="text-align: right;">
                  <NText depth="3" style="display: block;">用量（{{ usageMode }}）</NText>
                  <NText strong>
                    {{
                      activeSessionUsage
                        ? usageMode === 'tokens'
                          ? formatCompactNumber(activeSessionUsage.totalTokens)
                          : formatUsd(activeSessionUsage.totalCost)
                        : '-'
                    }}
                  </NText>
                </div>
              </NSpace>
              <NSpace justify="end" style="margin-top: 8px;">
                <NButton size="small" tertiary type="primary" @click="viewSessionDetail(activeSession)">
                  会话详情
                </NButton>
              </NSpace>
            </div>
          </NCard>
        </NGridItem>

        <NGridItem :span="1">
          <NCard title="实时事件流" class="dashboard-card">
            <template #header-extra>
              <NInput
                v-model:value="eventKeyword"
                size="small"
                clearable
                placeholder="筛选事件名，如 chat / agent / tool"
                style="width: 260px;"
              />
            </template>

            <NSpace :size="8" wrap style="margin-bottom: 10px;">
              <NTag size="small" round :bordered="false">chat {{ eventStats.chat }}</NTag>
              <NTag size="small" round :bordered="false">agent {{ eventStats.agent }}</NTag>
              <NTag size="small" round :bordered="false">tool {{ eventStats.tool }}</NTag>
              <NTag size="small" round :bordered="false">system {{ eventStats.system }}</NTag>
            </NSpace>

            <div class="event-list">
              <div v-for="(event, index) in filteredEvents" :key="`${event.event}-${event.seq || index}`" class="event-row">
                <NSpace justify="space-between" align="center">
                  <NTag size="tiny" :bordered="false" round>{{ event.event }}</NTag>
                  <NText depth="3" style="font-size: 12px;">
                    {{ formatRelativeTime(event.timestamp) }}
                  </NText>
                </NSpace>
                <NText depth="3" style="display: block; margin-top: 4px; font-size: 12px;">
                  {{ formatEventPayload(event.payload) }}
                </NText>
              </div>
              <div v-if="filteredEvents.length === 0" class="event-empty">等待事件...</div>
            </div>
          </NCard>
        </NGridItem>
      </NGrid>
    </div>
  </NSpin>
</template>

<style scoped>
.dashboard-page {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.dashboard-card {
  border-radius: var(--radius-lg);
}

.dashboard-hero {
  border-radius: var(--radius-lg);
  background:
    radial-gradient(circle at 84% 16%, rgba(24, 160, 88, 0.22), transparent 36%),
    linear-gradient(120deg, var(--bg-card), rgba(42, 127, 255, 0.08));
  border: 1px solid rgba(42, 127, 255, 0.18);
}

.dashboard-hero-top {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  gap: 12px;
  margin-bottom: 12px;
  flex-wrap: wrap;
}

.dashboard-hero-title {
  font-size: 18px;
  font-weight: 700;
  line-height: 1.3;
}

.dashboard-hero-subtitle {
  margin-top: 4px;
  font-size: 13px;
  color: var(--text-secondary);
  line-height: 1.55;
}

.dashboard-filters-row {
  align-items: center;
}

.usage-date-input {
  border: 1px solid var(--border-color);
  background: var(--bg-primary);
  color: var(--text-primary);
  border-radius: 8px;
  height: 30px;
  padding: 0 10px;
  font-size: 12px;
}

.usage-date-sep {
  font-size: 12px;
  color: var(--text-secondary);
}

.dashboard-session-focus {
  margin-top: 10px;
  border: 1px solid var(--border-color);
  border-radius: 10px;
  padding: 10px;
  background: var(--bg-secondary);
}

.usage-trend-item,
.usage-structure-item {
  display: flex;
}

.usage-trend-card,
.usage-structure-card {
  width: 100%;
  height: 100%;
}

.usage-trend-card :deep(.n-card__content),
.usage-structure-card :deep(.n-card__content) {
  height: 100%;
}

.usage-structure-card :deep(.n-card__content) {
  display: flex;
  flex-direction: column;
  justify-content: space-between;
}

.kpi-grid {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 10px;
}

.kpi-card {
  border: 1px solid var(--border-color);
  border-radius: 10px;
  background: linear-gradient(130deg, rgba(42, 127, 255, 0.08), rgba(24, 160, 88, 0.06));
  padding: 10px 12px;
}

.kpi-value {
  margin: 4px 0;
  font-size: 22px;
  font-weight: 700;
  line-height: 1.2;
}

.trend-chart-panel {
  border: 1px solid var(--border-color);
  border-radius: 10px;
  padding: 10px;
  background: linear-gradient(180deg, rgba(42, 127, 255, 0.06), transparent 38%);
}

.trend-chart-svg {
  width: 100%;
  height: 250px;
}

.trend-grid-line {
  stroke: var(--border-color);
  stroke-width: 1;
  stroke-dasharray: 4 4;
}

.trend-grid-label {
  fill: var(--text-secondary);
  font-size: 11px;
}

.trend-area {
  fill: rgba(42, 127, 255, 0.2);
}

.trend-line {
  fill: none;
  stroke: #2a7fff;
  stroke-width: 2.5;
  stroke-linejoin: round;
  stroke-linecap: round;
}

.trend-point {
  fill: #18a058;
  stroke: rgba(24, 160, 88, 0.3);
  stroke-width: 3;
}

.trend-axis-note {
  margin-top: 6px;
  display: flex;
  justify-content: space-between;
  color: var(--text-secondary);
  font-size: 12px;
}

.daily-empty {
  font-size: 12px;
  color: var(--text-secondary);
  padding: 10px 0;
}

.segment-track {
  width: 100%;
  height: 10px;
  border-radius: 999px;
  overflow: hidden;
  background: var(--bg-secondary);
  display: flex;
}

.segment-item {
  min-width: 0;
  height: 100%;
}

.segment-list {
  margin-top: 10px;
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.segment-row {
  display: flex;
  justify-content: space-between;
  align-items: center;
  font-size: 13px;
}

.segment-row-label {
  display: flex;
  align-items: center;
  gap: 6px;
}

.segment-dot {
  width: 8px;
  height: 8px;
  border-radius: 999px;
}

.top-title {
  font-size: 12px;
  color: var(--text-secondary);
  margin-bottom: 8px;
}

.top-pane-card {
  border: 1px solid var(--border-color);
  border-radius: 10px;
  background: var(--bg-primary);
  padding: 10px;
  height: 100%;
}

.top-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.top-row {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.top-row-main {
  display: flex;
  justify-content: space-between;
  gap: 8px;
  font-size: 13px;
}

.top-row-main span:first-child {
  max-width: 70%;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.top-row-bar {
  height: 6px;
  border-radius: 999px;
  background: var(--bg-secondary);
  overflow: hidden;
}

.top-row-bar-inner {
  height: 100%;
  border-radius: 999px;
  min-width: 0;
}

.top-row-bar-inner-model {
  background: linear-gradient(90deg, rgba(42, 127, 255, 0.9), rgba(42, 127, 255, 0.45));
}

.top-row-bar-inner-provider {
  background: linear-gradient(90deg, rgba(24, 160, 88, 0.9), rgba(24, 160, 88, 0.45));
}

.top-row-bar-inner-tool {
  background: linear-gradient(90deg, rgba(240, 160, 32, 0.95), rgba(240, 160, 32, 0.45));
}

.top-empty {
  font-size: 12px;
  color: var(--text-secondary);
}

.event-list {
  max-height: 320px;
  overflow-y: auto;
  border: 1px solid var(--border-color);
  border-radius: 8px;
  padding: 0 10px;
  background: var(--bg-primary);
}

.event-row {
  padding: 10px 0;
  border-bottom: 1px dashed var(--border-color);
}

.event-row:last-child {
  border-bottom: none;
}

.event-empty {
  text-align: center;
  padding: 32px 0;
  color: var(--text-secondary);
}

:deep(.dashboard-row-active td) {
  background: rgba(24, 160, 88, 0.12) !important;
}

@media (max-width: 900px) {
  .dashboard-filters-row {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  .kpi-grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}

@media (max-width: 560px) {
  .kpi-grid {
    grid-template-columns: 1fr;
  }
}
</style>
