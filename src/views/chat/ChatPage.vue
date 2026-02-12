<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, reactive, ref, watch } from 'vue'
import {
  NAlert,
  NButton,
  NCard,
  NEmpty,
  NForm,
  NFormItem,
  NGrid,
  NGridItem,
  NIcon,
  NInput,
  NModal,
  NPopconfirm,
  NSelect,
  NSpace,
  NSpin,
  NSwitch,
  NTag,
  NText,
  useMessage,
} from 'naive-ui'
import type { SelectOption } from 'naive-ui'
import { RefreshOutline, SendOutline } from '@vicons/ionicons5'
import { useChatStore } from '@/stores/chat'
import { useConfigStore } from '@/stores/config'
import { useSessionStore } from '@/stores/session'
import { useSkillStore } from '@/stores/skill'
import { useWebSocketStore } from '@/stores/websocket'
import { formatDate, formatRelativeTime, parseSessionKey, truncate } from '@/utils/format'
import { renderSimpleMarkdown } from '@/utils/markdown'
import type { ChatMessage, Skill } from '@/api/types'

const message = useMessage()
const chatStore = useChatStore()
const configStore = useConfigStore()
const sessionStore = useSessionStore()
const skillStore = useSkillStore()
const wsStore = useWebSocketStore()

const sessionKeyInput = ref('')
const draft = ref('')
const roleFilter = ref<'all' | 'user' | 'assistant' | 'tool' | 'system'>('all')
const autoFollowBottom = ref(true)
const transcriptRef = ref<HTMLElement | null>(null)
const quickReplySearch = ref('')
const showQuickReplyModal = ref(false)
const quickReplyModalMode = ref<'create' | 'edit'>('create')
const editingQuickReplyId = ref('')
const quickReplyForm = reactive({
  title: '',
  content: '',
})

const roleFilterOptions: SelectOption[] = [
  { label: '全部角色', value: 'all' },
  { label: '仅用户', value: 'user' },
  { label: '仅助手', value: 'assistant' },
  { label: '仅工具', value: 'tool' },
  { label: '仅系统', value: 'system' },
]

const BOTTOM_GAP = 32
const QUICK_REPLY_STORAGE_KEY = 'openclaw_chat_quick_replies_v1'
let pendingForceScroll = false
let pendingScroll = false
let destroyed = false
const quickReplies = ref<Array<{
  id: string
  title: string
  content: string
  updatedAt: number
}>>([])

const sessionOptions = computed(() =>
  sessionStore.sessions.map((session) => ({
    label: session.key,
    value: session.key,
  }))
)

const normalizedSessionKey = computed(() => sessionKeyInput.value.trim() || 'main')
const selectedSession = computed(() =>
  sessionStore.sessions.find((session) => session.key === normalizedSessionKey.value) || null
)
const sessionMeta = computed(() => parseSessionKey(normalizedSessionKey.value))
const sessionChannelDisplay = computed(() => {
  const channel = selectedSession.value?.channel?.trim().toLowerCase() || ''
  if (!channel || channel === 'unknown') return sessionMeta.value.channel
  return channel
})

const messageList = computed(() => chatStore.messages)
const filteredMessages = computed(() => {
  const role = roleFilter.value
  if (role === 'all') return messageList.value
  return messageList.value.filter((item) => item.role === role)
})

interface ToolCallItemView {
  id?: string
  name: string
  command?: string
  workdir?: string
  timeout?: number
  partialJson?: string
}

interface ThinkingItemView {
  type?: string
  text: string
  signatureId?: string
  summaryText?: string
  hasEncryptedSignature: boolean
}

interface ToolResultItemView {
  id?: string
  name?: string
  status?: string
  content: string
}

interface ToolValidationErrorItemView {
  toolName: string
  issues: string[]
  argumentsText?: string
}

interface StructuredMessageView {
  toolCalls: ToolCallItemView[]
  thinkings: ThinkingItemView[]
  toolResults: ToolResultItemView[]
  validationErrors: ToolValidationErrorItemView[]
  plainTexts: string[]
}

interface RenderMessage {
  key: string
  item: ChatMessage
  structured: StructuredMessageView | null
}

interface SlashCommandPreset {
  command: string
  usage?: string
  description: string
  category: '常用' | '会话' | '模型与上下文' | '执行与权限'
  aliases?: string[]
  expectArgs?: boolean
  requiresFlag?: string
}

interface ConfiguredModelOption {
  modelRef: string
  providerId: string
  modelId: string
}

interface SlashSuggestionItem {
  kind: 'command' | 'skill' | 'model'
  key: string
  preset?: SlashCommandPreset
  skill?: Skill
  model?: ConfiguredModelOption
}

// 基于 OpenClaw 官方 docs/tools/slash-commands.md 维护的常用命令清单
const slashCommandPresets: SlashCommandPreset[] = [
  {
    command: '/new',
    usage: '[model]',
    description: '重置并启动新会话，可选指定模型',
    category: '会话',
    expectArgs: true,
  },
  {
    command: '/skill',
    usage: '<name> [input]',
    description: '执行技能（自动提示你的技能列表）',
    category: '模型与上下文',
    expectArgs: true,
  },
  {
    command: '/model',
    usage: '<name|list|status>',
    aliases: ['/models'],
    description: '查看或切换模型',
    category: '模型与上下文',
    expectArgs: true,
  },
]
const transcriptLoading = computed(() => chatStore.loading && messageList.value.length === 0)
const refreshingChatData = computed(() => sessionStore.loading || chatStore.loading)
const syncHint = computed(() => {
  if (chatStore.syncing) return '实时同步中...'
  if (chatStore.lastSyncedAt) {
    return `已同步 ${formatDate(chatStore.lastSyncedAt)}`
  }
  return '未同步'
})
const syncTagType = computed<'default' | 'success' | 'warning' | 'info'>(() => {
  if (chatStore.syncing) return 'info'
  if (chatStore.lastError) return 'warning'
  if (chatStore.lastSyncedAt) return 'success'
  return 'default'
})

const stats = computed(() => {
  const list = messageList.value
  let user = 0
  let assistant = 0
  let tool = 0
  let system = 0

  for (const item of list) {
    if (item.role === 'user') user += 1
    else if (item.role === 'assistant') assistant += 1
    else if (item.role === 'tool') tool += 1
    else if (item.role === 'system') system += 1
  }

  const last = list.length > 0 ? list[list.length - 1] : null
  return {
    total: list.length,
    user,
    assistant,
    tool,
    system,
    lastMessageAt: last?.timestamp ? formatRelativeTime(last.timestamp) : '-',
  }
})

const renderedMessages = computed<RenderMessage[]>(() =>
  filteredMessages.value.map((item, idx) => {
    const structured = parseStructuredMessage(item.content)
    return {
      key: item.id || `${item.role}-${idx}`,
      item,
      structured,
    }
  })
)

const filteredQuickReplies = computed(() => {
  const query = quickReplySearch.value.trim().toLowerCase()
  const list = [...quickReplies.value].sort((a, b) => b.updatedAt - a.updatedAt)
  if (!query) return list
  return list.filter((item) =>
    [item.title, item.content].some((field) => field.toLowerCase().includes(query))
  )
})

const workspaceRoot = computed(() => configStore.config?.agents?.defaults?.workspace || '~/.openclaw/workspace')
const workspaceQuickReplyDir = computed(() => {
  const root = workspaceRoot.value.endsWith('/') ? workspaceRoot.value.slice(0, -1) : workspaceRoot.value
  return `${root}/prompts/common-replies`
})

const selectedSlashCommandIndex = ref(0)
const slashFirstLine = computed(() => (draft.value.split('\n')[0] || '').trimStart())
const slashMode = computed(() => slashFirstLine.value.startsWith('/'))
const slashHasArgs = computed(() => {
  if (!slashMode.value) return false
  const content = slashFirstLine.value.slice(1)
  return /[\s:]/.test(content)
})
const slashCommandKeyword = computed(() => {
  if (!slashMode.value) return ''
  const content = slashFirstLine.value.slice(1)
  const token = content.split(/[\s:]/)[0] || ''
  return token.toLowerCase()
})
const slashCommandOptions = computed<SlashCommandPreset[]>(() => {
  if (!slashMode.value) return []
  const query = slashCommandKeyword.value
  if (!query) return slashCommandPresets
  return slashCommandPresets.filter((item) => {
    const primary = item.command.slice(1).toLowerCase()
    if (primary.includes(query)) return true
    return (item.aliases || []).some((alias) => alias.slice(1).toLowerCase().includes(query))
  })
})
const slashSkillMode = computed(() => slashMode.value && slashCommandKeyword.value === 'skill')
const slashModelMode = computed(() =>
  slashMode.value && (slashCommandKeyword.value === 'model' || slashCommandKeyword.value === 'models')
)

function isUserSkill(skill: Skill): boolean {
  return skill.source === 'workspace' || skill.source === 'managed' || skill.source === 'extra'
}

