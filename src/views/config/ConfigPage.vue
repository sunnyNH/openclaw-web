<script setup lang="ts">
import { ref, onMounted, watch } from 'vue'
import { useRouter } from 'vue-router'
import {
  NCard,
  NSpace,
  NButton,
  NIcon,
  NTabs,
  NTabPane,
  NForm,
  NFormItem,
  NInput,
  NInputNumber,
  NSelect,
  NDynamicTags,
  NSpin,
  NAlert,
  NCode,
  NScrollbar,
  useMessage,
} from 'naive-ui'
import { GitNetworkOutline, RefreshOutline, SaveOutline } from '@vicons/ionicons5'
import { useConfigStore } from '@/stores/config'
import type { ConfigPatch } from '@/api/types'

const configStore = useConfigStore()
const message = useMessage()
const router = useRouter()
const activeTab = ref('general')
const rawJsonEdit = ref('')

onMounted(() => {
  configStore.fetchConfig()
})

watch(
  () => configStore.config,
  (config) => {
    if (config) {
      rawJsonEdit.value = JSON.stringify(config, null, 2)
    }
  },
  { immediate: true }
)

// -- General settings --
const primaryModel = ref('')
const gatewayPort = ref(18789)
const workspace = ref('')

watch(
  () => configStore.config,
  (config) => {
    if (!config) return
    primaryModel.value = config.models?.primary || config.agents?.defaults?.model?.primary || ''
    gatewayPort.value = config.gateway?.port || 18789
    workspace.value = config.agents?.defaults?.workspace || '~/.openclaw/workspace'
  },
  { immediate: true }
)

async function saveGeneralSettings() {
  const patches: ConfigPatch[] = []
  if (primaryModel.value) {
    patches.push({ path: 'agents.defaults.model.primary', value: primaryModel.value })
  }
  if (gatewayPort.value) {
    patches.push({ path: 'gateway.port', value: gatewayPort.value })
  }
  if (workspace.value) {
    patches.push({ path: 'agents.defaults.workspace', value: workspace.value })
  }

  if (patches.length === 0) {
    message.info('没有需要保存的更改')
    return
  }

  try {
    await configStore.patchConfig(patches)
    message.success('配置已保存')
  } catch {
    message.error('保存失败')
  }
}

// -- Tools settings --
const toolProfile = ref('full')
const allowedTools = ref<string[]>([])
const deniedTools = ref<string[]>([])

watch(
  () => configStore.config,
  (config) => {
    if (!config) return
    toolProfile.value = config.tools?.profile || config.agents?.defaults?.tools?.profile || 'full'
    allowedTools.value = config.tools?.allow || config.agents?.defaults?.tools?.allow || []
    deniedTools.value = config.tools?.deny || config.agents?.defaults?.tools?.deny || []
  },
  { immediate: true }
)

async function saveToolSettings() {
  const patches: ConfigPatch[] = [
    { path: 'tools.profile', value: toolProfile.value },
    { path: 'tools.allow', value: allowedTools.value },
    { path: 'tools.deny', value: deniedTools.value },
  ]

  try {
    await configStore.patchConfig(patches)
    message.success('工具配置已保存')
  } catch {
    message.error('保存失败')
  }
}

// -- Session settings --
const sessionResetMode = ref('off')
const sessionResetHour = ref(6)
const sessionIdleMinutes = ref(30)
const queueMode = ref('sequential')

watch(
  () => configStore.config,
  (config) => {
    if (!config) return
    sessionResetMode.value = config.session?.reset?.mode || 'off'
    sessionResetHour.value = config.session?.reset?.hour ?? 6
    sessionIdleMinutes.value = config.session?.reset?.idleMinutes ?? 30
    queueMode.value = config.session?.queue?.mode || 'sequential'
  },
  { immediate: true }
)

async function saveSessionSettings() {
  const patches: ConfigPatch[] = [
    { path: 'session.reset.mode', value: sessionResetMode.value },
    { path: 'session.queue.mode', value: queueMode.value },
  ]
  if (sessionResetMode.value === 'daily') {
    patches.push({ path: 'session.reset.hour', value: sessionResetHour.value })
  }
  if (sessionResetMode.value === 'idle') {
    patches.push({ path: 'session.reset.idleMinutes', value: sessionIdleMinutes.value })
  }

  try {
    await configStore.patchConfig(patches)
    message.success('会话配置已保存')
  } catch {
    message.error('保存失败')
  }
}

async function handleApply() {
  try {
    await configStore.applyConfig()
    message.success('配置已应用，Gateway 将重新加载')
  } catch {
    message.error('应用失败')
  }
}

const modelOptions = [
  { label: 'Claude Sonnet 4.5', value: 'anthropic/claude-sonnet-4-5' },
  { label: 'Claude Opus 4', value: 'anthropic/claude-opus-4' },
  { label: 'Claude Haiku 3.5', value: 'anthropic/claude-haiku-3-5' },
  { label: 'GPT-4o', value: 'openai/gpt-4o' },
  { label: 'GPT-4o Mini', value: 'openai/gpt-4o-mini' },
]

