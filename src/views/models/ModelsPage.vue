<script setup lang="ts">
import { computed, h, onMounted, reactive, ref, watch } from 'vue'
import {
  NAlert,
  NButton,
  NCard,
  NCode,
  NCollapse,
  NCollapseItem,
  NDataTable,
  NDescriptions,
  NDescriptionsItem,
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
  NTabPane,
  NTag,
  NTabs,
  NText,
  useMessage,
} from 'naive-ui'
import { AddOutline, RefreshOutline, SaveOutline, SearchOutline } from '@vicons/ionicons5'
import { useConfigStore } from '@/stores/config'
import { useWebSocketStore } from '@/stores/websocket'
import type { DataTableColumns } from 'naive-ui'
import type { ConfigPatch, ModelProviderConfig } from '@/api/types'

const configStore = useConfigStore()
const wsStore = useWebSocketStore()
const message = useMessage()

const primaryModel = ref('')
const selectedProviderId = ref('')
const providerSearch = ref('')
const probing = ref(false)
const probeError = ref('')
const showCreateProviderModal = ref(false)
const probingCreateProvider = ref(false)
const createProbeError = ref('')
const showSaveConfirmModal = ref(false)
const confirmActionType = ref<'edit' | 'create'>('edit')
const editActiveTab = ref<'basic' | 'models' | 'preview'>('basic')
const createActiveTab = ref<'basic' | 'models' | 'preview'>('basic')

type ModelInputType = 'text' | 'image'

const modelInputTypeOptions = [
  { label: 'text', value: 'text' },
  { label: 'image', value: 'image' },
]

const DEFAULT_MODEL_INPUT_TYPES: ModelInputType[] = ['text']

const providerForm = reactive({
  id: '',
  api: 'openai-completions',
  baseUrl: '',
  apiKey: '',
  modelInputTypes: [...DEFAULT_MODEL_INPUT_TYPES] as ModelInputType[],
  modelIdsText: '',
})

const createProviderForm = reactive({
  id: '',
  api: 'openai-completions',
  baseUrl: '',
  apiKey: '',
  modelInputTypes: [...DEFAULT_MODEL_INPUT_TYPES] as ModelInputType[],
  modelIdsText: '',
})

const apiOptions = [
  { label: 'OpenAI Completions', value: 'openai-completions' },
  { label: 'OpenAI Responses', value: 'openai-responses' },
  { label: 'Anthropic Messages', value: 'anthropic-messages' },
  { label: 'Google Generative AI', value: 'google-generative-ai' },
]

type ProviderSummary = {
  id: string
  api: string
  baseUrl: string
  modelIds: string[]
  sources: string[]
}

type ConfiguredModelRow = {
  key: string
  providerId: string
  modelId: string
  modelRef: string
}

function splitModelRef(value: string): { providerId: string; modelId: string } | null {
  const modelRef = value.trim()
  const slashIndex = modelRef.indexOf('/')
  if (slashIndex <= 0 || slashIndex >= modelRef.length - 1) {
    return null
  }

  const providerId = modelRef.slice(0, slashIndex).trim()
  const modelId = modelRef.slice(slashIndex + 1).trim()
  if (!providerId || !modelId) {
    return null
  }

  return { providerId, modelId }
}

function looksLikeProviderConfig(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const row = value as Record<string, unknown>
  return (
    'api' in row ||
    'baseUrl' in row ||
    'baseURL' in row ||
    'base_url' in row ||
    'apiKey' in row ||
    'api_key' in row ||
    'token' in row ||
    'models' in row ||
    'modelIds' in row ||
    'availableModels' in row ||
    'whitelist' in row
  )
}

function extractProviderEntries(config: unknown): Array<{
  id: string
  pathPrefix: 'models.providers' | 'models'
  provider: Record<string, unknown>
}> {
  if (!config || typeof config !== 'object' || Array.isArray(config)) return []
  const root = config as Record<string, unknown>
  const modelsRaw = root.models
  if (!modelsRaw || typeof modelsRaw !== 'object' || Array.isArray(modelsRaw)) return []
  const models = modelsRaw as Record<string, unknown>

  const registry = new Map<string, { id: string; pathPrefix: 'models.providers' | 'models'; provider: Record<string, unknown> }>()
  const addEntry = (
    id: string,
    pathPrefix: 'models.providers' | 'models',
    provider: unknown
  ) => {
    if (!id || !looksLikeProviderConfig(provider)) return
    registry.set(id, {
      id,
      pathPrefix,
      provider: provider as Record<string, unknown>,
    })
  }

  const providersRaw = models.providers
  if (providersRaw && typeof providersRaw === 'object' && !Array.isArray(providersRaw)) {
    for (const [id, provider] of Object.entries(providersRaw as Record<string, unknown>)) {
      addEntry(id, 'models.providers', provider)
    }
  }

  const reservedKeys = new Set(['primary', 'fallback', 'mode', 'providers'])
  for (const [id, provider] of Object.entries(models)) {
    if (reservedKeys.has(id)) continue
    addEntry(id, 'models', provider)
  }

  return Array.from(registry.values())
}

type ModelRefSource =
  | 'models.primary'
  | 'models.fallback'
  | 'agents.defaults.models'
  | 'agents.defaults.model.primary'
  | 'agents.defaults.model.fallback'

function readProviderText(
  provider: ModelProviderConfig | Record<string, unknown> | undefined,
  keys: string[]
): string {
  if (!provider) return ''
  const row = provider as Record<string, unknown>
  for (const key of keys) {
    const value = row[key]
    if (typeof value === 'string' && value.trim()) {
      return value
    }
  }
  return ''
}

function readProviderApiKeyForProbe(provider: ModelProviderConfig | Record<string, unknown> | undefined): string {
  const raw = readProviderText(provider, ['apiKey', 'api_key', 'key', 'token', 'accessToken', 'access_token'])
  const value = raw.trim()
  if (!value) return ''
  if (/^[*•]+$/.test(value)) return ''
  return value
}

function normalizeModelInputTypes(value: unknown): ModelInputType[] {
  if (!Array.isArray(value)) return []
  const allowed = new Set<ModelInputType>(['text', 'image'])
  const normalized = value
    .filter((item): item is string => typeof item === 'string')
    .map((item) => item.trim().toLowerCase())
    .filter((item): item is ModelInputType => allowed.has(item as ModelInputType))
  return Array.from(new Set(normalized)) as ModelInputType[]
}

function normalizeModelInputTypeSelection(types: ModelInputType[] | string[]): ModelInputType[] {
  const normalized = normalizeModelInputTypes(types)
  if (normalized.length > 0) {
    return normalized
  }
  return [...DEFAULT_MODEL_INPUT_TYPES]
}

function isSameModelInputTypes(before: ModelInputType[], after: ModelInputType[]): boolean {
  if (before.length !== after.length) return false
  const beforeSorted = [...before].sort((a, b) => a.localeCompare(b))
  const afterSorted = [...after].sort((a, b) => a.localeCompare(b))
  return beforeSorted.every((item, index) => item === afterSorted[index])
}

function readProviderModelInputTypes(
  provider: ModelProviderConfig | Record<string, unknown> | undefined
): ModelInputType[] {
  if (!provider) {
    return [...DEFAULT_MODEL_INPUT_TYPES]
  }
  const row = provider as Record<string, unknown>
  const result = new Set<ModelInputType>()

  const collectFromModelEntry = (entry: unknown) => {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return
    const model = entry as Record<string, unknown>
    const inputs = normalizeModelInputTypes(model.input)
    for (const input of inputs) {
      result.add(input)
    }
  }

  const models = row.models
  if (Array.isArray(models)) {
    for (const entry of models) {
      collectFromModelEntry(entry)
    }
  } else if (models && typeof models === 'object') {
    for (const entry of Object.values(models as Record<string, unknown>)) {
      collectFromModelEntry(entry)
    }
  }

  if (result.size > 0) {
    return Array.from(result).sort((a, b) => a.localeCompare(b))
  }
  return [...DEFAULT_MODEL_INPUT_TYPES]
}

function readProviderModelIds(provider: ModelProviderConfig | Record<string, unknown> | undefined): string[] {
  if (!provider) return []
  const row = provider as Record<string, unknown>

  const collectFromCollection = (value: unknown): string[] => {
    if (!value) return []

    const collectFromArray = (items: unknown[]): string[] => {
      const ids: string[] = []
      for (const item of items) {
        if (typeof item === 'string' && item.trim()) {
          ids.push(item.trim())
          continue
        }
        if (item && typeof item === 'object' && !Array.isArray(item)) {
          const model = item as Record<string, unknown>
          const id =
            (typeof model.id === 'string' && model.id.trim()) ||
            (typeof model.name === 'string' && model.name.trim()) ||
            ''
          if (id) ids.push(id)
        }
      }
      return ids
    }

    if (Array.isArray(value)) {
      return collectFromArray(value)
    }

    if (typeof value === 'object') {
      const ids: string[] = []
      for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
        const candidateKey = key.trim()
        if (!candidateKey) continue

        if (typeof item === 'string' && item.trim()) {
          ids.push(item.trim())
          continue
        }
        if (item && typeof item === 'object' && !Array.isArray(item)) {
          const model = item as Record<string, unknown>
          const id =
            (typeof model.id === 'string' && model.id.trim()) ||
            (typeof model.name === 'string' && model.name.trim()) ||
            ''
          ids.push(id || candidateKey)
          continue
        }
        ids.push(candidateKey)
      }
      return ids
    }

    return []
  }

  const candidates: unknown[] = [
    row.models,
    row.modelIds,
    row.availableModels,
    row.whitelist,
  ]
  const collected: string[] = []
  for (const candidate of candidates) {
    collected.push(...collectFromCollection(candidate))
  }
  return Array.from(new Set(collected))
}

