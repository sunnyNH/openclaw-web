<script setup lang="ts">
import { computed, h, onMounted, ref, watch } from 'vue'
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
  NPopconfirm,
  NSelect,
  NSpace,
  NTag,
  NText,
  useMessage,
} from 'naive-ui'
import type { DataTableColumns, SelectOption } from 'naive-ui'
import {
  ChatbubblesOutline,
  DownloadOutline,
  EyeOutline,
  RefreshOutline,
  SearchOutline,
  TimeOutline,
  TrashOutline,
} from '@vicons/ionicons5'
import { useSessionStore } from '@/stores/session'
import { downloadJSON, formatDate, formatRelativeTime, parseSessionKey, truncate } from '@/utils/format'
import type { Session } from '@/api/types'

type SortMode = 'recent' | 'messages'

type SessionRow = Session & {
  parsed: ReturnType<typeof parseSessionKey>
  lastActivityTs: number
  active24h: boolean
}

const router = useRouter()
const sessionStore = useSessionStore()
const message = useMessage()

const searchQuery = ref('')
const channelFilter = ref<string>('all')
const modelFilter = ref<string>('all')
const sortMode = ref<SortMode>('recent')
const selectedSessionKey = ref('')

const sortOptions: SelectOption[] = [
  { label: '按最近活动', value: 'recent' },
  { label: '按消息数量', value: 'messages' },
]

const sessionRows = computed<SessionRow[]>(() => {
  return sessionStore.sessions.map((session) => {
    const parsed = parseSessionKey(session.key)
    const lastActivityTs = parseTimestamp(session.lastActivity)
    return {
      ...session,
      parsed,
      lastActivityTs,
      active24h: isActiveIn24h(lastActivityTs),
    }
  })
})

const channelOptions = computed<SelectOption[]>(() => {
  const set = new Set(sessionRows.value.map((item) => item.parsed.channel).filter(Boolean))
  return [
    { label: '全部渠道', value: 'all' },
    ...Array.from(set)
      .sort((a, b) => a.localeCompare(b))
      .map((channel) => ({ label: channel, value: channel })),
  ]
})

const modelOptions = computed<SelectOption[]>(() => {
  const set = new Set(sessionRows.value.map((item) => item.model || '').filter(Boolean))
  return [
    { label: '全部模型', value: 'all' },
    ...Array.from(set)
      .sort((a, b) => a.localeCompare(b))
      .map((model) => ({ label: model, value: model })),
  ]
})

const filteredSessions = computed<SessionRow[]>(() => {
  const q = searchQuery.value.trim().toLowerCase()

  let list = sessionRows.value.filter((item) => {
    if (channelFilter.value !== 'all' && item.parsed.channel !== channelFilter.value) return false
    if (modelFilter.value !== 'all' && (item.model || '') !== modelFilter.value) return false

    if (!q) return true
    return [
      item.key,
      item.parsed.agent,
      item.parsed.channel,
      item.parsed.peer,
      item.model || '',
    ].some((field) => field.toLowerCase().includes(q))
  })

  list = [...list].sort((a, b) => {
    if (sortMode.value === 'messages') {
      if (b.messageCount !== a.messageCount) return b.messageCount - a.messageCount
      return b.lastActivityTs - a.lastActivityTs
    }
    return b.lastActivityTs - a.lastActivityTs
  })

  return list
})

const stats = computed(() => {
  const total = sessionRows.value.length
  const active24h = sessionRows.value.filter((item) => item.active24h).length
  const totalMessages = sessionRows.value.reduce((acc, item) => acc + (item.messageCount || 0), 0)
  const uniqueChannels = new Set(sessionRows.value.map((item) => item.parsed.channel).filter(Boolean)).size
  return {
    total,
    active24h,
    totalMessages,
    uniqueChannels,
  }
})

const selectedSession = computed<SessionRow | null>(() =>
  filteredSessions.value.find((item) => item.key === selectedSessionKey.value) || null
)