function skillSourceLabel(source: Skill['source']): string {
  if (source === 'workspace') return '用户创建'
  if (source === 'managed') return '用户安装'
  if (source === 'extra') return '外部插件'
  return '内置'
}

const userSkills = computed(() =>
  skillStore.skills
    .filter((skill) => isUserSkill(skill))
    .filter((skill) => !skill.disabled)
    .sort((a, b) => a.name.localeCompare(b.name))
)

const slashSkillNameQuery = computed(() => {
  if (!slashSkillMode.value) return ''
  const args = normalizeSlashArguments(slashFirstLine.value)
  const firstToken = args.split(/\s+/)[0] || ''
  return firstToken.toLowerCase()
})

const slashSkillOptions = computed<Skill[]>(() => {
  if (!slashSkillMode.value) return []
  const query = slashSkillNameQuery.value
  if (!query) return userSkills.value
  return userSkills.value.filter((skill) =>
    [skill.name, skill.description || ''].some((field) => field.toLowerCase().includes(query))
  )
})

function splitModelRef(value: string): ConfiguredModelOption | null {
  const text = value.trim()
  const slashIndex = text.indexOf('/')
  if (slashIndex <= 0 || slashIndex >= text.length - 1) return null
  const providerId = text.slice(0, slashIndex).trim()
  const modelId = text.slice(slashIndex + 1).trim()
  if (!providerId || !modelId) return null
  return {
    modelRef: `${providerId}/${modelId}`,
    providerId,
    modelId,
  }
}

function collectConfiguredModelRefs(input: unknown, refs: Set<string>) {
  if (!input) return

  if (typeof input === 'string') {
    const parsed = splitModelRef(input)
    if (parsed) refs.add(parsed.modelRef)
    return
  }

  if (Array.isArray(input)) {
    for (const item of input) {
      collectConfiguredModelRefs(item, refs)
    }
    return
  }

  const row = asRecord(input)
  if (!row) return

  for (const candidate of [row.id, row.model, row.ref, row.primary]) {
    if (typeof candidate === 'string') {
      const parsed = splitModelRef(candidate)
      if (parsed) refs.add(parsed.modelRef)
    }
  }

  for (const [key, value] of Object.entries(row)) {
    const keyParsed = splitModelRef(key)
    if (keyParsed) refs.add(keyParsed.modelRef)
    if (typeof value === 'string') {
      const valueParsed = splitModelRef(value)
      if (valueParsed) refs.add(valueParsed.modelRef)
    }
  }
}

function extractProviderModelIds(value: unknown): string[] {
  if (!value) return []

  if (Array.isArray(value)) {
    const ids: string[] = []
    for (const item of value) {
      if (typeof item === 'string' && item.trim()) {
        ids.push(item.trim())
        continue
      }
      const row = asRecord(item)
      if (!row) continue
      const id =
        (typeof row.id === 'string' && row.id.trim()) ||
        (typeof row.name === 'string' && row.name.trim()) ||
        ''
      if (id) ids.push(id)
    }
    return ids
  }

  const mapRow = asRecord(value)
  if (!mapRow) return []
  const ids: string[] = []
  for (const [key, item] of Object.entries(mapRow)) {
    const normalizedKey = key.trim()
    if (!normalizedKey) continue

    if (typeof item === 'string' && item.trim()) {
      ids.push(item.trim())
      continue
    }

    const row = asRecord(item)
    if (row) {
      const id =
        (typeof row.id === 'string' && row.id.trim()) ||
        (typeof row.name === 'string' && row.name.trim()) ||
        normalizedKey
      ids.push(id)
      continue
    }

    ids.push(normalizedKey)
  }
  return ids
}

function collectConfiguredModelRefsFromProviders(input: unknown, refs: Set<string>) {
  const providers = asRecord(input)
  if (!providers) return

  for (const [providerIdRaw, providerValue] of Object.entries(providers)) {
    const providerId = providerIdRaw.trim()
    if (!providerId) continue
    const provider = asRecord(providerValue)
    if (!provider) continue

    const candidates = [provider.models, provider.modelIds, provider.availableModels, provider.whitelist]
    for (const candidate of candidates) {
      const ids = extractProviderModelIds(candidate)
      for (const id of ids) {
        const parsed = splitModelRef(id)
        if (parsed) {
          refs.add(parsed.modelRef)
        } else if (id.trim()) {
          refs.add(`${providerId}/${id.trim()}`)
        }
      }
    }
  }
}

const configuredModelOptions = computed<ConfiguredModelOption[]>(() => {
  const refs = new Set<string>()
  const defaultsRaw = asRecord(configStore.config?.agents?.defaults)
  const defaultsModelRaw = asRecord(defaultsRaw?.model)

  collectConfiguredModelRefs(configStore.config?.models?.primary, refs)
  collectConfiguredModelRefs(configStore.config?.models?.fallback, refs)
  collectConfiguredModelRefs(defaultsRaw?.models, refs)
  collectConfiguredModelRefs(defaultsModelRaw?.primary, refs)
  collectConfiguredModelRefs(defaultsModelRaw?.fallback, refs)
  collectConfiguredModelRefs(defaultsModelRaw?.fallbacks, refs)
  collectConfiguredModelRefsFromProviders(configStore.config?.models?.providers, refs)

  return Array.from(refs)
    .sort((a, b) => a.localeCompare(b))
    .map((ref) => splitModelRef(ref))
    .filter((item): item is ConfiguredModelOption => !!item)
})

const slashModelQuery = computed(() => {
  if (!slashModelMode.value) return ''
  const args = normalizeSlashArguments(slashFirstLine.value)
  const firstToken = args.split(/\s+/)[0] || ''
  return firstToken.toLowerCase()
})

const slashModelOptions = computed<ConfiguredModelOption[]>(() => {
  if (!slashModelMode.value) return []
  const query = slashModelQuery.value
  const list = configuredModelOptions.value
  if (!query) return list
  return list.filter((model) =>
    [model.modelRef, model.providerId, model.modelId].some((field) => field.toLowerCase().includes(query))
  )
})

const slashSuggestions = computed<SlashSuggestionItem[]>(() => {
  if (!slashMode.value) return []
  if (slashSkillMode.value) {
    return slashSkillOptions.value.map((skill) => ({
      kind: 'skill',
      key: `skill-${skill.name}`,
      skill,
    }))
  }
  if (slashModelMode.value) {
    return slashModelOptions.value.map((model) => ({
      kind: 'model',
      key: `model-${model.modelRef}`,
      model,
    }))
  }
  return slashCommandOptions.value.map((preset) => ({
    kind: 'command',
    key: `cmd-${preset.command}`,
    preset,
  }))
})

const activeSlashSuggestion = computed(() => {
  if (slashSuggestions.value.length === 0) return null
  const safeIndex = Math.min(
    Math.max(selectedSlashCommandIndex.value, 0),
    slashSuggestions.value.length - 1
  )
  return slashSuggestions.value[safeIndex]
})

const eventCleanups: Array<() => void> = []

function ensureSessionKey(): string {
  const normalized = sessionKeyInput.value.trim() || 'main'
  sessionKeyInput.value = normalized
  return normalized
}

async function loadHistoryForKey(rawKey: string, options?: { force?: boolean }) {
  const key = rawKey.trim() || 'main'
  sessionKeyInput.value = key

  const shouldSkip =
    !options?.force &&
    key === chatStore.sessionKey &&
    !chatStore.loading &&
    !chatStore.syncing
  if (shouldSkip) return

  chatStore.setSessionKey(key)
  await chatStore.fetchHistory(key)
  await nextTick()
  autoFollowBottom.value = true
  requestScrollToBottom({ force: true })
}

function normalizeSessionSelectValue(value: string | number | null): string {
  if (typeof value === 'string') return value.trim()
  if (typeof value === 'number') return String(value).trim()
  return ''
}

function handleSessionKeyChange(value: string | number | null) {
  const key = normalizeSessionSelectValue(value)
  if (!key) return
  void loadHistoryForKey(key, { force: true })
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

function looksLikeMarkdown(value: string): boolean {
  const text = value.replace(/\r\n/g, '\n')
  if (!text.trim()) return false
  if (/```[\s\S]*```/.test(text)) return true
  if (/\[[^\]]+]\((https?:\/\/[^)\s]+)\)/.test(text)) return true
  if (/(^|\s)\*\*[^*\n]+\*\*(\s|$)/.test(text)) return true
  if (/(^|\s)\*[^*\n]+\*(\s|$)/.test(text)) return true
  if (/^\s{0,3}#{1,6}\s+\S+/m.test(text)) return true
  if (/^\s{0,3}>\s+\S+/m.test(text)) return true
  if (/^\s{0,3}[-*+]\s+\S+/m.test(text)) return true
  if (/^\s{0,3}[-*_]{3,}\s*$/m.test(text)) return true
  return false
}

function renderPlainText(content: string): string {
  const escaped = escapeHtml(content || '')
  return `<p>${escaped.replace(/\n/g, '<br />')}</p>`
}