const profileOptions = [
  { label: '最小 (minimal)', value: 'minimal' },
  { label: '编程 (coding)', value: 'coding' },
  { label: '完整 (full)', value: 'full' },
]

const resetModeOptions = [
  { label: '关闭', value: 'off' },
  { label: '每日重置', value: 'daily' },
  { label: '空闲重置', value: 'idle' },
]

const queueModeOptions = [
  { label: '顺序执行', value: 'sequential' },
  { label: '并发执行', value: 'concurrent' },
  { label: '批量收集', value: 'collect' },
]

function goToChannels() {
  router.push({ name: 'Channels' })
}
</script>

<template>
  <NSpin :show="configStore.loading">
    <NSpace vertical :size="16">
      <NCard title="openclaw.json 管理" style="border-radius: var(--radius-lg);">
        <template #header-extra>
          <NSpace :size="8">
            <NButton size="small" @click="configStore.fetchConfig()">
              <template #icon><NIcon :component="RefreshOutline" /></template>
              刷新
            </NButton>
            <NButton size="small" type="warning" @click="handleApply">
              应用并重载
            </NButton>
          </NSpace>
        </template>

        <NAlert type="info" :bordered="false" style="margin-top: 12px;">
          <NSpace justify="space-between" align="center">
            <span>频道账号、策略、认证配对、凭证更新已迁移到频道管理页集中维护，建议从该入口进行日常运维。</span>
            <NButton size="tiny" type="primary" ghost @click="goToChannels">
              <template #icon><NIcon :component="GitNetworkOutline" /></template>
              前往频道管理
            </NButton>
          </NSpace>
        </NAlert>

        <NTabs v-model:value="activeTab" type="line" animated>

          <!-- General -->
          <NTabPane name="general" tab="基本设置">
            <NForm label-placement="left" label-width="120" style="max-width: 600px; margin-top: 16px;">
              <NFormItem label="默认模型">
                <NSelect
                  v-model:value="primaryModel"
                  :options="modelOptions"
                  filterable
                  tag
                  placeholder="选择或输入模型"
                />
              </NFormItem>
              <NFormItem label="Gateway 端口">
                <NInputNumber v-model:value="gatewayPort" :min="1" :max="65535" />
              </NFormItem>
              <NFormItem label="工作区路径">
                <NInput v-model:value="workspace" placeholder="~/.openclaw/workspace" />
              </NFormItem>
              <NFormItem>
                <NButton type="primary" @click="saveGeneralSettings" :loading="configStore.saving">
                  <template #icon><NIcon :component="SaveOutline" /></template>
                  保存
                </NButton>
              </NFormItem>
            </NForm>
          </NTabPane>

          <!-- Tools -->
          <NTabPane name="tools" tab="工具策略">
            <NForm label-placement="left" label-width="120" style="max-width: 600px; margin-top: 16px;">
              <NFormItem label="工具配置">
                <NSelect v-model:value="toolProfile" :options="profileOptions" />
              </NFormItem>
              <NFormItem label="允许工具">
                <NDynamicTags v-model:value="allowedTools" />
              </NFormItem>
              <NFormItem label="禁止工具">
                <NDynamicTags v-model:value="deniedTools" />
              </NFormItem>
              <NFormItem>
                <NButton type="primary" @click="saveToolSettings" :loading="configStore.saving">
                  <template #icon><NIcon :component="SaveOutline" /></template>
                  保存
                </NButton>
              </NFormItem>
            </NForm>
          </NTabPane>

          <!-- Sessions -->
          <NTabPane name="sessions" tab="会话设置">
            <NForm label-placement="left" label-width="120" style="max-width: 600px; margin-top: 16px;">
              <NFormItem label="重置模式">
                <NSelect v-model:value="sessionResetMode" :options="resetModeOptions" />
              </NFormItem>
              <NFormItem v-if="sessionResetMode === 'daily'" label="重置时间 (UTC)">
                <NInputNumber v-model:value="sessionResetHour" :min="0" :max="23" />
              </NFormItem>
              <NFormItem v-if="sessionResetMode === 'idle'" label="空闲分钟数">
                <NInputNumber v-model:value="sessionIdleMinutes" :min="1" :max="1440" />
              </NFormItem>
              <NFormItem label="队列模式">
                <NSelect v-model:value="queueMode" :options="queueModeOptions" />
              </NFormItem>
              <NFormItem>
                <NButton type="primary" @click="saveSessionSettings" :loading="configStore.saving">
                  <template #icon><NIcon :component="SaveOutline" /></template>
                  保存
                </NButton>
              </NFormItem>
            </NForm>
          </NTabPane>

          <!-- Raw JSON -->
          <NTabPane name="raw" tab="原始 openclaw.json">
            <NAlert type="info" :bordered="false" style="margin: 16px 0 12px;">
              以下为当前 openclaw.json 的完整配置内容（只读查看）
            </NAlert>
            <NScrollbar style="max-height: 500px;">
              <NCode :code="rawJsonEdit" language="json" style="font-size: 13px;" />
            </NScrollbar>
          </NTabPane>
        </NTabs>
      </NCard>
    </NSpace>
  </NSpin>
</template>
