<script setup lang="ts">
import { computed, h, onMounted, reactive, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import {
  NAlert,
  NButton,
  NCard,
  NCode,
  NDataTable,
  NDivider,
  NForm,
  NFormItem,
  NGrid,
  NGridItem,
  NIcon,
  NInput,
  NInputNumber,
  NModal,
  NPopconfirm,
  NRadioButton,
  NRadioGroup,
  NSelect,
  NSpace,
  NSwitch,
  NTag,
  NText,
  useMessage,
} from 'naive-ui'
import type { DataTableColumns, SelectOption } from 'naive-ui'
import {
  AddOutline,
  CalendarOutline,
  CheckmarkCircleOutline,
  PauseCircleOutline,
  PlayOutline,
  RefreshOutline,
  TimeOutline,
  TrashOutline,
  CreateOutline,
  SearchOutline,
} from '@vicons/ionicons5'
import { useCronStore } from '@/stores/cron'
import type {
  CronDelivery,
  CronJob,
  CronPayload,
  CronRunLogEntry,
  CronSchedule,
  CronUpsertParams,
} from '@/api/types'
import { formatDate, formatRelativeTime, truncate } from '@/utils/format'
import { renderSimpleMarkdown } from '@/utils/markdown'

type ScheduleKind = 'cron' | 'every' | 'at'
type EveryUnit = 'minutes' | 'hours' | 'days'
type StatusFilter = 'all' | 'enabled' | 'disabled'
type CronTemplatePreset = {
  id: string
  label: string
  description: string
  scheduleKind: ScheduleKind
  cronExpr?: string
  everyValue?: number
  everyUnit?: EveryUnit
  payloadText: string
  payloadKind?: 'systemEvent' | 'agentTurn'
  sessionTarget?: 'main' | 'isolated'
  deliveryMode?: 'none' | 'announce'
}

const cronStore = useCronStore()
const router = useRouter()
const message = useMessage()

const showModal = ref(false)
const modalMode = ref<'create' | 'edit'>('create')
const editingJobId = ref('')
const searchQuery = ref('')
const statusFilter = ref<StatusFilter>('all')

const quickTemplatePresets: CronTemplatePreset[] = [
  {
    id: 'morning-report',
    label: '每日晨报',
    description: '每天早上固定时段汇总信息并推送',
    scheduleKind: 'cron',
    cronExpr: '0 8 * * *',
    payloadText: '请汇总今天的重要动态，输出可直接阅读的晨报摘要。',
    payloadKind: 'agentTurn',
    sessionTarget: 'isolated',
    deliveryMode: 'announce',
  },
  {
    id: 'heartbeat-check',
    label: '健康巡检',
    description: '定时执行运行状态检查',
    scheduleKind: 'every',
    everyValue: 30,
    everyUnit: 'minutes',
    payloadText: '检查服务运行状态，若异常请给出简要原因和建议。',
    payloadKind: 'agentTurn',
    sessionTarget: 'isolated',
    deliveryMode: 'announce',
  },
  {
    id: 'main-reminder',
    label: '主会话提醒',
    description: '在主会话推送系统提醒',
    scheduleKind: 'cron',
    cronExpr: '0 21 * * *',
    payloadText: '提醒：请检查今日待办并同步完成进度。',
    payloadKind: 'systemEvent',
    sessionTarget: 'main',
    deliveryMode: 'none',
  },
]

const scheduleKindOptions: Array<{ label: string; value: ScheduleKind }> = [
  { label: 'Cron 表达式', value: 'cron' },
  { label: '固定间隔', value: 'every' },
  { label: '指定时间', value: 'at' },
]

const everyUnitOptions: Array<{ label: string; value: EveryUnit }> = [
  { label: '分钟', value: 'minutes' },
  { label: '小时', value: 'hours' },
  { label: '天', value: 'days' },
]

const deliveryChannelOptions: SelectOption[] = [
  { label: 'last（沿用最近回复渠道）', value: 'last' },
  { label: 'whatsapp', value: 'whatsapp' },
  { label: 'telegram', value: 'telegram' },
  { label: 'discord', value: 'discord' },
  { label: 'slack', value: 'slack' },
  { label: 'mattermost', value: 'mattermost' },
  { label: 'signal', value: 'signal' },
  { label: 'imessage', value: 'imessage' },
]

const form = reactive({
  name: '',
  description: '',
  agentId: '',
  enabled: true,
  deleteAfterRun: false,

  scheduleKind: 'cron' as ScheduleKind,
  cronExpr: '0 7 * * *',
  cronTz: '',
  everyValue: 1,
  everyUnit: 'hours' as EveryUnit,
  atTime: '',

  sessionTarget: 'isolated' as 'main' | 'isolated',
  wakeMode: 'next-heartbeat' as 'next-heartbeat' | 'now',

  payloadKind: 'agentTurn' as 'systemEvent' | 'agentTurn',
  payloadText: '',
  model: '',
  thinking: '',
  timeoutSeconds: 120,

  deliveryMode: 'announce' as 'none' | 'announce',
  deliveryChannel: 'last',
  deliveryTo: '',
  deliveryBestEffort: true,
})

const isEditing = computed(() => modalMode.value === 'edit')
const filteredJobs = computed(() => {
  const query = searchQuery.value.trim().toLowerCase()
  return cronStore.jobs.filter((job) => {
    if (statusFilter.value === 'enabled' && !job.enabled) return false
    if (statusFilter.value === 'disabled' && job.enabled) return false
    if (!query) return true

    return [
      job.name,
      job.description || '',
      job.schedule || '',
      job.agentId || '',
      job.payload?.kind || '',
      job.payload?.kind === 'agentTurn' ? job.payload.message : '',
      job.payload?.kind === 'systemEvent' ? job.payload.text : '',
      job.delivery?.channel || '',
      job.delivery?.to || '',
    ].some((field) => field.toLowerCase().includes(query))
  })
})

const hasJobs = computed(() => cronStore.jobs.length > 0)

const selectedJob = computed(() =>
  cronStore.jobs.find((job) => job.id === cronStore.selectedJobId) || null
)

const selectedJobPayloadText = computed(() => {
  const payload = selectedJob.value?.payload
  if (!payload) return ''
  if (payload.kind === 'systemEvent') return payload.text || ''
  if (payload.kind === 'agentTurn') return payload.message || ''
  return ''
})

const selectedJobPayloadHtml = computed(() => {
  const text = selectedJobPayloadText.value.trim()
  if (!text) return ''
  return renderSimpleMarkdown(text)
})

const orderedRuns = computed(() => [...cronStore.runs].sort((a, b) => b.ts - a.ts))

const stats = computed(() => {
  const total = cronStore.jobs.length
  const enabled = cronStore.jobs.filter((job) => job.enabled).length
  const disabled = total - enabled
  const nextWakeAtMs = cronStore.status?.nextWakeAtMs
  return {
    schedulerEnabled: cronStore.status?.enabled ?? true,
    total,
    enabled,
    disabled,
    nextWakeText: nextWakeAtMs ? formatDate(nextWakeAtMs) : '-',
  }
})

const previewPayload = computed(() => {
  try {
    const payload = buildSubmitPayload()
    return JSON.stringify(payload, null, 2)
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error)
    return `// 预览暂不可用：${msg}`
  }
})