function renderChatMarkdown(content: string, role?: ChatMessage['role']): string {
  const text = content || ''
  if (!looksLikeMarkdown(text)) {
    return renderPlainText(text)
  }
  const autoNestList = role === 'assistant' || role === 'tool' || role === 'system'
  return renderSimpleMarkdown(text, { autoNestList })
}

function isNearBottom(): boolean {
  const el = transcriptRef.value
  if (!el) return true
  const distance = el.scrollHeight - el.scrollTop - el.clientHeight
  return distance <= BOTTOM_GAP
}

function handleTranscriptScroll() {
  autoFollowBottom.value = isNearBottom()
}

function looksLikeStreamingPayload(payload: unknown): boolean {
  const queue: Array<{ value: unknown; depth: number }> = [{ value: payload, depth: 0 }]
  const visited = new Set<unknown>()
  const maxDepth = 4

  while (queue.length > 0) {
    const current = queue.shift()
    if (!current) continue
    if (current.depth > maxDepth) continue

    const value = current.value
    if (!value || typeof value !== 'object') continue
    if (visited.has(value)) continue
    visited.add(value)

    if (!Array.isArray(value)) {
      const row = value as Record<string, unknown>
      if (
        'delta' in row ||
        'chunk' in row ||
        'partial' in row ||
        'stream' in row ||
        'streaming' in row
      ) {
        return true
      }
      const kind = typeof row.type === 'string' ? row.type.toLowerCase() : ''
      if (kind.includes('delta') || kind.includes('chunk') || kind.includes('stream')) {
        return true
      }

      for (const child of Object.values(row)) {
        if (child && typeof child === 'object') {
          queue.push({ value: child, depth: current.depth + 1 })
        }
      }
      continue
    }

    for (const child of value) {
      if (child && typeof child === 'object') {
        queue.push({ value: child, depth: current.depth + 1 })
      }
    }
  }

  return false
}

function scrollToBottom(options?: { force?: boolean }) {
  const el = transcriptRef.value
  if (!el) return

  const force = options?.force ?? false
  if (!force && !autoFollowBottom.value) return

  el.scrollTop = el.scrollHeight
}

function requestScrollToBottom(options?: { force?: boolean }) {
  const force = options?.force ?? false
  if (!force && !autoFollowBottom.value) return
  if (force) pendingForceScroll = true
  if (pendingScroll) return

  pendingScroll = true
  const schedule =
    typeof queueMicrotask === 'function' ? queueMicrotask : (fn: () => void) => Promise.resolve().then(fn)
  schedule(() => {
    pendingScroll = false
    if (destroyed) return
    const forceNow = pendingForceScroll
    pendingForceScroll = false
    scrollToBottom({ force: forceNow })
  })
}

function cancelPendingScroll() {
  destroyed = true
  pendingForceScroll = false
  pendingScroll = false
}

function roleType(role: string): 'default' | 'success' | 'info' | 'warning' {
  if (role === 'user') return 'info'
  if (role === 'assistant') return 'success'
  if (role === 'tool') return 'warning'
  return 'default'
}

function roleLabel(role: string): string {
  if (role === 'user') return '用户'
  if (role === 'assistant') return '助手'
  if (role === 'tool') return '工具'
  if (role === 'system') return '系统'
  return role
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return value as Record<string, unknown>
  }
  return null
}

function asString(value: unknown): string {
  if (typeof value === 'string') return value
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)
  return ''
}

function asText(value: unknown): string {
  if (typeof value === 'string') return value
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)
  if (Array.isArray(value)) {
    return value
      .map((item) => asText(item))
      .filter((item) => !!item.trim())
      .join('\n')
  }
  const row = asRecord(value)
  if (row) {
    if ('text' in row) return asText(row.text)
    if ('content' in row) return asText(row.content)
    if ('message' in row) return asText(row.message)
    if ('output' in row) return asText(row.output)
    try {
      return JSON.stringify(row, null, 2)
    } catch {
      return ''
    }
  }
  return ''
}

function asNumber(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string' && value.trim()) {
    const parsed = Number(value)
    if (Number.isFinite(parsed)) return parsed
  }
  return undefined
}

function stripCodeFence(text: string): string {
  const value = text.trim()
  if (!value.startsWith('```') || !value.endsWith('```')) return value
  const lines = value.split('\n')
  if (lines.length < 2) return value
  return lines.slice(1, -1).join('\n').trim()
}

function decodeEscapedJsonText(text: string): string | null {
  const normalized = text.trim()
  if (!normalized.includes('\\"')) return null
  try {
    const wrapped = `"${normalized.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`
    const decoded = JSON.parse(wrapped)
    if (typeof decoded === 'string' && decoded.trim()) {
      return decoded.trim()
    }
  } catch {
    return null
  }
  return null
}

function looksLikeJsonString(value: string): boolean {
  const text = value.trim()
  if (!text) return false
  return (
    text.startsWith('{') ||
    text.startsWith('[') ||
    text.startsWith('{\\') ||
    text.startsWith('[\\') ||
    (text.startsWith('"') && text.endsWith('"'))
  )
}

function unwrapJsonValue(value: unknown, depth = 0): unknown {
  if (depth > 3) return value
  if (typeof value !== 'string') return value
  const text = value.trim()
  if (!looksLikeJsonString(text)) return value
  try {
    const parsed = JSON.parse(text)
    return unwrapJsonValue(parsed, depth + 1)
  } catch {
    return value
  }
}

function parseSingleJsonValue(text: string): unknown | null {
  const normalized = text.trim()
  if (!normalized) return null

  const candidates: string[] = [normalized]
  const decoded = decodeEscapedJsonText(normalized)
  if (decoded && decoded !== normalized) {
    candidates.push(decoded)
  }

  for (const candidate of candidates) {
    try {
      return unwrapJsonValue(JSON.parse(candidate))
    } catch {
      // try next
    }
  }

  return null
}

function parseJsonItems(content: string): { items: unknown[]; plainLines: string[] } | null {
  const normalized = stripCodeFence(content).trim()
  if (!normalized) return null

  const rawItems: unknown[] = []
  const plainLines: string[] = []
  const parsed = parseSingleJsonValue(normalized)
  if (parsed != null) {
    if (Array.isArray(parsed)) {
      for (const item of parsed) {
        rawItems.push(unwrapJsonValue(item))
      }
    } else {
      rawItems.push(parsed)
    }
    return {
      items: rawItems,
      plainLines,
    }
  }

  const lines = normalized
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
  if (!lines.length) return null
  for (const line of lines) {
    const parsedLine = parseSingleJsonValue(line)
    if (parsedLine == null) {
      plainLines.push(line)
      continue
    }
    if (Array.isArray(parsedLine)) {
      for (const item of parsedLine) {
        rawItems.push(unwrapJsonValue(item))
      }
      continue
    }
    rawItems.push(parsedLine)
  }

  if (!rawItems.length) return null
  return {
    items: rawItems,
    plainLines,
  }
}

function parseThinkingSignature(value: unknown): {
  signatureId?: string
  summaryText?: string
  hasEncryptedSignature: boolean
} {
  const raw = asString(value).trim()
  if (!raw) {
    return {
      hasEncryptedSignature: false,
    }
  }

  try {
    const parsed = unwrapJsonValue(JSON.parse(raw))
    const row = asRecord(parsed)
    if (!row) {
      return {
        hasEncryptedSignature: false,
      }
    }
    const signatureId = asString(row.id) || undefined
    const summaryArray = Array.isArray(row.summary) ? row.summary : []
    let summaryText = ''
    for (const item of summaryArray) {
      const text = asText(item).trim()
      if (text) {
        summaryText = text
        break
      }
    }
    const encrypted = asString(row.encrypted_content)
    return {
      signatureId,
      summaryText: summaryText || undefined,
      hasEncryptedSignature: !!encrypted,
    }
  } catch {
    return {
      hasEncryptedSignature: false,
    }
  }
}

