<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import {
  NAlert,
  NButton,
  NCard,
  NDivider,
  NEllipsis,
  NEmpty,
  NIcon,
  NInput,
  NSelect,
  NSpace,
  NTag,
  NText,
  useMessage,
} from 'naive-ui'
import type { SelectOption } from 'naive-ui'
import {
  BookOutline,
  CreateOutline,
  DocumentTextOutline,
  RefreshOutline,
  SaveOutline,
  SparklesOutline,
} from '@vicons/ionicons5'
import { formatDate } from '@/utils/format'
import { useMemoryStore } from '@/stores/memory'

type DocGroupKey = 'role' | 'runtime' | 'memory' | 'other'
type DocRisk = 'high' | 'normal'

type DocMeta = {
  label: string
  group: DocGroupKey
  description: string
  risk: DocRisk
}

type DocEntry = {
  name: string
  path: string
  missing: boolean
  size?: number
  updatedAtMs?: number
  label: string
  group: DocGroupKey
  description: string
  risk: DocRisk
}

type Snippet = {
  label: string
  content: string
}

const DOC_GROUP_LABELS: Record<DocGroupKey, string> = {
  role: '角色与人格',
  runtime: '运行与策略',
  memory: '记忆与偏好',
  other: '其他',
}

const DOC_META_MAP: Record<string, DocMeta> = {
  'AGENTS.md': {
    label: 'AGENTS',
    group: 'role',
    description: '主行为规则与约束（高影响）',
    risk: 'high',
  },
  'SOUL.md': {
    label: 'SOUL',
    group: 'role',
    description: '人格、语气与风格（高影响）',
    risk: 'high',
  },
  'IDENTITY.md': {
    label: 'IDENTITY',
    group: 'role',
    description: '名称、头像、主题等身份',
    risk: 'normal',
  },
  'USER.md': {
    label: 'USER',
    group: 'memory',
    description: '用户偏好与沟通约定',
    risk: 'normal',
  },
  'TOOLS.md': {
    label: 'TOOLS',
    group: 'runtime',
    description: '工具使用说明（不控制可用性）',
    risk: 'normal',
  },
  'HEARTBEAT.md': {
    label: 'HEARTBEAT',
    group: 'runtime',
    description: '心跳回合任务提示',
    risk: 'normal',
  },
  'BOOTSTRAP.md': {
    label: 'BOOTSTRAP',
    group: 'runtime',
    description: '启动注入上下文（高影响）',
    risk: 'high',
  },
  'MEMORY.md': {
    label: 'MEMORY',
    group: 'memory',
    description: '长期稳定事实与偏好',
    risk: 'normal',
  },
  'memory.md': {
    label: 'memory',
    group: 'memory',
    description: '长期稳定事实与偏好',
    risk: 'normal',
  },
}

const memoryStore = useMemoryStore()
const message = useMessage()
const editorContent = ref('')
const isEditing = ref(false)

function isMemoryAliasName(name: string): boolean {
  return name.trim().toLowerCase() === 'memory.md'
}

function isSameDocName(left: string, right: string): boolean {
  if (left === right) return true
  return isMemoryAliasName(left) && isMemoryAliasName(right)
}

function shouldReplaceDoc(current: DocEntry, next: DocEntry): boolean {
  if (current.missing !== next.missing) return current.missing

  const currentUpdated = current.updatedAtMs || 0
  const nextUpdated = next.updatedAtMs || 0
  if (currentUpdated !== nextUpdated) return nextUpdated > currentUpdated

  const currentSize = current.size || 0
  const nextSize = next.size || 0
  if (currentSize !== nextSize) return nextSize > currentSize

  if (current.name === 'MEMORY.md') return false
  if (next.name === 'MEMORY.md') return true
  return false
}

const agentOptions = computed<SelectOption[]>(() =>
  memoryStore.agents.map((agent) => ({
    label: agent.identity?.name || agent.name || agent.id,
    value: agent.id,
  }))
)

const docEntries = computed<DocEntry[]>(() => {
  const deduped = new Map<string, DocEntry>()
  for (const file of memoryStore.docFiles) {
    const meta = DOC_META_MAP[file.name]
    const entry: DocEntry = {
      name: file.name,
      path: file.path,
      missing: file.missing,
      size: file.size,
      updatedAtMs: file.updatedAtMs,
      label: meta?.label || file.name,
      group: meta?.group || 'other',
      description: meta?.description || '未分类文档',
      risk: meta?.risk || 'normal',
    }
    const key = isMemoryAliasName(entry.name) ? 'memory.md' : entry.name
    const existing = deduped.get(key)
    if (!existing || shouldReplaceDoc(existing, entry)) {
      deduped.set(key, entry)
    }
  }
  return Array.from(deduped.values())
})

