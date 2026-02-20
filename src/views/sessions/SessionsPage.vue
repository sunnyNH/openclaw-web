<script setup lang="ts">
import { computed, h, onMounted, ref } from 'vue'
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
  RefreshOutline,
  SearchOutline,
  TimeOutline,
  TrashOutline,
} from '@vicons/ionicons5'
import { useI18n } from 'vue-i18n'
import { useSessionStore } from '@/stores/session'
import { formatRelativeTime, parseSessionKey } from '@/utils/format'
import type { Session } from '@/api/types'

type SortMode = 'recent' | 'messages'

type SessionRow = Session & {
  parsed: ReturnType<typeof parseSessionKey>
  lastActivityTs: number
  active24h: boolean
}

const sessionStore = useSessionStore()
const message = useMessage()
const { t } = useI18n()

const searchQuery = ref('')
const channelFilter = ref<string>('all')
const modelFilter = ref<string>('all')
const sortMode = ref<SortMode>('recent')

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
    title: t('pages.sessions.list.columns.tokenTotal'),
    key: 'tokenTotal',
    width: 120,
    render(row) {
      const total = resolveSessionTokenTotal(row)
      if (total === null) return '-'
      return formatTokenTotalK(total)
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
  {
    title: t('pages.sessions.list.columns.actions'),
    key: 'actions',
    width: 170,
    render(row) {
      return h(NSpace, { size: 8, wrap: false, class: 'sessions-row-actions' }, () => [
        h(
          NPopconfirm,
          { onPositiveClick: () => handleNew(row) },
          {
            trigger: () => h(
              NButton,
              {
                size: 'small',
                type: 'success',
                secondary: true,
                strong: true,
                class: 'sessions-action-btn sessions-action-btn--new',
              },
              {
                icon: () => h(NIcon, { component: RefreshOutline }),
                default: () => t('pages.sessions.list.newAction'),
              }
            ),
            default: () => t('pages.sessions.list.confirmNew'),
          }
        ),
        h(
          NPopconfirm,
          { onPositiveClick: () => handleDelete(row) },
          {
            trigger: () => h(
              NButton,
              {
                size: 'small',
                type: 'error',
                secondary: true,
                strong: true,
                class: 'sessions-action-btn sessions-action-btn--delete',
              },
              {
                icon: () => h(NIcon, { component: TrashOutline }),
                default: () => t('common.delete'),
              }
            ),
            default: () => t('pages.sessions.detail.confirmDelete'),
          }
        ),
      ])
    },
  },
]))

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

function resolveSessionTokenTotal(session: Session): number | null {
  const usage = session.tokenUsage
  if (!usage) return null
  const input = Number.isFinite(usage.totalInput) ? usage.totalInput : 0
  const output = Number.isFinite(usage.totalOutput) ? usage.totalOutput : 0
  return Math.max(0, Math.floor(input + output))
}

function formatTokenTotalK(total: number): string {
  const value = Math.max(0, total) / 1000
  const digits = value >= 100 ? 0 : value >= 10 ? 1 : 2
  const text = value.toFixed(digits).replace(/\.0+$/, '').replace(/(\.\d*[1-9])0+$/, '$1')
  return `${text}K`
}

function clearFilters() {
  searchQuery.value = ''
  channelFilter.value = 'all'
  modelFilter.value = 'all'
  sortMode.value = 'recent'
}

async function handleRefresh() {
  await sessionStore.fetchSessions()
}

async function handleNew(session: SessionRow) {
  try {
    await sessionStore.newSession(session.key)
    message.success(t('pages.sessions.list.newSuccess'))
  } catch {
    message.error(t('pages.sessions.list.newFailed'))
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
        :scroll-x="1110"
        striped
      />
    </NCard>
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

.sessions-card {
  border-radius: var(--radius-lg);
}

.sessions-row-actions {
  align-items: center;
  flex-wrap: nowrap;
}

.sessions-action-btn {
  min-width: 78px;
  height: 34px;
  padding: 0 12px;
  border-radius: 9px;
  font-size: 13px;
  font-weight: 600;
  letter-spacing: 0.1px;
  transition: transform 0.16s ease, box-shadow 0.16s ease;
}

.sessions-action-btn:not(:disabled):hover {
  transform: translateY(-1px);
  box-shadow: 0 3px 10px rgba(15, 23, 42, 0.12);
}

@media (max-width: 1100px) {
  .sessions-filter-bar {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}
</style>
