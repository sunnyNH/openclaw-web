<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import {
  NAlert,
  NCard,
  NGrid,
  NGridItem,
  NButton,
  NSpace,
  NTag,
  NText,
  NIcon,
  NInput,
  NSpin,
} from 'naive-ui'
import { RefreshOutline, SearchOutline } from '@vicons/ionicons5'
import { useSkillStore } from '@/stores/skill'
import type { Skill } from '@/api/types'

const skillStore = useSkillStore()
const searchQuery = ref('')

onMounted(() => {
  skillStore.fetchSkills()
})

function isUserPlugin(skill: Skill): boolean {
  return (
    skill.source === 'workspace' ||
    skill.source === 'managed' ||
    skill.source === 'extra'
  )
}

function matchesQuery(skill: Skill): boolean {
  const query = searchQuery.value.trim().toLowerCase()
  if (!query) return true

  return [
    skill.name,
    skill.description || '',
    skill.version || '',
  ].some((field) => field.toLowerCase().includes(query))
}

function sourceLabel(source: Skill['source']): string {
  switch (source) {
    case 'workspace': return '用户创建'
    case 'managed': return '用户安装'
    case 'extra': return '外部插件'
    case 'bundled': return '内置'
    default: return source
  }
}

function sourceType(source: Skill['source']): 'info' | 'success' | 'warning' {
  switch (source) {
    case 'workspace': return 'warning'
    case 'managed': return 'success'
    case 'extra': return 'info'
    case 'bundled': return 'info'
    default: return 'info'
  }
}

const userPlugins = computed(() => skillStore.skills.filter((skill) => isUserPlugin(skill)))
const visiblePlugins = computed(() => userPlugins.value.filter((skill) => matchesQuery(skill)))
const workspaceTotalPlugins = computed(() =>
  userPlugins.value.filter((skill) => skill.source === 'workspace')
)
const workspacePlugins = computed(() =>
  visiblePlugins.value.filter((skill) => skill.source === 'workspace')
)
const installedPlugins = computed(() =>
  visiblePlugins.value.filter((skill) => skill.source === 'managed' || skill.source === 'extra')
)
const installedTotalPlugins = computed(() =>
  userPlugins.value.filter((skill) => skill.source === 'managed' || skill.source === 'extra')
)
const bundledTotalPlugins = computed(() =>
  skillStore.skills.filter((skill) => skill.source === 'bundled')
)

const pluginGroups = computed(() => [
  {
    key: 'workspace',
    title: '我创建的插件',
    description: '来自 workspace，本地维护',
    emptyText: '当前没有用户创建插件',
    skills: workspacePlugins.value,
  },
  {
    key: 'installed',
    title: '我安装的插件',
    description: '来自托管源或额外目录，已被当前 OpenClaw 加载',
    emptyText: '当前没有用户安装插件',
    skills: installedPlugins.value,
  },
])
</script>

