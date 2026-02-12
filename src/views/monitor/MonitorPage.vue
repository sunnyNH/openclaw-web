<script setup lang="ts">
import { ref, nextTick, watch, onMounted, onUnmounted } from 'vue'
import {
  NCard,
  NButton,
  NSpace,
  NSwitch,
  NIcon,
  NTag,
  NText,
  NSelect,
  NBadge,
  NScrollbar,
} from 'naive-ui'
import { TrashOutline, PauseOutline, PlayOutline } from '@vicons/ionicons5'
import { useEventStream } from '@/composables/useEventStream'
import { useMonitorStore } from '@/stores/monitor'
import { formatDate } from '@/utils/format'

const monitorStore = useMonitorStore()
const { events, clear } = useEventStream()
const autoScroll = ref(true)
const filterType = ref('')
const scrollbarRef = ref<any>(null)

const eventTypeOptions = [
  { label: '全部事件', value: '' },
  { label: 'Agent 启动', value: 'agent.started' },
  { label: 'Agent 完成', value: 'agent.done' },
  { label: 'Agent 思考', value: 'agent.thinking' },
  { label: '工具调用', value: 'tool.call' },
  { label: '工具结果', value: 'tool.result' },
  { label: '模型流式输出', value: 'model.streaming' },
  { label: '配置更新', value: 'config.updated' },
  { label: '频道连接', value: 'channel.connected' },
]

function filteredEvents() {
  if (!filterType.value) return events.value
  return events.value.filter((e) => e.event === filterType.value)
}

function eventColor(event: string): string {
  if (event.startsWith('agent.')) return '#18a058'
  if (event.startsWith('tool.')) return '#f0a020'
  if (event.startsWith('model.')) return '#2080f0'
  if (event.startsWith('config.')) return '#909399'
  if (event.startsWith('channel.')) return '#d03050'
  return '#666666'
}

function formatPayload(payload: unknown): string {
  if (payload === null || payload === undefined) return ''
  if (typeof payload === 'string') return payload
  try {
    const str = JSON.stringify(payload, null, 2)
    if (str.length > 300) return str.slice(0, 300) + '...'
    return str
  } catch {
    return String(payload)
  }
}

watch(
  () => events.value.length,
  () => {
    if (autoScroll.value) {
      nextTick(() => {
        scrollbarRef.value?.scrollTo({ top: 0 })
      })
    }
  }
)
</script>

<template>
  <NCard title="Agent 实时监控" style="border-radius: var(--radius-lg);">
    <template #header-extra>
      <NSpace :size="12" align="center">
        <NSelect
          v-model:value="filterType"
          :options="eventTypeOptions"
          size="small"
          style="width: 160px;"
          clearable
          placeholder="过滤事件"
        />

        <NSpace :size="8" align="center">
          <NText depth="3" style="font-size: 12px;">自动滚动</NText>
          <NSwitch v-model:value="autoScroll" size="small" />
        </NSpace>

        <NButton
          size="small"
          :type="monitorStore.paused ? 'primary' : 'default'"
          @click="monitorStore.paused = !monitorStore.paused"
        >
          <template #icon>
            <NIcon :component="monitorStore.paused ? PlayOutline : PauseOutline" />
          </template>
          {{ monitorStore.paused ? '恢复' : '暂停' }}
        </NButton>

        <NBadge :value="monitorStore.eventCount" :max="999" :offset="[-4, 0]">
          <NButton size="small" @click="clear">
            <template #icon><NIcon :component="TrashOutline" /></template>
            清空
          </NButton>
        </NBadge>
      </NSpace>
    </template>

    <NScrollbar
      ref="scrollbarRef"
      style="max-height: calc(100vh - 200px);"
    >
      <div style="font-family: 'SF Mono', 'Fira Code', monospace; font-size: 13px;">
        <div
          v-for="(event, index) in filteredEvents()"
          :key="index"
          style="padding: 10px 12px; border-bottom: 1px solid var(--border-color); display: flex; gap: 12px; align-items: flex-start;"
        >
          <NText depth="3" style="font-size: 11px; white-space: nowrap; min-width: 70px; padding-top: 2px;">
            {{ formatDate(event.timestamp).split(' ')[1] }}
          </NText>

          <NTag
            size="tiny"
            :bordered="false"
            round
            :color="{ color: eventColor(event.event) + '18', textColor: eventColor(event.event) }"
            style="flex-shrink: 0;"
          >
            {{ event.event }}
          </NTag>

          <div style="flex: 1; min-width: 0; overflow: hidden;">
            <pre
              v-if="event.payload"
              style="margin: 0; white-space: pre-wrap; word-break: break-word; font-size: 12px; line-height: 1.5; color: var(--text-secondary);"
            >{{ formatPayload(event.payload) }}</pre>
          </div>

          <NText v-if="event.seq !== undefined" depth="3" style="font-size: 11px; flex-shrink: 0;">
            #{{ event.seq }}
          </NText>
        </div>

        <div
          v-if="filteredEvents().length === 0"
          style="text-align: center; padding: 80px 0; color: var(--text-secondary);"
        >
          <div style="font-size: 32px; margin-bottom: 12px;">📡</div>
          <div>{{ monitorStore.paused ? '监控已暂停' : '等待事件...' }}</div>
        </div>
      </div>
    </NScrollbar>
  </NCard>
</template>