function parseToolValidationError(content: string): ToolValidationErrorItemView | null {
  const normalized = stripCodeFence(content).trim()
  if (!normalized) return null

  const lines = normalized.split('\n')
  const headerIndex = lines.findIndex((line) => /validation failed for tool/i.test(line))
  if (headerIndex < 0) return null

  const header = lines[headerIndex]?.trim() || ''
  const toolMatch = header.match(/validation failed for tool\s+["'`]?(.+?)["'`]?:?\s*$/i)
  const toolName = toolMatch?.[1]?.trim() || 'unknown'

  const argsMarkerIndex = lines.findIndex((line, idx) => {
    if (idx <= headerIndex) return false
    return /^\s*received arguments\s*:?\s*$/i.test(line)
  })

  const issueSliceEnd = argsMarkerIndex >= 0 ? argsMarkerIndex : lines.length
  const issues = lines
    .slice(headerIndex + 1, issueSliceEnd)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => line.replace(/^-\s*/, '').trim())
    .filter(Boolean)

  let argumentsText = ''
  if (argsMarkerIndex >= 0) {
    const rawArguments = lines.slice(argsMarkerIndex + 1).join('\n').trim()
    const normalizedArguments = stripCodeFence(rawArguments).trim()
    if (rawArguments) {
      const parsedArgs = parseSingleJsonValue(normalizedArguments || rawArguments)
      if (parsedArgs == null) {
        argumentsText = normalizedArguments || rawArguments
      } else if (typeof parsedArgs === 'string') {
        argumentsText = parsedArgs
      } else {
        try {
          argumentsText = JSON.stringify(parsedArgs, null, 2)
        } catch {
          argumentsText = rawArguments
        }
      }
    }
  }

  if (!toolName && issues.length === 0 && !argumentsText) return null
  return {
    toolName,
    issues,
    argumentsText: argumentsText || undefined,
  }
}

function parseStructuredMessage(content: string): StructuredMessageView | null {
  const parsed = parseJsonItems(content)
  if (!parsed?.items.length) {
    const validationError = parseToolValidationError(content)
    if (!validationError) return null
    return {
      toolCalls: [],
      thinkings: [],
      toolResults: [],
      validationErrors: [validationError],
      plainTexts: [],
    }
  }
  const rawItems = parsed.items

  const toolCalls: ToolCallItemView[] = []
  const thinkings: ThinkingItemView[] = []
  const toolResults: ToolResultItemView[] = []
  let recognized = 0

  for (const rowValue of rawItems) {
    const row = asRecord(unwrapJsonValue(rowValue))
    if (!row) continue
    const typeRaw = asString(row.type).toLowerCase()
    const type = typeRaw ||
      ('thinking' in row || 'thinkingSignature' in row
        ? 'thinking'
        : ('arguments' in row && ('name' in row || 'tool' in row) ? 'toolcall' : ''))

    if (type === 'toolcall' || type === 'tool_call') {
      const args = asRecord(row.arguments)
      toolCalls.push({
        id: asString(row.id) || undefined,
        name: asString(row.name) || 'unknown',
        command: args ? asString(args.command) || undefined : undefined,
        workdir: args ? asString(args.workdir) || undefined : undefined,
        timeout: args ? asNumber(args.timeout) : undefined,
        partialJson: asString(row.partialJson) || undefined,
      })
      recognized += 1
      continue
    }

    if (type === 'thinking' || type === 'reasoning') {
      const text = asText(row.thinking ?? row.text ?? row.message).trim()
      if (!text) continue
      const signature = parseThinkingSignature(row.thinkingSignature ?? row.signature)
      thinkings.push({
        type: type || undefined,
        text,
        signatureId: signature.signatureId,
        summaryText: signature.summaryText,
        hasEncryptedSignature: signature.hasEncryptedSignature,
      })
      recognized += 1
      continue
    }

    if (type === 'toolresult' || type === 'tool_result') {
      const text = asText(row.content ?? row.output ?? row.result ?? row.message).trim()
      if (!text) continue
      toolResults.push({
        id: asString(row.id) || undefined,
        name: asString(row.name || row.tool || row.toolName) || undefined,
        status: asString(row.status || row.state) || undefined,
        content: text,
      })
      recognized += 1
      continue
    }
  }

  if (!recognized) return null
  return {
    toolCalls,
    thinkings,
    toolResults,
    validationErrors: [],
    plainTexts: parsed.plainLines,
  }
}

function loadQuickReplies() {
  try {
    const raw = localStorage.getItem(QUICK_REPLY_STORAGE_KEY)
    if (!raw) {
      quickReplies.value = []
      return
    }
    const parsed = JSON.parse(raw)
    if (!Array.isArray(parsed)) {
      quickReplies.value = []
      return
    }
    quickReplies.value = parsed
      .map((item) => {
        if (!item || typeof item !== 'object' || Array.isArray(item)) return null
        const row = item as Record<string, unknown>
        const title = asString(row.title).trim()
        const content = asString(row.content).trim()
        if (!title || !content) return null
        const id = asString(row.id).trim() || `quick-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
        const updatedAt = asNumber(row.updatedAt) || Date.now()
        return {
          id,
          title,
          content,
          updatedAt,
        }
      })
      .filter((item): item is { id: string; title: string; content: string; updatedAt: number } => !!item)
  } catch {
    quickReplies.value = []
  }
}

function persistQuickReplies() {
  localStorage.setItem(QUICK_REPLY_STORAGE_KEY, JSON.stringify(quickReplies.value))
}

function resetQuickReplyForm() {
  quickReplyForm.title = ''
  quickReplyForm.content = ''
}

function openCreateQuickReply() {
  quickReplyModalMode.value = 'create'
  editingQuickReplyId.value = ''
  resetQuickReplyForm()
  showQuickReplyModal.value = true
}

function openEditQuickReply(item: { id: string; title: string; content: string }) {
  quickReplyModalMode.value = 'edit'
  editingQuickReplyId.value = item.id
  quickReplyForm.title = item.title
  quickReplyForm.content = item.content
  showQuickReplyModal.value = true
}

function handleDeleteQuickReply(id: string) {
  quickReplies.value = quickReplies.value.filter((item) => item.id !== id)
  persistQuickReplies()
  message.success('已删除常用对话')
}

function handleInsertQuickReply(item: { title: string; content: string }) {
  const text = item.content.trim()
  if (!text) return
  draft.value = draft.value.trim() ? `${draft.value}\n${text}` : text
  message.success(`已插入：${item.title}`)
}

async function handleSendQuickReply(item: { content: string }) {
  draft.value = item.content
  await handleSend()
}

function handleSaveQuickReply() {
  const title = quickReplyForm.title.trim()
  const content = quickReplyForm.content.trim()
  if (!title) {
    message.warning('请输入常用对话标题')
    return
  }
  if (!content) {
    message.warning('请输入常用对话内容')
    return
  }

  if (quickReplyModalMode.value === 'edit' && editingQuickReplyId.value) {
    quickReplies.value = quickReplies.value.map((item) =>
      item.id === editingQuickReplyId.value
        ? { ...item, title, content, updatedAt: Date.now() }
        : item
    )
    message.success('常用对话已更新')
  } else {
    quickReplies.value = [
      {
        id: `quick-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        title,
        content,
        updatedAt: Date.now(),
      },
      ...quickReplies.value,
    ]
    message.success('常用对话已新增')
  }

  persistQuickReplies()
  showQuickReplyModal.value = false
}

async function handleCopyWorkspaceDir() {
  try {
    await navigator.clipboard.writeText(workspaceQuickReplyDir.value)
    message.success('已复制 workspace 建议目录')
  } catch {
    message.warning('复制失败，请手动复制目录路径')
  }
}

function normalizeSlashArguments(line: string): string {
  const trimmed = line.trimStart()
  const matched = trimmed.match(/^\/[^\s:]+(?::|\s+)?(.*)$/)
  if (!matched) return ''
  return matched[1]?.trim() || ''
}

function splitFirstToken(value: string): { first: string; rest: string } {
  const text = value.trim()
  if (!text) return { first: '', rest: '' }
  const parts = text.split(/\s+/)
  const [first = '', ...rest] = parts
  return {
    first,
    rest: rest.join(' '),
  }
}

function buildSlashCommandLine(command: SlashCommandPreset): string {
  const args = normalizeSlashArguments(slashFirstLine.value)
  if (args) return `${command.command} ${args}`
  if (command.expectArgs) return `${command.command} `
  return command.command
}

function applySlashCommand(command: SlashCommandPreset) {
  const lines = draft.value.split('\n')
  lines[0] = buildSlashCommandLine(command)
  draft.value = lines.join('\n')
}

function applySlashSkill(skill: Skill) {
  const lines = draft.value.split('\n')
  const args = normalizeSlashArguments(slashFirstLine.value)
  const { rest } = splitFirstToken(args)
  lines[0] = rest ? `/skill ${skill.name} ${rest}` : `/skill ${skill.name} `
  draft.value = lines.join('\n')
}

function applySlashModel(model: ConfiguredModelOption) {
  const lines = draft.value.split('\n')
  const args = normalizeSlashArguments(slashFirstLine.value)
  const { rest } = splitFirstToken(args)
  const modelRef = model.modelRef
  lines[0] = rest ? `/model ${modelRef} ${rest}` : `/model ${modelRef}`
  draft.value = lines.join('\n')
}

function applySlashSuggestion(item: SlashSuggestionItem) {
  if (item.kind === 'skill' && item.skill) {
    applySlashSkill(item.skill)
    return
  }
  if (item.kind === 'model' && item.model) {
    applySlashModel(item.model)
    return
  }
  if (item.kind === 'command' && item.preset) {
    applySlashCommand(item.preset)
  }
}

function moveSlashSuggestionSelection(step: number) {
  const size = slashSuggestions.value.length
  if (!size) return
  selectedSlashCommandIndex.value = (selectedSlashCommandIndex.value + step + size) % size
}

async function handleDraftKeydown(event: KeyboardEvent) {
  const isEnter = event.key === 'Enter'
  const canSend = !event.shiftKey && !event.isComposing

  if (slashMode.value && slashSuggestions.value.length > 0) {
    if (event.key === 'ArrowDown') {
      event.preventDefault()
      moveSlashSuggestionSelection(1)
      return
    }
    if (event.key === 'ArrowUp') {
      event.preventDefault()
      moveSlashSuggestionSelection(-1)
      return
    }
    if (event.key === 'Tab') {
      event.preventDefault()
      const item = activeSlashSuggestion.value
      if (item) {
        applySlashSuggestion(item)
      }
      return
    }
    if (isEnter && canSend) {
      event.preventDefault()
      const item = activeSlashSuggestion.value
      if (!item) return

      if (item.kind === 'skill' && item.skill) {
        const args = normalizeSlashArguments(slashFirstLine.value)
        const { first } = splitFirstToken(args)
        if (first && first.toLowerCase() === item.skill.name.toLowerCase()) {
          await handleSend()
          return
        }
        applySlashSkill(item.skill)
        return
      }

      if (item.kind === 'model' && item.model) {
        const args = normalizeSlashArguments(slashFirstLine.value)
        const { first } = splitFirstToken(args)
        const modelRef = item.model.modelRef.toLowerCase()
        if (first && first.toLowerCase() === modelRef) {
          await handleSend()
          return
        }
        applySlashModel(item.model)
        return
      }

      if (item.kind === 'command' && item.preset) {
        if (!slashHasArgs.value) {
          const exact = slashFirstLine.value.trim() === item.preset.command
          if (exact) {
            await handleSend()
            return
          }
          applySlashCommand(item.preset)
          return
        }
        await handleSend()
      }
      return
    }
    if (event.key === 'Escape') {
      event.preventDefault()
      draft.value = draft.value.replace(/^\s*\/+/, '')
      return
    }
  }

  if ((event.metaKey || event.ctrlKey) && isEnter) {
    event.preventDefault()
    await handleSend()
    return
  }

  if (isEnter && canSend) {
    event.preventDefault()
    await handleSend()
  }
}

watch(
  slashSuggestions,
  (list) => {
    if (!list.length) {
      selectedSlashCommandIndex.value = 0
      return
    }
    if (selectedSlashCommandIndex.value >= list.length) {
      selectedSlashCommandIndex.value = 0
    }
  },
  { immediate: true }
)

watch(slashMode, (value) => {
  if (value) {
    selectedSlashCommandIndex.value = 0
  }
})

watch(slashCommandKeyword, () => {
  selectedSlashCommandIndex.value = 0
})

const messageSignature = computed(() => {
  const list = messageList.value
  const last = list.length > 0 ? list[list.length - 1] : null
  const lastContentLength = last?.content ? last.content.length : 0
  return `${list.length}|${last?.id || ''}|${last?.role || ''}|${last?.timestamp || ''}|${lastContentLength}`
})

watch(
  messageSignature,
  async (next, prev) => {
    if (next === prev) return
    requestScrollToBottom()
  },
  { flush: 'post' }
)

onMounted(async () => {
  loadQuickReplies()
  void configStore.fetchConfig()
  void skillStore.fetchSkills()

  eventCleanups.push(
    wsStore.subscribe('event', (evt: unknown) => {
      const data = evt as { event?: string; payload?: unknown }
      const eventName = data.event || ''
      if (
        eventName === 'chat' ||
        eventName.startsWith('chat.') ||
        eventName === 'agent' ||
        eventName.startsWith('agent.') ||
        eventName.startsWith('tool.') ||
        eventName.startsWith('model.')
      ) {
        const name = eventName.toLowerCase()
        const isStreamingEvent =
          name.includes('stream') ||
          name.includes('delta') ||
          name.includes('chunk') ||
          name.includes('partial') ||
          looksLikeStreamingPayload(data.payload)
        chatStore.handleRealtimeEvent(data.payload, {
          refreshHistory: false,
          streaming: isStreamingEvent,
        })
      }
    })
  )

  await sessionStore.fetchSessions()
  const currentStoreKey = chatStore.sessionKey.trim()
  if (!sessionKeyInput.value && currentStoreKey) {
    sessionKeyInput.value = currentStoreKey
  }

  const firstSession = sessionStore.sessions[0]
  if (!sessionKeyInput.value && firstSession) {
    sessionKeyInput.value = firstSession.key
  }

  await loadHistoryForKey(ensureSessionKey(), { force: true })
})

onUnmounted(() => {
  eventCleanups.forEach((cleanup) => cleanup())
  chatStore.clearTimers()
  cancelPendingScroll()
})

async function handleRefreshChatData() {
  await sessionStore.fetchSessions()
  await loadHistoryForKey(ensureSessionKey(), { force: true })
}

async function handleSend() {
  const content = draft.value.trim()
  if (!content) return
  if (chatStore.sending) return

  try {
    const key = ensureSessionKey()
    chatStore.setSessionKey(key)
    await chatStore.sendMessage(content)
    draft.value = ''
    await nextTick()
    autoFollowBottom.value = true
    requestScrollToBottom({ force: true })
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error)
    message.error(reason)
  }
}
</script>