<template>
  <NSpace vertical :size="16">
    <NCard title="技能管理（我的插件）" class="app-card">
      <template #header-extra>
        <NSpace :size="8" class="app-toolbar">
          <NButton size="small" class="app-toolbar-btn app-toolbar-btn--refresh" @click="skillStore.fetchSkills()">
            <template #icon><NIcon :component="RefreshOutline" /></template>
            刷新
          </NButton>
        </NSpace>
      </template>

      <NSpace vertical :size="14">
        <NAlert type="info" :show-icon="true" style="border-radius: var(--radius);">
          仅展示 OpenClaw 用户自己创建与安装的插件，内置插件默认隐藏。
        </NAlert>
        <NAlert v-if="skillStore.error" type="error" :show-icon="true" style="border-radius: var(--radius);">
          技能数据加载失败：{{ skillStore.error }}
        </NAlert>

        <NGrid cols="1 s:3" responsive="screen" :x-gap="12" :y-gap="12">
          <NGridItem>
            <NCard embedded :bordered="false" style="border-radius: var(--radius);">
              <NText depth="3" style="font-size: 12px;">用户插件总数</NText>
              <div style="font-size: 22px; font-weight: 600; margin-top: 6px;">{{ userPlugins.length }}</div>
            </NCard>
          </NGridItem>
          <NGridItem>
            <NCard embedded :bordered="false" style="border-radius: var(--radius);">
              <NText depth="3" style="font-size: 12px;">我创建的插件</NText>
              <div style="font-size: 22px; font-weight: 600; margin-top: 6px;">{{ workspaceTotalPlugins.length }}</div>
            </NCard>
          </NGridItem>
          <NGridItem>
            <NCard embedded :bordered="false" style="border-radius: var(--radius);">
              <NText depth="3" style="font-size: 12px;">我安装的插件</NText>
              <div style="font-size: 22px; font-weight: 600; margin-top: 6px;">{{ installedTotalPlugins.length }}</div>
            </NCard>
          </NGridItem>
        </NGrid>

        <NInput v-model:value="searchQuery" clearable placeholder="搜索插件名称 / 描述 / 版本号">
          <template #prefix><NIcon :component="SearchOutline" /></template>
        </NInput>
        <NText v-if="userPlugins.length === 0 && skillStore.skills.length > 0" depth="3" style="font-size: 12px;">
          网关共返回 {{ skillStore.skills.length }} 个技能，其中内置 {{ bundledTotalPlugins.length }} 个。
        </NText>
      </NSpace>

      <NSpin :show="skillStore.loading" style="margin-top: 16px;">
        <NSpace vertical :size="14">
          <NCard
            v-for="group in pluginGroups"
            :key="group.key"
            embedded
            :bordered="false"
            style="border-radius: var(--radius);"
          >
            <NSpace justify="space-between" align="center" style="margin-bottom: 10px;">
              <NSpace vertical :size="2">
                <NText strong>{{ group.title }}</NText>
                <NText depth="3" style="font-size: 12px;">{{ group.description }}</NText>
              </NSpace>
              <NTag size="small" round :bordered="false">{{ group.skills.length }} 个</NTag>
            </NSpace>

            <NGrid v-if="group.skills.length > 0" cols="1 s:2 m:3" responsive="screen" :x-gap="12" :y-gap="12">
              <NGridItem v-for="skill in group.skills" :key="`${group.key}-${skill.name}`">
                <NCard hoverable style="border-radius: var(--radius);">
                  <NSpace vertical :size="10">
                    <NSpace justify="space-between" align="center">
                      <NText strong style="font-size: 15px;">{{ skill.name }}</NText>
                      <NSpace :size="6">
                        <NTag :type="sourceType(skill.source)" size="tiny" :bordered="false" round>
                          {{ sourceLabel(skill.source) }}
                        </NTag>
                        <NTag v-if="skill.hasUpdate" type="warning" size="tiny" :bordered="false" round>
                          有更新
                        </NTag>
                      </NSpace>
                    </NSpace>

                    <NText v-if="skill.description" depth="3" style="font-size: 13px; line-height: 1.5;">
                      {{ skill.description }}
                    </NText>
                    <NText v-else depth="3" style="font-size: 13px;">暂无描述</NText>

                    <NSpace justify="space-between" align="center">
                      <NText depth="3" style="font-size: 12px;">
                        {{ skill.version ? `v${skill.version}` : '未标注版本' }}
                      </NText>
                      <NTag
                        :type="skill.eligible === false ? 'warning' : 'success'"
                        size="small"
                        :bordered="false"
                        round
                      >
                        {{ skill.eligible === false ? '缺依赖/受限' : '可用' }}
                      </NTag>
                    </NSpace>
                  </NSpace>
                </NCard>
              </NGridItem>
            </NGrid>

            <div
              v-else
              style="text-align: center; padding: 28px 12px; color: var(--text-secondary); font-size: 13px;"
            >
              {{ group.emptyText }}
            </div>
          </NCard>
        </NSpace>

        <div
          v-if="!skillStore.loading && visiblePlugins.length === 0"
          style="text-align: center; padding: 56px 0; color: var(--text-secondary);"
        >
          没有匹配的用户插件
        </div>
      </NSpin>
    </NCard>
  </NSpace>
</template>