const sessionColumns: DataTableColumns<SessionRow> = [
  {
    title: '会话',
    key: 'session',
    minWidth: 320,
    render(row) {
      return h(NSpace, { vertical: true, size: 3 }, () => [
        h(NSpace, { size: 6, align: 'center' }, () => [
          h(NTag, { size: 'small', type: 'info', bordered: false, round: true }, { default: () => row.parsed.agent }),
          h(NTag, { size: 'small', bordered: false, round: true }, { default: () => row.parsed.channel }),
          row.active24h
            ? h(NTag, { size: 'small', bordered: false, type: 'success', round: true }, { default: () => '24h 活跃' })
            : null,
        ]),
        h(
          NText,
          { style: 'font-size: 13px;' },
          { default: () => row.parsed.peer || '-' }
        ),
      ])
    },
  },
  {
    title: '消息数',
    key: 'messageCount',
    width: 100,
    sorter: (a, b) => a.messageCount - b.messageCount,
    render(row) {
      return row.messageCount || 0
    },
  },
  {
    title: '模型',
    key: 'model',
    minWidth: 180,
    ellipsis: { tooltip: true },
    render(row) {
      return row.model || '-'
    },
  },
  {
    title: '最近活动',
    key: 'lastActivity',
    width: 150,
    sorter: (a, b) => a.lastActivityTs - b.lastActivityTs,
    render(row) {
      return row.lastActivity ? formatRelativeTime(row.lastActivity) : '-'
    },
  },
]

watch(
  filteredSessions,
  (list) => {
    if (!list.length) {
      selectedSessionKey.value = ''
      return
    }

    if (!selectedSessionKey.value || !list.some((item) => item.key === selectedSessionKey.value)) {
      const first = list[0]
      if (!first) return
      selectedSessionKey.value = first.key
    }
  },
  { immediate: true }
)

onMounted(() => {
  void sessionStore.fetchSessions()
})

function parseTimestamp(value?: string): number {
  if (!value) return 0
  const ts = new Date(value).getTime()
  return Number.isFinite(ts) ? ts : 0
}

function isActiveIn24h(timestamp: number): boolean {
  if (!timestamp) return false
  return Date.now() - timestamp <= 24 * 60 * 60 * 1000
}

function sessionRowProps(row: SessionRow) {
  return {
    style: 'cursor: pointer;',
    onClick: () => {
      selectedSessionKey.value = row.key
    },
  }
}

function sessionRowClassName(row: SessionRow) {
  return row.key === selectedSessionKey.value ? 'session-row-active' : ''
}

function clearFilters() {
  searchQuery.value = ''
  channelFilter.value = 'all'
  modelFilter.value = 'all'
  sortMode.value = 'recent'
}

function handleView(session: SessionRow) {
  router.push({ name: 'SessionDetail', params: { key: encodeURIComponent(session.key) } })
}

async function handleRefresh() {
  await sessionStore.fetchSessions()
}

async function handleReset(session: SessionRow) {
  try {
    await sessionStore.resetSession(session.key)
    message.success('会话已重置')
  } catch {
    message.error('重置失败')
  }
}

async function handleDelete(session: SessionRow) {
  try {
    await sessionStore.deleteSession(session.key)
    message.success('会话已删除')
  } catch {
    message.error('删除失败')
  }
}

async function handleExport(session: SessionRow) {
  try {
    const data = await sessionStore.exportSession(session.key)
    downloadJSON(data, `session-${session.key.replace(/:/g, '-')}.json`)
    message.success('导出成功')
  } catch {
    message.error('导出失败')
  }
}
</script>