const jobColumns: DataTableColumns<CronJob> = [
  {
    title: '任务',
    key: 'name',
    minWidth: 192,
    render(row) {
      return h(NSpace, { size: 6, align: 'center', wrap: false }, () => [
        h(
          NText,
          { strong: true, style: 'font-size: 13px; line-height: 1.3;' },
          { default: () => row.name }
        ),
        row.id === cronStore.selectedJobId
          ? h(
              NTag,
              { size: 'tiny', bordered: false, type: 'success' },
              { default: () => '已选中' }
            )
          : null,
      ])
    },
  },
  {
    title: '调度',
    key: 'schedule',
    minWidth: 176,
    render(row) {
      return h(NSpace, { vertical: true, size: 2 }, () => [
        h('code', { style: 'font-size: 10px; line-height: 1.3;' }, resolveScheduleText(row)),
        h(
          NSpace,
          { size: 4 },
          () => [
            row.sessionTarget
              ? h(
                  NTag,
                  { size: 'tiny', bordered: false, type: row.sessionTarget === 'isolated' ? 'info' : 'default', round: true },
                  { default: () => row.sessionTarget === 'isolated' ? '隔离会话' : '主会话' }
                )
              : null,
            row.payload
              ? h(
                  NTag,
                  { size: 'tiny', bordered: false, type: row.payload.kind === 'agentTurn' ? 'success' : 'warning', round: true },
                  { default: () => row.payload?.kind === 'agentTurn' ? 'Agent 执行' : '系统事件' }
                )
              : null,
          ].filter(Boolean)
        ),
      ])
    },
  },
  {
    title: '下次执行',
    key: 'next',
    width: 126,
    render(row) {
      return nextRunText(row)
    },
  },
  {
    title: '状态',
    key: 'enabled',
    width: 92,
    render(row) {
      return h(NSwitch, {
        size: 'small',
        value: row.enabled,
        loading: cronStore.saving,
        'onUpdate:value': (value: boolean) => {
          void handleToggle(row, value)
        },
      })
    },
  },
  {
    title: '操作',
    key: 'actions',
    width: 178,
    render(row) {
      return h(NSpace, { size: 6 }, () => [
        h(
          NButton,
          {
            size: 'tiny',
            quaternary: true,
            onClick: (e: MouseEvent) => {
              e.stopPropagation()
              void handleRun(row)
            },
          },
          {
            icon: () => h(NIcon, { component: PlayOutline }),
            default: () => '运行',
          }
        ),
        h(
          NButton,
          {
            size: 'tiny',
            quaternary: true,
            onClick: (e: MouseEvent) => {
              e.stopPropagation()
              openEditModal(row)
            },
          },
          {
            icon: () => h(NIcon, { component: CreateOutline }),
            default: () => '编辑',
          }
        ),
        h(
          NPopconfirm,
          {
            onPositiveClick: () => handleDelete(row),
            positiveText: '删除',
            negativeText: '取消',
          },
          {
            trigger: () =>
              h(
                NButton,
                {
                  size: 'tiny',
                  quaternary: true,
                  type: 'error',
                  onClick: (e: MouseEvent) => e.stopPropagation(),
                },
                {
                  icon: () => h(NIcon, { component: TrashOutline }),
                  default: () => '删除',
                }
              ),
            default: () => '确认删除该定时任务？',
          }
        ),
      ])
    },
  },
]

const runColumns: DataTableColumns<CronRunLogEntry> = [
  {
    title: '执行时间',
    key: 'ts',
    width: 170,
    render(row) {
      return formatDate(row.ts)
    },
  },
  {
    title: '状态',
    key: 'status',
    width: 100,
    render(row) {
      const status = row.status || 'unknown'
      const type =
        status === 'ok'
          ? 'success'
          : status === 'error'
            ? 'error'
            : status === 'skipped'
              ? 'warning'
              : 'default'
      return h(NTag, { size: 'small', bordered: false, type }, { default: () => status })
    },
  },
  {
    title: '耗时',
    key: 'durationMs',
    width: 90,
    render(row) {
      if (!row.durationMs) return '-'
      return `${row.durationMs}ms`
    },
  },
  {
    title: '摘要',
    key: 'summary',
    minWidth: 260,
    render(row) {
      return truncate(row.summary || row.error || '-', 96)
    },
  },
  {
    title: '会话',
    key: 'sessionKey',
    width: 100,
    render(row) {
      if (!row.sessionKey) return '-'
      return h(
        NButton,
        {
          text: true,
          type: 'primary',
          onClick: () => openRunSession(row),
        },
        { default: () => '打开' }
      )
    },
  },
]

onMounted(async () => {
  await cronStore.fetchOverview()
  const firstJob = cronStore.jobs[0]
  if (firstJob) {
    await cronStore.fetchRuns(firstJob.id)
  }
})

watch(
  () => form.sessionTarget,
  (target) => {
    if (target === 'main') {
      form.payloadKind = 'systemEvent'
      form.deliveryMode = 'none'
      return
    }
    if (form.payloadKind === 'systemEvent') {
      form.payloadKind = 'agentTurn'
    }
    if (form.deliveryMode === 'none') {
      form.deliveryMode = 'announce'
    }
  }
)