function collectModelRefsFromUnknown(
  value: unknown,
  source: ModelRefSource
): Array<{ modelRef: string; source: ModelRefSource }> {
  const refs = new Map<string, ModelRefSource>()

  const addRef = (modelRef: string) => {
    if (!refs.has(modelRef)) {
      refs.set(modelRef, source)
    }
  }

  const collect = (input: unknown) => {
    if (!input) return

    if (typeof input === 'string') {
      const parsed = splitModelRef(input)
      if (parsed) addRef(`${parsed.providerId}/${parsed.modelId}`)
      return
    }

    if (Array.isArray(input)) {
      for (const item of input) {
        collect(item)
      }
      return
    }

    if (typeof input === 'object') {
      const row = input as Record<string, unknown>
      const possibleRefs = [row.id, row.model, row.ref, row.primary]
      for (const candidate of possibleRefs) {
        if (typeof candidate === 'string') {
          const parsed = splitModelRef(candidate)
          if (parsed) addRef(`${parsed.providerId}/${parsed.modelId}`)
        }
      }

      for (const [key, item] of Object.entries(row)) {
        const parsedKey = splitModelRef(key)
        if (parsedKey) addRef(`${parsedKey.providerId}/${parsedKey.modelId}`)

        if (typeof item === 'string') {
          const parsedValue = splitModelRef(item)
          if (parsedValue) addRef(`${parsedValue.providerId}/${parsedValue.modelId}`)
        }
      }
    }
  }

  collect(value)
  return Array.from(refs.entries()).map(([modelRef, modelRefSource]) => ({
    modelRef,
    source: modelRefSource,
  }))
}

function extractConfiguredModelRefs(config: unknown): Array<{ modelRef: string; source: ModelRefSource }> {
  if (!config || typeof config !== 'object' || Array.isArray(config)) return []
  const root = config as Record<string, unknown>
  const refs = new Map<string, ModelRefSource>()
  const addRefs = (value: unknown, source: ModelRefSource) => {
    for (const item of collectModelRefsFromUnknown(value, source)) {
      if (!refs.has(item.modelRef)) {
        refs.set(item.modelRef, item.source)
      }
    }
  }

  const models = root.models as Record<string, unknown> | undefined
  addRefs(models?.primary, 'models.primary')
  addRefs(models?.fallback, 'models.fallback')

  const agents = root.agents as Record<string, unknown> | undefined
  const defaults = agents?.defaults as Record<string, unknown> | undefined
  addRefs(defaults?.models, 'agents.defaults.models')

  const defaultModel = defaults?.model as Record<string, unknown> | undefined
  addRefs(defaultModel?.primary, 'agents.defaults.model.primary')
  addRefs(defaultModel?.fallback, 'agents.defaults.model.fallback')
  addRefs(defaultModel?.fallbacks, 'agents.defaults.model.fallback')

  return Array.from(refs.entries()).map(([modelRef, source]) => ({
    modelRef,
    source,
  }))
}

const providerEntries = computed(() => extractProviderEntries(configStore.config))
const configuredModelRefs = computed(() => extractConfiguredModelRefs(configStore.config))

const providerMap = computed<Record<string, ModelProviderConfig>>(() => {
  const map: Record<string, ModelProviderConfig> = {}
  for (const entry of providerEntries.value) {
    map[entry.id] = entry.provider as unknown as ModelProviderConfig
  }
  return map
})

const providerPathPrefixMap = computed<Record<string, 'models.providers' | 'models'>>(() => {
  const map: Record<string, 'models.providers' | 'models'> = {}
  for (const entry of providerEntries.value) {
    map[entry.id] = entry.pathPrefix
  }
  return map
})

const managedProviderIdSet = computed(() => new Set(providerEntries.value.map((entry) => entry.id)))

const providerSummaries = computed(() => {
  const registry = new Map<
    string,
    {
      id: string
      api: string
      baseUrl: string
      modelIds: Set<string>
      sources: Set<string>
    }
  >()

  for (const entry of providerEntries.value) {
    const id = entry.id
    const provider = entry.provider as unknown as ModelProviderConfig
    const providerApi = readProviderText(provider, ['api', 'protocol', 'format']) || '-'
    const providerBaseUrl = readProviderText(provider, ['baseUrl', 'baseURL', 'base_url', 'url', 'endpoint']) || '-'
    registry.set(id, {
      id,
      api: providerApi,
      baseUrl: providerBaseUrl,
      modelIds: new Set(readProviderModelIds(provider)),
      sources: new Set([entry.pathPrefix]),
    })
  }

  for (const refItem of configuredModelRefs.value) {
    const parsed = splitModelRef(refItem.modelRef)
    if (!parsed) continue

    const provider = providerMap.value[parsed.providerId]
    const providerApi = readProviderText(provider, ['api', 'protocol', 'format']) || '-'
    const providerBaseUrl = readProviderText(provider, ['baseUrl', 'baseURL', 'base_url', 'url', 'endpoint']) || '-'

    const current = registry.get(parsed.providerId)
    if (current) {
      current.modelIds.add(parsed.modelId)
      current.sources.add(refItem.source)
      continue
    }

    registry.set(parsed.providerId, {
      id: parsed.providerId,
      api: providerApi,
      baseUrl: providerBaseUrl,
      modelIds: new Set([parsed.modelId]),
      sources: new Set([refItem.source]),
    })
  }

  return Array.from(registry.values())
    .map((item) => ({
      id: item.id,
      api: item.api,
      baseUrl: item.baseUrl,
      modelIds: Array.from(item.modelIds).sort((a, b) => a.localeCompare(b)),
      sources: Array.from(item.sources).sort((a, b) => a.localeCompare(b)),
    }))
    .sort((a, b) => a.id.localeCompare(b.id))
})

const filteredProviderSummaries = computed(() => {
  const q = providerSearch.value.trim().toLowerCase()
  if (!q) return providerSummaries.value
  return providerSummaries.value.filter((item) => {
    if (item.id.toLowerCase().includes(q)) return true
    if (item.api.toLowerCase().includes(q)) return true
    if (item.baseUrl.toLowerCase().includes(q)) return true
    return item.modelIds.some((modelId) => modelId.toLowerCase().includes(q))
  })
})

function sanitizeProviderForDisplay(provider: Record<string, unknown>): Record<string, unknown> {
  const clone: Record<string, unknown> = { ...provider }
  for (const key of ['apiKey', 'api_key', 'key', 'token', 'accessToken', 'access_token']) {
    const value = clone[key]
    if (typeof value === 'string' && value.trim()) {
      clone[key] = '********'
    }
  }
  return clone
}

const selectedProviderHasKey = computed(() => {
  if (!selectedProviderId.value) return false
  const provider = providerMap.value[selectedProviderId.value] as unknown as Record<string, unknown> | undefined
  if (!provider) return false
  return !!readProviderText(provider, ['apiKey', 'api_key', 'key', 'token', 'accessToken', 'access_token'])
})

const selectedProviderRawText = computed(() => {
  if (!selectedProviderId.value) return ''
  const provider = providerMap.value[selectedProviderId.value]
  if (!provider) return ''
  try {
    return JSON.stringify(sanitizeProviderForDisplay(provider as unknown as Record<string, unknown>), null, 2)
  } catch {
    return ''
  }
})

const configuredModelRows = computed<ConfiguredModelRow[]>(() => {
  const rowsMap = new Map<string, ConfiguredModelRow>()
  for (const provider of providerSummaries.value) {
    for (const modelId of provider.modelIds) {
      const modelRef = `${provider.id}/${modelId}`
      rowsMap.set(modelRef, {
        key: modelRef,
        providerId: provider.id,
        modelId,
        modelRef,
      })
    }
  }

  return Array.from(rowsMap.values()).sort((a, b) => a.modelRef.localeCompare(b.modelRef))
})

const editingExistingProvider = computed(() => {
  const id = normalizeProviderId(providerForm.id || selectedProviderId.value)
  return !!id && !!providerMap.value[id]
})

const currentEditingProviderId = computed(() =>
  normalizeProviderId(providerForm.id || selectedProviderId.value)
)
const providerEditorTitle = computed(() =>
  editingExistingProvider.value
    ? `编辑渠道：${currentEditingProviderId.value}`
    : selectedProviderId.value
      ? `渠道详情缺失：${normalizeProviderId(selectedProviderId.value)}`
      : '请选择已配置渠道'
)
const providerSubmitLabel = computed(() => '保存修改')

const apiKeyPlaceholder = computed(() =>
  editingExistingProvider.value ? '留空表示保持现有 Key 不变' : '输入渠道 Key'
)