<template>
  <div class="sessions-page">
    <NCard class="sessions-hero" :bordered="false">
      <template #header>
        <div class="sessions-hero-title">会话管理</div>
      </template>
      <template #header-extra>
        <NButton size="small" :loading="sessionStore.loading" @click="handleRefresh">
          <template #icon>
            <NIcon :component="RefreshOutline" />
          </template>
          刷新
        </NButton>
      </template>

      <NAlert type="info" :bordered="false">
        先筛选会话，再在右侧执行查看详情、导出、重置、删除等操作，避免误操作。
      </NAlert>

      <NGrid cols="1 s:2 m:4" responsive="screen" :x-gap="10" :y-gap="10" style="margin-top: 12px;">
        <NGridItem>
          <NCard embedded :bordered="false" class="sessions-metric-card">
            <NSpace justify="space-between" align="center">
              <NText depth="3">会话总数</NText>
              <NIcon :component="ChatbubblesOutline" />
            </NSpace>
            <div class="sessions-metric-value">{{ stats.total }}</div>
          </NCard>
        </NGridItem>
        <NGridItem>
          <NCard embedded :bordered="false" class="sessions-metric-card">
            <NSpace justify="space-between" align="center">
              <NText depth="3">24h 活跃</NText>
              <NIcon :component="TimeOutline" />
            </NSpace>
            <div class="sessions-metric-value">{{ stats.active24h }}</div>
          </NCard>
        </NGridItem>
        <NGridItem>
          <NCard embedded :bordered="false" class="sessions-metric-card">
            <NSpace justify="space-between" align="center">
              <NText depth="3">消息总量</NText>
              <NText depth="3">条</NText>
            </NSpace>
            <div class="sessions-metric-value">{{ stats.totalMessages }}</div>
          </NCard>
        </NGridItem>
        <NGridItem>
          <NCard embedded :bordered="false" class="sessions-metric-card">
            <NSpace justify="space-between" align="center">
              <NText depth="3">渠道数</NText>
              <NText depth="3">个</NText>
            </NSpace>
            <div class="sessions-metric-value">{{ stats.uniqueChannels }}</div>
          </NCard>
        </NGridItem>
      </NGrid>

      <div class="sessions-filter-bar">
        <NInput v-model:value="searchQuery" clearable placeholder="搜索 key / agent / 渠道 / 对话方 / 模型">
          <template #prefix>
            <NIcon :component="SearchOutline" />
          </template>
        </NInput>
        <NSelect v-model:value="channelFilter" :options="channelOptions" />
        <NSelect v-model:value="modelFilter" :options="modelOptions" />
        <NSelect v-model:value="sortMode" :options="sortOptions" />
        <NButton @click="clearFilters">清空筛选</NButton>
      </div>
    </NCard>

    <NGrid cols="1 l:3" responsive="screen" :x-gap="12" :y-gap="12">
      <NGridItem :span="2" class="sessions-grid-item">
        <NCard title="会话列表" class="sessions-card">
          <template #header-extra>
            <NText depth="3" style="font-size: 12px;">
              当前 {{ filteredSessions.length }} / 共 {{ stats.total }}
            </NText>
          </template>

          <NDataTable
            :columns="sessionColumns"
            :data="filteredSessions"
            :loading="sessionStore.loading"
            :bordered="false"
            :row-key="(row: SessionRow) => row.key"
            :pagination="{ pageSize: 12 }"
            :row-props="sessionRowProps"
            :row-class-name="sessionRowClassName"
            :scroll-x="860"
            striped
          />
        </NCard>
      </NGridItem>

      <NGridItem :span="1" class="sessions-grid-item">
        <NCard title="会话操作" class="sessions-card sessions-side-card">
          <template v-if="selectedSession">
            <NSpace vertical :size="10">
              <div class="session-selected-key">
                <code>{{ selectedSession.key }}</code>
              </div>

              <NSpace :size="6" style="flex-wrap: wrap;">
                <NTag size="small" type="info" :bordered="false">{{ selectedSession.parsed.agent }}</NTag>
                <NTag size="small" :bordered="false">{{ selectedSession.parsed.channel }}</NTag>
                <NTag size="small" :bordered="false" :type="selectedSession.active24h ? 'success' : 'default'">
                  {{ selectedSession.active24h ? '24h 活跃' : '非活跃' }}
                </NTag>
              </NSpace>

              <div class="session-meta-grid">
                <div class="session-meta-item">
                  <NText depth="3">对话方</NText>
                  <div class="session-meta-value">{{ selectedSession.parsed.peer || '-' }}</div>
                </div>
                <div class="session-meta-item">
                  <NText depth="3">消息数</NText>
                  <div class="session-meta-value">{{ selectedSession.messageCount }}</div>
                </div>
                <div class="session-meta-item">
                  <NText depth="3">模型</NText>
                  <div class="session-meta-value">{{ selectedSession.model || '-' }}</div>
                </div>
                <div class="session-meta-item">
                  <NText depth="3">最近活动</NText>
                  <div class="session-meta-value">{{ selectedSession.lastActivity ? formatRelativeTime(selectedSession.lastActivity) : '-' }}</div>
                </div>
              </div>

              <NText depth="3" style="font-size: 12px;">
                活动时间：{{ selectedSession.lastActivity ? formatDate(selectedSession.lastActivity) : '-' }}
              </NText>

              <NSpace :size="8" wrap>
                <NButton size="small" type="primary" @click="handleView(selectedSession)">
                  <template #icon><NIcon :component="EyeOutline" /></template>
                  查看详情
                </NButton>
                <NButton size="small" @click="handleExport(selectedSession)">
                  <template #icon><NIcon :component="DownloadOutline" /></template>
                  导出
                </NButton>
                <NPopconfirm @positive-click="handleReset(selectedSession)">
                  <template #trigger>
                    <NButton size="small">
                      <template #icon><NIcon :component="RefreshOutline" /></template>
                      重置
                    </NButton>
                  </template>
                  确认重置该会话？
                </NPopconfirm>
                <NPopconfirm @positive-click="handleDelete(selectedSession)">
                  <template #trigger>
                    <NButton size="small" type="error">
                      <template #icon><NIcon :component="TrashOutline" /></template>
                      删除
                    </NButton>
                  </template>
                  确认删除该会话？此操作不可撤销。
                </NPopconfirm>
              </NSpace>

              <NAlert type="default" :bordered="false">
                当前会话摘要：{{ truncate(selectedSession.parsed.peer || selectedSession.key, 56) }}
              </NAlert>
            </NSpace>
          </template>

          <div v-else class="sessions-empty-side">
            从左侧选择会话后，可进行查看详情、导出、重置或删除。
          </div>
        </NCard>
      </NGridItem>
    </NGrid>
  </div>