watch(
  () => form.payloadKind,
  (payloadKind) => {
    if (payloadKind === 'systemEvent') {
      form.deliveryMode = 'none'
    }
  }
)

function resetForm() {
  form.name = ''
  form.description = ''
  form.agentId = ''
  form.enabled = true
  form.deleteAfterRun = false
  form.scheduleKind = 'cron'
  form.cronExpr = '0 7 * * *'
  form.cronTz = ''
  form.everyValue = 1
  form.everyUnit = 'hours'
  form.atTime = ''
  form.sessionTarget = 'isolated'
  form.wakeMode = 'next-heartbeat'
  form.payloadKind = 'agentTurn'
  form.payloadText = ''
  form.model = ''
  form.thinking = ''
  form.timeoutSeconds = 120
  form.deliveryMode = 'announce'
  form.deliveryChannel = 'last'
  form.deliveryTo = ''
  form.deliveryBestEffort = true
}

function openCreateModal() {
  modalMode.value = 'create'
  editingJobId.value = ''
  resetForm()
  showModal.value = true
}

function applyQuickTemplate(preset: CronTemplatePreset) {
  openCreateModal()
  form.name = preset.label
  form.description = preset.description
  form.scheduleKind = preset.scheduleKind

  if (preset.scheduleKind === 'cron') {
    form.cronExpr = preset.cronExpr || '0 8 * * *'
  } else if (preset.scheduleKind === 'every') {
    form.everyValue = preset.everyValue || 1
    form.everyUnit = preset.everyUnit || 'hours'
  }

  form.sessionTarget = preset.sessionTarget || 'isolated'
  form.payloadKind = preset.payloadKind || 'agentTurn'
  form.payloadText = preset.payloadText
  form.deliveryMode = preset.deliveryMode || (form.sessionTarget === 'main' ? 'none' : 'announce')
}

function openEditModal(job: CronJob) {
  modalMode.value = 'edit'
  editingJobId.value = job.id
  fillFormByJob(job)
  showModal.value = true
}

function fillFormByJob(job: CronJob) {
  resetForm()
  form.name = job.name
  form.description = job.description || ''
  form.agentId = job.agentId || ''
  form.enabled = job.enabled
  form.deleteAfterRun = job.deleteAfterRun === true

  const schedule = job.scheduleObj
  if (schedule?.kind === 'cron') {
    form.scheduleKind = 'cron'
    form.cronExpr = schedule.expr
    form.cronTz = schedule.tz || ''
  } else if (schedule?.kind === 'every') {
    form.scheduleKind = 'every'
    const every = resolveEveryForm(schedule.everyMs)
    form.everyValue = every.value
    form.everyUnit = every.unit
  } else if (schedule?.kind === 'at') {
    form.scheduleKind = 'at'
    form.atTime = toDatetimeLocal(schedule.at)
  } else {
    form.scheduleKind = 'cron'
    form.cronExpr = job.schedule || '0 7 * * *'
    form.cronTz = job.timezone || ''
  }

  form.sessionTarget = job.sessionTarget || 'isolated'
  form.wakeMode = job.wakeMode || 'next-heartbeat'

  if (job.payload?.kind === 'systemEvent') {
    form.payloadKind = 'systemEvent'
    form.payloadText = job.payload.text
  } else {
    form.payloadKind = 'agentTurn'
    form.payloadText = job.payload?.kind === 'agentTurn' ? job.payload.message : ''
    form.model = job.payload?.kind === 'agentTurn' ? (job.payload.model || '') : ''
    form.thinking = job.payload?.kind === 'agentTurn' ? (job.payload.thinking || '') : ''
    form.timeoutSeconds = job.payload?.kind === 'agentTurn'
      ? (job.payload.timeoutSeconds || 120)
      : 120
  }

  form.deliveryMode = job.delivery?.mode || (form.sessionTarget === 'isolated' ? 'announce' : 'none')
  form.deliveryChannel = job.delivery?.channel || 'last'
  form.deliveryTo = job.delivery?.to || ''
  form.deliveryBestEffort = job.delivery?.bestEffort !== false
}

function toDatetimeLocal(value?: string): string {
  if (!value) return ''
  const timestamp = Date.parse(value)
  if (!Number.isFinite(timestamp)) return ''
  const date = new Date(timestamp - new Date(timestamp).getTimezoneOffset() * 60_000)
  return date.toISOString().slice(0, 16)
}

function resolveEveryForm(everyMs: number): { value: number; unit: EveryUnit } {
  if (everyMs % 86_400_000 === 0) {
    return { value: everyMs / 86_400_000, unit: 'days' }
  }
  if (everyMs % 3_600_000 === 0) {
    return { value: everyMs / 3_600_000, unit: 'hours' }
  }
  return { value: Math.max(1, Math.round(everyMs / 60_000)), unit: 'minutes' }
}

function buildSchedule(): CronSchedule {
  if (form.scheduleKind === 'cron') {
    const expr = form.cronExpr.trim()
    if (!expr) throw new Error('请输入 Cron 表达式')
    return {
      kind: 'cron',
      expr,
      tz: form.cronTz.trim() || undefined,
    }
  }

  if (form.scheduleKind === 'every') {
    const amount = Number(form.everyValue)
    if (!Number.isFinite(amount) || amount <= 0) {
      throw new Error('间隔数值必须大于 0')
    }
    const multiplier =
      form.everyUnit === 'days'
        ? 86_400_000
        : form.everyUnit === 'hours'
          ? 3_600_000
          : 60_000
    return {
      kind: 'every',
      everyMs: Math.round(amount * multiplier),
    }
  }

  const atMs = Date.parse(form.atTime)
  if (!form.atTime || !Number.isFinite(atMs)) {
    throw new Error('请选择有效的执行时间')
  }
  return {
    kind: 'at',
    at: new Date(atMs).toISOString(),
  }
}

