<script setup lang="ts">
import { computed, h, nextTick, onMounted, onUnmounted, ref, watch } from 'vue'
import {
  NAlert,
  NButton,
  NCard,
  NEmpty,
  NFormItem,
  NGrid,
  NGridItem,
  NIcon,
  NInput,
  NInputNumber,
  NScrollbar,
  NSelect,
  NSpace,
  NSpin,
  NSwitch,
  NTabPane,
  NTabs,
  NTag,
  NText,
  useDialog,
  useMessage,
} from 'naive-ui'
import {
  AddOutline,
  DownloadOutline,
  RefreshOutline,
  SearchOutline,
  SaveOutline,
  TrashOutline,
} from '@vicons/ionicons5'
import { useWebSocketStore } from '@/stores/websocket'
import { formatDate, formatRelativeTime } from '@/utils/format'
import type {
  DeviceNode,
  ExecApprovalsAgent,
  ExecApprovalsDefaults,
  ExecApprovalsFile,
  ExecApprovalsSnapshot,
  HealthSummary,
  LogEntry,
  LogLevel,
  StatusSummary,
  SystemPresenceEntry,
  UpdateRunResponse,
  UpdateRunStepResult,
} from '@/api/types'

type OpsTab = 'presence' | 'logs' | 'approvals' | 'update'
type ExecTargetKind = 'gateway' | 'node'

const LOG_LEVEL_OPTIONS: Array<{ label: string; value: LogLevel }> = [
  { label: 'TRACE', value: 'trace' },
  { label: 'DEBUG', value: 'debug' },
  { label: 'INFO', value: 'info' },
  { label: 'WARN', value: 'warn' },
  { label: 'ERROR', value: 'error' },
  { label: 'FATAL', value: 'fatal' },
]
const POLICY_SECURITY_OPTIONS = [
  { label: 'deny', value: 'deny' },
  { label: 'allowlist', value: 'allowlist' },
  { label: 'full', value: 'full' },
]
const POLICY_ASK_OPTIONS = [
  { label: 'off', value: 'off' },
  { label: 'on-miss', value: 'on-miss' },
  { label: 'always', value: 'always' },
]
const LOG_BUFFER_LIMIT = 2000

const message = useMessage()
const dialog = useDialog()
const wsStore = useWebSocketStore()

const activeTab = ref<OpsTab>('presence')

const presenceLoading = ref(false)
const presenceError = ref('')
const presenceEntries = ref<SystemPresenceEntry[]>([])
const presenceLastUpdatedAt = ref<number | null>(null)

const diagLoading = ref(false)
const healthError = ref('')
const statusError = ref('')
const healthSnapshot = ref<HealthSummary | null>(null)
const statusSnapshot = ref<StatusSummary | null>(null)
const diagLastUpdatedAt = ref<number | null>(null)
const diagLastProbeAt = ref<number | null>(null)

const logsLoading = ref(false)
const logsError = ref('')
const logsCursor = ref<number | null>(null)
const logsFile = ref('')
const logsEntries = ref<LogEntry[]>([])
const logsTruncated = ref(false)
const logsLastUpdatedAt = ref<number | null>(null)
const logsAutoFollow = ref(true)
const logsKeyword = ref('')
const logsLevelFilter = ref<LogLevel[]>(LOG_LEVEL_OPTIONS.map((item) => item.value))
const logsLimit = ref(500)
const logsMaxBytes = ref(250000)
const logScrollbarRef = ref<any>(null)

const nodesLoading = ref(false)
const nodes = ref<DeviceNode[]>([])

const approvalsLoading = ref(false)
const approvalsSaving = ref(false)
const approvalsError = ref('')
const approvalsDirty = ref(false)
const approvalsSnapshot = ref<ExecApprovalsSnapshot | null>(null)
const approvalsForm = ref<ExecApprovalsFile | null>(null)
const approvalsTargetKind = ref<ExecTargetKind>('gateway')
const approvalsTargetNodeId = ref('')
const approvalsAgentId = ref('main')
const newAgentId = ref('')
const newAllowPattern = ref('')

const updateRunning = ref(false)
const updateError = ref('')
const updateSessionKey = ref('')
const updateNote = ref('')
const updateRestartDelayMs = ref<number | null>(2000)
const updateTimeoutMs = ref<number | null>(180000)
const updateLastTriggeredAt = ref<number | null>(null)
const updateResponse = ref<UpdateRunResponse | null>(null)

let presenceTimer: ReturnType<typeof setInterval> | null = null
let logsTimer: ReturnType<typeof setInterval> | null = null

const connectionTagType = computed<'success' | 'warning' | 'error' | 'default'>(() => {
  if (wsStore.state === 'connected') return 'success'
  if (wsStore.state === 'connecting' || wsStore.state === 'reconnecting') return 'warning'
  if (wsStore.state === 'failed') return 'error'
  return 'default'
})

const connectionLabel = computed(() => {
  if (wsStore.state === 'connected') return '网关已连接'
  if (wsStore.state === 'connecting') return '网关连接中'
  if (wsStore.state === 'reconnecting') return '网关重连中'
  if (wsStore.state === 'failed') return '网关连接失败'
  return '网关未连接'
})

const onlinePresenceCount = computed(() => {
  const now = Date.now()
  return presenceEntries.value.filter((entry) => {
    const ts = typeof entry.ts === 'number' ? entry.ts : 0
    return ts > 0 && now - ts <= 60000
  }).length
})

const healthChannelCount = computed(() => {
  const snap = healthSnapshot.value
  if (!snap?.channels) return 0
  return Object.keys(snap.channels).length
})

const healthConfiguredChannelCount = computed(() => {
  const snap = healthSnapshot.value
  if (!snap?.channels) return 0
  return Object.values(snap.channels).filter((entry) => {
    if (!entry || typeof entry !== 'object') return false
    return (entry as { configured?: boolean }).configured === true
  }).length
})

const healthProbedAccountCount = computed(() => {
  const snap = healthSnapshot.value
  if (!snap?.channels) return 0
  let count = 0
  for (const channel of Object.values(snap.channels)) {
    if (!channel || typeof channel !== 'object') continue
    const accounts = (channel as { accounts?: Record<string, unknown> }).accounts
    const accountEntries =
      accounts && typeof accounts === 'object'
        ? Object.values(accounts).filter((row) => row && typeof row === 'object')
        : []

    if (accountEntries.length === 0) {
      const hasProbe =
        (channel as { lastProbeAt?: number | null }).lastProbeAt != null ||
        (channel as { probe?: unknown }).probe !== undefined
      if (hasProbe) count += 1
      continue
    }

    for (const entry of accountEntries) {
      const row = entry as { lastProbeAt?: number | null; probe?: unknown }
      if (row.lastProbeAt != null || row.probe !== undefined) {
        count += 1
      }
    }
  }
  return count
})

const statusHeartbeatEnabledCount = computed(() => {
  const agents = statusSnapshot.value?.heartbeat?.agents || []
  return agents.filter((agent) => agent.enabled).length
})