const groupedDocs = computed<Array<{ key: DocGroupKey; label: string; items: DocEntry[] }>>(() => {
  const groups: Record<DocGroupKey, DocEntry[]> = {
    role: [],
    runtime: [],
    memory: [],
    other: [],
  }
  for (const item of docEntries.value) {
    groups[item.group].push(item)
  }
  return (Object.keys(groups) as DocGroupKey[])
    .map((key) => ({
      key,
      label: DOC_GROUP_LABELS[key],
      items: groups[key],
    }))
    .filter((group) => group.items.length > 0)
})

const loading = computed(
  () => memoryStore.loadingAgents || memoryStore.loadingFiles || memoryStore.loadingFileContent
)
const activeFile = computed(() => memoryStore.activeFile)
const activeDoc = computed<DocEntry | null>(() => {
  const selected = activeFile.value?.name || memoryStore.selectedFileName
  if (!selected) return null
  return docEntries.value.find((item) => isSameDocName(item.name, selected)) || null
})

const hasUnsavedChanges = computed(() => editorContent.value !== memoryStore.currentContent)
const charCount = computed(() => editorContent.value.length)
const lineCount = computed(() => (editorContent.value ? editorContent.value.split(/\r?\n/).length : 0))
const previewHtml = computed(() => renderSimpleMarkdown(memoryStore.currentContent || ''))

const fileStateLabel = computed(() => {
  if (!activeFile.value) return '未加载'
  return activeFile.value.missing ? '未创建' : '已存在'
})

const fileStateType = computed<'warning' | 'success'>(() => {
  if (!activeFile.value || activeFile.value.missing) return 'warning'
  return 'success'
})

const fileUpdatedText = computed(() =>
  activeFile.value?.updatedAtMs ? formatDate(activeFile.value.updatedAtMs) : '未创建'
)

const fileSizeText = computed(() => formatBytes(activeFile.value?.size))

const docCount = computed(() => docEntries.value.length)
const highRiskDocCount = computed(() => docEntries.value.filter((item) => item.risk === 'high').length)

const snippets = computed<Snippet[]>(() => {
  const fileName = memoryStore.selectedFileName
  const common = [
    {
      label: '事实记录',
      content: ['## 事实记录', '- 背景：', '- 决策：', '- 结论：'].join('\n'),
    },
  ]

  if (fileName === 'AGENTS.md') {
    return [
      {
        label: '行为原则',
        content: ['## 行为原则', '- 目标：', '- 约束：', '- 禁止事项：'].join('\n'),
      },
      ...common,
    ]
  }

  if (fileName === 'SOUL.md') {
    return [
      {
        label: '人格设定',
        content: ['## 人格设定', '- 语气：', '- 风格：', '- 行事准则：'].join('\n'),
      },
      ...common,
    ]
  }

  if (fileName === 'BOOTSTRAP.md') {
    return [
      {
        label: '启动约束',
        content: ['## 启动约束', '- 目标：', '- 当前环境：', '- 首轮执行策略：'].join('\n'),
      },
      ...common,
    ]
  }

  if (fileName === 'USER.md') {
    return [
      {
        label: '用户偏好',
        content: ['## 用户偏好', '- 偏好输出：', '- 禁忌：', '- 语气偏好：'].join('\n'),
      },
      ...common,
    ]
  }

  if (fileName === 'HEARTBEAT.md') {
    return [
      {
        label: '心跳任务',
        content: ['## Tasks', '- [ ] 每日检查运行状态', '- [ ] 清理异常任务'].join('\n'),
      },
      ...common,
    ]
  }

  return [
    {
      label: '偏好模板',
      content: ['## 偏好', '- 输出风格：', '- 禁用项：', '- 沟通节奏：'].join('\n'),
    },
    {
      label: '项目约定',
      content: ['## 项目约定', '- 分支规范：', '- 发布流程：', '- 验证标准：'].join('\n'),
    },
    ...common,
  ]
})

watch(
  () => memoryStore.currentContent,
  (value) => {
    editorContent.value = value
  },
  { immediate: true }
)