const currentModelIds = computed(() => parseModelIds(providerForm.modelIdsText))
const createCurrentModelIds = computed(() => parseModelIds(createProviderForm.modelIdsText))
const currentModelInputTypes = computed(() => normalizeModelInputTypeSelection(providerForm.modelInputTypes))
const createCurrentModelInputTypes = computed(() => normalizeModelInputTypeSelection(createProviderForm.modelInputTypes))
const editChangePreview = computed(() => {
  if (!editingExistingProvider.value) return null
  const providerId = currentEditingProviderId.value
  const existingProvider = providerMap.value[providerId]
  if (!existingProvider) return null

  const providerPrefix = providerPathPrefixMap.value[providerId] || 'models.providers'
  const providerBasePath = `${providerPrefix}.${providerId}`
  const existingApi = readProviderText(existingProvider, ['api', 'protocol', 'format']) || ''
  const nextApi = providerForm.api || '-'
  const existingBaseUrl = readProviderText(existingProvider, ['baseUrl', 'baseURL', 'base_url', 'url', 'endpoint']) || ''
  const nextBaseUrl = providerForm.baseUrl.trim()

  const existingModelIds = normalizeUniqueIds(readProviderModelIds(existingProvider))
  const nextModelIds = normalizeUniqueIds(
    currentModelIds.value.length > 0 ? currentModelIds.value : existingModelIds
  )
  const existingInputTypes = readProviderModelInputTypes(existingProvider)
  const nextInputTypes = currentModelInputTypes.value
  const inputTypesChanged = !isSameModelInputTypes(existingInputTypes, nextInputTypes)
  const addedModelIds = nextModelIds.filter((id) => !existingModelIds.includes(id))
  const removedModelIds = existingModelIds.filter((id) => !nextModelIds.includes(id))
  const modelsChanged =
    addedModelIds.length > 0 ||
    removedModelIds.length > 0 ||
    existingModelIds.length !== nextModelIds.length

  const apiKeyInput = providerForm.apiKey.trim()
  const maskedKey = /^[*•]+$/.test(apiKeyInput)
  const willPatchApiKey = !!apiKeyInput && !maskedKey

  const warnings: string[] = []
  const patchPaths = [
    'models.mode',
    `${providerBasePath}.api`,
    `${providerBasePath}.baseUrl`,
    `${providerBasePath}.models`,
  ]

  const apiChanged = existingApi !== nextApi
  const baseUrlChanged = existingBaseUrl !== nextBaseUrl
  if (willPatchApiKey) {
    warnings.push('将写入新的 API Key，保存后页面不会回显明文 Key')
    patchPaths.push(`${providerBasePath}.apiKey`)
  }

  const currentPrimary = primaryModel.value.trim() || configStore.config?.agents?.defaults?.model?.primary || ''
  let inferredPrimary = ''
  if (!currentPrimary && nextModelIds[0]) {
    inferredPrimary = `${providerId}/${nextModelIds[0]}`
    patchPaths.push('agents.defaults.model.primary')
  }

  if (removedModelIds.length > 0) {
    warnings.push('本次会移除部分已配置模型，请确认不会影响线上默认模型或路由规则')
  }

  const hasChanges =
    apiChanged ||
    baseUrlChanged ||
    modelsChanged ||
    inputTypesChanged ||
    willPatchApiKey ||
    !!inferredPrimary

  return {
    providerId,
    hasChanges,
    warnings,
    patchPaths,
    apiDiff: {
      before: existingApi || '-',
      after: nextApi || '-',
      changed: apiChanged,
    },
    baseUrlDiff: {
      before: existingBaseUrl || '-',
      after: nextBaseUrl || '-',
      changed: baseUrlChanged,
    },
    modelDiff: {
      changed: modelsChanged,
      beforeCount: existingModelIds.length,
      afterCount: nextModelIds.length,
      added: addedModelIds,
      removed: removedModelIds,
    },
    inputDiff: {
      changed: inputTypesChanged,
      before: existingInputTypes,
      after: nextInputTypes,
    },
    apiKeyAction: willPatchApiKey ? 'overwrite' : 'keep',
    inferredPrimary: inferredPrimary || null,
  }
})

const createChangePreview = computed(() => {
  const providerId = normalizeProviderId(createProviderForm.id)
  const providerExists = !!providerMap.value[providerId]
  const api = createProviderForm.api
  const baseUrl = createProviderForm.baseUrl.trim()
  const apiKey = createProviderForm.apiKey.trim()
  const modelIds = normalizeUniqueIds(createCurrentModelIds.value)
  const inputTypes = createCurrentModelInputTypes.value
  const hasApiKey = !!apiKey

  const warnings: string[] = []
  const missingRequired: string[] = []
  const patchPaths: string[] = []

  if (!providerId) {
    warnings.push('未填写渠道 ID')
    missingRequired.push('渠道 ID')
  } else {
    patchPaths.push(
      `models.providers.${providerId}.api`,
      `models.providers.${providerId}.baseUrl`,
      `models.providers.${providerId}.apiKey`,
      `models.providers.${providerId}.models`
    )
  }

  if (providerExists) {
    warnings.push('该渠道 ID 已存在，请改用其他 ID')
  }

  if (baseUrl) {
  } else {
    warnings.push('未填写 Base URL')
    missingRequired.push('Base URL')
  }

  if (modelIds.length === 0) {
    warnings.push('未填写模型列表（可先点击“探测模型”）')
    missingRequired.push('模型列表')
  }

  if (hasApiKey) {
  } else {
    warnings.push('未填写 API Key，当前无法创建渠道')
    missingRequired.push('API Key')
  }

  const currentPrimary = primaryModel.value.trim() || configStore.config?.agents?.defaults?.model?.primary || ''
  let inferredPrimary = ''
  if (!currentPrimary && providerId && modelIds[0]) {
    inferredPrimary = `${providerId}/${modelIds[0]}`
    patchPaths.push('agents.defaults.model.primary')
  }

  if (patchPaths.length > 0) {
    patchPaths.unshift('models.mode')
  }

  const ready =
    !!providerId &&
    !providerExists &&
    !!baseUrl &&
    hasApiKey &&
    modelIds.length > 0

  return {
    ready,
    warnings,
    missingRequired,
    patchPaths,
    providerId,
    providerExists,
    api,
    baseUrl: baseUrl || '-',
    modelIds,
    inputTypes,
    hasApiKey,
    inferredPrimary: inferredPrimary || null,
  }
})
const saveConfirmTitle = computed(() =>
  confirmActionType.value === 'edit' ? '确认保存渠道修改' : '确认创建渠道'
)
const saveConfirmButtonLabel = computed(() =>
  confirmActionType.value === 'edit' ? '确认保存' : '确认创建'
)
const canConfirmSave = computed(() =>
  confirmActionType.value === 'edit'
    ? !!editChangePreview.value?.hasChanges
    : createChangePreview.value.ready
)
const selectedProviderSummary = computed(() =>
  providerSummaries.value.find((item) => item.id === selectedProviderId.value) || null
)
const providerStats = computed(() => {
  const providerCount = providerSummaries.value.length
  const modelCount = configuredModelRows.value.length
  return {
    providerCount,
    modelCount,
    selectedProvider: selectedProviderSummary.value?.id || '-',
  }
})

const primaryModelDisplay = computed(() => {
  const current = primaryModel.value.trim()
  if (current) return current
  const fromConfig = configStore.config?.models?.primary || configStore.config?.agents?.defaults?.model?.primary || ''
  return fromConfig || '-'
})

const currentPrimaryProviderId = computed(() => {
  const parsed = splitModelRef(primaryModelDisplay.value)
  return parsed?.providerId || ''
})

function sourceLabel(source: string): string {
  const map: Record<string, string> = {
    'models.providers': 'models.providers',
    models: 'models',
    'models.primary': 'models.primary',
    'models.fallback': 'models.fallback',
    'agents.defaults.models': 'agents.defaults.models',
    'agents.defaults.model.primary': 'agents.defaults.model.primary',
    'agents.defaults.model.fallback': 'agents.defaults.model.fallback',
  }
  return map[source] || source
}

function sourceTagType(source: string): 'default' | 'info' | 'success' | 'warning' {
  if (source === 'models.providers') return 'success'
  if (source === 'models') return 'info'
  return 'warning'
}

const providerColumns: DataTableColumns<ProviderSummary> = [
  {
    title: '渠道',
    key: 'id',
    width: 136,
    ellipsis: { tooltip: true },
    render(row) {
      return h('code', { style: 'font-size: 12px;' }, row.id)
    },
  },
  {
    title: '协议',
    key: 'api',
    width: 132,
    ellipsis: { tooltip: true },
    render(row) {
      return row.api || '-'
    },
  },
  {
    title: 'Base URL',
    key: 'baseUrl',
    width: 256,
    ellipsis: { tooltip: true },
    render(row) {
      return row.baseUrl || '-'
    },
  },
  {
    title: '模型数',
    key: 'modelCount',
    width: 76,
    align: 'center',
    render(row) {
      return `${row.modelIds.length}`
    },
  },
  {
    title: '来源',
    key: 'sources',
    width: 84,
    align: 'center',
    ellipsis: { tooltip: true },
    render(row) {
      return row.sources.length > 0 ? `${row.sources.length} 个` : '-'
    },
  },
  {
    title: '操作',
    key: 'actions',
    width: 214,
    render(row) {
      const isPrimaryProvider = row.id === currentPrimaryProviderId.value
      const isManagedProvider = managedProviderIdSet.value.has(row.id)
      return h(
        NSpace,
        { size: 2, wrap: false },
        () => [
          ...(isManagedProvider
            ? [
                h(
                  NButton,
                  { size: 'tiny', quaternary: true, onClick: () => handleLoadProvider(row.id) },
                  { default: () => '编辑' }
                ),
              ]
            : []),
          h(
            NButton,
            {
              size: 'tiny',
              type: isPrimaryProvider ? 'default' : 'primary',
              tertiary: !isPrimaryProvider,
              disabled: isPrimaryProvider,
              onClick: () => handleUseProviderAsPrimary(row.id, row.modelIds),
            },
            { default: () => (isPrimaryProvider ? '默认中' : '设默认') }
          ),
          ...(isManagedProvider
            ? [
                h(
                  NPopconfirm,
                  {
                    onPositiveClick: () => handleDeleteProvider(row.id),
                    positiveText: '删除',
                    negativeText: '取消',
                  },
                  {
                    trigger: () =>
                      h(
                        NButton,
                        {
                          size: 'tiny',
                          quaternary: true,
                          type: 'error',
                          disabled: isPrimaryProvider,
                          onClick: (e: MouseEvent) => e.stopPropagation(),
                        },
                        { default: () => '删除' }
                      ),
                    default: () =>
                      isPrimaryProvider
                        ? '当前默认渠道不可删除，请先切换默认模型。'
                        : `确认删除渠道 ${row.id}？`,
                  }
                ),
              ]
            : []),
        ]
      )
    },
  },
]

function providerRowProps(row: ProviderSummary) {
  const isManagedProvider = managedProviderIdSet.value.has(row.id)
  const active = row.id === selectedProviderId.value
  if (!isManagedProvider) {
    return {
      style: active ? 'cursor: default; background: rgba(32, 128, 240, 0.08);' : 'cursor: default;',
    }
  }
  return {
    style: active ? 'cursor: pointer; background: rgba(32, 128, 240, 0.08);' : 'cursor: pointer;',
    onClick: () => handleLoadProvider(row.id),
  }
}

const configuredModelColumns: DataTableColumns<ConfiguredModelRow> = [
  {
    title: '模型引用',
    key: 'modelRef',
    minWidth: 260,
    ellipsis: { tooltip: true },
    render(row) {
      return h('code', { style: 'font-size: 12px;' }, row.modelRef)
    },
  },
  {
    title: '操作',
    key: 'actions',
    width: 120,
    render(row) {
      const isPrimaryModel = row.modelRef === primaryModelDisplay.value
      return h(
        NButton,
        {
          size: 'tiny',
          type: isPrimaryModel ? 'default' : 'primary',
          tertiary: !isPrimaryModel,
          disabled: isPrimaryModel,
          onClick: () => handleUseModelAsPrimary(row.modelRef),
        },
        { default: () => (isPrimaryModel ? '默认中' : '设为默认') }
      )
    },
  },
]