const methodUnknown = computed(() => wsStore.gatewayMethods.length === 0)
const supportsPresence = computed(
  () => methodUnknown.value || wsStore.supportsAnyMethod(['system-presence'])
)
const supportsHealth = computed(() => methodUnknown.value || wsStore.supportsAnyMethod(['health']))
const supportsStatus = computed(() => methodUnknown.value || wsStore.supportsAnyMethod(['status']))
const supportsLogs = computed(
  () => methodUnknown.value || wsStore.supportsAnyMethod(['logs.tail'])
)
const supportsExecApprovals = computed(() => {
  if (methodUnknown.value) return true
  if (approvalsTargetKind.value === 'node') {
    return wsStore.supportsAnyMethod(['exec.approvals.node.get', 'exec.approvals.node.set'])
  }
  return wsStore.supportsAnyMethod(['exec.approvals.get', 'exec.approvals.set'])
})
const supportsUpdate = computed(
  () => methodUnknown.value || wsStore.supportsAnyMethod(['update.run'])
)

const logLevelOptions = computed(() => LOG_LEVEL_OPTIONS)
const logsFilteredEntries = computed(() => {
  const query = logsKeyword.value.trim().toLowerCase()
  const levelSet = new Set(logsLevelFilter.value)
  return logsEntries.value.filter((entry) => {
    if (entry.level && !levelSet.has(entry.level)) return false
    if (!query) return true
    return [entry.message, entry.subsystem, entry.raw]
      .filter(Boolean)
      .join(' ')
      .toLowerCase()
      .includes(query)
  })
})

const nodeOptions = computed(() =>
  nodes.value.map((node) => ({
    label: `${node.name} (${node.id})`,
    value: node.id,
  }))
)

const approvalsAgentOptions = computed(() => {
  const agents = approvalsForm.value?.agents || {}
  const keys = Object.keys(agents)
  if (!keys.includes('main')) keys.unshift('main')
  return keys.map((id) => ({ label: id, value: id }))
})

const currentApprovalsAgent = computed<ExecApprovalsAgent | null>(() => {
  const form = approvalsForm.value
  if (!form?.agents) return null
  return form.agents[approvalsAgentId.value] || null
})

const currentAllowlist = computed(() => currentApprovalsAgent.value?.allowlist || [])
const updateResult = computed(() => updateResponse.value?.result || null)
const updateSteps = computed(() => updateResult.value?.steps || [])
const updateRestartInfo = computed(() => updateResponse.value?.restart || null)
const updateStatusTagType = computed<'success' | 'error' | 'warning' | 'default'>(() => {
  const status = updateResult.value?.status
  if (status === 'ok') return 'success'
  if (status === 'error') return 'error'
  if (status === 'skipped') return 'warning'
  return 'default'
})

function methodNotReadyLabel(methodLabel: string): string {
  return `当前 Gateway 不支持 ${methodLabel}`
}

function asErrorMessage(error: unknown, fallback: string): string {
  if (error instanceof Error && error.message) return error.message
  if (typeof error === 'string' && error.trim()) return error
  return fallback
}

function cloneJson<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

function formatDuration(durationMs?: number | null): string {
  if (typeof durationMs !== 'number' || !Number.isFinite(durationMs) || durationMs < 0) return '-'
  if (durationMs < 1000) return `${Math.floor(durationMs)}ms`
  if (durationMs < 60000) return `${(durationMs / 1000).toFixed(1)}s`
  return `${(durationMs / 60000).toFixed(1)}m`
}

function resolveStepStatusType(step: UpdateRunStepResult): 'success' | 'error' | 'warning' | 'default' {
  if (step.exitCode === 0) return 'success'
  if (typeof step.exitCode === 'number' && step.exitCode > 0) return 'error'
  if (step.stderrTail || step.stdoutTail) return 'warning'
  return 'default'
}

function ensureApprovalsForm(): ExecApprovalsFile {
  if (!approvalsForm.value) {
    approvalsForm.value = {
      version: 1,
      defaults: {},
      agents: {},
    }
  }
  if (!approvalsForm.value.agents) approvalsForm.value.agents = {}
  approvalsForm.value.version = 1
  return approvalsForm.value
}

function parseMaybeJsonString(value: unknown): Record<string, unknown> | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  if (!trimmed.startsWith('{') || !trimmed.endsWith('}')) return null
  try {
    const parsed = JSON.parse(trimmed) as unknown
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null
    return parsed as Record<string, unknown>
  } catch {
    return null
  }
}

function parseLogLine(line: string): LogEntry {
  if (!line.trim()) {
    return { raw: line, message: line }
  }
  try {
    const obj = JSON.parse(line) as Record<string, unknown>
    const meta =
      obj && typeof obj._meta === 'object' && obj._meta !== null
        ? (obj._meta as Record<string, unknown>)
        : null

    const levelRaw =
      typeof meta?.logLevelName === 'string'
        ? meta.logLevelName
        : (typeof meta?.level === 'string' ? meta.level : '')
    const levelLower = levelRaw.toLowerCase()
    const level = LOG_LEVEL_OPTIONS.some((item) => item.value === levelLower as LogLevel)
      ? (levelLower as LogLevel)
      : null
    const time =
      typeof obj.time === 'string'
        ? obj.time
        : (typeof meta?.date === 'string' ? meta.date : null)
    const contextCandidate =
      typeof obj['0'] === 'string'
        ? obj['0']
        : (typeof meta?.name === 'string' ? meta.name : null)
    const contextObject = parseMaybeJsonString(contextCandidate)

    let subsystem: string | null = null
    if (contextObject) {
      if (typeof contextObject.subsystem === 'string') {
        subsystem = contextObject.subsystem
      } else if (typeof contextObject.module === 'string') {
        subsystem = contextObject.module
      }
    } else if (contextCandidate && contextCandidate.length < 120) {
      subsystem = contextCandidate
    }

    let text: string | null = null
    if (typeof obj['1'] === 'string') {
      text = obj['1']
    } else if (!contextObject && typeof obj['0'] === 'string') {
      text = obj['0']
    } else if (typeof obj.message === 'string') {
      text = obj.message
    }

    return {
      raw: line,
      time,
      level,
      subsystem,
      message: text || line,
      meta: meta || undefined,
    }
  } catch {
    return { raw: line, message: line }
  }
}

function scrollLogsToBottom() {
  nextTick(() => {
    logScrollbarRef.value?.scrollTo({ top: Number.MAX_SAFE_INTEGER })
  })
}

async function loadNodes() {
  if (nodesLoading.value) return
  nodesLoading.value = true
  try {
    nodes.value = await wsStore.rpc.listNodes()
  } catch {
    nodes.value = []
  } finally {
    nodesLoading.value = false
  }
}

async function loadHealthStatus(opts?: { probe?: boolean }) {
  if (diagLoading.value) return

  const wantsProbe = opts?.probe === true
  diagLoading.value = true
  healthError.value = ''
  statusError.value = ''

  let updated = false

  if (!supportsHealth.value) {
    healthError.value = methodNotReadyLabel('health')
  } else {
    try {
      healthSnapshot.value = await wsStore.rpc.getHealth({ probe: wantsProbe })
      updated = true
      if (wantsProbe) {
        diagLastProbeAt.value = Date.now()
      }
    } catch (error) {
      healthError.value = asErrorMessage(error, '获取 health 失败')
    }
  }

  if (!supportsStatus.value) {
    statusError.value = methodNotReadyLabel('status')
  } else {
    try {
      statusSnapshot.value = await wsStore.rpc.getStatus()
      updated = true
    } catch (error) {
      statusError.value = asErrorMessage(error, '获取 status 失败')
    }
  }

  if (updated) {
    diagLastUpdatedAt.value = Date.now()
  }

  diagLoading.value = false
}