<template>
  <NSpace vertical :size="16">
    <NCard title="在线对话（工作台）" class="app-card">
      <template #header-extra>
        <NSpace :size="8" class="app-toolbar">
          <NButton size="small" class="app-toolbar-btn app-toolbar-btn--refresh" :loading="refreshingChatData" @click="handleRefreshChatData">
            <template #icon><NIcon :component="RefreshOutline" /></template>
            刷新聊天数据
          </NButton>
        </NSpace>
      </template>

      <NGrid cols="1 l:3" responsive="screen" :x-gap="12" :y-gap="12">
        <NGridItem :span="1">
          <NCard embedded :bordered="false" class="chat-side-card">
            <NSpace vertical :size="12">
              <div class="chat-side-stats">
                <div class="chat-stat-item">
                  <span class="chat-stat-label">总消息</span>
                  <strong>{{ stats.total }}</strong>
                </div>
                <div class="chat-stat-item">
                  <span class="chat-stat-label">助手回复</span>
                  <strong>{{ stats.assistant }}</strong>
                </div>
                <div class="chat-stat-item">
                  <span class="chat-stat-label">最近消息</span>
                  <strong>{{ stats.lastMessageAt }}</strong>
                </div>
              </div>

              <div>
                <NText depth="3" style="font-size: 12px;">会话 Key</NText>
                <NSelect
                  v-model:value="sessionKeyInput"
                  :options="sessionOptions"
                  filterable
                  tag
                  placeholder="输入或选择会话 Key（选中后自动加载）"
                  style="min-width: 240px; margin-top: 6px;"
                  @update:value="handleSessionKeyChange"
                />
              </div>

              <div class="chat-quick-panel">
                <NSpace justify="space-between" align="center">
                  <NText strong>常用对话</NText>
                  <NButton size="tiny" type="primary" secondary @click="openCreateQuickReply">新增</NButton>
                </NSpace>
                <NInput
                  v-model:value="quickReplySearch"
                  size="small"
                  style="margin-top: 8px;"
                  placeholder="搜索标题/内容"
                />

                <div v-if="filteredQuickReplies.length" class="chat-quick-list">
                  <div v-for="item in filteredQuickReplies" :key="item.id" class="chat-quick-item">
                    <NSpace justify="space-between" align="start" :wrap="false">
                      <div style="min-width: 0; flex: 1;">
                        <NText strong>{{ item.title }}</NText>
                        <NText depth="3" style="display: block; font-size: 12px; margin-top: 4px;">
                          {{ truncate(item.content, 78) }}
                        </NText>
                      </div>
                      <NSpace :size="2">
                        <NButton size="tiny" text @click="handleInsertQuickReply(item)">插入</NButton>
                        <NButton size="tiny" text type="primary" @click="handleSendQuickReply(item)">发送</NButton>
                        <NButton size="tiny" text @click="openEditQuickReply(item)">编辑</NButton>
                        <NPopconfirm
                          positive-text="删除"
                          negative-text="取消"
                          @positive-click="handleDeleteQuickReply(item.id)"
                        >
                          <template #trigger>
                            <NButton size="tiny" text type="error">删除</NButton>
                          </template>
                          确认删除该条常用对话？
                        </NPopconfirm>
                      </NSpace>
                    </NSpace>
                  </div>
                </div>
                <NEmpty v-else description="暂无常用对话" style="padding: 14px 0 8px;" />

                <div class="chat-quick-footnote">
                  <NText depth="3" style="font-size: 12px;">
                    存储位置：当前浏览器。按官方建议，长期可维护内容可放到 workspace。
                  </NText>
                  <NText depth="3" style="display: block; font-size: 12px; margin-top: 4px;">
                    建议目录：<code>{{ workspaceQuickReplyDir }}</code>
                  </NText>
                  <NButton size="tiny" text @click="handleCopyWorkspaceDir" style="margin-top: 4px;">
                    复制目录
                  </NButton>
                </div>
              </div>

              <div class="chat-side-switches">
                <NSpace justify="space-between" align="center">
                  <NText>自动跟随最新消息</NText>
                  <NSwitch v-model:value="autoFollowBottom" />
                </NSpace>
                <NSpace justify="space-between" align="center" style="margin-top: 8px;">
                  <NText>消息筛选</NText>
                  <NSelect
                    v-model:value="roleFilter"
                    size="small"
                    :options="roleFilterOptions"
                    style="width: 132px;"
                  />
                </NSpace>
              </div>

              <div class="chat-side-kv">
                <div class="chat-kv-row">
                  <span>Agent</span>
                  <code>{{ selectedSession?.agentId || sessionMeta.agent }}</code>
                </div>
                <div class="chat-kv-row">
                  <span>Channel</span>
                  <code>{{ sessionChannelDisplay }}</code>
                </div>
                <div class="chat-kv-row">
                  <span>Peer</span>
                  <code>{{ selectedSession?.peer || sessionMeta.peer || '-' }}</code>
                </div>
                <div class="chat-kv-row">
                  <span>模型</span>
                  <code>{{ selectedSession?.model || '-' }}</code>
                </div>
              </div>
            </NSpace>
          </NCard>
        </NGridItem>

        <NGridItem :span="2">
          <div class="chat-main-column">
            <NCard embedded :bordered="false" class="chat-transcript-card">
              <NSpace justify="space-between" align="center" style="margin-bottom: 10px;">
                <NSpace align="center" :size="8">
                  <NTag size="small" type="info" :bordered="false" round>
                    会话 {{ normalizedSessionKey }}
                  </NTag>
                  <NTag size="small" :type="syncTagType" :bordered="false" round>
                    {{ syncHint }}
                  </NTag>
                </NSpace>
                <NText depth="3" style="font-size: 12px;">
                  用户 {{ stats.user }} / 助手 {{ stats.assistant }} / 工具 {{ stats.tool }} / 系统 {{ stats.system }}
                </NText>
              </NSpace>

              <div class="chat-transcript-shell">
                <NSpin :show="transcriptLoading" class="chat-transcript-spin">
                  <div ref="transcriptRef" class="chat-transcript" @scroll="handleTranscriptScroll">
                    <template v-if="renderedMessages.length">
                      <div
                        v-for="entry in renderedMessages"
                        :key="entry.key"
                        class="chat-bubble"
                        :class="`is-${entry.item.role}`"
                      >
                        <NSpace justify="space-between" align="center" class="chat-bubble-meta" :size="8">
                          <NSpace align="center" :size="6">
                            <NTag size="small" :type="roleType(entry.item.role)" :bordered="false" round>
                              {{ roleLabel(entry.item.role) }}
                            </NTag>
                            <NText v-if="entry.item.name" depth="3" style="font-size: 12px;">
                              {{ entry.item.name }}
                            </NText>
                          </NSpace>
                          <NText v-if="entry.item.timestamp" depth="3" style="font-size: 12px;">
                            {{ formatDate(entry.item.timestamp) }}
                          </NText>
                        </NSpace>

                        <div v-if="entry.structured" class="structured-message-list">
                          <div v-if="entry.structured.thinkings.length" class="thinking-list">
                            <div
                              v-for="(thinking, thinkingIndex) in entry.structured.thinkings"
                              :key="`${entry.key}-thinking-${thinkingIndex}`"
                              class="thinking-card"
                            >
                              <NSpace align="center" justify="space-between">
                                <NSpace align="center" :size="6">
                                  <NTag size="small" type="info" :bordered="false" round>思考</NTag>
                                  <NText depth="3" style="font-size: 12px;">{{ thinking.type || 'thinking' }}</NText>
                                </NSpace>
                                <NTag
                                  v-if="thinking.hasEncryptedSignature"
                                  size="small"
                                  type="warning"
                                  :bordered="false"
                                  round
                                >
                                  已签名
                                </NTag>
                              </NSpace>

                              <div class="chat-bubble-content thinking-content">{{ thinking.text }}</div>

                              <details
                                v-if="thinking.signatureId || thinking.summaryText || thinking.hasEncryptedSignature"
                                class="thinking-details"
                              >
                                <summary>查看签名信息</summary>
                                <div class="tool-call-grid">
                                  <span class="tool-call-label">签名 ID</span>
                                  <code>{{ thinking.signatureId || '-' }}</code>
                                  <span class="tool-call-label">摘要</span>
                                  <div class="thinking-summary">{{ thinking.summaryText || '-' }}</div>
                                </div>
                              </details>
                            </div>
                          </div>

                          <div v-if="entry.structured.toolCalls.length" class="tool-call-list">
                            <div
                              v-for="(tool, toolIndex) in entry.structured.toolCalls"
                              :key="`${entry.key}-tool-${toolIndex}`"
                              class="tool-call-card"
                            >
                              <NSpace align="center" justify="space-between">
                                <NSpace align="center" :size="6">
                                  <NTag size="small" type="warning" :bordered="false" round>工具调用</NTag>
                                  <NText strong>{{ tool.name }}</NText>
                                </NSpace>
                                <NText v-if="tool.timeout" depth="3" style="font-size: 12px;">
                                  超时 {{ tool.timeout }}s
                                </NText>
                              </NSpace>

                              <div class="tool-call-grid">
                                <span class="tool-call-label">命令</span>
                                <code>{{ tool.command || '-' }}</code>
                                <span class="tool-call-label">目录</span>
                                <code>{{ tool.workdir || '-' }}</code>
                                <span class="tool-call-label">调用 ID</span>
                                <code>{{ tool.id || '-' }}</code>
                              </div>

                              <details v-if="tool.partialJson" class="tool-call-details">
                                <summary>查看 partialJson</summary>
                                <pre>{{ tool.partialJson }}</pre>
                              </details>
                            </div>
                          </div>

                          <div v-if="entry.structured.toolResults.length" class="tool-result-list">
                            <div
                              v-for="(result, resultIndex) in entry.structured.toolResults"
                              :key="`${entry.key}-tool-result-${resultIndex}`"
                              class="tool-result-card"
                            >
                              <NSpace align="center" justify="space-between">
                                <NSpace align="center" :size="6">
                                  <NTag size="small" type="success" :bordered="false" round>工具结果</NTag>
                                  <NText strong>{{ result.name || 'unknown' }}</NText>
                                </NSpace>
                                <NText v-if="result.status" depth="3" style="font-size: 12px;">
                                  {{ result.status }}
                                </NText>
                              </NSpace>

                              <div class="tool-call-grid">
                                <span class="tool-call-label">调用 ID</span>
                                <code>{{ result.id || '-' }}</code>
                                <span class="tool-call-label">内容</span>
                                <pre class="tool-result-content">{{ result.content }}</pre>
                              </div>
                            </div>
                          </div>

                          <div v-if="entry.structured.validationErrors.length" class="validation-error-list">
                            <div
                              v-for="(validation, validationIndex) in entry.structured.validationErrors"
                              :key="`${entry.key}-validation-${validationIndex}`"
                              class="validation-error-card"
                            >
                              <NSpace align="center" justify="space-between">
                                <NSpace align="center" :size="6">
                                  <NTag size="small" type="warning" :bordered="false" round>参数校验失败</NTag>
                                  <NText strong>{{ validation.toolName }}</NText>
                                </NSpace>
                                <NText depth="3" style="font-size: 12px;">
                                  {{ validation.issues.length }} 项问题
                                </NText>
                              </NSpace>

                              <div class="tool-call-grid">
                                <span class="tool-call-label">问题</span>
                                <div class="validation-issues">
                                  <div v-if="validation.issues.length === 0">-</div>
                                  <div v-for="(issue, issueIndex) in validation.issues" :key="issueIndex">
                                    - {{ issue }}
                                  </div>
                                </div>
                              </div>

                              <details v-if="validation.argumentsText" class="tool-call-details">
                                <summary>查看入参</summary>
                                <pre>{{ validation.argumentsText }}</pre>
                              </details>
                            </div>
                          </div>

                          <div
                            v-if="entry.structured.plainTexts.length"
                            class="chat-bubble-content structured-plain-text chat-markdown"
                            v-html="renderChatMarkdown(entry.structured.plainTexts.join('\n'), entry.item.role)"
                          >
                          </div>
                        </div>

                        <div
                          v-else
                          class="chat-bubble-content chat-markdown"
                          v-html="renderChatMarkdown(entry.item.content, entry.item.role)"
                        ></div>
                      </div>
                    </template>

                    <NEmpty
                      v-else
                      :description="messageList.length ? '当前筛选下无消息' : '暂无消息'"
                      style="padding: 72px 0;"
                    />
                  </div>
                </NSpin>
              </div>
            </NCard>

            <NCard embedded :bordered="false" class="chat-compose-card">
              <NSpace vertical :size="10">
                <NInput
                  v-model:value="draft"
                  type="textarea"
                  :autosize="{ minRows: 3, maxRows: 8 }"
                  placeholder="输入消息（输入 / 可查看 OpenClaw 命令）"
                  @keydown="handleDraftKeydown"
                />

                <div v-if="slashMode" class="chat-slash-panel">
                  <div class="chat-slash-head">
                    <NText depth="3" style="font-size: 12px;">OpenClaw 斜杠命令</NText>
                    <NText depth="3" style="font-size: 12px;">↑/↓ 选择，Tab 应用，Enter 应用或发送，Esc 退出</NText>
                  </div>
                  <div v-if="slashSuggestions.length" class="chat-slash-list">
                    <button
                      v-for="(item, index) in slashSuggestions"
                      :key="item.key"
                      class="chat-slash-item"
                      :class="{ 'is-active': index === selectedSlashCommandIndex }"
                      type="button"
                      @mouseenter="selectedSlashCommandIndex = index"
                      @mousedown.prevent
                      @click="applySlashSuggestion(item)"
                    >
                      <div v-if="item.kind === 'command' && item.preset">
                        <div class="chat-slash-line">
                          <span class="chat-slash-command">{{ item.preset.command }}</span>
                          <span v-if="item.preset.usage" class="chat-slash-usage">{{ item.preset.usage }}</span>
                          <NTag size="tiny" :bordered="false" round>{{ item.preset.category }}</NTag>
                        </div>
                        <div class="chat-slash-line chat-slash-desc">
                          <span>{{ item.preset.description }}</span>
                          <span v-if="item.preset.requiresFlag" class="chat-slash-flag">需 {{ item.preset.requiresFlag }}</span>
                        </div>
                      </div>
                      <div v-else-if="item.kind === 'skill' && item.skill">
                        <div class="chat-slash-line">
                          <span class="chat-slash-command">/skill {{ item.skill.name }}</span>
                          <NTag size="tiny" type="success" :bordered="false" round>
                            {{ skillSourceLabel(item.skill.source) }}
                          </NTag>
                        </div>
                        <div class="chat-slash-line chat-slash-desc">
                          <span>{{ item.skill.description || '无描述' }}</span>
                          <span v-if="item.skill.version" class="chat-slash-flag">v{{ item.skill.version }}</span>
                        </div>
                      </div>
                      <div v-else-if="item.kind === 'model' && item.model">
                        <div class="chat-slash-line">
                          <span class="chat-slash-command">/model {{ item.model.modelRef }}</span>
                          <NTag size="tiny" type="info" :bordered="false" round>
                            {{ item.model.providerId }}
                          </NTag>
                        </div>
                        <div class="chat-slash-line chat-slash-desc">
                          <span>{{ item.model.modelId }}</span>
                          <span class="chat-slash-flag">来自当前配置</span>
                        </div>
                      </div>
                    </button>
                  </div>
                  <div v-else class="chat-slash-empty">
                    <template v-if="slashSkillMode">
                      {{ skillStore.loading ? '正在加载技能列表...' : '没有匹配技能，或当前没有用户技能。' }}
                    </template>
                    <template v-else-if="slashModelMode">
                      {{ configStore.loading ? '正在读取配置模型...' : '没有匹配模型，或当前未配置模型。' }}
                    </template>
                    <template v-else>
                      没有匹配命令，仅支持 /new、/skill、/model。
                    </template>
                  </div>
                </div>

                <NSpace justify="space-between" align="center">
                  <NText depth="3" style="font-size: 12px;">
                    当前发送到：{{ normalizedSessionKey }} ｜ Enter 发送，Shift+Enter 换行，Ctrl/Cmd+Enter 发送
                  </NText>
                  <NSpace :size="8">
                    <NButton size="small" secondary :disabled="!draft" @click="draft = ''">
                      清空输入
                    </NButton>
                    <NButton type="primary" :loading="chatStore.sending" @click="handleSend">
                      <template #icon><NIcon :component="SendOutline" /></template>
                      发送
                    </NButton>
                  </NSpace>
                </NSpace>
              </NSpace>
            </NCard>
          </div>
        </NGridItem>
      </NGrid>

      <NAlert v-if="chatStore.lastError" type="error" :show-icon="true" style="margin-top: 12px; border-radius: var(--radius);">
        {{ chatStore.lastError }}
      </NAlert>
    </NCard>

    <NModal
      v-model:show="showQuickReplyModal"
      preset="card"
      :title="quickReplyModalMode === 'edit' ? '编辑常用对话' : '新增常用对话'"
      style="width: 640px; max-width: calc(100vw - 28px);"
    >
      <NForm label-placement="left" label-width="72">
        <NFormItem label="标题" required>
          <NInput v-model:value="quickReplyForm.title" placeholder="例如：确认需求澄清" />
        </NFormItem>
        <NFormItem label="内容" required>
          <NInput
            v-model:value="quickReplyForm.content"
            type="textarea"
            :autosize="{ minRows: 4, maxRows: 10 }"
            placeholder="输入常用对话正文"
          />
        </NFormItem>
      </NForm>
      <template #footer>
        <NSpace justify="end">
          <NButton @click="showQuickReplyModal = false">取消</NButton>
          <NButton type="primary" @click="handleSaveQuickReply">
            {{ quickReplyModalMode === 'edit' ? '保存修改' : '新增' }}
          </NButton>
        </NSpace>
      </template>
    </NModal>
  </NSpace>