watch(
  () => configStore.config,
  (config) => {
    if (!config) return
    primaryModel.value = config.models?.primary || config.agents?.defaults?.model?.primary || ''

    const allProviders = providerEntries.value.map((item) => item.id)
    if (selectedProviderId.value && !allProviders.includes(selectedProviderId.value)) {
      selectedProviderId.value = ''
    }
    const firstProvider = allProviders[0]
    if (!selectedProviderId.value && firstProvider) {
      selectedProviderId.value = firstProvider
      loadProviderForm(firstProvider)
    }
  },
  { immediate: true }
)

watch(selectedProviderId, (value) => {
  if (!value) {
    resetEditorForm()
    return
  }
  loadProviderForm(value)
})

onMounted(async () => {
  await configStore.fetchConfig()
})

function normalizeProviderId(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, '-')
}

function parseModelIds(input: string): string[] {
  const values = input
    .split(/\n|,|;/g)
    .map((item) => item.trim())
    .filter(Boolean)
  return Array.from(new Set(values))
}

function normalizeUniqueIds(ids: string[]): string[] {
  return Array.from(
    new Set(
      ids
        .map((id) => id.trim())
        .filter(Boolean)
    )
  ).sort((a, b) => a.localeCompare(b))
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return value as Record<string, unknown>
  }
  return null
}

function readExistingDefaultsModelsCatalog(): Record<string, unknown> | null {
  const agents = asRecord(configStore.config?.agents)
  const defaults = asRecord(agents?.defaults)
  const models = asRecord(defaults?.models)
  return models
}

function buildBootstrapDefaultsModelsCatalog(): Record<string, unknown> {
  const next: Record<string, unknown> = {}
  for (const provider of providerSummaries.value) {
    for (const modelId of provider.modelIds) {
      const modelRef = `${provider.id}/${modelId}`.trim()
      if (!modelRef) continue
      next[modelRef] = {
        alias: modelId || modelRef,
      }
    }
  }
  return next
}

function buildMergedDefaultsModelsCatalog(
  entries: Array<{ modelRef: string; alias: string }>,
  options?: { createWhenMissing?: boolean }
): Record<string, unknown> | null {
  const existing = readExistingDefaultsModelsCatalog()
  if (!existing && !options?.createWhenMissing) return null

  const next: Record<string, unknown> = existing ? { ...existing } : buildBootstrapDefaultsModelsCatalog()
  let changed = !existing && Object.keys(next).length > 0

  for (const entry of entries) {
    const modelRef = entry.modelRef.trim()
    if (!modelRef) continue
    if (Object.prototype.hasOwnProperty.call(next, modelRef)) continue

    next[modelRef] = {
      alias: entry.alias.trim() || modelRef,
    }
    changed = true
  }

  return changed ? next : null
}

function buildAllowlistEntriesFromProvider(
  providerId: string,
  modelIds: string[]
): Array<{ modelRef: string; alias: string }> {
  return normalizeUniqueIds(modelIds).map((modelId) => ({
    modelRef: `${providerId}/${modelId}`,
    alias: modelId,
  }))
}

function buildDefaultsModelsCatalogWithoutProvider(providerId: string): Record<string, unknown> | null {
  const existing = readExistingDefaultsModelsCatalog()
  if (!existing) return null

  const prefix = `${providerId.toLowerCase()}/`
  const next: Record<string, unknown> = {}
  let changed = false

  for (const [modelRef, entry] of Object.entries(existing)) {
    if (modelRef.trim().toLowerCase().startsWith(prefix)) {
      changed = true
      continue
    }
    next[modelRef] = entry
  }

  return changed ? next : null
}

function resetEditorForm() {
  providerForm.id = ''
  providerForm.api = 'openai-completions'
  providerForm.baseUrl = ''
  providerForm.apiKey = ''
  providerForm.modelInputTypes = [...DEFAULT_MODEL_INPUT_TYPES]
  providerForm.modelIdsText = ''
  probeError.value = ''
}

function resetCreateProviderForm() {
  createProviderForm.id = ''
  createProviderForm.api = 'openai-completions'
  createProviderForm.baseUrl = ''
  createProviderForm.apiKey = ''
  createProviderForm.modelInputTypes = [...DEFAULT_MODEL_INPUT_TYPES]
  createProviderForm.modelIdsText = ''
  createProbeError.value = ''
}

function buildProbeUrls(baseUrl: string, apiType: string): string[] {
  const trimmed = baseUrl.trim().replace(/\/+$/, '')
  if (!trimmed) return []

  if (apiType === 'google-generative-ai') {
    if (/\/models$/i.test(trimmed)) {
      return [trimmed]
    }
    return [`${trimmed}/models`]
  }

  const urls = []
  if (/\/models$/i.test(trimmed)) {
    urls.push(trimmed)
  } else {
    urls.push(`${trimmed}/models`)
    if (!/\/v1$/i.test(trimmed)) {
      urls.push(`${trimmed}/v1/models`)
    }
  }

  return Array.from(new Set(urls))
}

function appendApiKeyToUrl(url: string, apiKey: string): string {
  try {
    const parsed = new URL(url)
    if (!parsed.searchParams.has('key')) {
      parsed.searchParams.set('key', apiKey)
    }
    return parsed.toString()
  } catch {
    const separator = url.includes('?') ? '&' : '?'
    return `${url}${separator}key=${encodeURIComponent(apiKey)}`
  }
}

function parseModelIdsFromPayload(payload: unknown): string[] {
  const ids = new Set<string>()

  const collect = (value: unknown) => {
    if (!value) return
    if (typeof value === 'string') {
      ids.add(value)
      return
    }
    if (typeof value === 'object' && !Array.isArray(value)) {
      const row = value as Record<string, unknown>
      if (typeof row.id === 'string' && row.id.trim()) ids.add(row.id)
      else if (typeof row.name === 'string' && row.name.trim()) ids.add(row.name)
      return
    }
  }

  if (Array.isArray(payload)) {
    payload.forEach(collect)
    return Array.from(ids)
  }

  if (payload && typeof payload === 'object') {
    const row = payload as Record<string, unknown>
    if (Array.isArray(row.data)) row.data.forEach(collect)
    if (Array.isArray(row.models)) row.models.forEach(collect)
    if (Array.isArray(row.items)) row.items.forEach(collect)
  }

  return Array.from(ids)
}

function loadProviderForm(providerId: string) {
  const provider = providerMap.value[providerId]

  providerForm.id = providerId
  providerForm.api = readProviderText(provider, ['api', 'protocol', 'format']) || 'openai-completions'
  providerForm.baseUrl = readProviderText(provider, ['baseUrl', 'baseURL', 'base_url', 'url', 'endpoint']) || ''
  providerForm.modelInputTypes = readProviderModelInputTypes(provider)
  // 不回显线上 Key，避免在 UI 里泄露；编辑时可重新输入覆盖
  providerForm.apiKey = ''
  providerForm.modelIdsText = readProviderModelIds(provider).join('\n')
  probeError.value = ''
}

function handleNewProvider() {
  resetCreateProviderForm()
  createActiveTab.value = 'basic'
  showCreateProviderModal.value = true
}

function openSaveConfirm(action: 'edit' | 'create') {
  confirmActionType.value = action
  showSaveConfirmModal.value = true
}

function handleLoadProvider(providerId: string) {
  selectedProviderId.value = providerId
  editActiveTab.value = 'basic'
}

async function savePrimaryModel(targetInput: string): Promise<void> {
  const target = targetInput.trim()
  if (!target) {
    message.warning('请先选择或输入默认模型')
    return
  }

  const parsedTarget = splitModelRef(target)
  const mergedDefaultsModels = parsedTarget
    ? buildMergedDefaultsModelsCatalog([
        {
          modelRef: `${parsedTarget.providerId}/${parsedTarget.modelId}`,
          alias: parsedTarget.modelId,
        },
      ], {
        createWhenMissing: true,
      })
    : null

  const patches: ConfigPatch[] = [
    { path: 'agents.defaults.model.primary', value: target },
  ]
  if (mergedDefaultsModels) {
    patches.push({ path: 'agents.defaults.models', value: mergedDefaultsModels })
  }

  try {
    await configStore.patchConfig(patches)
    primaryModel.value = target
    message.success(`默认模型已保存：${target}`)
  } catch (error) {
    message.error(error instanceof Error ? error.message : '保存失败')
  }
}

async function handleUseProviderAsPrimary(providerId: string, modelIds: string[]) {
  if (modelIds.length === 0) {
    message.warning('该渠道没有可用模型，无法设置默认模型')
    return
  }
  const primary = `${providerId}/${modelIds[0]}`
  await savePrimaryModel(primary)
}

async function handleUseModelAsPrimary(modelRef: string) {
  const value = modelRef.trim()
  if (!value) return
  await savePrimaryModel(value)
}

async function handleDeleteProvider(providerIdInput: string): Promise<void> {
  const providerId = normalizeProviderId(providerIdInput)
  if (!providerId) return

  if (providerId === currentPrimaryProviderId.value) {
    message.warning('当前默认渠道不允许删除，请先切换默认模型')
    return
  }

  if (!providerMap.value[providerId]) {
    message.warning('该渠道来自模型白名单（如 agents.defaults.models），不支持删除')
    return
  }

  const providerPrefix = providerPathPrefixMap.value[providerId] || 'models.providers'
  const patches: ConfigPatch[] = [
    { path: `${providerPrefix}.${providerId}`, value: null },
  ]

  const nextDefaultsModels = buildDefaultsModelsCatalogWithoutProvider(providerId)
  if (nextDefaultsModels) {
    patches.push({
      path: 'agents.defaults.models',
      value: Object.keys(nextDefaultsModels).length > 0 ? nextDefaultsModels : null,
    })
  }

  try {
    await configStore.patchConfig(patches)
    if (selectedProviderId.value === providerId) {
      selectedProviderId.value = ''
    }
    message.success(`已删除渠道：${providerId}`)
  } catch (error) {
    message.error(error instanceof Error ? error.message : '删除失败')
  }
}