async function loadPresence(quiet = false) {
  if (!supportsPresence.value) {
    presenceError.value = methodNotReadyLabel('system-presence')
    return
  }
  if (presenceLoading.value) return
  if (!quiet) presenceLoading.value = true
  presenceError.value = ''
  try {
    presenceEntries.value = await wsStore.rpc.getSystemPresence()
    presenceLastUpdatedAt.value = Date.now()
  } catch (error) {
    presenceError.value = asErrorMessage(error, '获取实例状态失败')
  } finally {
    if (!quiet) presenceLoading.value = false
  }
}

async function loadLogs(opts?: { reset?: boolean; quiet?: boolean }) {
  if (!supportsLogs.value) {
    logsError.value = methodNotReadyLabel('logs.tail')
    return
  }
  if (logsLoading.value) return

  if (!opts?.quiet) logsLoading.value = true
  logsError.value = ''
  try {
    const result = await wsStore.rpc.tailLogs({
      cursor: opts?.reset ? undefined : (logsCursor.value ?? undefined),
      limit: Math.max(1, Math.floor(logsLimit.value || 500)),
      maxBytes: Math.max(1, Math.floor(logsMaxBytes.value || 250000)),
    })

    const parsed = result.lines.map((line) => parseLogLine(line))
    const shouldReset = Boolean(opts?.reset || result.reset || logsCursor.value == null)
    logsEntries.value = shouldReset
      ? parsed
      : [...logsEntries.value, ...parsed].slice(-LOG_BUFFER_LIMIT)
    logsCursor.value = result.cursor
    logsFile.value = result.file
    logsTruncated.value = Boolean(result.truncated)
    logsLastUpdatedAt.value = Date.now()

    if (logsAutoFollow.value && activeTab.value === 'logs') {
      scrollLogsToBottom()
    }
  } catch (error) {
    logsError.value = asErrorMessage(error, '获取日志失败')
  } finally {
    if (!opts?.quiet) logsLoading.value = false
  }
}

function clearLogs() {
  logsEntries.value = []
  logsCursor.value = null
  logsFile.value = ''
  logsTruncated.value = false
}