</template>

<style scoped>
.chat-side-card {
  border-radius: var(--radius);
}

.chat-main-column {
  display: flex;
  flex-direction: column;
  gap: 12px;
  height: calc(100vh - 224px);
  min-height: 520px;
  overflow: hidden;
}

.chat-side-switches,
.chat-side-stats,
.chat-side-kv,
.chat-quick-panel {
  padding: 10px;
  border: 1px solid var(--border-color);
  border-radius: var(--radius);
  background: var(--bg-primary);
}

.chat-quick-list {
  margin-top: 8px;
  display: flex;
  flex-direction: column;
  gap: 8px;
  max-height: 220px;
  overflow-y: auto;
  padding-right: 2px;
}

.chat-quick-item {
  border: 1px solid var(--border-color);
  border-radius: 8px;
  padding: 8px;
  background: var(--bg-secondary);
}

.chat-quick-footnote {
  margin-top: 8px;
  border-top: 1px dashed var(--border-color);
  padding-top: 8px;
}

.chat-quick-footnote code {
  padding: 1px 6px;
  border-radius: 4px;
  background: var(--bg-secondary);
  word-break: break-all;
}

.chat-side-stats {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 8px;
}

.chat-stat-item {
  padding: 8px;
  border-radius: 6px;
  background: var(--bg-secondary);
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.chat-stat-item strong {
  font-size: 13px;
  line-height: 1.3;
}

.chat-stat-label {
  font-size: 11px;
  color: var(--text-secondary);
}

.chat-kv-row {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 10px;
  padding: 6px 0;
  font-size: 12px;
  border-bottom: 1px dashed var(--border-color);
}

.chat-kv-row:last-child {
  border-bottom: none;
}

.chat-kv-row code {
  padding: 2px 6px;
  border-radius: 4px;
  background: var(--bg-secondary);
  word-break: break-all;
}

.chat-transcript-card,
.chat-compose-card {
  border-radius: var(--radius);
}

.chat-transcript-card {
  flex: 1;
  min-height: 0;
  overflow: hidden;
}

:deep(.chat-transcript-card .n-card__content) {
  height: 100%;
  display: flex;
  flex-direction: column;
  min-height: 0;
}

.chat-transcript-shell {
  flex: 1;
  min-height: 0;
}

:deep(.chat-transcript-shell .n-spin-container),
:deep(.chat-transcript-shell .n-spin-content) {
  height: 100%;
  display: flex;
  flex-direction: column;
  min-height: 0;
}

.chat-transcript {
  border: 1px solid var(--border-color);
  border-radius: var(--radius);
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  padding: 14px;
  padding-bottom: 20px;
  overflow-anchor: none;
  overscroll-behavior: contain;
  background:
    radial-gradient(circle at top right, rgba(24, 160, 88, 0.06), transparent 30%),
    var(--bg-primary);
}

.chat-compose-card {
  flex-shrink: 0;
  border: 1px solid var(--border-color);
  background: var(--bg-card);
  box-shadow: var(--shadow-sm);
}

.chat-slash-panel {
  border: 1px solid var(--border-color);
  border-radius: 10px;
  background: var(--bg-secondary);
  overflow: hidden;
}

.chat-slash-head {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 8px;
  padding: 8px 10px;
  border-bottom: 1px dashed var(--border-color);
}

.chat-slash-list {
  max-height: 240px;
  overflow-y: auto;
}

.chat-slash-item {
  width: 100%;
  text-align: left;
  border: 0;
  border-bottom: 1px solid var(--border-color);
  background: transparent;
  color: var(--text-primary);
  padding: 8px 10px;
  cursor: pointer;
}

.chat-slash-item:last-child {
  border-bottom: 0;
}

.chat-slash-item:hover,
.chat-slash-item.is-active {
  background: rgba(24, 144, 255, 0.1);
}

.chat-slash-line {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}

.chat-slash-command {
  font-family: 'JetBrains Mono', 'SF Mono', Monaco, monospace;
  font-size: 13px;
  line-height: 1.45;
}

.chat-slash-usage {
  color: var(--text-secondary);
  font-size: 12px;
}

.chat-slash-desc {
  margin-top: 4px;
  color: var(--text-secondary);
  font-size: 12px;
  justify-content: space-between;
}

.chat-slash-flag {
  color: var(--warning-color);
  white-space: nowrap;
}

.chat-slash-empty {
  padding: 12px 10px;
  color: var(--text-secondary);
  font-size: 12px;
}

.chat-bubble {
  width: fit-content;
  max-width: min(840px, 88%);
  margin-bottom: 12px;
  padding: 10px 12px;
  border-radius: 10px;
  border: 1px solid var(--border-color);
  background: var(--bg-secondary);
}

.chat-bubble.is-user {
  margin-left: auto;
  border-color: rgba(24, 160, 88, 0.35);
  background: rgba(24, 160, 88, 0.09);
}

.chat-bubble.is-assistant {
  margin-right: auto;
  border-color: rgba(24, 144, 255, 0.3);
  background: rgba(24, 144, 255, 0.08);
}

.chat-bubble.is-tool {
  margin-right: auto;
  border-style: dashed;
}

.chat-bubble.is-system {
  margin: 0 auto 12px;
  border-style: dashed;
  background: rgba(250, 173, 20, 0.08);
}

.chat-bubble-meta {
  margin-bottom: 6px;
}

.chat-bubble-content {
  white-space: pre-wrap;
  line-height: 1.65;
  word-break: break-word;
}

.chat-markdown {
  white-space: normal;
  font-size: 13.5px;
  line-height: 1.72;
  word-break: break-word;
  overflow-wrap: break-word;
}

.chat-markdown :deep(> :first-child) {
  margin-top: 0;
}

.chat-markdown :deep(> :last-child) {
  margin-bottom: 0;
}

/* —— 标题 —— */
.chat-markdown :deep(h1),
.chat-markdown :deep(h2),
.chat-markdown :deep(h3),
.chat-markdown :deep(h4),
.chat-markdown :deep(h5),
.chat-markdown :deep(h6) {
  margin: 16px 0 4px;
  line-height: 1.4;
  font-weight: 600;
  letter-spacing: -0.01em;
}

.chat-markdown :deep(h1) { font-size: 1.25em; }
.chat-markdown :deep(h2) { font-size: 1.12em; }
.chat-markdown :deep(h3) { font-size: 1.02em; }

/* —— 段落 —— */
.chat-markdown :deep(p) {
  margin: 4px 0;
  line-height: 1.72;
}

/* —— 无序列表 —— */
.chat-markdown :deep(ul) {
  margin: 4px 0;
  padding-left: 1.1em;
  list-style: none;
}

.chat-markdown :deep(ul > li) {
  position: relative;
  margin: 2px 0;
  line-height: 1.72;
}

.chat-markdown :deep(ul > li::before) {
  content: '';
  position: absolute;
  left: -0.88em;
  top: 0.58em;
  width: 4px;
  height: 4px;
  border-radius: 50%;
  background: var(--md-bullet-color);
}

/* 嵌套列表 */
.chat-markdown :deep(ul ul) {
  margin: 1px 0 1px 0.15em;
}

.chat-markdown :deep(ul ul > li::before) {
  width: 3.5px;
  height: 3.5px;
  background: transparent;
  border: 1px solid var(--md-bullet-nested-color);
  top: 0.62em;
}

/* 三级列表 */
.chat-markdown :deep(ul ul ul > li::before) {
  width: 3px;
  height: 3px;
  border: none;
  background: var(--md-bullet-nested-color);
  border-radius: 0;
}

/* —— 有序列表 —— */
.chat-markdown :deep(ol) {
  margin: 4px 0;
  padding-left: 1.5em;
  list-style-position: outside;
}

.chat-markdown :deep(ol > li) {
  margin: 2px 0;
  line-height: 1.72;
}

.chat-markdown :deep(ol > li::marker) {
  color: var(--md-bullet-color);
  font-size: 0.9em;
  font-weight: 500;
}

/* —— 链接 —— */
.chat-markdown :deep(a) {
  color: var(--link-color);
  text-decoration: none;
  font-weight: 500;
  text-underline-offset: 2px;
  text-decoration-thickness: 1px;
  transition: color 0.12s ease, text-decoration-color 0.12s ease;
  text-decoration-line: underline;
  text-decoration-color: var(--link-underline);
}

.chat-markdown :deep(a:hover) {
  color: var(--link-color-hover);
  text-decoration-color: var(--link-color-hover);
}

/* —— 引用块 —— */
.chat-markdown :deep(blockquote) {
  margin: 6px 0;
  padding: 4px 10px;
  border-left: 2.5px solid var(--md-blockquote-border);
  border-radius: 0 4px 4px 0;
  background: var(--md-blockquote-bg);
}

.chat-markdown :deep(blockquote p) {
  margin: 2px 0;
  color: var(--text-secondary);
  font-size: 0.94em;
}

/* —— 代码 —— */
.chat-markdown :deep(pre) {
  margin: 6px 0;
  padding: 9px 11px;
  border-radius: 6px;
  border: 1px solid var(--md-code-border);
  background: var(--md-pre-bg);
  overflow-x: auto;
  line-height: 1.52;
}

.chat-markdown :deep(code) {
  font-family: 'SFMono-Regular', Menlo, Monaco, Consolas, monospace;
  font-size: 0.87em;
}

.chat-markdown :deep(p code),
.chat-markdown :deep(li code) {
  padding: 0.5px 4.5px;
  border-radius: 3px;
  border: 1px solid var(--md-code-border);
  background: var(--md-code-bg);
}

/* —— 分割线 —— */
.chat-markdown :deep(hr) {
  border: 0;
  height: 1px;
  background: var(--border-color);
  margin: 10px 0;
}

/* —— 加粗/强调 —— */
.chat-markdown :deep(strong) {
  font-weight: 600;
}

.chat-markdown :deep(em) {
  font-style: italic;
}

.structured-message-list {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.structured-plain-text {
  padding: 8px 10px;
  border-radius: 8px;
  border: 1px dashed var(--border-color);
  background: var(--bg-primary);
}

.thinking-list,
.tool-call-list {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.thinking-card {
  border: 1px solid rgba(24, 144, 255, 0.34);
  border-radius: 8px;
  background: rgba(24, 144, 255, 0.08);
  padding: 10px;
}

.thinking-content {
  margin-top: 8px;
}

.thinking-details {
  margin-top: 8px;
}

.thinking-details summary {
  font-size: 12px;
  color: var(--text-secondary);
  cursor: pointer;
  user-select: none;
}

.thinking-summary {
  white-space: pre-wrap;
  word-break: break-word;
  line-height: 1.55;
}

.tool-call-card {
  border: 1px solid rgba(250, 173, 20, 0.35);
  border-radius: 8px;
  background: rgba(250, 173, 20, 0.08);
  padding: 10px;
}

.tool-result-list {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.tool-result-card {
  border: 1px solid rgba(24, 160, 88, 0.35);
  border-radius: 8px;
  background: rgba(24, 160, 88, 0.08);
  padding: 10px;
}

.tool-result-content {
  margin: 0;
  white-space: pre-wrap;
  word-break: break-word;
  line-height: 1.55;
  padding: 8px;
  border-radius: 6px;
  border: 1px solid var(--border-color);
  background: var(--bg-primary);
}

.validation-error-list {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.validation-error-card {
  border: 1px solid rgba(250, 173, 20, 0.45);
  border-radius: 8px;
  background: rgba(250, 173, 20, 0.08);
  padding: 10px;
}

.validation-issues {
  white-space: pre-wrap;
  word-break: break-word;
  line-height: 1.55;
}

.tool-call-grid {
  margin-top: 8px;
  display: grid;
  grid-template-columns: 72px minmax(0, 1fr);
  gap: 6px 8px;
  align-items: start;
}

.tool-call-label {
  font-size: 12px;
  color: var(--text-secondary);
  line-height: 1.7;
}

.tool-call-grid code {
  display: inline-block;
  padding: 2px 6px;
  border-radius: 4px;
  background: var(--bg-primary);
  line-height: 1.5;
  word-break: break-all;
}

.tool-call-details {
  margin-top: 8px;
}

.tool-call-details summary {
  font-size: 12px;
  color: var(--text-secondary);
  cursor: pointer;
  user-select: none;
}

.tool-call-details pre {
  margin-top: 6px;
  padding: 8px;
  border: 1px solid var(--border-color);
  border-radius: 6px;
  background: var(--bg-primary);
  white-space: pre-wrap;
  word-break: break-word;
  font-size: 12px;
}

@media (max-width: 1200px) {
  .chat-side-card {
    min-height: auto;
  }

  .chat-main-column {
    height: auto;
    min-height: 0;
  }

  .chat-transcript {
    min-height: 320px;
    max-height: 52vh;
  }

}

@media (max-width: 640px) {
  .chat-side-stats {
    grid-template-columns: 1fr;
  }

  .chat-slash-head {
    flex-direction: column;
    align-items: flex-start;
  }

  .chat-bubble {
    max-width: 96%;
  }

  .tool-call-grid {
    grid-template-columns: 1fr;
  }
}
</style>
