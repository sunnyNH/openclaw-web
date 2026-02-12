<script setup lang="ts">
import { onMounted, computed } from 'vue'
import {
  NCard,
  NGrid,
  NGridItem,
  NButton,
  NSpace,
  NTag,
  NText,
  NIcon,
  NDescriptions,
  NDescriptionsItem,
  NSpin,
  useMessage,
} from 'naive-ui'
import { RefreshOutline } from '@vicons/ionicons5'
import { useChannelStore } from '@/stores/channel'
import type { Channel } from '@/api/types'

const channelStore = useChannelStore()
const message = useMessage()

onMounted(() => {
  channelStore.fetchChannels()
})

const platformIcons: Record<string, string> = {
  whatsapp: '💬',
  telegram: '✈️',
  discord: '🎮',
  slack: '💼',
  signal: '🔒',
  imessage: '💎',
  webchat: '🌐',
  matrix: '🔗',
}

function statusType(status: string): 'success' | 'warning' | 'error' | 'info' {
  switch (status) {
    case 'connected': return 'success'
    case 'authenticating': return 'warning'
    case 'disconnected': return 'error'
    default: return 'info'
  }
}

function statusLabel(status: string): string {
  switch (status) {
    case 'connected': return '已连接'
    case 'authenticating': return '认证中'
    case 'disconnected': return '已断开'
    case 'error': return '错误'
    default: return status
  }
}

function dmPolicyLabel(policy: string): string {
  switch (policy) {
    case 'pairing': return '配对模式'
    case 'allowlist': return '白名单'
    case 'open': return '开放'
    case 'disabled': return '已禁用'
    default: return policy
  }
}

async function handleAuth(channel: Channel) {
  try {
    await channelStore.authChannel({ channelId: channel.id })
    message.success('认证请求已发送')
    channelStore.fetchChannels()
  } catch {
    message.error('认证失败')
  }
}
</script>

<template>
  <NSpace vertical :size="16">
    <NCard title="频道管理" style="border-radius: var(--radius-lg);">
      <template #header-extra>
        <NButton size="small" @click="channelStore.fetchChannels()">
          <template #icon><NIcon :component="RefreshOutline" /></template>
          刷新
        </NButton>
      </template>

      <NSpin :show="channelStore.loading">
        <NGrid cols="1 s:2 l:3" responsive="screen" :x-gap="16" :y-gap="16">
          <NGridItem v-for="channel in channelStore.channels" :key="channel.id">
            <NCard :bordered="true" style="border-radius: var(--radius);" hoverable>
              <NSpace vertical :size="12">
                <NSpace justify="space-between" align="center">
                  <NSpace align="center" :size="8">
                    <span style="font-size: 24px;">
                      {{ platformIcons[channel.platform] || '📡' }}
                    </span>
                    <div>
                      <NText strong style="font-size: 15px; text-transform: capitalize;">
                        {{ channel.platform }}
                      </NText>
                      <NText v-if="channel.accountName" depth="3" style="font-size: 12px; display: block;">
                        {{ channel.accountName }}
                      </NText>
                    </div>
                  </NSpace>
                  <NTag :type="statusType(channel.status)" size="small" round :bordered="false">
                    {{ statusLabel(channel.status) }}
                  </NTag>
                </NSpace>

                <NDescriptions :column="2" size="small" label-placement="left">
                  <NDescriptionsItem label="启用">
                    <NTag :type="channel.enabled ? 'success' : 'default'" size="tiny" :bordered="false">
                      {{ channel.enabled ? '是' : '否' }}
                    </NTag>
                  </NDescriptionsItem>
                  <NDescriptionsItem label="DM 策略">
                    {{ dmPolicyLabel(channel.dmPolicy) }}
                  </NDescriptionsItem>
                  <NDescriptionsItem v-if="channel.groups?.length" label="群组">
                    {{ channel.groups.length }} 个
                  </NDescriptionsItem>
                </NDescriptions>

                <NButton
                  v-if="channel.status !== 'connected'"
                  size="small"
                  type="primary"
                  block
                  @click="handleAuth(channel)"
                >
                  {{ channel.status === 'authenticating' ? '重新认证' : '连接' }}
                </NButton>
              </NSpace>
            </NCard>
          </NGridItem>
        </NGrid>

        <div
          v-if="!channelStore.loading && channelStore.channels.length === 0"
          style="text-align: center; padding: 60px 0; color: var(--text-secondary);"
        >
          暂无频道配置。请在 openclaw.json 中配置频道。
        </div>
      </NSpin>
    </NCard>
  </NSpace>
</template>