function buildPayload(): CronPayload {
  const text = form.payloadText.trim()
  if (!text) throw new Error('请输入执行内容')

  if (form.sessionTarget === 'main' || form.payloadKind === 'systemEvent') {
    return {
      kind: 'systemEvent',
      text,
    }
  }

  const timeout = Number(form.timeoutSeconds)
  return {
    kind: 'agentTurn',
    message: text,
    model: form.model.trim() || undefined,
    thinking: form.thinking.trim() || undefined,
    timeoutSeconds: Number.isFinite(timeout) && timeout > 0 ? Math.round(timeout) : undefined,
  }
}

function buildDelivery(): CronDelivery | undefined {
  if (form.sessionTarget !== 'isolated' || form.payloadKind !== 'agentTurn') {
    return undefined
  }
  if (form.deliveryMode === 'none') {
    return { mode: 'none' }
  }
  return {
    mode: 'announce',
    channel: form.deliveryChannel.trim() || 'last',
    to: form.deliveryTo.trim() || undefined,
    bestEffort: form.deliveryBestEffort,
  }
}

function buildSubmitPayload(): CronUpsertParams {
  const name = form.name.trim()
  if (!name) throw new Error('请输入任务名称')

  const payload: CronUpsertParams = {
    name,
    description: form.description.trim() || undefined,
    enabled: form.enabled,
    deleteAfterRun: form.deleteAfterRun,
    schedule: buildSchedule(),
    sessionTarget: form.sessionTarget,
    wakeMode: form.wakeMode,
    payload: buildPayload(),
    delivery: buildDelivery(),
  }

  const agentId = form.agentId.trim()
  if (isEditing.value) {
    payload.agentId = agentId || null
  } else if (agentId) {
    payload.agentId = agentId
  }

  return payload
}

function clearFilters() {
  searchQuery.value = ''
  statusFilter.value = 'all'
}

function parseCronSource(text: string): { expr: string; tz?: string } {
  const value = text.trim()
  const match = value.match(/^(.*?)\s*\(([^()]+)\)\s*$/)
  if (!match) return { expr: value }
  return {
    expr: match[1]?.trim() || value,
    tz: match[2]?.trim() || undefined,
  }
}

function formatCronAsCn(expr: string, tz?: string): string {
  const compactExpr = expr.trim().replace(/\s+/g, ' ')
  const parts = compactExpr.split(' ')
  const tzSuffix = tz ? `（${tz}）` : ''
  if (parts.length !== 5) return `${compactExpr}${tzSuffix}`

  const minute = parts[0] ?? ''
  const hour = parts[1] ?? ''
  const dayOfMonth = parts[2] ?? ''
  const month = parts[3] ?? ''
  const dayOfWeek = parts[4] ?? ''
  const isNumber = (value: string) => /^\d+$/.test(value)
  const asNum = (value: string) => (isNumber(value) ? Number(value) : NaN)
  const pad2 = (value: number) => String(value).padStart(2, '0')

  if (/^\*\/\d+$/.test(minute) && hour === '*' && dayOfMonth === '*' && month === '*' && dayOfWeek === '*') {
    return `每 ${minute.slice(2)} 分钟${tzSuffix}`
  }

  if (minute === '0' && /^\*\/\d+$/.test(hour) && dayOfMonth === '*' && month === '*' && dayOfWeek === '*') {
    return `每 ${hour.slice(2)} 小时${tzSuffix}`
  }

  if (isNumber(minute) && /^\*\/\d+$/.test(hour) && dayOfMonth === '*' && month === '*' && dayOfWeek === '*') {
    return `每 ${hour.slice(2)} 小时的 ${pad2(asNum(minute))} 分${tzSuffix}`
  }

  const weekdayMap: Record<string, string> = {
    '0': '周日',
    '7': '周日',
    '1': '周一',
    '2': '周二',
    '3': '周三',
    '4': '周四',
    '5': '周五',
    '6': '周六',
    SUN: '周日',
    MON: '周一',
    TUE: '周二',
    WED: '周三',
    THU: '周四',
    FRI: '周五',
    SAT: '周六',
  }
  const normalizeDow = (value: string) => weekdayMap[value.toUpperCase()] || null
  const parseDowPart = (value: string): string | null => {
    if (value.includes('-')) {
      const [start, end] = value.split('-')
      const startText = start ? normalizeDow(start) : null
      const endText = end ? normalizeDow(end) : null
      return startText && endText ? `${startText}至${endText}` : null
    }
    return normalizeDow(value)
  }
  const parseDow = (value: string): string | null => {
    if (value === '*') return null
    const partsText = value.split(',').map((item) => parseDowPart(item.trim())).filter(Boolean) as string[]
    if (!partsText.length) return null
    return partsText.join('、')
  }

  if (isNumber(minute) && isNumber(hour)) {
    const timeText = `${pad2(asNum(hour))}:${pad2(asNum(minute))}`
    if (dayOfMonth === '*' && month === '*' && dayOfWeek === '*') {
      return `每天 ${timeText}${tzSuffix}`
    }
    const weekText = parseDow(dayOfWeek)
    if (dayOfMonth === '*' && month === '*' && weekText) {
      return `每周${weekText} ${timeText}${tzSuffix}`
    }
    if (isNumber(dayOfMonth) && month === '*' && dayOfWeek === '*') {
      return `每月 ${asNum(dayOfMonth)} 日 ${timeText}${tzSuffix}`
    }
    if (isNumber(dayOfMonth) && isNumber(month) && dayOfWeek === '*') {
      return `每年 ${asNum(month)} 月 ${asNum(dayOfMonth)} 日 ${timeText}${tzSuffix}`
    }
  }

  return `${compactExpr}${tzSuffix}`
}

function resolveScheduleText(job: CronJob): string {
  if (job.scheduleObj?.kind === 'cron') {
    return formatCronAsCn(job.scheduleObj.expr, job.scheduleObj.tz)
  }
  if (job.scheduleObj?.kind === 'every') {
    const every = resolveEveryForm(job.scheduleObj.everyMs)
    const unitText = every.unit === 'minutes' ? '分钟' : every.unit === 'hours' ? '小时' : '天'
    return `每 ${every.value} ${unitText}`
  }
  if (job.scheduleObj?.kind === 'at') {
    return `at ${formatDate(job.scheduleObj.at)}`
  }
  if (job.schedule) {
    const schedule = parseCronSource(job.schedule)
    return formatCronAsCn(schedule.expr, schedule.tz || job.timezone)
  }
  return '-'
}