onMounted(async () => {
  try {
    await memoryStore.initialize()
  } catch (error) {
    message.warning(error instanceof Error ? error.message : '记忆模块初始化失败')
  }
})

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

function renderInlineMarkdown(value: string): string {
  return value
    .replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g, '<a href="$2" target="_blank" rel="noreferrer">$1</a>')
    .replace(/`([^`\n]+?)`/g, '<code>$1</code>')
    .replace(/\*\*([^*]+?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*([^*]+?)\*/g, '<em>$1</em>')
}

function renderSimpleMarkdown(markdown: string): string {
  const normalized = markdown.replace(/\r\n/g, '\n')
  if (!normalized.trim()) {
    return '<p class="memory-markdown-empty">当前文件为空，点击“编辑文档”开始维护内容。</p>'
  }

  const codeBlocks: string[] = []
  const source = normalized.replace(/```([^\n]*)\n([\s\S]*?)```/g, (_raw, lang: string, code: string) => {
    const langText = lang?.trim()
    const codeHtml = `<pre><code${langText ? ` data-lang="${escapeHtml(langText)}"` : ''}>${escapeHtml(code)}</code></pre>`
    const token = `@@CODE_BLOCK_${codeBlocks.length}@@`
    codeBlocks.push(codeHtml)
    return token
  })

  const lines = source.split('\n')
  const output: string[] = []
  let inUnorderedList = false
  let inOrderedList = false
  let inBlockquote = false

  const closeLists = () => {
    if (inUnorderedList) {
      output.push('</ul>')
      inUnorderedList = false
    }
    if (inOrderedList) {
      output.push('</ol>')
      inOrderedList = false
    }
  }

  const closeBlockquote = () => {
    if (inBlockquote) {
      output.push('</blockquote>')
      inBlockquote = false
    }
  }

  const closeAllBlocks = () => {
    closeLists()
    closeBlockquote()
  }

  for (const line of lines) {
    const trimmed = line.trim()
    const normalizedListLine = trimmed.replace(/^[•·●▪◦‣⁃]\s*/u, '- ')

    if (/^@@CODE_BLOCK_\d+@@$/.test(trimmed)) {
      closeAllBlocks()
      output.push(trimmed)
      continue
    }

    if (!trimmed) {
      closeAllBlocks()
      continue
    }

    const headingMatch = trimmed.match(/^(#{1,6})\s+(.+)$/)
    if (headingMatch) {
      closeAllBlocks()
      const headingMarks = headingMatch[1] || '#'
      const headingText = headingMatch[2] || ''
      const level = headingMarks.length
      const content = renderInlineMarkdown(escapeHtml(headingText))
      output.push(`<h${level}>${content}</h${level}>`)
      continue
    }

    const hrSource = trimmed.replace(/\s+/g, '')
    if (/^([-*_])\1{2,}$/.test(hrSource)) {
      closeAllBlocks()
      output.push('<hr />')
      continue
    }

    const quoteMatch = trimmed.match(/^>\s?(.*)$/)
    if (quoteMatch) {
      closeLists()
      if (!inBlockquote) {
        output.push('<blockquote>')
        inBlockquote = true
      }
      const quoteText = quoteMatch[1] || ''
      output.push(`<p>${renderInlineMarkdown(escapeHtml(quoteText))}</p>`)
      continue
    }
    closeBlockquote()

    const unorderedMatch = normalizedListLine.match(/^[-*+]\s*(.+)$/)
    if (unorderedMatch) {
      if (inOrderedList) {
        output.push('</ol>')
        inOrderedList = false
      }
      if (!inUnorderedList) {
        output.push('<ul>')
        inUnorderedList = true
      }
      const unorderedText = unorderedMatch[1] || ''
      output.push(`<li>${renderInlineMarkdown(escapeHtml(unorderedText))}</li>`)
      continue
    }

    const orderedMatch = trimmed.match(/^\d+\.\s+(.+)$/)
    if (orderedMatch) {
      if (inUnorderedList) {
        output.push('</ul>')
        inUnorderedList = false
      }
      if (!inOrderedList) {
        output.push('<ol>')
        inOrderedList = true
      }
      const orderedText = orderedMatch[1] || ''
      output.push(`<li>${renderInlineMarkdown(escapeHtml(orderedText))}</li>`)
      continue
    }

    closeLists()
    output.push(`<p>${renderInlineMarkdown(escapeHtml(trimmed))}</p>`)
  }

  closeAllBlocks()
  return output
    .join('\n')
    .replace(/@@CODE_BLOCK_(\d+)@@/g, (_raw, index: string) => codeBlocks[Number(index)] || '')
}

function formatBytes(value?: number): string {
  if (!value || value <= 0) return '-'
  if (value < 1024) return `${value} B`
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`
  return `${(value / (1024 * 1024)).toFixed(1)} MB`
}

