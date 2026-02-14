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
import { useI18n } from 'vue-i18n'
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
const { t } = useI18n()

const searchQuery = ref('')
const channelFilter = ref<string>('all')
const modelFilter = ref<string>('all')
const sortMode = ref<SortMode>('recent')
const selectedSessionKey = ref('')

const sortOptions = computed<SelectOption[]>(() => ([
  { label: t('pages.sessions.list.sort.recent'), value: 'recent' },
  { label: t('pages.sessions.list.sort.messages'), value: 'messages' },
]))

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
    { label: t('pages.sessions.list.filters.allChannels'), value: 'all' },
    ...Array.from(set)
      .sort((a, b) => a.localeCompare(b))
      .map((channel) => ({ label: channel, value: channel })),
  ]
})

const modelOptions = computed<SelectOption[]>(() => {
  const set = new Set(sessionRows.value.map((item) => item.model || '').filter(Boolean))
  return [
    { label: t('pages.sessions.list.filters.allModels'), value: 'all' },
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

const sessionColumns = computed<DataTableColumns<SessionRow>>(() => ([
  {
    title: t('pages.sessions.list.columns.session'),
    key: 'session',
    minWidth: 320,
    render(row) {
      return h(NSpace, { vertical: true, size: 3 }, () => [
        h(NSpace, { size: 6, align: 'center' }, () => [
          h(NTag, { size: 'small', type: 'info', bordered: false, round: true }, { default: () => row.parsed.agent }),
          h(NTag, { size: 'small', bordered: false, round: true }, { default: () => row.parsed.channel }),
          row.active24h
            ? h(NTag, { size: 'small', bordered: false, type: 'success', round: true }, { default: () => t('pages.sessions.list.badges.active24h') })
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
    title: t('pages.sessions.list.columns.messageCount'),
    key: 'messageCount',
    width: 100,
    sorter: (a, b) => a.messageCount - b.messageCount,
    render(row) {
      return row.messageCount || 0
    },
  },
  {
    title: t('pages.sessions.list.columns.model'),
    key: 'model',
    minWidth: 180,
    ellipsis: { tooltip: true },
    render(row) {
      return row.model || '-'
    },
  },
  {
    title: t('pages.sessions.list.columns.lastActivity'),
    key: 'lastActivity',
    width: 150,
    sorter: (a, b) => a.lastActivityTs - b.lastActivityTs,
    render(row) {
      return row.lastActivity ? formatRelativeTime(row.lastActivity) : '-'
    },
  },
]))

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
    message.success(t('pages.sessions.detail.resetSuccess'))
  } catch {
    message.error(t('pages.sessions.detail.resetFailed'))
  }
}

async function handleDelete(session: SessionRow) {
  try {
    await sessionStore.deleteSession(session.key)
    message.success(t('pages.sessions.detail.deleteSuccess'))
  } catch {
    message.error(t('pages.sessions.detail.deleteFailed'))
  }
}

async function handleExport(session: SessionRow) {
  try {
    const data = await sessionStore.exportSession(session.key)
    downloadJSON(data, `session-${session.key.replace(/:/g, '-')}.json`)
    message.success(t('pages.sessions.detail.exportSuccess'))
  } catch {
    message.error(t('pages.sessions.detail.exportFailed'))
  }
}
</script>

<template>
  <div class="sessions-page">
    <NCard class="sessions-hero" :bordered="false">
      <template #header>
        <div class="sessions-hero-title">{{ t('pages.sessions.list.title') }}</div>
      </template>
      <template #header-extra>
        <NButton size="small" :loading="sessionStore.loading" @click="handleRefresh">
          <template #icon>
            <NIcon :component="RefreshOutline" />
          </template>
          {{ t('common.refresh') }}
        </NButton>
      </template>

      <NAlert type="info" :bordered="false">
        {{ t('pages.sessions.list.hint') }}
      </NAlert>

      <NGrid cols="1 s:2 m:4" responsive="screen" :x-gap="10" :y-gap="10" style="margin-top: 12px;">
        <NGridItem>
          <NCard embedded :bordered="false" class="sessions-metric-card">
            <NSpace justify="space-between" align="center">
              <NText depth="3">{{ t('pages.sessions.list.metrics.totalSessions') }}</NText>
              <NIcon :component="ChatbubblesOutline" />
            </NSpace>
            <div class="sessions-metric-value">{{ stats.total }}</div>
          </NCard>
        </NGridItem>
        <NGridItem>
          <NCard embedded :bordered="false" class="sessions-metric-card">
            <NSpace justify="space-between" align="center">
              <NText depth="3">{{ t('pages.sessions.list.metrics.active24h') }}</NText>
              <NIcon :component="TimeOutline" />
            </NSpace>
            <div class="sessions-metric-value">{{ stats.active24h }}</div>
          </NCard>
        </NGridItem>
        <NGridItem>
          <NCard embedded :bordered="false" class="sessions-metric-card">
            <NSpace justify="space-between" align="center">
              <NText depth="3">{{ t('pages.sessions.list.metrics.totalMessages') }}</NText>
              <NText depth="3">{{ t('pages.sessions.list.units.messages') }}</NText>
            </NSpace>
            <div class="sessions-metric-value">{{ stats.totalMessages }}</div>
          </NCard>
        </NGridItem>
        <NGridItem>
          <NCard embedded :bordered="false" class="sessions-metric-card">
            <NSpace justify="space-between" align="center">
              <NText depth="3">{{ t('pages.sessions.list.metrics.uniqueChannels') }}</NText>
              <NText depth="3">{{ t('pages.sessions.list.units.channels') }}</NText>
            </NSpace>
            <div class="sessions-metric-value">{{ stats.uniqueChannels }}</div>
          </NCard>
        </NGridItem>
      </NGrid>

      <div class="sessions-filter-bar">
        <NInput v-model:value="searchQuery" clearable :placeholder="t('pages.sessions.list.searchPlaceholder')">
          <template #prefix>
            <NIcon :component="SearchOutline" />
          </template>
        </NInput>
        <NSelect v-model:value="channelFilter" :options="channelOptions" />
        <NSelect v-model:value="modelFilter" :options="modelOptions" />
        <NSelect v-model:value="sortMode" :options="sortOptions" />
        <NButton @click="clearFilters">{{ t('pages.sessions.list.clearFilters') }}</NButton>
      </div>
    </NCard>

    <NGrid cols="1 l:3" responsive="screen" :x-gap="12" :y-gap="12">
      <NGridItem :span="2" class="sessions-grid-item">
        <NCard :title="t('pages.sessions.list.listTitle')" class="sessions-card">
          <template #header-extra>
            <NText depth="3" style="font-size: 12px;">
              {{ t('pages.sessions.list.listCount', { current: filteredSessions.length, total: stats.total }) }}
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
        <NCard :title="t('pages.sessions.list.actionsTitle')" class="sessions-card sessions-side-card">
          <template v-if="selectedSession">
            <NSpace vertical :size="10">
              <div class="session-selected-key">
                <code>{{ selectedSession.key }}</code>
              </div>

              <NSpace :size="6" style="flex-wrap: wrap;">
                <NTag size="small" type="info" :bordered="false">{{ selectedSession.parsed.agent }}</NTag>
                <NTag size="small" :bordered="false">{{ selectedSession.parsed.channel }}</NTag>
                <NTag size="small" :bordered="false" :type="selectedSession.active24h ? 'success' : 'default'">
                  {{ selectedSession.active24h ? t('pages.sessions.list.badges.active24h') : t('pages.sessions.list.badges.inactive') }}
                </NTag>
              </NSpace>

              <div class="session-meta-grid">
                <div class="session-meta-item">
                  <NText depth="3">{{ t('pages.sessions.list.meta.peer') }}</NText>
                  <div class="session-meta-value">{{ selectedSession.parsed.peer || '-' }}</div>
                </div>
                <div class="session-meta-item">
                  <NText depth="3">{{ t('pages.sessions.list.meta.messageCount') }}</NText>
                  <div class="session-meta-value">{{ selectedSession.messageCount }}</div>
                </div>
                <div class="session-meta-item">
                  <NText depth="3">{{ t('pages.sessions.list.meta.model') }}</NText>
                  <div class="session-meta-value">{{ selectedSession.model || '-' }}</div>
                </div>
                <div class="session-meta-item">
                  <NText depth="3">{{ t('pages.sessions.list.meta.lastActivity') }}</NText>
                  <div class="session-meta-value">{{ selectedSession.lastActivity ? formatRelativeTime(selectedSession.lastActivity) : '-' }}</div>
                </div>
              </div>

              <NText depth="3" style="font-size: 12px;">
                {{ t('pages.sessions.list.activeTime', { time: selectedSession.lastActivity ? formatDate(selectedSession.lastActivity) : '-' }) }}
              </NText>

              <NSpace :size="8" wrap>
                <NButton size="small" type="primary" @click="handleView(selectedSession)">
                  <template #icon><NIcon :component="EyeOutline" /></template>
                  {{ t('pages.sessions.list.viewDetail') }}
                </NButton>
                <NButton size="small" @click="handleExport(selectedSession)">
                  <template #icon><NIcon :component="DownloadOutline" /></template>
                  {{ t('common.export') }}
                </NButton>
                <NPopconfirm @positive-click="handleReset(selectedSession)">
                  <template #trigger>
                    <NButton size="small">
                      <template #icon><NIcon :component="RefreshOutline" /></template>
                      {{ t('common.reset') }}
                    </NButton>
                  </template>
                  {{ t('pages.sessions.list.confirmReset') }}
                </NPopconfirm>
                <NPopconfirm @positive-click="handleDelete(selectedSession)">
                  <template #trigger>
                    <NButton size="small" type="error">
                      <template #icon><NIcon :component="TrashOutline" /></template>
                      {{ t('common.delete') }}
                    </NButton>
                  </template>
                  {{ t('pages.sessions.detail.confirmDelete') }}
                </NPopconfirm>
              </NSpace>

              <NAlert type="default" :bordered="false">
                {{ t('pages.sessions.list.summary', { text: truncate(selectedSession.parsed.peer || selectedSession.key, 56) }) }}
              </NAlert>
            </NSpace>
          </template>

          <div v-else class="sessions-empty-side">
            {{ t('pages.sessions.list.emptySide') }}
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