function nextRunText(job: CronJob): string {
  if (job.state?.nextRunAtMs) {
    return formatRelativeTime(job.state.nextRunAtMs)
  }
  if (job.nextRun) {
    return formatRelativeTime(job.nextRun)
  }
  return '-'
}

function lastRunText(job: CronJob): string {
  if (job.state?.lastRunAtMs) {
    return formatRelativeTime(job.state.lastRunAtMs)
  }
  if (job.lastRun) {
    return formatRelativeTime(job.lastRun)
  }
  return '-'
}

async function handleRefresh() {
  await cronStore.fetchOverview()
  if (cronStore.selectedJobId) {
    await cronStore.fetchRuns(cronStore.selectedJobId)
  }
}

async function handleSelectJob(row: CronJob) {
  await cronStore.fetchRuns(row.id)
}

async function handleToggle(job: CronJob, value: boolean) {
  try {
    await cronStore.updateJob(job.id, { enabled: value })
    message.success(value ? '任务已启用' : '任务已禁用')
  } catch (error) {
    message.error(error instanceof Error ? error.message : '更新失败')
  }
}

async function handleRun(job: CronJob) {
  try {
    await cronStore.runJob(job.id, 'force')
    message.success('任务已触发执行')
  } catch (error) {
    message.error(error instanceof Error ? error.message : '触发执行失败')
  }
}

async function handleDelete(job: CronJob) {
  try {
    await cronStore.deleteJob(job.id)
    message.success('任务已删除')
  } catch (error) {
    message.error(error instanceof Error ? error.message : '删除失败')
  }
}

async function handleSubmit() {
  try {
    const payload = buildSubmitPayload()
    if (isEditing.value && editingJobId.value) {
      await cronStore.updateJob(editingJobId.value, payload)
      message.success('任务已更新')
      if (editingJobId.value) {
        await cronStore.fetchRuns(editingJobId.value)
      }
    } else {
      await cronStore.createJob(payload)
      message.success('任务已创建')
    }
    showModal.value = false
  } catch (error) {
    message.error(error instanceof Error ? error.message : '保存失败')
  }
}

function openRunSession(run: CronRunLogEntry) {
  if (!run.sessionKey) return
  router.push({
    name: 'Chat',
    query: { session: run.sessionKey },
  })
}

function jobRowClassName(row: CronJob): string {
  return row.id === cronStore.selectedJobId ? 'cron-row-selected' : ''
}

function jobRowProps(row: CronJob) {
  return {
    style: 'cursor: pointer;',
    onClick: () => {
      void handleSelectJob(row)
    },
  }
}
</script>