function confirmDiscardIfNeeded(): boolean {
  if (!isEditing.value || !hasUnsavedChanges.value) return true
  return window.confirm('当前有未保存修改，切换后将丢失。确认继续吗？')
}

function handleStartEdit() {
  isEditing.value = true
  editorContent.value = memoryStore.currentContent
}

function handleCancelEdit() {
  editorContent.value = memoryStore.currentContent
  isEditing.value = false
}

function handleResetEditor() {
  editorContent.value = memoryStore.currentContent
  message.info('已恢复为最近加载内容')
}

function appendSnippet(text: string) {
  if (!isEditing.value) {
    handleStartEdit()
  }
  const prefix = editorContent.value.trim() ? '\n\n' : ''
  editorContent.value = `${editorContent.value}${prefix}${text}`.trim()
}

function insertTodayTemplate() {
  const dateText = new Date()
    .toLocaleDateString('zh-CN', { year: 'numeric', month: '2-digit', day: '2-digit' })
    .replace(/\//g, '-')
  appendSnippet(`## ${dateText}\n- `)
}

async function handleSwitchAgent(agentId: string) {
  if (!agentId || (agentId === memoryStore.selectedAgentId && activeFile.value)) return
  if (!confirmDiscardIfNeeded()) return
  try {
    isEditing.value = false
    await memoryStore.switchAgent(agentId)
  } catch (error) {
    message.error(error instanceof Error ? error.message : '切换 Agent 失败')
  }
}

async function handleSelectDoc(name: string) {
  if (!name || name === memoryStore.selectedFileName) return
  if (!confirmDiscardIfNeeded()) return
  try {
    isEditing.value = false
    await memoryStore.loadFile(name)
  } catch (error) {
    message.error(error instanceof Error ? error.message : '加载文档失败')
  }
}

async function handleRefresh() {
  if (!confirmDiscardIfNeeded()) return
  try {
    isEditing.value = false
    await memoryStore.refresh()
    message.success('文档已刷新')
  } catch (error) {
    message.error(error instanceof Error ? error.message : '刷新失败')
  }
}

async function handleSave() {
  if (!memoryStore.selectedAgentId || !memoryStore.selectedFileName) {
    message.warning('请先选择 Agent 与文档')
    return
  }
  if (activeDoc.value?.risk === 'high') {
    const confirmed = window.confirm(`正在保存高影响文档 ${memoryStore.selectedFileName}，确认继续？`)
    if (!confirmed) return
  }
  try {
    await memoryStore.saveFile(editorContent.value, memoryStore.selectedFileName)
    message.success('文档已保存')
    isEditing.value = false
  } catch (error) {
    message.error(error instanceof Error ? error.message : '保存失败')
  }
}

function isActiveDoc(name: string): boolean {
  return isSameDocName(name, memoryStore.selectedFileName)
}
</script>

<template>
  <div class="memory-page">
    <NCard class="memory-hero" :bordered="false">
      <template #header>
        <div class="memory-hero-title">记忆与文档管理</div>
      </template>
      <template #header-extra>
        <NSpace :size="8">
          <NButton size="small" :loading="loading" @click="handleRefresh">
            <template #icon><NIcon :component="RefreshOutline" /></template>
            刷新
          </NButton>
          <NButton v-if="!isEditing" size="small" type="primary" tertiary @click="handleStartEdit">
            <template #icon><NIcon :component="CreateOutline" /></template>
            编辑文档
          </NButton>
          <NButton v-else size="small" @click="handleCancelEdit">
            取消编辑
          </NButton>
          <NButton v-if="isEditing" size="small" type="primary" :loading="memoryStore.saving" @click="handleSave">
            <template #icon><NIcon :component="SaveOutline" /></template>
            保存文档
          </NButton>
        </NSpace>
      </template>

      <NSpace vertical :size="10">
        <NAlert type="info" :show-icon="true" :bordered="false">
          覆盖 OpenClaw 官方可管理文档：<code>AGENTS</code>、<code>SOUL</code>、<code>IDENTITY</code>、
          <code>USER</code>、<code>TOOLS</code>、<code>HEARTBEAT</code>、<code>BOOTSTRAP</code>、
          <code>MEMORY</code>。
        </NAlert>
        <NAlert v-if="memoryStore.lastError" type="warning" :show-icon="true" :bordered="false">
          当前网关可能不支持 <code>agents.files.*</code> 或权限受限：{{ memoryStore.lastError }}
        </NAlert>
      </NSpace>

      <div class="memory-toolbar">
        <NSelect
          :value="memoryStore.selectedAgentId"
          :options="agentOptions"
          :loading="memoryStore.loadingAgents"
          placeholder="选择 Agent"
          @update:value="(value) => handleSwitchAgent(String(value || ''))"
        />
        <div class="memory-stats-inline">
          <span>{{ docCount }} 个文档</span>
          <span>高影响 {{ highRiskDocCount }} 个</span>
          <span>当前 {{ memoryStore.selectedFileName || '-' }}</span>
        </div>
        <NSpace :size="6">
          <NTag size="small" :type="fileStateType" :bordered="false" round>
            {{ fileStateLabel }}
          </NTag>
          <NTag v-if="activeDoc?.risk === 'high'" size="small" type="error" :bordered="false" round>
            高影响
          </NTag>
          <NTag v-if="isEditing && hasUnsavedChanges" size="small" type="warning" :bordered="false" round>
            未保存
          </NTag>
        </NSpace>
      </div>
    </NCard>

    <section class="memory-layout">
      <NCard class="memory-card memory-nav-card" :bordered="false">
        <template #header>
          <NSpace :size="6" align="center">
            <NIcon :component="BookOutline" />
            <NText strong>文档目录</NText>
          </NSpace>
        </template>

        <div class="memory-doc-list">
          <template v-if="groupedDocs.length > 0">
            <section v-for="group in groupedDocs" :key="group.key" class="memory-doc-group">
              <header class="memory-doc-group-title">{{ group.label }}</header>
              <div class="memory-doc-items">
                <button
                  v-for="item in group.items"
                  :key="item.name"
                  type="button"
                  class="memory-doc-item"
                  :class="{ active: isActiveDoc(item.name) }"
                  @click="handleSelectDoc(item.name)"
                >
                  <div class="memory-doc-item-title">
                    <span>{{ item.label }}</span>
                    <NTag
                      size="small"
                      :bordered="false"
                      :type="item.missing ? 'warning' : 'success'"
                      class="memory-doc-item-state"
                    >
                      {{ item.missing ? '未创建' : '已存在' }}
                    </NTag>
                  </div>
                  <div class="memory-doc-item-name">{{ item.name }}</div>
                  <div class="memory-doc-item-desc">
                    <NEllipsis :line-clamp="1">{{ item.description }}</NEllipsis>
                  </div>
                </button>
              </div>
            </section>
          </template>
          <NEmpty v-else description="暂无可管理文档" />
        </div>
      </NCard>

      <div class="memory-main-column">
        <NCard class="memory-card" :bordered="false">
          <template #header>
            <div class="memory-main-header">
              <NSpace :size="6" align="center">
                <NIcon :component="DocumentTextOutline" />
                <NText strong>{{ activeDoc?.label || memoryStore.selectedFileName || '未选择文档' }}</NText>
                <NText depth="3">{{ memoryStore.selectedFileName || '-' }}</NText>
              </NSpace>
              <NText depth="3" style="font-size: 12px;">{{ lineCount }} 行 · {{ charCount }} 字符</NText>
            </div>
          </template>

          <template v-if="isEditing">
            <NInput
              v-model:value="editorContent"
              class="memory-editor"
              type="textarea"
              :autosize="{ minRows: 20, maxRows: 30 }"
              placeholder="以 Markdown 维护文档。空内容保存将写入空文件。"
            />
            <div class="memory-editor-footer">
              <NText depth="3">保存后将写入当前 Agent 工作区文档。</NText>
              <NSpace :size="8">
                <NButton size="small" @click="handleResetEditor">恢复</NButton>
                <NButton size="small" @click="handleCancelEdit">取消</NButton>
                <NButton size="small" type="primary" :loading="memoryStore.saving" @click="handleSave">保存</NButton>
              </NSpace>
            </div>
          </template>

          <template v-else>
            <div class="memory-markdown" v-html="previewHtml"></div>
            <div class="memory-editor-footer">
              <NText depth="3">当前为阅读模式，点击“编辑文档”进入可写状态。</NText>
              <NButton size="small" type="primary" tertiary @click="handleStartEdit">
                <template #icon><NIcon :component="CreateOutline" /></template>
                编辑文档
              </NButton>
            </div>
          </template>
        </NCard>

        <NCard class="memory-card" :bordered="false">
          <template #header>
            <NSpace :size="6" align="center">
              <NIcon :component="SparklesOutline" />
              <NText strong>文档信息</NText>
            </NSpace>
          </template>

          <div class="memory-meta-grid">
            <div class="memory-meta-item">
              <NText depth="3">工作区</NText>
              <code><NEllipsis>{{ memoryStore.workspace || '-' }}</NEllipsis></code>
            </div>
            <div class="memory-meta-item">
              <NText depth="3">文件路径</NText>
              <code><NEllipsis>{{ activeDoc?.path || activeFile?.path || '-' }}</NEllipsis></code>
            </div>
            <div class="memory-meta-item">
              <NText depth="3">更新时间</NText>
              <div>{{ fileUpdatedText }}</div>
            </div>
            <div class="memory-meta-item">
              <NText depth="3">文件大小</NText>
              <div>{{ fileSizeText }}</div>
            </div>
          </div>

          <NDivider title-placement="left">模板片段</NDivider>
          <NSpace :size="6" wrap>
            <NButton
              v-for="snippet in snippets"
              :key="snippet.label"
              size="small"
              tertiary
              type="primary"
              @click="appendSnippet(snippet.content)"
            >
              {{ snippet.label }}
            </NButton>
            <NButton size="small" tertiary @click="insertTodayTemplate">插入今日模板</NButton>
          </NSpace>

          <NText depth="3" style="display: block; margin-top: 10px; font-size: 12px;">
            每日流水记忆默认写入 <code>memory/YYYY-MM-DD.md</code>。本页聚焦官方可管理核心文档。
          </NText>
        </NCard>
      </div>
    </section>
  </div>
</template>

<style scoped>
.memory-page {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.memory-hero {
  border-radius: var(--radius-lg);
  background:
    radial-gradient(circle at 84% 14%, rgba(24, 160, 88, 0.15), transparent 36%),
    linear-gradient(125deg, var(--bg-card), rgba(32, 128, 240, 0.08));
  border: 1px solid rgba(24, 160, 88, 0.14);
}

.memory-hero-title {
  font-size: 18px;
  font-weight: 700;
  line-height: 1.2;
}

.memory-toolbar {
  margin-top: 10px;
  display: grid;
  grid-template-columns: minmax(220px, 320px) 1fr auto;
  gap: 8px;
  align-items: center;
}

.memory-stats-inline {
  min-width: 0;
  padding: 8px 10px;
  border: 1px solid var(--border-color);
  border-radius: 10px;
  background: var(--bg-primary);
  color: var(--text-secondary);
  font-size: 12px;
  display: flex;
  gap: 14px;
  white-space: nowrap;
  overflow: auto;
}

.memory-layout {
  display: grid;
  grid-template-columns: minmax(260px, 320px) minmax(0, 1fr);
  gap: 12px;
  align-items: start;
}

.memory-main-column {
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.memory-card {
  border-radius: var(--radius-lg);
}

.memory-nav-card {
  min-height: auto;
}

.memory-doc-list {
  max-height: none;
  overflow: visible;
  padding-right: 0;
}

.memory-doc-group + .memory-doc-group {
  margin-top: 14px;
}

.memory-doc-group-title {
  font-size: 12px;
  color: var(--text-tertiary);
  margin-bottom: 8px;
  padding-left: 2px;
}

.memory-doc-items {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.memory-doc-item {
  width: 100%;
  text-align: left;
  padding: 10px 10px;
  border-radius: 10px;
  border: 1px solid var(--border-color);
  background: var(--bg-primary);
  color: inherit;
  transition: all 0.18s ease;
  cursor: pointer;
}

.memory-doc-item:hover {
  border-color: rgba(32, 128, 240, 0.35);
  transform: translateY(-1px);
}

.memory-doc-item.active {
  border-color: rgba(32, 128, 240, 0.6);
  background: rgba(32, 128, 240, 0.08);
  box-shadow: inset 0 0 0 1px rgba(32, 128, 240, 0.24);
}

.memory-doc-item-title {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  font-weight: 600;
}

.memory-doc-item-state {
  flex-shrink: 0;
}

.memory-doc-item-name {
  font-size: 12px;
  margin-top: 2px;
  color: var(--text-secondary);
}

.memory-doc-item-desc {
  margin-top: 4px;
  color: var(--text-secondary);
  font-size: 12px;
}

.memory-main-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}

.memory-editor :deep(.n-input__textarea-el) {
  font-size: 13px;
  line-height: 1.55;
}

.memory-markdown {
  min-height: 460px;
  max-height: min(64vh, 760px);
  overflow: auto;
  border: 1px solid var(--border-color);
  border-radius: 10px;
  padding: 14px;
  background: var(--bg-primary);
}

.memory-markdown > :first-child {
  margin-top: 0;
}

.memory-markdown h1,
.memory-markdown h2,
.memory-markdown h3,
.memory-markdown h4,
.memory-markdown h5,
.memory-markdown h6 {
  margin: 14px 0 8px;
  line-height: 1.35;
}

.memory-markdown h1 {
  font-size: 20px;
}

.memory-markdown h2 {
  font-size: 17px;
}

.memory-markdown h3 {
  font-size: 15px;
}

.memory-markdown h4 {
  font-size: 14px;
}

.memory-markdown h5,
.memory-markdown h6 {
  font-size: 13px;
}

.memory-markdown p {
  margin: 6px 0;
  line-height: 1.7;
}

.memory-markdown ul {
  margin: 8px 0 8px 0.7em;
  padding-left: 0;
  list-style: none;
  line-height: 1.7;
}

.memory-markdown ol {
  margin: 8px 0 8px 1.35em;
  padding-left: 1.1em;
  list-style-position: outside;
  line-height: 1.7;
}

.memory-markdown li {
  margin: 4px 0;
}

.memory-markdown ul > li {
  position: relative;
  padding-left: 1.05em;
}

.memory-markdown ul > li::before {
  content: '•';
  position: absolute;
  left: 0;
  top: 0;
  color: var(--text-secondary);
  font-size: 0.95em;
  line-height: 1.7;
}

.memory-markdown ol > li::marker {
  color: var(--text-secondary);
  font-size: 0.9em;
}

.memory-markdown blockquote {
  margin: 10px 0;
  padding: 8px 12px;
  border-left: 3px solid var(--success-color);
  background: rgba(24, 160, 88, 0.08);
  border-radius: 0 6px 6px 0;
}

.memory-markdown pre {
  margin: 10px 0;
  padding: 12px;
  border-radius: 8px;
  background: rgba(16, 24, 40, 0.86);
  color: #e8eef8;
  overflow: auto;
}

.memory-markdown code {
  font-family: 'SFMono-Regular', Menlo, Monaco, Consolas, 'Liberation Mono', 'Courier New', monospace;
  font-size: 12px;
}

.memory-markdown p code,
.memory-markdown li code {
  padding: 1px 6px;
  border-radius: 4px;
  background: rgba(16, 24, 40, 0.08);
}

.memory-markdown a {
  color: var(--primary-color);
  text-decoration: none;
}

.memory-markdown a:hover {
  text-decoration: underline;
}

.memory-markdown hr {
  border: 0;
  border-top: 1px dashed var(--border-color);
  margin: 12px 0;
}

.memory-markdown-empty {
  color: var(--text-secondary);
}

.memory-editor-footer {
  margin-top: 10px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
}

.memory-meta-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 10px;
}

.memory-meta-item {
  display: flex;
  flex-direction: column;
  gap: 4px;
  min-width: 0;
}

.memory-meta-item code {
  display: inline-block;
  min-width: 0;
}

@media (max-width: 1200px) {
  .memory-layout {
    grid-template-columns: 1fr;
  }

  .memory-nav-card {
    min-height: auto;
  }

  .memory-doc-list {
    max-height: none;
  }

  .memory-main-column {
    max-height: none;
  }
}

@media (max-width: 1024px) {
  .memory-toolbar {
    grid-template-columns: 1fr;
    align-items: stretch;
  }

  .memory-stats-inline {
    gap: 10px;
  }

  .memory-main-header {
    flex-direction: column;
    align-items: flex-start;
  }

  .memory-meta-grid {
    grid-template-columns: 1fr;
  }

  .memory-editor-footer {
    flex-direction: column;
    align-items: stretch;
  }
}
</style>