async function probeModelsFromProvider(baseUrl: string, apiKey: string, apiType: string): Promise<string[]> {
  const urls = buildProbeUrls(baseUrl, apiType)
  if (urls.length === 0) {
    throw new Error('Base URL 不能为空')
  }

  const isGoogleApi = apiType === 'google-generative-ai'
  let lastError: string | null = null
  for (const url of urls) {
    try {
      const requestUrl = isGoogleApi ? appendApiKeyToUrl(url, apiKey) : url
      const headers: Record<string, string> = {}
      if (isGoogleApi) {
        // Google 探测仅用 query key，尽量避免浏览器预检导致的 CORS 失败
        headers.Accept = 'application/json'
      } else {
        headers.Authorization = `Bearer ${apiKey}`
      }

      const response = await fetch(requestUrl, {
        method: 'GET',
        headers,
      })

      if (!response.ok) {
        lastError = `${requestUrl} -> HTTP ${response.status}`
        continue
      }

      const payload = (await response.json()) as unknown
      const modelIds = parseModelIdsFromPayload(payload)
      if (modelIds.length > 0) {
        return modelIds
      }
      lastError = `${requestUrl} 返回成功，但未解析到模型列表`
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error)
      if (isGoogleApi && /failed to fetch/i.test(reason)) {
        lastError = `${url} 请求失败：浏览器跨域限制（CORS）。请先保存渠道后在编辑态探测（走网关）或手动填写模型 ID。`
      } else {
        lastError = `${url} 请求失败：${reason}`
      }
    }
  }

  throw new Error(lastError || '探测失败')
}

async function probeModelsFromGateway(providerId: string): Promise<string[]> {
  const runtimeModels = await wsStore.rpc.listModels()
  const ids = new Set<string>()

  for (const item of runtimeModels) {
    const rowProvider = (item.provider || '').trim()
    const rowId = (item.id || '').trim()
    if (!rowId) continue

    const matchesProvider = rowProvider === providerId || rowId.startsWith(`${providerId}/`)
    if (!matchesProvider) continue

    const normalized = rowId.startsWith(`${providerId}/`)
      ? rowId.slice(providerId.length + 1).trim()
      : rowId
    if (normalized) {
      ids.add(normalized)
    }
  }

  return Array.from(ids)
}

async function handleProbeModels() {
  const baseUrl = providerForm.baseUrl.trim()
  const apiType = providerForm.api || 'openai-completions'
  const providerId = currentEditingProviderId.value
  const inputApiKey = providerForm.apiKey.trim()
  const existingProviderKey = readProviderApiKeyForProbe(providerMap.value[currentEditingProviderId.value])
  const apiKey = inputApiKey || existingProviderKey
  if (!baseUrl) {
    message.warning('请填写 Base URL')
    return
  }
  if (!apiKey) {
    if (selectedProviderHasKey.value) {
      message.warning('当前渠道 Key 已配置但不可读取，请手动输入一次用于探测')
    } else {
      message.warning('请填写 API Key')
    }
    return
  }

  probing.value = true
  probeError.value = ''
  try {
    const modelIds = await probeModelsFromProvider(baseUrl, apiKey, apiType)
    providerForm.modelIdsText = modelIds.join('\n')
    editActiveTab.value = 'models'
    message.success(`探测到 ${modelIds.length} 个模型`)
  } catch (error) {
    const errorText = error instanceof Error ? error.message : String(error)
    if (providerId) {
      try {
        const runtimeModelIds = await probeModelsFromGateway(providerId)
        if (runtimeModelIds.length > 0) {
          providerForm.modelIdsText = runtimeModelIds.join('\n')
          editActiveTab.value = 'models'
          message.success(`直连失败，已通过网关读取到 ${runtimeModelIds.length} 个模型`)
          return
        }
      } catch {
        // ignore, fallback to original error below
      }
    }
    probeError.value = errorText
    message.error('模型探测失败')
  } finally {
    probing.value = false
  }
}

async function handleSaveProvider(confirmed = false) {
  const providerId = normalizeProviderId(providerForm.id)
  const baseUrl = providerForm.baseUrl.trim()
  const apiKey = providerForm.apiKey.trim()
  const inputTypes = currentModelInputTypes.value
  const modelIds = parseModelIds(providerForm.modelIdsText)
  const existingProvider = providerMap.value[providerId]
  const existingModelIds = readProviderModelIds(existingProvider)
  const finalModelIds = modelIds.length > 0 ? modelIds : existingModelIds
  const maskedKey = /^[*•]+$/.test(apiKey)
  const shouldPatchApiKey = !!apiKey && !maskedKey

  if (!existingProvider) {
    message.warning('请从左侧选择已配置渠道进行编辑；新增请使用“新建渠道”')
    return
  }
  if (!editChangePreview.value?.hasChanges) {
    message.info('未检测到配置变更')
    return
  }
  if (!confirmed) {
    openSaveConfirm('edit')
    return
  }
  if (!providerId) {
    message.warning('请填写渠道 ID')
    return
  }
  if (!/^[a-z0-9_-]+$/.test(providerId)) {
    message.warning('渠道 ID 仅支持小写字母、数字、下划线和中划线')
    return
  }
  if (!baseUrl) {
    message.warning('请填写 Base URL')
    return
  }
  if (finalModelIds.length === 0) {
    message.warning('请先探测模型或手动填写模型 ID')
    return
  }

  const providerPrefix = providerPathPrefixMap.value[providerId] || 'models.providers'
  const providerBasePath = `${providerPrefix}.${providerId}`
  const existingModelsRaw = existingProvider && typeof existingProvider === 'object' ? (existingProvider as Record<string, unknown>).models : undefined
  const shouldWriteModelMap =
    !!existingModelsRaw && typeof existingModelsRaw === 'object' && !Array.isArray(existingModelsRaw)
  const modelsValue = shouldWriteModelMap
    ? Object.fromEntries(finalModelIds.map((id) => [id, { id, name: id, input: [...inputTypes] }]))
    : finalModelIds.map((id) => ({ id, name: id, input: [...inputTypes] }))
  const patches: ConfigPatch[] = [
    { path: 'models.mode', value: 'merge' },
    { path: `${providerBasePath}.api`, value: providerForm.api },
    { path: `${providerBasePath}.baseUrl`, value: baseUrl },
    {
      path: `${providerBasePath}.models`,
      value: modelsValue,
    },
  ]
  if (shouldPatchApiKey) {
    patches.push({ path: `${providerBasePath}.apiKey`, value: apiKey })
  }

  const mergedDefaultsModels = buildMergedDefaultsModelsCatalog(
    buildAllowlistEntriesFromProvider(providerId, finalModelIds),
    { createWhenMissing: true }
  )
  if (mergedDefaultsModels) {
    patches.push({ path: 'agents.defaults.models', value: mergedDefaultsModels })
  }

  const currentPrimary = primaryModel.value.trim() || configStore.config?.agents?.defaults?.model?.primary || ''
  if (!currentPrimary) {
    const inferredPrimary = `${providerId}/${finalModelIds[0]}`
    patches.push({ path: 'agents.defaults.model.primary', value: inferredPrimary })
  }

  try {
    await configStore.patchConfig(patches)
    showSaveConfirmModal.value = false
    selectedProviderId.value = providerId
    providerForm.id = providerId
    providerForm.apiKey = ''
    message.success(shouldPatchApiKey ? '模型渠道已保存' : '模型渠道已保存（Key 保持不变）')
  } catch (error) {
    message.error(error instanceof Error ? error.message : '保存失败')
  }
}

async function handleProbeCreateProviderModels() {
  const baseUrl = createProviderForm.baseUrl.trim()
  const apiType = createProviderForm.api || 'openai-completions'
  const apiKey = createProviderForm.apiKey.trim()
  if (!baseUrl) {
    message.warning('请填写 Base URL')
    return
  }
  if (!apiKey) {
    message.warning('请填写 API Key')
    return
  }

  probingCreateProvider.value = true
  createProbeError.value = ''
  try {
    const modelIds = await probeModelsFromProvider(baseUrl, apiKey, apiType)
    createProviderForm.modelIdsText = modelIds.join('\n')
    createActiveTab.value = 'models'
    message.success(`探测到 ${modelIds.length} 个模型`)
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error)
    createProbeError.value = reason
    message.error('模型探测失败')
  } finally {
    probingCreateProvider.value = false
  }
}

async function handleCreateProvider(confirmed = false) {
  const providerId = normalizeProviderId(createProviderForm.id)
  const baseUrl = createProviderForm.baseUrl.trim()
  const apiKey = createProviderForm.apiKey.trim()
  const inputTypes = createCurrentModelInputTypes.value
  const modelIds = parseModelIds(createProviderForm.modelIdsText)

  if (!providerId) {
    message.warning('请填写渠道 ID')
    return
  }
  if (!/^[a-z0-9_-]+$/.test(providerId)) {
    message.warning('渠道 ID 仅支持小写字母、数字、下划线和中划线')
    return
  }
  if (providerMap.value[providerId]) {
    message.warning('该渠道已存在，请在左侧列表中编辑')
    return
  }
  if (!baseUrl) {
    message.warning('请填写 Base URL')
    return
  }
  if (!apiKey) {
    message.warning('新建渠道时必须填写 API Key')
    return
  }
  if (!confirmed) {
    openSaveConfirm('create')
    return
  }

  const patches: ConfigPatch[] = [
    { path: 'models.mode', value: 'merge' },
    { path: `models.providers.${providerId}.api`, value: createProviderForm.api },
    { path: `models.providers.${providerId}.baseUrl`, value: baseUrl },
    { path: `models.providers.${providerId}.apiKey`, value: apiKey },
    {
      path: `models.providers.${providerId}.models`,
      value: modelIds.map((id) => ({ id, name: id, input: [...inputTypes] })),
    },
  ]

  const mergedDefaultsModels = buildMergedDefaultsModelsCatalog(
    buildAllowlistEntriesFromProvider(providerId, modelIds),
    { createWhenMissing: true }
  )
  if (mergedDefaultsModels) {
    patches.push({ path: 'agents.defaults.models', value: mergedDefaultsModels })
  }

  const currentPrimary = primaryModel.value.trim() || configStore.config?.agents?.defaults?.model?.primary || ''
  if (!currentPrimary) {
    const inferredPrimary = `${providerId}/${modelIds[0]}`
    patches.push({ path: 'agents.defaults.model.primary', value: inferredPrimary })
  }

  try {
    await configStore.patchConfig(patches)
    showSaveConfirmModal.value = false
    showCreateProviderModal.value = false
    selectedProviderId.value = providerId
    loadProviderForm(providerId)
    message.success('模型渠道已创建')
  } catch (error) {
    message.error(error instanceof Error ? error.message : '创建失败')
  }
}