<template>
  <div class="cron-page">
    <NCard class="cron-hero" :bordered="false">
      <template #header>
        <div class="cron-hero-title">Cron 管理（调度中心）</div>
      </template>
      <template #header-extra>
        <NSpace :size="8">
          <NButton size="small" :loading="cronStore.loading || cronStore.statusLoading" @click="handleRefresh">
            <template #icon><NIcon :component="RefreshOutline" /></template>
            刷新
          </NButton>
          <NButton size="small" type="primary" @click="openCreateModal">
            <template #icon><NIcon :component="AddOutline" /></template>
            新建任务
          </NButton>
        </NSpace>
      </template>

      <NSpace vertical :size="10">
        <NAlert type="info" :show-icon="true" :bordered="false">
          重复任务建议使用 Cron/Every，一次性触发使用 At；先用模板起步，再按业务调整细节。
        </NAlert>
        <NAlert v-if="!stats.schedulerEnabled" type="warning" :show-icon="true" :bordered="false">
          当前网关 `cron.enabled` 可能已关闭，任务不会自动调度执行。
        </NAlert>
        <NAlert v-if="cronStore.lastError" type="error" :show-icon="true" :bordered="false">
          Cron 请求失败：{{ cronStore.lastError }}
        </NAlert>
      </NSpace>

      <div class="cron-template-row">
        <NText depth="3">快捷模板</NText>
        <NSpace :size="8" wrap>
          <NButton
            v-for="preset in quickTemplatePresets"
            :key="preset.id"
            size="small"
            tertiary
            type="primary"
            @click="applyQuickTemplate(preset)"
          >
            {{ preset.label }}
          </NButton>
        </NSpace>
      </div>

      <NGrid cols="1 s:2 m:5" responsive="screen" :x-gap="10" :y-gap="10" class="cron-stats-grid">
        <NGridItem>
          <NCard embedded :bordered="false" class="cron-stat-card">
            <NSpace align="center" justify="space-between">
              <NText depth="3">调度器</NText>
              <NIcon :component="CalendarOutline" />
            </NSpace>
            <div class="cron-stat-value">{{ stats.schedulerEnabled ? '已启用' : '已关闭' }}</div>
          </NCard>
        </NGridItem>
        <NGridItem>
          <NCard embedded :bordered="false" class="cron-stat-card">
            <NSpace align="center" justify="space-between">
              <NText depth="3">任务总数</NText>
              <NIcon :component="TimeOutline" />
            </NSpace>
            <div class="cron-stat-value">{{ stats.total }}</div>
          </NCard>
        </NGridItem>
        <NGridItem>
          <NCard embedded :bordered="false" class="cron-stat-card">
            <NSpace align="center" justify="space-between">
              <NText depth="3">启用任务</NText>
              <NIcon :component="CheckmarkCircleOutline" />
            </NSpace>
            <div class="cron-stat-value">{{ stats.enabled }}</div>
          </NCard>
        </NGridItem>
        <NGridItem>
          <NCard embedded :bordered="false" class="cron-stat-card">
            <NSpace align="center" justify="space-between">
              <NText depth="3">禁用任务</NText>
              <NIcon :component="PauseCircleOutline" />
            </NSpace>
            <div class="cron-stat-value">{{ stats.disabled }}</div>
          </NCard>
        </NGridItem>
        <NGridItem>
          <NCard embedded :bordered="false" class="cron-stat-card">
            <NText depth="3">下次唤醒</NText>
            <div class="cron-stat-subvalue">{{ stats.nextWakeText }}</div>
          </NCard>
        </NGridItem>
      </NGrid>
    </NCard>

    <NGrid cols="1 l:11" responsive="screen" :x-gap="12" :y-gap="12">
      <NGridItem class="cron-grid-item" span="1 l:7">
        <NCard class="cron-card" :bordered="false">
          <template #header>
            <NSpace justify="space-between" align="center">
              <NText strong>任务列表</NText>
              <NText depth="3" style="font-size: 12px;">{{ filteredJobs.length }} 条</NText>
            </NSpace>
          </template>

          <div class="cron-filter-row">
            <NInput v-model:value="searchQuery" clearable placeholder="搜索名称 / 描述 / 负载内容">
              <template #prefix><NIcon :component="SearchOutline" /></template>
            </NInput>
            <NRadioGroup v-model:value="statusFilter" size="small">
              <NRadioButton value="all">全部</NRadioButton>
              <NRadioButton value="enabled">启用</NRadioButton>
              <NRadioButton value="disabled">禁用</NRadioButton>
            </NRadioGroup>
            <NButton size="small" @click="clearFilters">清空</NButton>
          </div>

          <NDataTable
            class="cron-job-table"
            :columns="jobColumns"
            :data="filteredJobs"
            :loading="cronStore.loading"
            :bordered="false"
            :pagination="{ pageSize: 8 }"
            :row-key="(row: CronJob) => row.id"
            :row-class-name="jobRowClassName"
            :row-props="jobRowProps"
            style="margin-top: 12px;"
          />

          <NAlert v-if="!cronStore.loading && !hasJobs" type="default" :bordered="false" class="cron-empty-alert">
            还没有任务。可直接使用上方“快捷模板”或点击“新建任务”。
          </NAlert>
        </NCard>
      </NGridItem>

      <NGridItem class="cron-grid-item" span="1 l:4">
        <NCard class="cron-card cron-detail-card" :bordered="false">
          <template v-if="selectedJob">
            <NSpace justify="space-between" align="center">
              <NText strong>{{ selectedJob.name }}</NText>
              <NSpace :size="6">
                <NTag :type="selectedJob.enabled ? 'success' : 'default'" size="small" :bordered="false" round>
                  {{ selectedJob.enabled ? '启用中' : '已禁用' }}
                </NTag>
                <NTag v-if="selectedJob.state?.lastStatus" size="small" :bordered="false" round>
                  {{ selectedJob.state?.lastStatus }}
                </NTag>
              </NSpace>
            </NSpace>

            <NText depth="3" class="cron-detail-desc">{{ selectedJob.description || '暂无描述' }}</NText>

            <NGrid cols="1 s:2" responsive="screen" :x-gap="10" :y-gap="10" class="cron-detail-grid">
              <NGridItem>
                <NText depth="3">调度</NText>
                <div class="cron-detail-value">{{ resolveScheduleText(selectedJob) }}</div>
              </NGridItem>
              <NGridItem>
                <NText depth="3">执行模式</NText>
                <div class="cron-detail-value">{{ selectedJob.sessionTarget || '-' }} / {{ selectedJob.wakeMode || '-' }}</div>
              </NGridItem>
              <NGridItem>
                <NText depth="3">负载类型</NText>
                <div class="cron-detail-value">{{ selectedJob.payload?.kind || '-' }}</div>
              </NGridItem>
              <NGridItem>
                <NText depth="3">Agent</NText>
                <div class="cron-detail-value">{{ selectedJob.agentId || '默认 Agent' }}</div>
              </NGridItem>
              <NGridItem>
                <NText depth="3">下次执行</NText>
                <div class="cron-detail-value">{{ nextRunText(selectedJob) }}</div>
              </NGridItem>
              <NGridItem>
                <NText depth="3">上次执行</NText>
                <div class="cron-detail-value">{{ lastRunText(selectedJob) }}</div>
              </NGridItem>
            </NGrid>

            <NDivider style="margin: 14px 0 10px;" />

            <NText depth="3">执行内容</NText>
            <div
              v-if="selectedJobPayloadHtml"
              class="cron-detail-value cron-detail-block cron-markdown"
              v-html="selectedJobPayloadHtml"
            ></div>
            <div v-else class="cron-detail-value cron-detail-block">-</div>

            <div v-if="selectedJob.delivery" class="cron-delivery-block">
              <NText depth="3">投递策略</NText>
              <div class="cron-detail-value cron-detail-block">
                {{ selectedJob.delivery.mode }}
                <span v-if="selectedJob.delivery.channel"> / {{ selectedJob.delivery.channel }}</span>
                <span v-if="selectedJob.delivery.to"> / {{ selectedJob.delivery.to }}</span>
              </div>
            </div>

            <NAlert
              v-if="selectedJob.state?.lastError"
              type="error"
              :show-icon="true"
              :bordered="false"
              class="cron-error-alert"
            >
              最近错误：{{ selectedJob.state?.lastError }}
            </NAlert>

            <NSpace class="cron-detail-actions" wrap>
              <NButton size="small" type="primary" @click="handleRun(selectedJob)">
                <template #icon><NIcon :component="PlayOutline" /></template>
                立即运行
              </NButton>
              <NButton size="small" @click="openEditModal(selectedJob)">
                <template #icon><NIcon :component="CreateOutline" /></template>
                编辑任务
              </NButton>
              <NButton size="small" @click="cronStore.fetchRuns(selectedJob.id)">
                <template #icon><NIcon :component="RefreshOutline" /></template>
                刷新历史
              </NButton>
            </NSpace>
          </template>

          <div v-else class="cron-empty-state">
            从左侧选择任务后，可查看调度详情、最近状态和运行历史。
          </div>
        </NCard>
      </NGridItem>
    </NGrid>

    <NCard class="cron-card" :bordered="false">
      <template #header>
        <NSpace justify="space-between" align="center">
          <NText strong>运行历史</NText>
          <NText depth="3" style="font-size: 12px;">
            {{ selectedJob ? `${selectedJob.name}（最近 ${orderedRuns.length} 条）` : '未选择任务' }}
          </NText>
        </NSpace>
      </template>

      <NDataTable
        :columns="runColumns"
        :data="orderedRuns"
        :loading="cronStore.runsLoading"
        :bordered="false"
        :pagination="{ pageSize: 6 }"
        :row-key="(row: CronRunLogEntry) => `${row.jobId}-${row.ts}-${row.sessionKey || ''}`"
        :scroll-x="760"
      />
    </NCard>

    <NModal
      v-model:show="showModal"
      preset="card"
      :title="isEditing ? '编辑任务' : '新建任务'"
      style="width: 860px; max-width: calc(100vw - 32px);"
    >
      <NForm label-placement="left" label-width="110">
        <NDivider title-placement="left">基础信息</NDivider>
        <NGrid cols="1 s:2" responsive="screen" :x-gap="10">
          <NGridItem>
            <NFormItem label="任务名称" required>
              <NInput v-model:value="form.name" placeholder="例如：每日晨报" />
            </NFormItem>
          </NGridItem>
          <NGridItem>
            <NFormItem label="Agent ID">
              <NInput v-model:value="form.agentId" placeholder="为空则使用默认 Agent" />
            </NFormItem>
          </NGridItem>
        </NGrid>
        <NFormItem label="任务描述">
          <NInput
            v-model:value="form.description"
            type="textarea"
            :autosize="{ minRows: 2, maxRows: 4 }"
            placeholder="简要说明任务目的（可选）"
          />
        </NFormItem>
        <NGrid cols="1 s:2" responsive="screen" :x-gap="10">
          <NGridItem>
            <NFormItem label="启用任务">
              <NSwitch v-model:value="form.enabled" />
            </NFormItem>
          </NGridItem>
          <NGridItem>
            <NFormItem label="完成后删除">
              <NSwitch v-model:value="form.deleteAfterRun" />
            </NFormItem>
          </NGridItem>
        </NGrid>

        <NDivider title-placement="left">调度策略</NDivider>
        <NFormItem label="调度方式">
          <NSelect v-model:value="form.scheduleKind" :options="scheduleKindOptions" />
        </NFormItem>
        <template v-if="form.scheduleKind === 'cron'">
          <NGrid cols="1 s:2" responsive="screen" :x-gap="10">
            <NGridItem>
              <NFormItem label="Cron 表达式" required>
                <NInput v-model:value="form.cronExpr" placeholder="例如：0 7 * * *" />
              </NFormItem>
            </NGridItem>
            <NGridItem>
              <NFormItem label="时区">
                <NInput v-model:value="form.cronTz" placeholder="例如：Asia/Shanghai（可选）" />
              </NFormItem>
            </NGridItem>
          </NGrid>
        </template>
        <template v-else-if="form.scheduleKind === 'every'">
          <NGrid cols="1 s:2" responsive="screen" :x-gap="10">
            <NGridItem>
              <NFormItem label="间隔数值" required>
                <NInputNumber
                  v-model:value="form.everyValue"
                  :min="1"
                  :precision="0"
                  :show-button="false"
                  placeholder="例如：2"
                  style="width: 100%;"
                />
              </NFormItem>
            </NGridItem>
            <NGridItem>
              <NFormItem label="间隔单位" required>
                <NSelect v-model:value="form.everyUnit" :options="everyUnitOptions" />
              </NFormItem>
            </NGridItem>
          </NGrid>
        </template>
        <template v-else>
          <NFormItem label="执行时间" required>
            <input v-model="form.atTime" class="cron-native-input" type="datetime-local" />
          </NFormItem>
        </template>

        <NDivider title-placement="left">执行内容</NDivider>
        <NGrid cols="1 s:3" responsive="screen" :x-gap="10">
          <NGridItem>
            <NFormItem label="会话目标">
              <NSelect
                v-model:value="form.sessionTarget"
                :options="[
                  { label: 'isolated（推荐）', value: 'isolated' },
                  { label: 'main', value: 'main' },
                ]"
              />
            </NFormItem>
          </NGridItem>
          <NGridItem>
            <NFormItem label="唤醒模式">
              <NSelect
                v-model:value="form.wakeMode"
                :options="[
                  { label: 'next-heartbeat', value: 'next-heartbeat' },
                  { label: 'now', value: 'now' },
                ]"
              />
            </NFormItem>
          </NGridItem>
          <NGridItem>
            <NFormItem label="负载类型">
              <NSelect
                v-model:value="form.payloadKind"
                :disabled="form.sessionTarget === 'main'"
                :options="[
                  { label: 'agentTurn', value: 'agentTurn' },
                  { label: 'systemEvent', value: 'systemEvent' },
                ]"
              />
            </NFormItem>
          </NGridItem>
        </NGrid>
        <NFormItem label="执行文本" required>
          <NInput
            v-model:value="form.payloadText"
            type="textarea"
            :autosize="{ minRows: 3, maxRows: 6 }"
            :placeholder="form.payloadKind === 'agentTurn' ? '输入给 Agent 的执行提示词' : '输入 system event 内容'"
          />
        </NFormItem>

        <template v-if="form.payloadKind === 'agentTurn'">
          <NGrid cols="1 s:3" responsive="screen" :x-gap="10">
            <NGridItem>
              <NFormItem label="模型覆盖">
                <NInput v-model:value="form.model" placeholder="例如：opus（可选）" />
              </NFormItem>
            </NGridItem>
            <NGridItem>
              <NFormItem label="思维级别">
                <NInput v-model:value="form.thinking" placeholder="例如：low/high（可选）" />
              </NFormItem>
            </NGridItem>
            <NGridItem>
              <NFormItem label="超时秒数">
                <NInputNumber
                  v-model:value="form.timeoutSeconds"
                  :min="1"
                  :precision="0"
                  :show-button="false"
                  placeholder="例如：120"
                  style="width: 100%;"
                />
              </NFormItem>
            </NGridItem>
          </NGrid>
        </template>

        <template v-if="form.sessionTarget === 'isolated' && form.payloadKind === 'agentTurn'">
          <NDivider title-placement="left">投递策略</NDivider>
          <NGrid cols="1 s:3" responsive="screen" :x-gap="10">
            <NGridItem>
              <NFormItem label="投递模式">
                <NSelect
                  v-model:value="form.deliveryMode"
                  :options="[
                    { label: 'announce（摘要投递）', value: 'announce' },
                    { label: 'none（仅内部运行）', value: 'none' },
                  ]"
                />
              </NFormItem>
            </NGridItem>
            <NGridItem>
              <NFormItem label="投递频道">
                <NSelect
                  v-model:value="form.deliveryChannel"
                  :disabled="form.deliveryMode === 'none'"
                  :options="deliveryChannelOptions"
                />
              </NFormItem>
            </NGridItem>
            <NGridItem>
              <NFormItem label="投递目标">
                <NInput
                  v-model:value="form.deliveryTo"
                  :disabled="form.deliveryMode === 'none'"
                  placeholder="例如：channel:C123 / -100xxx:topic:123"
                />
              </NFormItem>
            </NGridItem>
          </NGrid>
          <NFormItem label="bestEffort">
            <NSwitch v-model:value="form.deliveryBestEffort" :disabled="form.deliveryMode === 'none'" />
          </NFormItem>
        </template>

        <NDivider title-placement="left">保存预览（发送到网关）</NDivider>
        <NCode :code="previewPayload" language="json" :word-wrap="true" />
      </NForm>

      <template #footer>
        <NSpace justify="space-between" align="center">
          <NText depth="3" style="font-size: 12px;">
            任务将写入 Gateway 的 cron 存储，并由网关进程调度执行。
          </NText>
          <NSpace>
            <NButton @click="showModal = false">取消</NButton>
            <NButton type="primary" :loading="cronStore.saving" @click="handleSubmit">
              {{ isEditing ? '保存修改' : '创建任务' }}
            </NButton>
          </NSpace>
        </NSpace>
      </template>
    </NModal>
  </div>
