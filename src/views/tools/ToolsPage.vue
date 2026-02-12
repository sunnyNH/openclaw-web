<script setup lang="ts">
import { ref, onMounted, computed } from 'vue'
import {
  NCard,
  NDataTable,
  NButton,
  NSpace,
  NTag,
  NIcon,
  NInput,
  NSpin,
} from 'naive-ui'
import { RefreshOutline, SearchOutline } from '@vicons/ionicons5'
import { useWebSocketStore } from '@/stores/websocket'
import type { Tool } from '@/api/types'
import { h } from 'vue'

const wsStore = useWebSocketStore()
const tools = ref<Tool[]>([])
const loading = ref(false)
const searchQuery = ref('')

const filteredTools = computed(() => {
  if (!searchQuery.value) return tools.value
  const q = searchQuery.value.toLowerCase()
  return tools.value.filter(
    (t) => t.name.toLowerCase().includes(q) || t.description.toLowerCase().includes(q) || t.category.toLowerCase().includes(q)
  )
})

const columns = [
  {
    title: '工具名称',
    key: 'name',
    width: 160,
    render(row: Tool) {
      return h(
        'span',
        { style: 'font-weight: 500; font-family: monospace;' },
        row.name
      )
    },
  },
  {
    title: '分类',
    key: 'category',
    width: 100,
    render(row: Tool) {
      return h(NTag, { size: 'small', bordered: false, round: true }, { default: () => row.category })
    },
  },
  {
    title: '描述',
    key: 'description',
    ellipsis: { tooltip: true },
  },
  {
    title: '状态',
    key: 'enabled',
    width: 80,
    render(row: Tool) {
      return h(
        NTag,
        {
          type: row.enabled ? 'success' : 'default',
          size: 'small',
          bordered: false,
          round: true,
        },
        { default: () => (row.enabled ? '启用' : '禁用') }
      )
    },
  },
]

async function fetchTools() {
  loading.value = true
  try {
    tools.value = await wsStore.rpc.listTools()
  } catch {
    tools.value = []
  } finally {
    loading.value = false
  }
}

onMounted(fetchTools)
</script>

<template>
  <NCard title="工具管理" style="border-radius: var(--radius-lg);">
    <template #header-extra>
      <NSpace :size="8">
        <NInput
          v-model:value="searchQuery"
          placeholder="搜索工具..."
          size="small"
          clearable
          style="width: 200px;"
        >
          <template #prefix>
            <NIcon :component="SearchOutline" />
          </template>
        </NInput>
        <NButton size="small" @click="fetchTools">
          <template #icon><NIcon :component="RefreshOutline" /></template>
          刷新
        </NButton>
      </NSpace>
    </template>

    <NDataTable
      :columns="columns"
      :data="filteredTools"
      :loading="loading"
      :bordered="false"
      :pagination="{ pageSize: 20 }"
      :row-key="(row: Tool) => row.name"
      striped
    />
  </NCard>
</template>