async function handleConfirmSave() {
  if (confirmActionType.value === 'edit') {
    await handleSaveProvider(true)
    return
  }
  await handleCreateProvider(true)
}

function handleSaveProviderClick() {
  void handleSaveProvider()
}

function handleCreateProviderClick() {
  void handleCreateProvider()
}
</script>

<template>
  <div class="models-page">
    <NCard class="models-overview-card" :bordered="false">
      <template #header>
        <div class="models-overview-title">模型管理总览</div>
      </template>
      <template #header-extra>
        <NButton size="small" :loading="configStore.loading" @click="configStore.fetchConfig()">
          <template #icon><NIcon :component="RefreshOutline" /></template>
          刷新配置
        </NButton>
      </template>

      <NAlert type="info" :bordered="false" style="margin-bottom: 12px;">
        模型引用格式为 <code>provider/model</code>，建议通过 <code>models.providers</code> 统一维护渠道。
      </NAlert>

      <NAlert v-if="configStore.lastError" type="error" :bordered="false" style="margin-bottom: 12px;">
        {{ configStore.lastError }}
      </NAlert>

      <div class="models-overview-metrics">
        <div class="models-metric-item">
          <NText depth="3">渠道总数</NText>
          <div class="models-metric-value">{{ providerStats.providerCount }}</div>
        </div>
        <div class="models-metric-item">
          <NText depth="3">模型引用数</NText>
          <div class="models-metric-value">{{ providerStats.modelCount }}</div>
        </div>
        <div class="models-metric-item">
          <NText depth="3">当前编辑</NText>
          <div class="models-metric-value">{{ providerStats.selectedProvider }}</div>
        </div>
        <div class="models-metric-item">
          <NText depth="3">默认模型</NText>
          <div class="models-metric-value models-metric-code">{{ primaryModelDisplay }}</div>
        </div>
      </div>

    </NCard>

    <NCard title="渠道工作台" class="models-workbench-card">
      <NGrid cols="1 xl:12" responsive="screen" :x-gap="16" :y-gap="16">
        <NGridItem class="models-workbench-item" span="1 xl:8">
          <div class="models-panel">
            <NSpace justify="space-between" align="center" :size="8" class="models-panel-toolbar">
              <NInput
                v-model:value="providerSearch"
                size="small"
                placeholder="搜索渠道 / Base URL / 模型"
                style="width: 100%; max-width: 340px;"
              />
              <NButton size="small" type="primary" @click="handleNewProvider">
                <template #icon><NIcon :component="AddOutline" /></template>
                新建渠道
              </NButton>
            </NSpace>

            <NDataTable
              class="models-provider-table"
              :columns="providerColumns"
              :data="filteredProviderSummaries"
              :loading="configStore.loading"
              :bordered="false"
              :pagination="{ pageSize: 8 }"
              :row-key="(row: ProviderSummary) => row.id"
              :row-props="providerRowProps"
              striped
            />

            <NEmpty
              v-if="!configStore.loading && providerSummaries.length === 0"
              description="未读取到任何已配置渠道"
              class="models-empty"
            >
              <template #extra>
                <NText depth="3">请检查 <code>models.providers</code> 配置或 Token 权限</NText>
              </template>
            </NEmpty>
          </div>
        </NGridItem>

        <NGridItem class="models-workbench-item" span="1 xl:4">
          <div class="models-panel">
            <div class="models-editor-header">
              <NText strong>{{ providerEditorTitle }}</NText>
              <NSpace v-if="selectedProviderSummary" :size="6" style="flex-wrap: wrap;">
                <NTag size="small" :bordered="false">模型 {{ selectedProviderSummary.modelIds.length }}</NTag>
                <NTag
                  v-for="source in selectedProviderSummary.sources"
                  :key="source"
                  size="small"
                  :bordered="false"
                  :type="sourceTagType(source)"
                >
                  {{ sourceLabel(source) }}
                </NTag>
              </NSpace>
            </div>

            <template v-if="editingExistingProvider">
              <NTabs v-model:value="editActiveTab" type="line" animated>
                <NTabPane name="basic" tab="1. 基本信息">
                  <NForm label-placement="left" label-width="100">
                    <NFormItem label="渠道 ID">
                      <NInput
                        v-model:value="providerForm.id"
                        :disabled="true"
                        placeholder="例如：moonshot / openrouter / myproxy"
                      />
                    </NFormItem>
                    <NFormItem label="API 协议">
                      <NSelect v-model:value="providerForm.api" :options="apiOptions" />
                    </NFormItem>
                    <NFormItem label="Base URL">
                      <NInput v-model:value="providerForm.baseUrl" placeholder="例如：https://api.openai.com/v1" />
                    </NFormItem>
                    <NFormItem label="API Key">
                      <NSpace vertical :size="6" style="width: 100%;">
                        <NInput
                          v-model:value="providerForm.apiKey"
                          type="password"
                          show-password-on="click"
                          :placeholder="apiKeyPlaceholder"
                        />
                        <NText depth="3" style="font-size: 12px;">
                          留空会保持线上 Key 不变；探测模型会优先使用已配置 Key（可读取时）。
                        </NText>
                      </NSpace>
                    </NFormItem>
                    <NFormItem label="Key 状态">
                      <NTag size="small" :bordered="false" :type="selectedProviderHasKey ? 'success' : 'default'">
                        {{ selectedProviderHasKey ? '已配置（已隐藏）' : '未配置' }}
                      </NTag>
                    </NFormItem>
                    <NFormItem>
                      <NSpace justify="end" style="width: 100%;">
                        <NButton @click="editActiveTab = 'models'">下一步：模型管理</NButton>
                      </NSpace>
                    </NFormItem>
                  </NForm>
                </NTabPane>

                <NTabPane name="models" tab="2. 模型管理">
                  <NForm label-placement="left" label-width="100">
                    <NFormItem label="输入类型">
                      <NSelect
                        v-model:value="providerForm.modelInputTypes"
                        :options="modelInputTypeOptions"
                        multiple
                        placeholder="选择该渠道模型支持的输入类型（可多选）"
                      />
                    </NFormItem>
                    <NFormItem label="模型列表">
                      <NInput
                        v-model:value="providerForm.modelIdsText"
                        type="textarea"
                        :autosize="{ minRows: 5, maxRows: 10 }"
                        placeholder="一行一个模型 ID；可点击“探测模型”自动填充"
                      />
                    </NFormItem>
                    <NFormItem v-if="currentModelIds.length" label="已识别">
                      <NSpace :size="6" style="flex-wrap: wrap;">
                        <NTag
                          v-for="id in currentModelIds.slice(0, 20)"
                          :key="id"
                          size="small"
                          :bordered="false"
                        >
                          {{ id }}
                        </NTag>
                        <NText depth="3" v-if="currentModelIds.length > 20">共 {{ currentModelIds.length }} 个模型</NText>
                      </NSpace>
                    </NFormItem>
                    <NFormItem>
                      <NSpace justify="space-between" style="width: 100%;">
                        <NSpace>
                          <NButton :loading="probing" @click="handleProbeModels">
                            <template #icon><NIcon :component="SearchOutline" /></template>
                            探测模型
                          </NButton>
                        </NSpace>
                        <NSpace>
                          <NButton @click="editActiveTab = 'basic'">上一步</NButton>
                          <NButton type="primary" @click="editActiveTab = 'preview'">下一步：保存预览</NButton>
                        </NSpace>
                      </NSpace>
                    </NFormItem>
                  </NForm>
                  <NAlert v-if="probeError" type="error" :bordered="false" style="margin-top: 8px;">
                    {{ probeError }}
                  </NAlert>
                </NTabPane>

                <NTabPane name="preview" tab="3. 保存预览">
                  <NSpace vertical :size="10">
                    <NDescriptions bordered :column="1" size="small" label-placement="left">
                      <NDescriptionsItem label="API 协议">
                        <NTag size="small" :type="editChangePreview?.apiDiff.changed ? 'warning' : 'default'" :bordered="false">
                          {{ editChangePreview?.apiDiff.before || '-' }} -> {{ editChangePreview?.apiDiff.after || '-' }}
                        </NTag>
                      </NDescriptionsItem>
                      <NDescriptionsItem label="Base URL">
                        <NTag size="small" :type="editChangePreview?.baseUrlDiff.changed ? 'warning' : 'default'" :bordered="false">
                          {{ editChangePreview?.baseUrlDiff.before || '-' }} -> {{ editChangePreview?.baseUrlDiff.after || '-' }}
                        </NTag>
                      </NDescriptionsItem>
                      <NDescriptionsItem label="模型数量">
                        <NTag size="small" :type="editChangePreview?.modelDiff.changed ? 'warning' : 'default'" :bordered="false">
                          {{ editChangePreview?.modelDiff.beforeCount || 0 }} -> {{ editChangePreview?.modelDiff.afterCount || 0 }}
                        </NTag>
                      </NDescriptionsItem>
                      <NDescriptionsItem label="输入类型">
                        <NTag size="small" :type="editChangePreview?.inputDiff.changed ? 'warning' : 'default'" :bordered="false">
                          {{ editChangePreview?.inputDiff.before.join(', ') || '-' }} -> {{ editChangePreview?.inputDiff.after.join(', ') || '-' }}
                        </NTag>
                      </NDescriptionsItem>
                      <NDescriptionsItem label="API Key">
                        <NTag
                          size="small"
                          :type="editChangePreview?.apiKeyAction === 'overwrite' ? 'warning' : 'default'"
                          :bordered="false"
                        >
                          {{ editChangePreview?.apiKeyAction === 'overwrite' ? '覆盖线上 Key' : '保持不变' }}
                        </NTag>
                      </NDescriptionsItem>
                      <NDescriptionsItem label="默认模型">
                        <NTag size="small" :type="editChangePreview?.inferredPrimary ? 'warning' : 'default'" :bordered="false">
                          {{ editChangePreview?.inferredPrimary || '不变' }}
                        </NTag>
                      </NDescriptionsItem>
                    </NDescriptions>

                    <NCollapse v-if="editChangePreview?.modelDiff.changed">
                      <NCollapseItem
                        :title="`模型变更详情（+${editChangePreview?.modelDiff.added.length || 0} / -${editChangePreview?.modelDiff.removed.length || 0}）`"
                        name="edit-model-diff"
                      >
                        <NSpace vertical :size="8">
                          <div v-if="editChangePreview?.modelDiff.added.length">
                            <NText depth="3" style="font-size: 12px;">新增模型</NText>
                            <NSpace :size="6" style="margin-top: 6px; flex-wrap: wrap;">
                              <NTag
                                v-for="id in editChangePreview?.modelDiff.added"
                                :key="`add-${id}`"
                                type="success"
                                size="small"
                                :bordered="false"
                              >
                                + {{ id }}
                              </NTag>
                            </NSpace>
                          </div>
                          <div v-if="editChangePreview?.modelDiff.removed.length">
                            <NText depth="3" style="font-size: 12px;">移除模型</NText>
                            <NSpace :size="6" style="margin-top: 6px; flex-wrap: wrap;">
                              <NTag
                                v-for="id in editChangePreview?.modelDiff.removed"
                                :key="`remove-${id}`"
                                type="error"
                                size="small"
                                :bordered="false"
                              >
                                - {{ id }}
                              </NTag>
                            </NSpace>
                          </div>
                        </NSpace>
                      </NCollapseItem>
                    </NCollapse>

                    <NText depth="3" style="font-size: 12px;">
                      将写入路径：{{ editChangePreview?.patchPaths.join('，') || '-' }}
                    </NText>

                    <NAlert v-if="editChangePreview?.warnings.length" type="warning" :bordered="false">
                      <div v-for="(warning, index) in editChangePreview?.warnings" :key="index">
                        {{ warning }}
                      </div>
                    </NAlert>

                    <NAlert v-if="editChangePreview && !editChangePreview.hasChanges" type="info" :bordered="false">
                      当前未检测到配置差异，保存按钮已禁用。
                    </NAlert>

                    <NSpace justify="space-between">
                      <NButton @click="editActiveTab = 'models'">上一步</NButton>
                      <NButton
                        type="primary"
                        :loading="configStore.saving"
                        :disabled="!editChangePreview?.hasChanges"
                        @click="handleSaveProviderClick"
                      >
                        <template #icon><NIcon :component="SaveOutline" /></template>
                        {{ providerSubmitLabel }}
                      </NButton>
                    </NSpace>
                  </NSpace>
                </NTabPane>
              </NTabs>

              <NCollapse v-if="selectedProviderRawText" style="margin-top: 12px;">
                <NCollapseItem title="查看当前渠道原始配置（Key 已脱敏）" name="provider-raw-json">
                  <NCode :code="selectedProviderRawText" language="json" style="font-size: 12px;" />
                </NCollapseItem>
              </NCollapse>
            </template>

            <NEmpty v-else description="请从左侧选择一个已配置渠道进行编辑">
              <template #extra>
                <NButton size="small" type="primary" @click="handleNewProvider">
                  <template #icon><NIcon :component="AddOutline" /></template>
                  新建渠道
                </NButton>
              </template>
            </NEmpty>
          </div>
        </NGridItem>
      </NGrid>
    </NCard>

    <NModal
      v-model:show="showCreateProviderModal"
      preset="card"
      title="新建渠道"
      style="max-width: 720px; width: 92vw;"
      :mask-closable="false"
    >
      <NAlert type="default" :bordered="false" style="margin-bottom: 12px;">
        新建流程：填写基础信息 -> 探测/确认模型 -> 查看保存预览 -> 创建渠道。
      </NAlert>

      <NTabs v-model:value="createActiveTab" type="line" animated>
        <NTabPane name="basic" tab="1. 基本信息">
          <NForm label-placement="left" label-width="100">
            <NFormItem label="渠道 ID">
              <NInput v-model:value="createProviderForm.id" placeholder="例如：moonshot / openrouter / myproxy" />
            </NFormItem>
            <NFormItem label="API 协议">
              <NSelect v-model:value="createProviderForm.api" :options="apiOptions" />
            </NFormItem>
            <NFormItem label="Base URL">
              <NInput v-model:value="createProviderForm.baseUrl" placeholder="例如：https://api.openai.com/v1" />
            </NFormItem>
            <NFormItem label="API Key">
              <NInput
                v-model:value="createProviderForm.apiKey"
                type="password"
                show-password-on="click"
                placeholder="新建渠道必须填写 API Key"
              />
            </NFormItem>
            <NFormItem>
              <NSpace justify="end" style="width: 100%;">
                <NButton type="primary" @click="createActiveTab = 'models'">下一步：模型管理</NButton>
              </NSpace>
            </NFormItem>
          </NForm>
        </NTabPane>

        <NTabPane name="models" tab="2. 模型管理">
          <NForm label-placement="left" label-width="100">
            <NFormItem label="输入类型">
              <NSelect
                v-model:value="createProviderForm.modelInputTypes"
                :options="modelInputTypeOptions"
                multiple
                placeholder="选择该渠道模型支持的输入类型（可多选）"
              />
            </NFormItem>
            <NFormItem label="模型列表">
              <NInput
                v-model:value="createProviderForm.modelIdsText"
                type="textarea"
                :autosize="{ minRows: 5, maxRows: 10 }"
                placeholder="一行一个模型 ID；可点击“探测模型”自动填充"
              />
            </NFormItem>
            <NFormItem v-if="createCurrentModelIds.length" label="已识别">
              <NSpace :size="6" style="flex-wrap: wrap;">
                <NTag
                  v-for="id in createCurrentModelIds.slice(0, 20)"
                  :key="id"
                  size="small"
                  :bordered="false"
                >
                  {{ id }}
                </NTag>
                <NText depth="3" v-if="createCurrentModelIds.length > 20">
                  共 {{ createCurrentModelIds.length }} 个模型
                </NText>
              </NSpace>
            </NFormItem>
            <NFormItem>
              <NSpace justify="space-between" style="width: 100%;">
                <NButton @click="createActiveTab = 'basic'">上一步</NButton>
                <NSpace>
                  <NButton :loading="probingCreateProvider" @click="handleProbeCreateProviderModels">
                    <template #icon><NIcon :component="SearchOutline" /></template>
                    探测模型
                  </NButton>
                  <NButton type="primary" @click="createActiveTab = 'preview'">下一步：保存预览</NButton>
                </NSpace>
              </NSpace>
            </NFormItem>
          </NForm>
          <NAlert v-if="createProbeError" type="error" :bordered="false" style="margin-top: 8px;">
            {{ createProbeError }}
          </NAlert>
        </NTabPane>

        <NTabPane name="preview" tab="3. 保存预览">
          <NSpace vertical :size="8">
            <NDescriptions bordered :column="1" size="small" label-placement="left">
              <NDescriptionsItem label="渠道 ID">
                <NTag size="small" :type="createChangePreview.providerExists ? 'error' : 'info'" :bordered="false">
                  {{ createChangePreview.providerId || '未填写' }}
                </NTag>
              </NDescriptionsItem>
              <NDescriptionsItem label="API 协议">
                <NTag size="small" :bordered="false">{{ createChangePreview.api }}</NTag>
              </NDescriptionsItem>
              <NDescriptionsItem label="Base URL">
                <NTag size="small" :type="createChangePreview.baseUrl === '-' ? 'warning' : 'default'" :bordered="false">
                  {{ createChangePreview.baseUrl }}
                </NTag>
              </NDescriptionsItem>
              <NDescriptionsItem label="模型数量">
                <NTag size="small" :type="createChangePreview.modelIds.length > 0 ? 'default' : 'warning'" :bordered="false">
                  {{ createChangePreview.modelIds.length }}
                </NTag>
              </NDescriptionsItem>
              <NDescriptionsItem label="输入类型">
                <NTag size="small" :bordered="false">
                  {{ createChangePreview.inputTypes.join(', ') }}
                </NTag>
              </NDescriptionsItem>
              <NDescriptionsItem label="API Key">
                <NTag size="small" :type="createChangePreview.hasApiKey ? 'warning' : 'error'" :bordered="false">
                  {{ createChangePreview.hasApiKey ? '将写入（不回显）' : '未填写' }}
                </NTag>
              </NDescriptionsItem>
              <NDescriptionsItem label="默认模型">
                <NTag size="small" :type="createChangePreview.inferredPrimary ? 'warning' : 'default'" :bordered="false">
                  {{ createChangePreview.inferredPrimary || '不变' }}
                </NTag>
              </NDescriptionsItem>
            </NDescriptions>

            <NCollapse v-if="createChangePreview.modelIds.length > 0">
              <NCollapseItem :title="`模型列表（${createChangePreview.modelIds.length}）`" name="create-model-list">
                <NSpace :size="6" style="flex-wrap: wrap;">
                  <NTag
                    v-for="id in createChangePreview.modelIds"
                    :key="`create-model-${id}`"
                    size="small"
                    :bordered="false"
                  >
                    {{ id }}
                  </NTag>
                </NSpace>
              </NCollapseItem>
            </NCollapse>

            <NText depth="3" style="font-size: 12px;">
              将写入路径：{{ createChangePreview.patchPaths.join('，') || '-' }}
            </NText>

            <NAlert v-if="createChangePreview.warnings.length" type="warning" :bordered="false">
              <div v-for="(warning, index) in createChangePreview.warnings" :key="index">
                {{ warning }}
              </div>
            </NAlert>

            <NAlert v-if="!createChangePreview.ready" type="info" :bordered="false">
              需补全必填项后才可创建：{{ createChangePreview.missingRequired.join('、') || '无' }}。
            </NAlert>

            <NSpace justify="space-between">
              <NButton @click="createActiveTab = 'models'">上一步</NButton>
              <NButton
                type="primary"
                :loading="configStore.saving"
                :disabled="!createChangePreview.ready"
                @click="handleCreateProviderClick"
              >
                <template #icon><NIcon :component="SaveOutline" /></template>
                创建渠道
              </NButton>
            </NSpace>
          </NSpace>
        </NTabPane>
      </NTabs>

      <template #footer>
        <NSpace justify="end">
          <NButton @click="showCreateProviderModal = false">取消</NButton>
        </NSpace>
      </template>
    </NModal>

    <NModal
      v-model:show="showSaveConfirmModal"
      preset="card"
      :title="saveConfirmTitle"
      style="max-width: 760px; width: 92vw;"
      :mask-closable="false"
    >
      <NSpace vertical :size="12">
        <NAlert type="warning" :bordered="false">
          请确认下列变更将写入配置文件。确认后会立即调用 <code>config.patch</code>。
        </NAlert>

        <template v-if="confirmActionType === 'edit' && editChangePreview">
          <NDescriptions bordered :column="1" size="small" label-placement="left">
            <NDescriptionsItem label="编辑渠道">
              <NTag size="small" type="info" :bordered="false">
                {{ editChangePreview.providerId }}
              </NTag>
            </NDescriptionsItem>
            <NDescriptionsItem label="API 协议">
              {{ editChangePreview.apiDiff.before }} -> {{ editChangePreview.apiDiff.after }}
            </NDescriptionsItem>
            <NDescriptionsItem label="Base URL">
              {{ editChangePreview.baseUrlDiff.before }} -> {{ editChangePreview.baseUrlDiff.after }}
            </NDescriptionsItem>
            <NDescriptionsItem label="模型数量">
              {{ editChangePreview.modelDiff.beforeCount }} -> {{ editChangePreview.modelDiff.afterCount }}
            </NDescriptionsItem>
            <NDescriptionsItem label="输入类型">
              {{ editChangePreview.inputDiff.before.join(', ') || '-' }} -> {{ editChangePreview.inputDiff.after.join(', ') || '-' }}
            </NDescriptionsItem>
            <NDescriptionsItem label="API Key">
              {{ editChangePreview.apiKeyAction === 'overwrite' ? '覆盖线上 Key' : '保持不变' }}
            </NDescriptionsItem>
            <NDescriptionsItem label="默认模型">
              {{ editChangePreview.inferredPrimary || '不变' }}
            </NDescriptionsItem>
          </NDescriptions>

          <NCollapse v-if="editChangePreview.modelDiff.changed">
            <NCollapseItem
              :title="`模型差异（+${editChangePreview.modelDiff.added.length} / -${editChangePreview.modelDiff.removed.length}）`"
              name="confirm-edit-models"
            >
              <NSpace vertical :size="8">
                <div v-if="editChangePreview.modelDiff.added.length">
                  <NText depth="3" style="font-size: 12px;">新增模型</NText>
                  <NSpace :size="6" style="margin-top: 6px; flex-wrap: wrap;">
                    <NTag
                      v-for="id in editChangePreview.modelDiff.added"
                      :key="`confirm-add-${id}`"
                      type="success"
                      size="small"
                      :bordered="false"
                    >
                      + {{ id }}
                    </NTag>
                  </NSpace>
                </div>
                <div v-if="editChangePreview.modelDiff.removed.length">
                  <NText depth="3" style="font-size: 12px;">移除模型</NText>
                  <NSpace :size="6" style="margin-top: 6px; flex-wrap: wrap;">
                    <NTag
                      v-for="id in editChangePreview.modelDiff.removed"
                      :key="`confirm-remove-${id}`"
                      type="error"
                      size="small"
                      :bordered="false"
                    >
                      - {{ id }}
                    </NTag>
                  </NSpace>
                </div>
              </NSpace>
            </NCollapseItem>
          </NCollapse>

          <NText depth="3" style="font-size: 12px;">
            将写入路径：{{ editChangePreview.patchPaths.join('，') }}
          </NText>
        </template>

        <template v-else>
          <NDescriptions bordered :column="1" size="small" label-placement="left">
            <NDescriptionsItem label="创建渠道">
              <NTag size="small" type="info" :bordered="false">
                {{ createChangePreview.providerId || '未填写' }}
              </NTag>
            </NDescriptionsItem>
            <NDescriptionsItem label="API 协议">
              {{ createChangePreview.api }}
            </NDescriptionsItem>
            <NDescriptionsItem label="Base URL">
              {{ createChangePreview.baseUrl }}
            </NDescriptionsItem>
            <NDescriptionsItem label="模型数量">
              {{ createChangePreview.modelIds.length }}
            </NDescriptionsItem>
            <NDescriptionsItem label="输入类型">
              {{ createChangePreview.inputTypes.join(', ') }}
            </NDescriptionsItem>
            <NDescriptionsItem label="API Key">
              {{ createChangePreview.hasApiKey ? '将写入（不回显）' : '未填写' }}
            </NDescriptionsItem>
            <NDescriptionsItem label="默认模型">
              {{ createChangePreview.inferredPrimary || '不变' }}
            </NDescriptionsItem>
          </NDescriptions>

          <NCollapse v-if="createChangePreview.modelIds.length > 0">
            <NCollapseItem :title="`模型列表（${createChangePreview.modelIds.length}）`" name="confirm-create-models">
              <NSpace :size="6" style="flex-wrap: wrap;">
                <NTag
                  v-for="id in createChangePreview.modelIds"
                  :key="`confirm-create-${id}`"
                  size="small"
                  :bordered="false"
                >
                  {{ id }}
                </NTag>
              </NSpace>
            </NCollapseItem>
          </NCollapse>

          <NText depth="3" style="font-size: 12px;">
            将写入路径：{{ createChangePreview.patchPaths.join('，') || '-' }}
          </NText>
        </template>

        <NAlert v-if="confirmActionType === 'edit' && editChangePreview?.warnings.length" type="warning" :bordered="false">
          <div v-for="(warning, index) in editChangePreview?.warnings" :key="`confirm-edit-warning-${index}`">
            {{ warning }}
          </div>
        </NAlert>
        <NAlert v-if="confirmActionType === 'create' && createChangePreview.warnings.length" type="warning" :bordered="false">
          <div v-for="(warning, index) in createChangePreview.warnings" :key="`confirm-create-warning-${index}`">
            {{ warning }}
          </div>
        </NAlert>
      </NSpace>

      <template #footer>
        <NSpace justify="end">
          <NButton @click="showSaveConfirmModal = false">取消</NButton>
          <NButton
            type="primary"
            :loading="configStore.saving"
            :disabled="!canConfirmSave"
            @click="handleConfirmSave"
          >
            {{ saveConfirmButtonLabel }}
          </NButton>
        </NSpace>
      </template>
    </NModal>

    <NCard title="模型索引" class="models-index-card">
      <NText depth="3" style="font-size: 12px;">
        已配置模型（来自 openclaw.json）。可在列表中快速将任意模型设为默认。
      </NText>

      <NDataTable
        :columns="configuredModelColumns"
        :data="configuredModelRows"
        :loading="configStore.loading"
        :bordered="false"
        :pagination="{ pageSize: 12 }"
        :row-key="(row: ConfiguredModelRow) => row.key"
        striped
        style="margin-top: 10px;"
      />

      <NEmpty
        v-if="!configStore.loading && configuredModelRows.length === 0"
        description="当前未配置任何模型"
        class="models-empty"
      >
        <template #extra>
          <NText depth="3">请先在上方渠道工作台中填写或探测模型并保存</NText>
        </template>
      </NEmpty>
    </NCard>
  </div>