</template>

<style scoped>
:deep(.cron-job-table .n-data-table-wrapper) {
  overflow-x: auto;
}

:deep(.cron-job-table .n-data-table-th) {
  padding-top: 8px;
  padding-bottom: 8px;
  font-size: 12px;
}

:deep(.cron-job-table .n-data-table-td) {
  padding-top: 8px;
  padding-bottom: 8px;
  font-size: 12px;
}

:deep(.cron-job-table .cron-row-selected > td) {
  background: rgba(24, 160, 88, 0.12);
  transition: background-color 0.15s ease;
}

:deep(.cron-job-table .cron-row-selected > td:first-child) {
  box-shadow: inset 3px 0 0 var(--success-color);
}

:deep(.cron-job-table .cron-row-selected:hover > td) {
  background: rgba(24, 160, 88, 0.18);
}

.cron-page {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.cron-hero {
  border-radius: var(--radius-lg);
  background:
    radial-gradient(circle at 82% 14%, rgba(24, 160, 88, 0.2), transparent 34%),
    linear-gradient(125deg, var(--bg-card), rgba(32, 128, 240, 0.08));
  border: 1px solid rgba(24, 160, 88, 0.18);
}

.cron-hero-title {
  font-size: 18px;
  font-weight: 700;
  line-height: 1.25;
}

.cron-template-row {
  margin-top: 12px;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.cron-stats-grid {
  margin-top: 12px;
}

.cron-stat-card {
  border-radius: 10px;
}

.cron-stat-value {
  margin-top: 8px;
  font-size: 22px;
  font-weight: 700;
  line-height: 1.2;
}

.cron-stat-subvalue {
  margin-top: 10px;
  font-size: 14px;
  font-weight: 600;
  line-height: 1.5;
}

.cron-grid-item {
  min-width: 0;
}

.cron-card {
  border-radius: var(--radius-lg);
}

.cron-detail-card {
  min-height: 440px;
}

.cron-filter-row {
  display: grid;
  grid-template-columns: minmax(0, 2fr) auto auto;
  gap: 8px;
  align-items: center;
}

.cron-empty-alert {
  margin-top: 10px;
}

.cron-detail-desc {
  display: block;
  margin-top: 8px;
}

.cron-detail-grid {
  margin-top: 12px;
}

.cron-detail-value {
  font-size: 13px;
  line-height: 1.6;
  word-break: break-word;
}

.cron-detail-block {
  margin-top: 6px;
}

.cron-delivery-block {
  margin-top: 10px;
}

.cron-markdown {
  white-space: normal;
  line-height: 1.7;
  word-break: break-word;
  overflow-wrap: break-word;
}

.cron-markdown :deep(> :first-child) {
  margin-top: 0;
}

.cron-markdown :deep(> :last-child) {
  margin-bottom: 0;
}

.cron-markdown :deep(p) {
  margin: 4px 0;
}

.cron-markdown :deep(ul),
.cron-markdown :deep(ol) {
  margin: 6px 0;
  padding-left: 1.35em;
}

.cron-markdown :deep(li) {
  margin: 2px 0;
}

.cron-markdown :deep(a) {
  color: var(--link-color);
  text-decoration: underline;
  text-decoration-color: var(--link-underline);
  text-underline-offset: 2px;
}

.cron-markdown :deep(a:hover) {
  color: var(--link-color-hover);
  text-decoration-color: var(--link-color-hover);
}

.cron-markdown :deep(code) {
  padding: 1px 4px;
  border-radius: 4px;
  border: 1px solid var(--md-code-border);
  background: var(--md-code-bg);
  font-family: 'SFMono-Regular', Menlo, Monaco, Consolas, monospace;
  font-size: 0.88em;
}

.cron-markdown :deep(pre) {
  margin: 8px 0;
  padding: 8px 10px;
  border-radius: 6px;
  border: 1px solid var(--md-code-border);
  background: var(--md-pre-bg);
  overflow-x: auto;
}

.cron-markdown :deep(pre code) {
  padding: 0;
  border: 0;
  background: transparent;
}

.cron-error-alert {
  margin-top: 12px;
}

.cron-detail-actions {
  margin-top: 14px;
}

.cron-empty-state {
  text-align: center;
  padding: 100px 0;
  color: var(--text-secondary);
}

.cron-native-input {
  width: 100%;
  min-height: 34px;
  padding: 0 12px;
  border: 1px solid var(--border-color);
  border-radius: 3px;
  background: var(--bg-card);
  color: var(--text-primary);
}

@media (max-width: 1200px) {
  .cron-filter-row {
    grid-template-columns: 1fr;
    align-items: stretch;
  }
}
</style>