</template>

<style scoped>
.sessions-page {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.sessions-hero {
  border-radius: var(--radius-lg);
  background:
    radial-gradient(circle at 84% 16%, rgba(32, 128, 240, 0.22), transparent 36%),
    linear-gradient(120deg, var(--bg-card), rgba(24, 160, 88, 0.08));
  border: 1px solid rgba(32, 128, 240, 0.18);
}

.sessions-hero-title {
  font-size: 18px;
  font-weight: 700;
  line-height: 1.2;
}

.sessions-metric-card {
  border-radius: 10px;
}

.sessions-metric-value {
  margin-top: 8px;
  font-size: 22px;
  font-weight: 700;
  line-height: 1.2;
}

.sessions-filter-bar {
  margin-top: 12px;
  display: grid;
  grid-template-columns: minmax(0, 2fr) repeat(3, minmax(0, 1fr)) auto;
  gap: 8px;
}

.sessions-grid-item {
  min-width: 0;
}

.sessions-card {
  border-radius: var(--radius-lg);
}

.sessions-side-card {
  height: 100%;
}

.session-selected-key {
  padding: 8px 10px;
  border: 1px solid var(--border-color);
  border-radius: 8px;
  background: var(--bg-secondary);
  overflow: hidden;
}

.session-selected-key code {
  display: block;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  font-size: 12px;
}

.session-meta-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 8px;
}

.session-meta-item {
  border: 1px solid var(--border-color);
  border-radius: 8px;
  padding: 8px 10px;
  background: var(--bg-primary);
}

.session-meta-value {
  margin-top: 4px;
  font-size: 13px;
  word-break: break-word;
}

.sessions-empty-side {
  color: var(--text-secondary);
  font-size: 13px;
  line-height: 1.6;
  padding: 40px 0;
  text-align: center;
}

:deep(.session-row-active td) {
  background: rgba(32, 128, 240, 0.12) !important;
}

@media (max-width: 1100px) {
  .sessions-filter-bar {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}

@media (max-width: 640px) {
  .session-meta-grid {
    grid-template-columns: 1fr;
  }
}
</style>