</template>

<style scoped>
.models-page {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.models-overview-card {
  border-radius: var(--radius-lg);
  background:
    radial-gradient(circle at 86% 12%, rgba(32, 128, 240, 0.18), transparent 36%),
    linear-gradient(125deg, var(--bg-card), rgba(24, 160, 88, 0.08));
  border: 1px solid rgba(32, 128, 240, 0.16);
}

.models-overview-title {
  font-size: 18px;
  font-weight: 700;
  line-height: 1.2;
}

.models-overview-metrics {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 10px;
  margin-bottom: 12px;
}

.models-metric-item {
  border: 1px solid var(--border-color);
  border-radius: 10px;
  background: var(--bg-primary);
  padding: 10px 12px;
}

.models-metric-value {
  margin-top: 4px;
  font-size: 20px;
  font-weight: 700;
  line-height: 1.2;
}

.models-metric-code {
  font-size: 14px;
  font-family: 'SFMono-Regular', Menlo, Monaco, Consolas, 'Liberation Mono', 'Courier New', monospace;
}

.models-workbench-card,
.models-index-card {
  border-radius: var(--radius-lg);
}

.models-workbench-item {
  min-width: 0;
}

.models-panel {
  border: 1px solid var(--border-color);
  border-radius: 10px;
  padding: 12px;
  background: var(--bg-primary);
  overflow: hidden;
}

.models-panel :deep(.n-data-table-wrapper) {
  overflow-x: auto;
}

.models-provider-table :deep(.n-data-table-th),
.models-provider-table :deep(.n-data-table-td) {
  padding: 9px 10px;
}

.models-panel-toolbar {
  margin-bottom: 10px;
}

.models-editor-header {
  margin-bottom: 10px;
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.models-empty {
  margin-top: 12px;
}

@media (max-width: 1100px) {
  .models-overview-metrics {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}

@media (max-width: 900px) {
  .models-panel-toolbar {
    flex-direction: column;
    align-items: stretch !important;
  }
}
</style>