function exportFilteredLogs() {
  if (logsFilteredEntries.value.length === 0) return
  const text = logsFilteredEntries.value.map((entry) => entry.raw).join('\n')
  const blob = new Blob([`${text}\n`], { type: 'text/plain;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = `openclaw-logs-${Date.now()}.log`
  link.click()
  URL.revokeObjectURL(url)
}

function applyApprovalsSnapshot(snapshot: ExecApprovalsSnapshot) {
  approvalsSnapshot.value = snapshot
  approvalsForm.value = cloneJson(snapshot.file || { version: 1, defaults: {}, agents: {} })
  approvalsDirty.value = false

  const options = approvalsAgentOptions.value
  if (options.length === 0) {
    approvalsAgentId.value = 'main'
    return
  }
  if (!options.some((item) => item.value === approvalsAgentId.value)) {
    approvalsAgentId.value = options[0]?.value || 'main'
  }
}

async function loadApprovals() {
  if (!supportsExecApprovals.value) {
    approvalsError.value = methodNotReadyLabel('exec.approvals.*')
    return
  }
  if (approvalsLoading.value) return

  if (approvalsTargetKind.value === 'node' && !approvalsTargetNodeId.value.trim()) {
    approvalsError.value = '请选择一个节点后再加载审批策略'
    return
  }

  approvalsLoading.value = true
  approvalsError.value = ''
  try {
    const snapshot = await wsStore.rpc.getExecApprovals({
      nodeId: approvalsTargetKind.value === 'node' ? approvalsTargetNodeId.value : undefined,
    })
    applyApprovalsSnapshot(snapshot)
  } catch (error) {
    approvalsError.value = asErrorMessage(error, '加载审批策略失败')
  } finally {
    approvalsLoading.value = false
  }
}

async function saveApprovals() {
  if (!approvalsSnapshot.value?.hash) {
    approvalsError.value = '缺少 baseHash，请先重新加载审批策略'
    return
  }
  if (approvalsTargetKind.value === 'node' && !approvalsTargetNodeId.value.trim()) {
    approvalsError.value = '请选择一个节点后再保存审批策略'
    return
  }

  approvalsSaving.value = true
  approvalsError.value = ''
  try {
    const form = ensureApprovalsForm()
    const snapshot = await wsStore.rpc.setExecApprovals({
      file: cloneJson(form),
      baseHash: approvalsSnapshot.value.hash,
      nodeId: approvalsTargetKind.value === 'node' ? approvalsTargetNodeId.value : undefined,
    })
    applyApprovalsSnapshot(snapshot)
    message.success('审批策略已保存')
  } catch (error) {
    approvalsError.value = asErrorMessage(error, '保存审批策略失败')
  } finally {
    approvalsSaving.value = false
  }
}

function updateDefaults(patch: Partial<ExecApprovalsDefaults>) {
  const form = ensureApprovalsForm()
  form.defaults = {
    ...(form.defaults || {}),
    ...patch,
  }
  approvalsDirty.value = true
}

function updateCurrentAgent(patch: Partial<ExecApprovalsAgent>) {
  const form = ensureApprovalsForm()
  const agentId = approvalsAgentId.value.trim() || 'main'
  if (!form.agents) form.agents = {}
  form.agents[agentId] = {
    ...(form.agents[agentId] || {}),
    ...patch,
  }
  approvalsDirty.value = true
}

function addAgent() {
  const id = newAgentId.value.trim()
  if (!id) {
    message.warning('请输入 Agent ID')
    return
  }
  const form = ensureApprovalsForm()
  if (!form.agents) form.agents = {}
  if (form.agents[id]) {
    message.warning(`Agent ${id} 已存在`)
    return
  }

  form.agents[id] = {
    security: 'allowlist',
    ask: 'on-miss',
    askFallback: 'deny',
    autoAllowSkills: false,
    allowlist: [],
  }
  approvalsAgentId.value = id
  newAgentId.value = ''
  approvalsDirty.value = true
}

function removeCurrentAgent() {
  const form = ensureApprovalsForm()
  const target = approvalsAgentId.value.trim()
  if (!target || target === 'main') {
    message.warning('main Agent 不支持删除')
    return
  }
  if (!form.agents || !form.agents[target]) return
  delete form.agents[target]
  const next = approvalsAgentOptions.value[0]?.value || 'main'
  approvalsAgentId.value = next
  approvalsDirty.value = true
}

function addAllowPattern() {
  const pattern = newAllowPattern.value.trim()
  if (!pattern) {
    message.warning('请输入 allowlist pattern')
    return
  }
  const allowlist = [...currentAllowlist.value]
  allowlist.push({
    id: `rule-${Date.now()}`,
    pattern,
  })
  updateCurrentAgent({ allowlist })
  newAllowPattern.value = ''
}

function updateAllowPattern(index: number, pattern: string) {
  const allowlist = [...currentAllowlist.value]
  if (!allowlist[index]) return
  allowlist[index] = {
    ...allowlist[index],
    pattern,
  }
  updateCurrentAgent({ allowlist })
}

function removeAllowPattern(index: number) {
  const allowlist = [...currentAllowlist.value]
  if (!allowlist[index]) return
  allowlist.splice(index, 1)
  updateCurrentAgent({ allowlist: allowlist.length > 0 ? allowlist : undefined })
}

function resetUpdateResult() {
  updateResponse.value = null
  updateError.value = ''
  updateLastTriggeredAt.value = null
}

async function runUpdate() {
  if (!supportsUpdate.value) {
    updateError.value = methodNotReadyLabel('update.run')
    return
  }

  updateRunning.value = true
  updateError.value = ''
  try {
    const response = await wsStore.rpc.runUpdate({
      sessionKey: updateSessionKey.value.trim() || undefined,
      note: updateNote.value.trim() || undefined,
      restartDelayMs: typeof updateRestartDelayMs.value === 'number' ? updateRestartDelayMs.value : undefined,
      timeoutMs: typeof updateTimeoutMs.value === 'number' ? updateTimeoutMs.value : undefined,
    })
    updateResponse.value = response
    updateLastTriggeredAt.value = Date.now()

    if (response.result?.status === 'ok') {
      message.success('更新任务已执行，网关将按计划重启')
    } else if (response.result?.status === 'skipped') {
      message.warning('更新任务已执行，但被跳过')
    } else {
      message.error(`更新任务失败：${response.result?.reason || '未知原因'}`)
    }
  } catch (error) {
    updateError.value = asErrorMessage(error, '执行更新失败')
  } finally {
    updateRunning.value = false
  }
}

function confirmRunUpdate() {
  dialog.warning({
    title: '⚠️ 危险操作检测！',
    content: () => h('div', { style: 'line-height: 1.75;' }, [
      h('div', '操作类型：运行 update.run（更新并重启网关）'),
      h('div', '影响范围：当前 OpenClaw Gateway 进程会触发重启，Web 管理连接会短暂中断'),
      h('div', '风险评估：更新失败可能导致版本不变或出现启动异常，需要结合日志排查'),
      h('div', { style: 'margin-top: 8px; font-weight: 600;' }, '请确认是否继续？'),
    ]),
    positiveText: '确认继续',
    negativeText: '取消',
    onPositiveClick: () => runUpdate(),
  })
}

async function refreshOpsData() {
  await Promise.all([
    loadHealthStatus(),
    loadPresence(),
    loadLogs({ reset: true }),
    loadNodes(),
  ])
  if (activeTab.value === 'approvals') {
    await loadApprovals()
  }
}

watch(
  () => wsStore.state,
  (state) => {
    if (state !== 'connected') return
    if (activeTab.value === 'presence') {
      void loadHealthStatus()
      void loadPresence()
    }
    if (activeTab.value === 'logs') {
      void loadLogs({ reset: true })
    }
    if (activeTab.value === 'approvals') {
      void loadApprovals()
    }
    void loadNodes()
  }
)

watch(activeTab, (tab) => {
  if (tab === 'presence' && presenceEntries.value.length === 0) {
    void loadPresence()
  }
  if (tab === 'presence' && !healthSnapshot.value && !statusSnapshot.value) {
    void loadHealthStatus()
  }
  if (tab === 'logs' && logsEntries.value.length === 0) {
    void loadLogs({ reset: true })
  }
  if (tab === 'approvals' && !approvalsSnapshot.value) {
    void loadApprovals()
  }
})

watch([approvalsTargetKind, approvalsTargetNodeId], () => {
  approvalsSnapshot.value = null
  approvalsForm.value = null
  approvalsDirty.value = false
  approvalsError.value = ''
})

onMounted(() => {
  void refreshOpsData()

  presenceTimer = setInterval(() => {
    if (activeTab.value !== 'presence') return
    void loadPresence(true)
  }, 8000)

  logsTimer = setInterval(() => {
    if (!logsAutoFollow.value || activeTab.value !== 'logs') return
    void loadLogs({ quiet: true })
  }, 2000)
})

onUnmounted(() => {
  if (presenceTimer) clearInterval(presenceTimer)
  if (logsTimer) clearInterval(logsTimer)
})
</script>

<template>
  <NSpace vertical :size="16">
    <NCard title="运维中心" class="app-card ops-top-card">
      <template #header-extra>
        <NButton size="small" class="app-toolbar-btn app-toolbar-btn--refresh" @click="refreshOpsData">
          <template #icon><NIcon :component="RefreshOutline" /></template>
          全量刷新
        </NButton>
      </template>

      <NSpace :size="12" align="center" style="flex-wrap: wrap;">
        <NTag :type="connectionTagType" :bordered="false" round>{{ connectionLabel }}</NTag>
        <NTag type="success" :bordered="false" round>
          实例 {{ onlinePresenceCount }}/{{ presenceEntries.length }}
        </NTag>
        <NTag type="info" :bordered="false" round>
          日志 {{ logsFilteredEntries.length }} 条
        </NTag>
        <NText depth="3" style="font-size: 12px;">
          最近同步：
          {{ logsLastUpdatedAt ? formatRelativeTime(logsLastUpdatedAt) : '尚未同步' }}
        </NText>
      </NSpace>
      <NText depth="3" class="ops-top-subtitle">
        统一查看实例在线、日志尾流、审批策略与更新执行结果。
      </NText>
    </NCard>

    <NTabs v-model:value="activeTab" type="line" animated>
      <NTabPane name="presence" tab="实例状态（system-presence）">
        <NCard title="实例状态" class="app-card">
          <template #header-extra>
            <NButton size="small" class="app-toolbar-btn app-toolbar-btn--refresh" @click="loadPresence()">
              <template #icon><NIcon :component="RefreshOutline" /></template>
              刷新实例
            </NButton>
          </template>

          <NAlert
            v-if="!supportsPresence"
            type="warning"
            :bordered="false"
            style="margin-bottom: 12px;"
          >
            当前 Gateway 不支持 <code>system-presence</code>，请升级后重试。
          </NAlert>
          <NAlert
            v-else-if="presenceError"
            type="error"
            :bordered="false"
            style="margin-bottom: 12px;"
          >
            {{ presenceError }}
          </NAlert>
          <NText depth="3" style="font-size: 12px; display: block; margin-bottom: 10px;">
            来源于 <code>system-presence</code>，用于观察网关与客户端在线情况。
          </NText>

          <NCard size="small" embedded class="ops-inner-card" title="健康 / 状态诊断（health + status）">
            <template #header-extra>
              <NSpace :size="8" align="center">
                <NButton size="small" :loading="diagLoading" @click="loadHealthStatus()">
                  <template #icon><NIcon :component="RefreshOutline" /></template>
                  刷新
                </NButton>
                <NButton size="small" type="warning" :loading="diagLoading" @click="loadHealthStatus({ probe: true })">
                  <template #icon><NIcon :component="SearchOutline" /></template>
                  Probe
                </NButton>
              </NSpace>
            </template>

            <NAlert
              v-if="!supportsHealth || !supportsStatus"
              type="warning"
              :bordered="false"
              style="margin-bottom: 12px;"
            >
              当前 Gateway 可能不支持 <code>health</code> / <code>status</code>（或方法列表未上报）。
            </NAlert>
            <NAlert
              v-if="healthError"
              type="error"
              :bordered="false"
              style="margin-bottom: 12px;"
            >
              health：{{ healthError }}
            </NAlert>
            <NAlert
              v-if="statusError"
              type="error"
              :bordered="false"
              style="margin-bottom: 12px;"
            >
              status：{{ statusError }}
            </NAlert>

            <NText depth="3" style="font-size: 12px; display: block; margin-bottom: 10px;">
              来源于 <code>health</code> / <code>status</code>。health 默认缓存约 60s；Probe 会触发更深探测，耗时可能更久。
            </NText>

            <NSpin :show="diagLoading">
              <NGrid cols="1 s:2 m:3" responsive="screen" :x-gap="12" :y-gap="10">
                <NGridItem>
                  <div class="ops-meta-item">
                    <div class="muted">Health</div>
                    <div>
                      <NTag v-if="healthSnapshot?.ok" type="success" :bordered="false" round>OK</NTag>
                      <span v-else>-</span>
                      <span class="muted" style="margin-left: 8px;">
                        {{ formatDuration(healthSnapshot?.durationMs) }}
                      </span>
                    </div>
                  </div>
                </NGridItem>
                <NGridItem>
                  <div class="ops-meta-item">
                    <div class="muted">Channels</div>
                    <div>
                      {{ healthChannelCount }}
                      <span class="muted">（configured {{ healthConfiguredChannelCount }}）</span>
                    </div>
                  </div>
                </NGridItem>
                <NGridItem>
                  <div class="ops-meta-item">
                    <div class="muted">Probe 结果</div>
                    <div>
                      {{ healthProbedAccountCount }}
                      <span class="muted">个账号有探测数据</span>
                    </div>
                  </div>
                </NGridItem>
                <NGridItem>
                  <div class="ops-meta-item">
                    <div class="muted">Sessions</div>
                    <div>
                      {{ healthSnapshot?.sessions?.count ?? '-' }}
                      <span v-if="healthSnapshot?.defaultAgentId" class="muted">
                        · 默认 {{ healthSnapshot.defaultAgentId }}
                      </span>
                    </div>
                  </div>
                </NGridItem>
                <NGridItem>
                  <div class="ops-meta-item">
                    <div class="muted">Heartbeat</div>
                    <div>
                      {{ statusHeartbeatEnabledCount }}/{{ statusSnapshot?.heartbeat?.agents?.length ?? 0 }}
                      <span class="muted">已启用</span>
                    </div>
                  </div>
                </NGridItem>
                <NGridItem>
                  <div class="ops-meta-item">
                    <div class="muted">System Events</div>
                    <div>{{ statusSnapshot?.queuedSystemEvents?.length ?? '-' }}</div>
                  </div>
                </NGridItem>
              </NGrid>

              <NText v-if="healthSnapshot?.ts" depth="3" style="font-size: 12px; display: block; margin-top: 8px;">
                health 更新时间：{{ formatRelativeTime(healthSnapshot.ts) }}
                <span v-if="diagLastProbeAt"> · 最近 Probe：{{ formatRelativeTime(diagLastProbeAt) }}</span>
              </NText>
              <NText v-else-if="diagLastUpdatedAt" depth="3" style="font-size: 12px; display: block; margin-top: 8px;">
                诊断更新时间：{{ formatRelativeTime(diagLastUpdatedAt) }}
                <span v-if="diagLastProbeAt"> · 最近 Probe：{{ formatRelativeTime(diagLastProbeAt) }}</span>
              </NText>
            </NSpin>
          </NCard>

          <NSpin :show="presenceLoading">
            <div class="presence-list">
              <div
                v-for="(entry, index) in presenceEntries"
                :key="entry.instanceId || entry.deviceId || `${entry.host}-${index}`"
                class="presence-item"
              >
                <div class="presence-main">
                  <div class="presence-title">
                    {{ entry.host || entry.instanceId || entry.deviceId || 'unknown-host' }}
                  </div>
                  <div class="presence-sub">
                    {{ entry.text || entry.reason || '无额外描述' }}
                  </div>
                  <NSpace :size="6" style="margin-top: 8px; flex-wrap: wrap;">
                    <NTag v-if="entry.mode" size="small" :bordered="false" round>{{ entry.mode }}</NTag>
                    <NTag v-if="entry.platform" size="small" :bordered="false" round>{{ entry.platform }}</NTag>
                    <NTag v-if="entry.deviceFamily" size="small" :bordered="false" round>{{ entry.deviceFamily }}</NTag>
                    <NTag v-if="entry.version" size="small" :bordered="false" round>{{ entry.version }}</NTag>
                    <NTag
                      v-for="role in entry.roles || []"
                      :key="`role-${role}`"
                      size="small"
                      type="info"
                      :bordered="false"
                      round
                    >
                      {{ role }}
                    </NTag>
                  </NSpace>
                </div>
                <div class="presence-meta">
                  <div>{{ entry.ts ? formatRelativeTime(entry.ts) : '-' }}</div>
                  <div class="muted">last input: {{ entry.lastInputSeconds ?? '-' }}s</div>
                  <div class="muted">{{ entry.ip || '-' }}</div>
                </div>
              </div>

              <NEmpty
                v-if="!presenceLoading && presenceEntries.length === 0"
                description="暂无实例上报"
                style="padding: 48px 0;"
              />
            </div>
          </NSpin>

          <NText v-if="presenceLastUpdatedAt" depth="3" style="font-size: 12px;">
            更新于 {{ formatDate(presenceLastUpdatedAt) }}
          </NText>
        </NCard>
      </NTabPane>

      <NTabPane name="logs" tab="实时日志（logs.tail）">
        <NCard title="实时日志" class="app-card">
          <template #header-extra>
            <NSpace :size="8" align="center" class="app-toolbar">
              <NButton size="small" class="app-toolbar-btn app-toolbar-btn--refresh" @click="loadLogs({ reset: true })">
                <template #icon><NIcon :component="RefreshOutline" /></template>
                刷新
              </NButton>
              <NButton
                size="small"
                class="app-toolbar-btn app-toolbar-btn--refresh"
                :disabled="logsFilteredEntries.length === 0"
                @click="exportFilteredLogs"
              >
                <template #icon><NIcon :component="DownloadOutline" /></template>
                导出
              </NButton>
              <NButton size="small" class="app-toolbar-btn app-toolbar-btn--refresh" @click="clearLogs">
                <template #icon><NIcon :component="TrashOutline" /></template>
                清空
              </NButton>
            </NSpace>
          </template>

          <NAlert
            v-if="!supportsLogs"
            type="warning"
            :bordered="false"
            style="margin-bottom: 12px;"
          >
            当前 Gateway 不支持 <code>logs.tail</code>，请升级后重试。
          </NAlert>
          <NAlert
            v-else-if="logsError"
            type="error"
            :bordered="false"
            style="margin-bottom: 12px;"
          >
            {{ logsError }}
          </NAlert>
          <NAlert
            v-if="logsTruncated"
            type="warning"
            :bordered="false"
            style="margin-bottom: 12px;"
          >
            日志返回被截断，仅显示最近一段（可调大 maxBytes）。
          </NAlert>
          <NText depth="3" style="font-size: 12px; display: block; margin-bottom: 10px;">
            来源于 <code>logs.tail</code>，支持增量游标与级别过滤。
          </NText>

          <NGrid cols="1 s:2 m:4" responsive="screen" :x-gap="12" :y-gap="10" style="margin-bottom: 12px;">
            <NGridItem>
              <NFormItem label="关键词">
                <NInput v-model:value="logsKeyword" placeholder="搜索 message/subsystem/raw" clearable />
              </NFormItem>
            </NGridItem>
            <NGridItem>
              <NFormItem label="日志级别">
                <NSelect
                  v-model:value="logsLevelFilter"
                  :options="logLevelOptions"
                  multiple
                  clearable
                  max-tag-count="responsive"
                />
              </NFormItem>
            </NGridItem>
            <NGridItem>
              <NFormItem label="limit">
                <NInputNumber v-model:value="logsLimit" :min="1" :max="5000" style="width: 100%;" />
              </NFormItem>
            </NGridItem>
            <NGridItem>
              <NFormItem label="maxBytes">
                <NInputNumber v-model:value="logsMaxBytes" :min="1" :max="1000000" style="width: 100%;" />
              </NFormItem>
            </NGridItem>
          </NGrid>

          <NSpace align="center" :size="8" style="margin-bottom: 12px;">
            <NText depth="3" style="font-size: 12px;">自动跟随</NText>
            <NSwitch v-model:value="logsAutoFollow" size="small" />
            <NText depth="3" style="font-size: 12px;">
              文件：{{ logsFile || '-' }}
            </NText>
          </NSpace>

          <NSpin :show="logsLoading">
            <NScrollbar ref="logScrollbarRef" class="logs-scroll">
              <div v-if="logsFilteredEntries.length === 0" class="logs-empty">
                <NEmpty description="暂无日志" />
              </div>
              <div v-else>
                <div
                  v-for="(entry, index) in logsFilteredEntries"
                  :key="`${entry.time || 'no-time'}-${index}`"
                  class="log-row"
                >
                  <div class="log-time">{{ entry.time ? formatDate(entry.time) : '-' }}</div>
                  <NTag size="small" :bordered="false" :type="entry.level === 'error' || entry.level === 'fatal' ? 'error' : entry.level === 'warn' ? 'warning' : 'default'">
                    {{ (entry.level || 'raw').toUpperCase() }}
                  </NTag>
                  <div class="log-subsystem">{{ entry.subsystem || '-' }}</div>
                  <pre class="log-message">{{ entry.message || entry.raw }}</pre>
                </div>
              </div>
            </NScrollbar>
          </NSpin>
        </NCard>
      </NTabPane>

      <NTabPane name="approvals" tab="审批策略（exec.approvals.*）">
        <NCard title="审批策略" class="app-card">
          <template #header-extra>
            <NSpace :size="8" align="center" class="app-toolbar">
              <NButton size="small" class="app-toolbar-btn app-toolbar-btn--refresh" :loading="approvalsLoading" @click="loadApprovals">
                <template #icon><NIcon :component="RefreshOutline" /></template>
                重新加载
              </NButton>
              <NButton
                type="primary"
                size="small"
                class="app-toolbar-btn app-toolbar-btn--save"
                :loading="approvalsSaving"
                :disabled="!approvalsDirty || !approvalsSnapshot"
                @click="saveApprovals"
              >
                <template #icon><NIcon :component="SaveOutline" /></template>
                保存策略
              </NButton>
            </NSpace>
          </template>

          <NGrid cols="1 s:2 m:3" responsive="screen" :x-gap="12" :y-gap="10" style="margin-bottom: 8px;">
            <NGridItem>
              <NFormItem label="目标">
                <NSelect
                  v-model:value="approvalsTargetKind"
                  :options="[
                    { label: 'Gateway', value: 'gateway' },
                    { label: 'Node', value: 'node' },
                  ]"
                />
              </NFormItem>
            </NGridItem>
            <NGridItem v-if="approvalsTargetKind === 'node'">
              <NFormItem label="节点">
                <NSelect
                  v-model:value="approvalsTargetNodeId"
                  :options="nodeOptions"
                  :loading="nodesLoading"
                  placeholder="选择 nodeId"
                  clearable
                  filterable
                />
              </NFormItem>
            </NGridItem>
          </NGrid>

          <NAlert
            v-if="!supportsExecApprovals"
            type="warning"
            :bordered="false"
            style="margin-bottom: 12px;"
          >
            当前 Gateway 不支持 <code>exec.approvals.*</code>（或当前节点不支持）。
          </NAlert>
          <NAlert
            v-else-if="approvalsError"
            type="error"
            :bordered="false"
            style="margin-bottom: 12px;"
          >
            {{ approvalsError }}
          </NAlert>
          <NText depth="3" style="font-size: 12px; display: block; margin-bottom: 10px;">
            来源于 <code>exec.approvals.*</code>，支持 Gateway 与节点级策略编辑。
          </NText>

          <div v-if="approvalsSnapshot" class="approvals-meta">
            <div><strong>文件：</strong>{{ approvalsSnapshot.path }}</div>
            <div><strong>Hash：</strong>{{ approvalsSnapshot.hash }}</div>
            <div><strong>状态：</strong>{{ approvalsSnapshot.exists ? '已存在' : '首次创建' }}</div>
          </div>

          <NSpin :show="approvalsLoading">
            <template v-if="approvalsForm">
              <NGrid cols="1 s:2 m:4" responsive="screen" :x-gap="12" :y-gap="10">
                <NGridItem>
                  <NFormItem label="默认 security">
                    <NSelect
                      :value="approvalsForm.defaults?.security || null"
                      :options="POLICY_SECURITY_OPTIONS"
                      clearable
                      @update:value="(value) => updateDefaults({ security: value || undefined })"
                    />
                  </NFormItem>
                </NGridItem>
                <NGridItem>
                  <NFormItem label="默认 ask">
                    <NSelect
                      :value="approvalsForm.defaults?.ask || null"
                      :options="POLICY_ASK_OPTIONS"
                      clearable
                      @update:value="(value) => updateDefaults({ ask: value || undefined })"
                    />
                  </NFormItem>
                </NGridItem>
                <NGridItem>
                  <NFormItem label="默认 askFallback">
                    <NSelect
                      :value="approvalsForm.defaults?.askFallback || null"
                      :options="POLICY_SECURITY_OPTIONS"
                      clearable
                      @update:value="(value) => updateDefaults({ askFallback: value || undefined })"
                    />
                  </NFormItem>
                </NGridItem>
                <NGridItem>
                  <NFormItem label="autoAllowSkills">
                    <NSwitch
                      :value="Boolean(approvalsForm.defaults?.autoAllowSkills)"
                      @update:value="(value) => updateDefaults({ autoAllowSkills: value })"
                    />
                  </NFormItem>
                </NGridItem>
              </NGrid>

              <div class="approvals-divider" />

              <NGrid cols="1 s:2 m:3" responsive="screen" :x-gap="12" :y-gap="10" style="margin-bottom: 10px;">
                <NGridItem>
                  <NFormItem label="当前 Agent">
                    <NSelect
                      v-model:value="approvalsAgentId"
                      :options="approvalsAgentOptions"
                      placeholder="选择 Agent"
                    />
                  </NFormItem>
                </NGridItem>
                <NGridItem>
                  <NFormItem label="新增 Agent">
                    <NInput v-model:value="newAgentId" placeholder="例如 main / analyst" />
                  </NFormItem>
                </NGridItem>
                <NGridItem>
                  <NFormItem label="操作">
                    <NSpace :size="8">
                      <NButton size="small" class="app-toolbar-btn app-toolbar-btn--refresh" @click="addAgent">
                        <template #icon><NIcon :component="AddOutline" /></template>
                        添加 Agent
                      </NButton>
                      <NButton size="small" class="app-toolbar-btn app-toolbar-btn--refresh" @click="removeCurrentAgent">
                        <template #icon><NIcon :component="TrashOutline" /></template>
                        删除当前 Agent
                      </NButton>
                    </NSpace>
                  </NFormItem>
                </NGridItem>
              </NGrid>

              <template v-if="currentApprovalsAgent">
                <NGrid cols="1 s:2 m:4" responsive="screen" :x-gap="12" :y-gap="10">
                  <NGridItem>
                    <NFormItem label="Agent security">
                      <NSelect
                        :value="currentApprovalsAgent.security || null"
                        :options="POLICY_SECURITY_OPTIONS"
                        clearable
                        @update:value="(value) => updateCurrentAgent({ security: value || undefined })"
                      />
                    </NFormItem>
                  </NGridItem>
                  <NGridItem>
                    <NFormItem label="Agent ask">
                      <NSelect
                        :value="currentApprovalsAgent.ask || null"
                        :options="POLICY_ASK_OPTIONS"
                        clearable
                        @update:value="(value) => updateCurrentAgent({ ask: value || undefined })"
                      />
                    </NFormItem>
                  </NGridItem>
                  <NGridItem>
                    <NFormItem label="Agent askFallback">
                      <NSelect
                        :value="currentApprovalsAgent.askFallback || null"
                        :options="POLICY_SECURITY_OPTIONS"
                        clearable
                        @update:value="(value) => updateCurrentAgent({ askFallback: value || undefined })"
                      />
                    </NFormItem>
                  </NGridItem>
                  <NGridItem>
                    <NFormItem label="Agent autoAllowSkills">
                      <NSwitch
                        :value="Boolean(currentApprovalsAgent.autoAllowSkills)"
                        @update:value="(value) => updateCurrentAgent({ autoAllowSkills: value })"
                      />
                    </NFormItem>
                  </NGridItem>
                </NGrid>

                <div class="allowlist-editor">
                  <div class="allowlist-head">
                    <NText strong>Allowlist</NText>
                    <NText depth="3">当前 {{ currentAllowlist.length }} 条</NText>
                  </div>
                  <NSpace :size="8" align="center" style="margin-top: 8px;">
                    <NInput
                      v-model:value="newAllowPattern"
                      placeholder="例如: ^(ls|cat|pwd)$"
                      style="max-width: 420px;"
                    />
                    <NButton size="small" class="app-toolbar-btn app-toolbar-btn--refresh" @click="addAllowPattern">
                      <template #icon><NIcon :component="AddOutline" /></template>
                      新增规则
                    </NButton>
                  </NSpace>

                  <div v-if="currentAllowlist.length === 0" class="allowlist-empty">
                    <NText depth="3">当前 Agent 暂无 allowlist 规则。</NText>
                  </div>

                  <div
                    v-for="(entry, index) in currentAllowlist"
                    :key="entry.id || `${index}-${entry.pattern}`"
                    class="allowlist-item"
                  >
                    <NInput
                      :value="entry.pattern"
                      @update:value="(value) => updateAllowPattern(index, value)"
                      placeholder="规则表达式"
                    />
                    <NButton size="small" class="app-toolbar-btn app-toolbar-btn--refresh" @click="removeAllowPattern(index)">
                      <template #icon><NIcon :component="TrashOutline" /></template>
                      删除
                    </NButton>
                  </div>
                </div>
              </template>
            </template>

            <NEmpty
              v-else
              description="未加载审批策略"
              style="padding: 40px 0;"
            />
          </NSpin>
        </NCard>
      </NTabPane>

      <NTabPane name="update" tab="更新与重启（update.run）">
        <NCard title="更新与重启" class="app-card">
          <template #header-extra>
            <NSpace :size="8" align="center" class="app-toolbar">
              <NButton
                type="primary"
                size="small"
                class="app-toolbar-btn app-toolbar-btn--save"
                :loading="updateRunning"
                @click="confirmRunUpdate"
              >
                <template #icon><NIcon :component="DownloadOutline" /></template>
                执行更新
              </NButton>
              <NButton
                size="small"
                class="app-toolbar-btn app-toolbar-btn--refresh"
                :disabled="updateRunning"
                @click="resetUpdateResult"
              >
                <template #icon><NIcon :component="TrashOutline" /></template>
                清空结果
              </NButton>
            </NSpace>
          </template>

          <NAlert
            v-if="!supportsUpdate"
            type="warning"
            :bordered="false"
            style="margin-bottom: 12px;"
          >
            当前 Gateway 不支持 <code>update.run</code>，请升级后重试。
          </NAlert>
          <NAlert
            v-else-if="updateError"
            type="error"
            :bordered="false"
            style="margin-bottom: 12px;"
          >
            {{ updateError }}
          </NAlert>
          <NAlert type="warning" :bordered="false" style="margin-bottom: 12px;">
            该操作会触发 Gateway 重启，页面连接短暂断开属于预期行为。
          </NAlert>

          <NCard size="small" embedded class="ops-inner-card" title="执行参数">
            <NText depth="3" style="font-size: 12px; display: block; margin-bottom: 10px;">
              可按需指定会话回执目标与超时，未填写时使用网关默认行为。
            </NText>
            <NGrid cols="1 s:2 m:2" responsive="screen" :x-gap="12" :y-gap="10">
              <NGridItem>
                <NFormItem label="会话键 sessionKey（可选）">
                  <NInput
                    v-model:value="updateSessionKey"
                    placeholder="例如：agent:main:main"
                  />
                </NFormItem>
              </NGridItem>
              <NGridItem>
                <NFormItem label="更新备注 note（可选）">
                  <NInput
                    v-model:value="updateNote"
                    placeholder="例如：运维中心手动触发更新"
                  />
                </NFormItem>
              </NGridItem>
              <NGridItem>
                <NFormItem label="重启延迟 restartDelayMs（毫秒）">
                  <NInputNumber
                    v-model:value="updateRestartDelayMs"
                    :min="0"
                    :step="500"
                    :show-button="false"
                    style="width: 100%;"
                  />
                </NFormItem>
              </NGridItem>
              <NGridItem>
                <NFormItem label="执行超时 timeoutMs（毫秒）">
                  <NInputNumber
                    v-model:value="updateTimeoutMs"
                    :min="1000"
                    :step="1000"
                    :show-button="false"
                    style="width: 100%;"
                  />
                </NFormItem>
              </NGridItem>
            </NGrid>
          </NCard>

          <div v-if="updateResult || updateRestartInfo || updateLastTriggeredAt" class="update-result-box">
            <div class="update-result-head">
              <NTag :type="updateStatusTagType" :bordered="false" round>
                {{ updateResult?.status || '未知' }}
              </NTag>
              <NText depth="3" style="font-size: 12px;">
                触发时间：{{ updateLastTriggeredAt ? formatDate(updateLastTriggeredAt) : '-' }}
              </NText>
              <NText depth="3" style="font-size: 12px;">
                总耗时：{{ formatDuration(updateResult?.durationMs) }}
              </NText>
            </div>

            <NGrid cols="1 s:2 m:3" responsive="screen" :x-gap="12" :y-gap="10" style="margin-top: 10px;">
              <NGridItem>
                <div class="ops-meta-item">
                  <div class="muted">更新模式</div>
                  <div>{{ updateResult?.mode || '-' }}</div>
                </div>
              </NGridItem>
              <NGridItem>
                <div class="ops-meta-item">
                  <div class="muted">重启调度</div>
                  <div>
                    {{
                      updateRestartInfo?.ok
                        ? `OK (${updateRestartInfo.delayMs ?? '-'}ms)`
                        : (updateRestartInfo?.error || '未返回')
                    }}
                  </div>
                </div>
              </NGridItem>
              <NGridItem>
                <div class="ops-meta-item">
                  <div class="muted">失败原因</div>
                  <div>{{ updateResult?.reason || '-' }}</div>
                </div>
              </NGridItem>
            </NGrid>

            <div class="muted" style="margin-top: 8px; font-size: 12px;">
              哨兵文件：{{ updateResponse?.sentinel?.path || '-' }}
            </div>

            <div v-if="updateResult?.before || updateResult?.after" class="update-before-after">
              <div><strong>Before:</strong> {{ updateResult?.before?.version || '-' }} / {{ updateResult?.before?.sha || '-' }}</div>
              <div><strong>After:</strong> {{ updateResult?.after?.version || '-' }} / {{ updateResult?.after?.sha || '-' }}</div>
            </div>

            <div v-if="updateSteps.length > 0" class="update-steps">
              <div class="update-steps-title">步骤回显（{{ updateSteps.length }}）</div>
              <div
                v-for="(step, index) in updateSteps"
                :key="`${step.name}-${index}`"
                class="update-step-item"
              >
                <div class="update-step-head">
                  <NTag size="small" :type="resolveStepStatusType(step)" :bordered="false">
                    #{{ index + 1 }} {{ step.name }}
                  </NTag>
                  <NText depth="3" style="font-size: 12px;">
                    exit={{ step.exitCode ?? 'null' }} · {{ formatDuration(step.durationMs) }}
                  </NText>
                </div>
                <div class="update-step-cmd">{{ step.command || '-' }}</div>
                <div v-if="step.cwd" class="muted" style="font-size: 12px;">cwd: {{ step.cwd }}</div>
                <pre v-if="step.stdoutTail" class="update-step-log update-step-log--stdout">{{ step.stdoutTail }}</pre>
                <pre v-if="step.stderrTail" class="update-step-log update-step-log--stderr">{{ step.stderrTail }}</pre>
              </div>
            </div>
          </div>
        </NCard>
      </NTabPane>
    </NTabs>
  </NSpace>
</template>

<style scoped>
.ops-top-card :deep(.n-card-header) {
  align-items: flex-start;
}

.ops-top-subtitle {
  margin-top: 6px;
  font-size: 12px;
}

.presence-list {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.presence-item {
  border: 1px solid var(--border-color);
  border-radius: 12px;
  padding: 12px;
  display: flex;
  justify-content: space-between;
  gap: 12px;
}

.presence-main {
  flex: 1;
  min-width: 0;
}

.presence-title {
  font-weight: 700;
  font-size: 14px;
}

.presence-sub {
  margin-top: 4px;
  color: var(--text-secondary);
  font-size: 12px;
}

.presence-meta {
  min-width: 180px;
  text-align: right;
  color: var(--text-secondary);
  font-size: 12px;
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.muted {
  color: var(--text-secondary);
}

.logs-scroll {
  max-height: calc(100vh - 370px);
}

.logs-empty {
  padding: 40px 0;
}

.log-row {
  display: grid;
  grid-template-columns: minmax(170px, 220px) 90px minmax(140px, 200px) minmax(320px, 1fr);
  gap: 10px;
  align-items: flex-start;
  border-bottom: 1px solid var(--border-color);
  padding: 8px 10px;
  font-size: 12px;
}

.log-time {
  color: var(--text-secondary);
}

.log-subsystem {
  color: var(--text-secondary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.log-message {
  margin: 0;
  white-space: pre-wrap;
  word-break: break-word;
  font-family: 'SF Mono', 'Menlo', 'Monaco', monospace;
  line-height: 1.4;
}

.approvals-meta {
  margin-bottom: 10px;
  padding: 10px 12px;
  border: 1px dashed var(--border-color);
  border-radius: 10px;
  color: var(--text-secondary);
  font-size: 12px;
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.approvals-divider {
  margin: 4px 0 12px;
  border-top: 1px solid var(--border-color);
}

.allowlist-editor {
  margin-top: 8px;
  padding: 12px;
  border: 1px solid var(--border-color);
  border-radius: 12px;
}

.allowlist-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.allowlist-empty {
  margin-top: 10px;
}

.allowlist-item {
  margin-top: 8px;
  display: grid;
  grid-template-columns: minmax(300px, 1fr) auto;
  gap: 8px;
}

.ops-inner-card {
  margin-bottom: 12px;
  border-radius: 12px;
}

.update-result-box {
  margin-top: 12px;
  padding: 12px;
  border: 1px solid var(--border-color);
  border-radius: 12px;
  background: var(--bg-primary);
}

.update-result-head {
  display: flex;
  gap: 10px;
  align-items: center;
  flex-wrap: wrap;
}

.ops-meta-item {
  padding: 10px;
  border: 1px dashed var(--border-color);
  border-radius: 10px;
  min-height: 62px;
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.update-before-after {
  margin-top: 10px;
  padding: 10px;
  border-radius: 10px;
  background: var(--bg-secondary);
  font-size: 12px;
  color: var(--text-secondary);
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.update-steps {
  margin-top: 12px;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.update-steps-title {
  font-size: 13px;
  font-weight: 700;
}

.update-step-item {
  border: 1px solid var(--border-color);
  border-radius: 10px;
  padding: 10px;
}

.update-step-head {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}

.update-step-cmd {
  margin-top: 8px;
  font-size: 12px;
  color: var(--text-primary);
  word-break: break-all;
}

.update-step-log {
  margin-top: 8px;
  margin-bottom: 0;
  padding: 8px 10px;
  border-radius: 8px;
  font-size: 12px;
  line-height: 1.45;
  white-space: pre-wrap;
  word-break: break-word;
  font-family: 'SF Mono', 'Menlo', 'Monaco', monospace;
  max-height: 260px;
  overflow: auto;
}

.update-step-log--stdout {
  background: rgba(22, 163, 74, 0.08);
}

.update-step-log--stderr {
  background: rgba(239, 68, 68, 0.08);
}

@media (max-width: 900px) {
  .presence-item {
    flex-direction: column;
  }

  .presence-meta {
    min-width: 0;
    text-align: left;
  }

  .log-row {
    grid-template-columns: 1fr;
    gap: 6px;
  }

  .allowlist-item {
    grid-template-columns: 1fr;
  }
}
</style>
