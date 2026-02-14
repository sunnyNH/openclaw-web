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
import { useI18n } from 'vue-i18n'
import { useConfigStore } from '@/stores/config'
import { useWebSocketStore } from '@/stores/websocket'
import type { DataTableColumns } from 'naive-ui'
import type { ConfigPatch, ModelProviderConfig } from '@/api/types'

const configStore = useConfigStore()
const wsStore = useWebSocketStore()
const message = useMessage()
const { t, locale } = useI18n()

function joinDisplayList(values: string[]): string {
  const separator = locale.value === 'zh-CN' ? '、' : ', '
  return values.join(separator)
}

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

type DefaultsModelsCatalogSnapshot = {
  catalog: Record<string, unknown> | null
  normalized: boolean
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

function normalizeProviderIdForMatch(value: string): string {
  const normalized = normalizeProviderId(value)
  if (normalized === 'z.ai' || normalized === 'z-ai') return 'zai'
  if (normalized === 'opencode-zen') return 'opencode'
  if (normalized === 'qwen') return 'qwen-portal'
  if (normalized === 'kimi-code') return 'kimi-coding'
  return normalized
}

function isModelRefFromProvider(modelRef: string, providerId: string): boolean {
  const parsed = splitModelRef(modelRef)
  if (!parsed) return false
  return normalizeProviderIdForMatch(parsed.providerId) === normalizeProviderIdForMatch(providerId)
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
    const existing = registry.get(id)
    if (existing && existing.pathPrefix === 'models.providers' && pathPrefix === 'models') {
      return
    }
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
    ? t('pages.models.editor.titleEdit', { id: currentEditingProviderId.value })
    : selectedProviderId.value
      ? t('pages.models.editor.titleMissing', { id: normalizeProviderId(selectedProviderId.value) })
      : t('pages.models.editor.titleSelect')
)
const providerSubmitLabel = computed(() => t('pages.models.actions.saveChanges'))

const apiKeyPlaceholder = computed(() =>
  editingExistingProvider.value
    ? t('pages.models.form.apiKeyPlaceholderEdit')
    : t('pages.models.form.apiKeyPlaceholderCreate')
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
  const providerBasePath = `models.providers.${providerId}`
  const shouldMigrateLegacyProviderPath = providerPrefix === 'models'
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
    warnings.push(t('pages.models.preview.warnings.overwriteApiKey'))
    patchPaths.push(`${providerBasePath}.apiKey`)
  }
  if (shouldMigrateLegacyProviderPath) {
    warnings.push(t('pages.models.preview.warnings.migrateLegacyPath'))
    patchPaths.push(`models.${providerId}`)
  }

  const currentPrimary = primaryModel.value.trim() || configStore.config?.agents?.defaults?.model?.primary || ''
  let inferredPrimary = ''
  if (!currentPrimary && nextModelIds[0]) {
    inferredPrimary = `${providerId}/${nextModelIds[0]}`
    patchPaths.push('agents.defaults.model.primary')
  }

  if (removedModelIds.length > 0) {
    warnings.push(t('pages.models.preview.warnings.removeModels'))
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
    warnings.push(t('pages.models.preview.warnings.providerIdMissing'))
    missingRequired.push(t('pages.models.fields.providerId'))
  } else {
    patchPaths.push(
      `models.providers.${providerId}.api`,
      `models.providers.${providerId}.baseUrl`,
      `models.providers.${providerId}.apiKey`,
      `models.providers.${providerId}.models`
    )
  }

  if (providerExists) {
    warnings.push(t('pages.models.preview.warnings.providerIdExists'))
  }

  if (baseUrl) {
  } else {
    warnings.push(t('pages.models.preview.warnings.baseUrlMissing'))
    missingRequired.push(t('pages.models.fields.baseUrl'))
  }

  if (modelIds.length === 0) {
    warnings.push(t('pages.models.preview.warnings.modelListMissing'))
    missingRequired.push(t('pages.models.fields.models'))
  }

  if (hasApiKey) {
  } else {
    warnings.push(t('pages.models.preview.warnings.apiKeyMissing'))
    missingRequired.push(t('pages.models.fields.apiKey'))
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
  confirmActionType.value === 'edit'
    ? t('pages.models.confirm.titleEdit')
    : t('pages.models.confirm.titleCreate')
)
const saveConfirmButtonLabel = computed(() =>
  confirmActionType.value === 'edit'
    ? t('pages.models.confirm.buttonEdit')
    : t('pages.models.confirm.buttonCreate')
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
  const resolvedModelRef = resolveModelRefFromConfigValue(primaryModelDisplay.value)
  const parsed = resolvedModelRef ? splitModelRef(resolvedModelRef) : null
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

const providerColumns = computed<DataTableColumns<ProviderSummary>>(() => [
  {
    title: t('pages.models.table.providers.provider'),
    key: 'id',
    width: 136,
    ellipsis: { tooltip: true },
    render(row) {
      return h('code', { style: 'font-size: 12px;' }, row.id)
    },
  },
  {
    title: t('pages.models.table.providers.protocol'),
    key: 'api',
    width: 132,
    ellipsis: { tooltip: true },
    render(row) {
      return row.api || '-'
    },
  },
  {
    title: t('pages.models.table.providers.baseUrl'),
    key: 'baseUrl',
    width: 256,
    ellipsis: { tooltip: true },
    render(row) {
      return row.baseUrl || '-'
    },
  },
  {
    title: t('pages.models.table.providers.models'),
    key: 'modelCount',
    width: 76,
    align: 'center',
    render(row) {
      return `${row.modelIds.length}`
    },
  },
  {
    title: t('pages.models.table.providers.sources'),
    key: 'sources',
    width: 84,
    align: 'center',
    ellipsis: { tooltip: true },
    render(row) {
      return row.sources.length > 0 ? t('common.itemsCount', { count: row.sources.length }) : '-'
    },
  },
  {
    title: t('pages.models.table.providers.actions'),
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
                  { default: () => t('common.edit') }
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
            { default: () => (isPrimaryProvider ? t('pages.models.default.active') : t('pages.models.default.set')) }
          ),
          ...(isManagedProvider
            ? [
                h(
                  NPopconfirm,
                  {
                    onPositiveClick: () => handleDeleteProvider(row.id),
                    positiveText: t('common.delete'),
                    negativeText: t('common.cancel'),
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
                        { default: () => t('common.delete') }
                      ),
                    default: () =>
                      isPrimaryProvider
                        ? t('pages.models.confirm.deleteDefaultProviderBlocked')
                        : t('pages.models.confirm.deleteProvider', { id: row.id }),
                  }
                ),
              ]
            : []),
        ]
      )
    },
  },
])

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

const configuredModelColumns = computed<DataTableColumns<ConfiguredModelRow>>(() => [
  {
    title: t('pages.models.table.models.modelRef'),
    key: 'modelRef',
    minWidth: 260,
    ellipsis: { tooltip: true },
    render(row) {
      return h('code', { style: 'font-size: 12px;' }, row.modelRef)
    },
  },
  {
    title: t('pages.models.table.models.actions'),
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
        { default: () => (isPrimaryModel ? t('pages.models.default.active') : t('pages.models.default.set')) }
      )
    },
  },
])

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

function normalizeDefaultsModelCatalogEntry(entry: unknown, fallbackAlias: string): Record<string, unknown> {
  if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
    return fallbackAlias ? { alias: fallbackAlias } : {}
  }

  const row = entry as Record<string, unknown>
  const normalized: Record<string, unknown> = {}

  if (typeof row.alias === 'string' && row.alias.trim()) {
    normalized.alias = row.alias.trim()
  } else if (fallbackAlias) {
    normalized.alias = fallbackAlias
  }
  if (row.params && typeof row.params === 'object' && !Array.isArray(row.params)) {
    normalized.params = row.params
  }
  if (typeof row.streaming === 'boolean') {
    normalized.streaming = row.streaming
  }

  return normalized
}

function readExistingDefaultsModelsCatalog(): DefaultsModelsCatalogSnapshot {
  const agents = asRecord(configStore.config?.agents)
  const defaults = asRecord(agents?.defaults)
  const modelsRaw = defaults?.models

  if (!modelsRaw) {
    return { catalog: null, normalized: false }
  }

  if (Array.isArray(modelsRaw)) {
    const next: Record<string, unknown> = {}
    for (const item of collectModelRefsFromUnknown(modelsRaw, 'agents.defaults.models')) {
      const parsed = splitModelRef(item.modelRef)
      if (!parsed) continue
      const modelRef = `${parsed.providerId}/${parsed.modelId}`
      if (next[modelRef]) continue
      next[modelRef] = { alias: parsed.modelId }
    }
    return { catalog: next, normalized: true }
  }

  const models = asRecord(modelsRaw)
  if (!models) {
    return { catalog: {}, normalized: true }
  }

  const next: Record<string, unknown> = {}
  let normalized = false

  for (const [rawModelRef, entry] of Object.entries(models)) {
    const modelRef = rawModelRef.trim()
    if (!modelRef) {
      normalized = true
      continue
    }
    const parsed = splitModelRef(modelRef)
    const fallbackAlias = parsed?.modelId || modelRef
    const normalizedEntry = normalizeDefaultsModelCatalogEntry(entry, fallbackAlias)
    next[modelRef] = normalizedEntry

    if (modelRef !== rawModelRef) {
      normalized = true
      continue
    }
    if (JSON.stringify(normalizedEntry) !== JSON.stringify(entry ?? {})) {
      normalized = true
    }
  }

  return { catalog: next, normalized }
}

function resolveModelRefFromConfigValue(
  value: unknown,
  defaultsModelsCatalog?: Record<string, unknown> | null
): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  if (!trimmed) return null

  const parsed = splitModelRef(trimmed)
  if (parsed) {
    return `${parsed.providerId}/${parsed.modelId}`
  }

  const catalog = defaultsModelsCatalog ?? readExistingDefaultsModelsCatalog().catalog
  if (!catalog) return null

  const aliasKey = trimmed.toLowerCase()
  for (const [modelRef, entry] of Object.entries(catalog)) {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) continue
    const aliasRaw = (entry as Record<string, unknown>).alias
    const alias = typeof aliasRaw === 'string' ? aliasRaw.trim() : ''
    if (alias && alias.toLowerCase() === aliasKey) {
      return modelRef
    }
  }

  return null
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
  const existingSnapshot = readExistingDefaultsModelsCatalog()
  const existing = existingSnapshot.catalog
  if (!existing && !options?.createWhenMissing) return null

  const next: Record<string, unknown> = existing ? { ...existing } : buildBootstrapDefaultsModelsCatalog()
  let changed = existingSnapshot.normalized || (!existing && Object.keys(next).length > 0)

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
  const existingSnapshot = readExistingDefaultsModelsCatalog()
  const existing = existingSnapshot.catalog
  if (!existing) return null

  const next: Record<string, unknown> = {}
  let changed = existingSnapshot.normalized

  for (const [modelRef, entry] of Object.entries(existing)) {
    if (isModelRefFromProvider(modelRef, providerId)) {
      changed = true
      continue
    }
    next[modelRef] = entry
  }

  return changed ? next : null
}

function buildDefaultsModelsCatalogSyncedForProvider(
  providerId: string,
  modelIds: string[],
  options?: { createWhenMissing?: boolean }
): Record<string, unknown> | null {
  const existingSnapshot = readExistingDefaultsModelsCatalog()
  const existing = existingSnapshot.catalog
  if (!existing && !options?.createWhenMissing) return null

  const base = existing ? { ...existing } : buildBootstrapDefaultsModelsCatalog()
  const incomingEntries = buildAllowlistEntriesFromProvider(providerId, modelIds)
  const incomingEntryMap = new Map(incomingEntries.map((entry) => [entry.modelRef, entry]))

  const next: Record<string, unknown> = {}
  let changed = existingSnapshot.normalized || (!existing && Object.keys(base).length > 0)

  for (const [modelRef, entry] of Object.entries(base)) {
    if (!isModelRefFromProvider(modelRef, providerId)) {
      next[modelRef] = entry
      continue
    }

    const incoming = incomingEntryMap.get(modelRef)
    if (!incoming) {
      changed = true
      continue
    }

    const normalizedEntry = normalizeDefaultsModelCatalogEntry(entry, incoming.alias)
    next[modelRef] = normalizedEntry
    incomingEntryMap.delete(modelRef)
    if (JSON.stringify(normalizedEntry) !== JSON.stringify(entry ?? {})) {
      changed = true
    }
  }

  for (const entry of incomingEntryMap.values()) {
    next[entry.modelRef] = {
      alias: entry.alias.trim() || entry.modelRef,
    }
    changed = true
  }

  return changed ? next : null
}

function filterModelRefArrayWithoutProvider(
  value: unknown,
  providerId: string,
  defaultsModelsCatalog: Record<string, unknown> | null
): { changed: boolean; value: string[] } {
  if (!Array.isArray(value)) {
    return { changed: false, value: [] }
  }

  const next: string[] = []
  let changed = false

  for (const rawItem of value) {
    if (typeof rawItem !== 'string') {
      changed = true
      continue
    }

    const item = rawItem.trim()
    if (!item) {
      changed = true
      continue
    }
    if (item !== rawItem) {
      changed = true
    }

    const resolvedModelRef = resolveModelRefFromConfigValue(item, defaultsModelsCatalog)
    if (resolvedModelRef && isModelRefFromProvider(resolvedModelRef, providerId)) {
      changed = true
      continue
    }
    next.push(item)
  }

  return { changed, value: next }
}

function buildProviderModelReferenceCleanupPatches(
  providerId: string,
  defaultsModelsCatalog: Record<string, unknown> | null
): ConfigPatch[] {
  const patches: ConfigPatch[] = []

  const agents = asRecord(configStore.config?.agents)
  const defaults = asRecord(agents?.defaults)
  const defaultModel = asRecord(defaults?.model)
  if (defaultModel) {
    const primaryModelRef = resolveModelRefFromConfigValue(defaultModel.primary, defaultsModelsCatalog)
    if (primaryModelRef && isModelRefFromProvider(primaryModelRef, providerId)) {
      patches.push({ path: 'agents.defaults.model.primary', value: null })
    }

    const fallbacks = filterModelRefArrayWithoutProvider(defaultModel.fallbacks, providerId, defaultsModelsCatalog)
    if (fallbacks.changed) {
      patches.push({
        path: 'agents.defaults.model.fallbacks',
        value: fallbacks.value.length > 0 ? fallbacks.value : null,
      })
    }

    const legacyFallback = filterModelRefArrayWithoutProvider(defaultModel.fallback, providerId, defaultsModelsCatalog)
    if (legacyFallback.changed) {
      patches.push({
        path: 'agents.defaults.model.fallback',
        value: legacyFallback.value.length > 0 ? legacyFallback.value : null,
      })
    }
  }

  return patches
}

function dedupeConfigPatchesByPath(patches: ConfigPatch[]): ConfigPatch[] {
  const map = new Map<string, ConfigPatch>()
  for (const patch of patches) {
    const path = patch.path.trim()
    if (!path) continue
    map.set(path, { path, value: patch.value })
  }
  return Array.from(map.values())
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
    message.warning(t('pages.models.messages.primaryModelRequired'))
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
    message.success(t('pages.models.messages.primaryModelSaved', { model: target }))
  } catch (error) {
    message.error(error instanceof Error ? error.message : t('common.saveFailed'))
  }
}

async function handleUseProviderAsPrimary(providerId: string, modelIds: string[]) {
  if (modelIds.length === 0) {
    message.warning(t('pages.models.messages.noModelsForProvider'))
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
    message.warning(t('pages.models.messages.deleteDefaultProviderBlocked'))
    return
  }

  if (!providerMap.value[providerId]) {
    message.warning(t('pages.models.messages.deleteWhitelistProviderBlocked'))
    return
  }

  const providerPrefix = providerPathPrefixMap.value[providerId] || 'models.providers'
  const patches: ConfigPatch[] = [
    { path: `${providerPrefix}.${providerId}`, value: null },
  ]

  const defaultsCatalogSnapshot = readExistingDefaultsModelsCatalog()
  const nextDefaultsModels = buildDefaultsModelsCatalogWithoutProvider(providerId)
  if (nextDefaultsModels) {
    patches.push({
      path: 'agents.defaults.models',
      value: Object.keys(nextDefaultsModels).length > 0 ? nextDefaultsModels : null,
    })
  }
  patches.push(
    ...buildProviderModelReferenceCleanupPatches(providerId, defaultsCatalogSnapshot.catalog)
  )

  const finalPatches = dedupeConfigPatchesByPath(patches)

  try {
    await configStore.patchConfig(finalPatches)
    if (selectedProviderId.value === providerId) {
      selectedProviderId.value = ''
    }
    message.success(t('pages.models.messages.providerDeleted', { id: providerId }))
  } catch (error) {
    message.error(error instanceof Error ? error.message : t('pages.models.messages.deleteFailed'))
  }
}

async function probeModelsFromProvider(baseUrl: string, apiKey: string, apiType: string): Promise<string[]> {
  const urls = buildProbeUrls(baseUrl, apiType)
  if (urls.length === 0) {
    throw new Error(t('pages.models.validation.baseUrlRequired'))
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
      lastError = t('pages.models.probe.noModelsParsed', { url: requestUrl })
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error)
      if (isGoogleApi && /failed to fetch/i.test(reason)) {
        lastError = t('pages.models.probe.fetchFailedCors', { url })
      } else {
        lastError = t('pages.models.probe.fetchFailed', { url, reason })
      }
    }
  }

  throw new Error(lastError || t('pages.models.probe.failed'))
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
    message.warning(t('pages.models.validation.baseUrlRequired'))
    return
  }
  if (!apiKey) {
    if (selectedProviderHasKey.value) {
      message.warning(t('pages.models.messages.apiKeyNotReadableForProbe'))
    } else {
      message.warning(t('pages.models.validation.apiKeyRequired'))
    }
    return
  }

  probing.value = true
  probeError.value = ''
  try {
    const modelIds = await probeModelsFromProvider(baseUrl, apiKey, apiType)
    providerForm.modelIdsText = modelIds.join('\n')
    editActiveTab.value = 'models'
    message.success(t('pages.models.messages.modelsProbed', { count: modelIds.length }))
  } catch (error) {
    const errorText = error instanceof Error ? error.message : String(error)
    if (providerId) {
      try {
        const runtimeModelIds = await probeModelsFromGateway(providerId)
        if (runtimeModelIds.length > 0) {
          providerForm.modelIdsText = runtimeModelIds.join('\n')
          editActiveTab.value = 'models'
          message.success(t('pages.models.messages.modelsProbedFromGateway', { count: runtimeModelIds.length }))
          return
        }
      } catch {
        // ignore, fallback to original error below
      }
    }
    probeError.value = errorText
    message.error(t('pages.models.messages.modelProbeFailed'))
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
    message.warning(t('pages.models.messages.selectProviderToEdit'))
    return
  }
  if (!editChangePreview.value?.hasChanges) {
    message.info(t('pages.models.messages.noConfigChanges'))
    return
  }
  if (!confirmed) {
    openSaveConfirm('edit')
    return
  }
  if (!providerId) {
    message.warning(t('pages.models.validation.providerIdRequired'))
    return
  }
  if (!/^[a-z0-9_-]+$/.test(providerId)) {
    message.warning(t('pages.models.validation.providerIdInvalid'))
    return
  }
  if (!baseUrl) {
    message.warning(t('pages.models.validation.baseUrlRequired'))
    return
  }
  if (finalModelIds.length === 0) {
    message.warning(t('pages.models.validation.modelsRequired'))
    return
  }

  const providerPrefix = providerPathPrefixMap.value[providerId] || 'models.providers'
  const providerBasePath = `models.providers.${providerId}`
  const shouldMigrateLegacyProviderPath = providerPrefix === 'models'
  const modelsValue = finalModelIds.map((id) => ({ id, name: id, input: [...inputTypes] }))
  const patches: ConfigPatch[] = [
    { path: 'models.mode', value: 'merge' },
    { path: `${providerBasePath}.api`, value: providerForm.api },
    { path: `${providerBasePath}.baseUrl`, value: baseUrl },
    {
      path: `${providerBasePath}.models`,
      value: modelsValue,
    },
  ]
  if (shouldMigrateLegacyProviderPath) {
    patches.push({ path: `models.${providerId}`, value: null })
  }
  if (shouldPatchApiKey) {
    patches.push({ path: `${providerBasePath}.apiKey`, value: apiKey })
  }

  const mergedDefaultsModels = buildDefaultsModelsCatalogSyncedForProvider(providerId, finalModelIds, {
    createWhenMissing: true,
  })
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
    message.success(shouldPatchApiKey
      ? t('pages.models.messages.providerSaved')
      : t('pages.models.messages.providerSavedKeepKey'))
  } catch (error) {
    message.error(error instanceof Error ? error.message : t('common.saveFailed'))
  }
}

async function handleProbeCreateProviderModels() {
  const baseUrl = createProviderForm.baseUrl.trim()
  const apiType = createProviderForm.api || 'openai-completions'
  const apiKey = createProviderForm.apiKey.trim()
  if (!baseUrl) {
    message.warning(t('pages.models.validation.baseUrlRequired'))
    return
  }
  if (!apiKey) {
    message.warning(t('pages.models.validation.apiKeyRequired'))
    return
  }

  probingCreateProvider.value = true
  createProbeError.value = ''
  try {
    const modelIds = await probeModelsFromProvider(baseUrl, apiKey, apiType)
    createProviderForm.modelIdsText = modelIds.join('\n')
    createActiveTab.value = 'models'
    message.success(t('pages.models.messages.modelsProbed', { count: modelIds.length }))
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error)
    createProbeError.value = reason
    message.error(t('pages.models.messages.modelProbeFailed'))
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
    message.warning(t('pages.models.validation.providerIdRequired'))
    return
  }
  if (!/^[a-z0-9_-]+$/.test(providerId)) {
    message.warning(t('pages.models.validation.providerIdInvalid'))
    return
  }
  if (providerMap.value[providerId]) {
    message.warning(t('pages.models.validation.providerIdExists'))
    return
  }
  if (!baseUrl) {
    message.warning(t('pages.models.validation.baseUrlRequired'))
    return
  }
  if (!apiKey) {
    message.warning(t('pages.models.validation.apiKeyRequiredForCreate'))
    return
  }
  if (modelIds.length === 0) {
    message.warning(t('pages.models.validation.modelsRequired'))
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

  const mergedDefaultsModels = buildDefaultsModelsCatalogSyncedForProvider(providerId, modelIds, {
    createWhenMissing: true,
  })
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
    message.success(t('pages.models.messages.providerCreated'))
  } catch (error) {
    message.error(error instanceof Error ? error.message : t('pages.models.messages.createFailed'))
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
        <div class="models-overview-title">{{ t('pages.models.overview.title') }}</div>
      </template>
      <template #header-extra>
        <NButton size="small" :loading="configStore.loading" @click="configStore.fetchConfig()">
          <template #icon><NIcon :component="RefreshOutline" /></template>
          {{ t('pages.models.actions.refreshConfig') }}
        </NButton>
      </template>

      <NAlert type="info" :bordered="false" style="margin-bottom: 12px;">
        {{ t('pages.models.overview.hintPrefix') }}<code>provider/model</code>{{ t('pages.models.overview.hintMiddle') }}<code>models.providers</code>{{ t('pages.models.overview.hintSuffix') }}
      </NAlert>

      <NAlert v-if="configStore.lastError" type="error" :bordered="false" style="margin-bottom: 12px;">
        {{ configStore.lastError }}
      </NAlert>

      <div class="models-overview-metrics">
        <div class="models-metric-item">
          <NText depth="3">{{ t('pages.models.overview.metrics.providers') }}</NText>
          <div class="models-metric-value">{{ providerStats.providerCount }}</div>
        </div>
        <div class="models-metric-item">
          <NText depth="3">{{ t('pages.models.overview.metrics.modelRefs') }}</NText>
          <div class="models-metric-value">{{ providerStats.modelCount }}</div>
        </div>
        <div class="models-metric-item">
          <NText depth="3">{{ t('pages.models.overview.metrics.editing') }}</NText>
          <div class="models-metric-value">{{ providerStats.selectedProvider }}</div>
        </div>
        <div class="models-metric-item">
          <NText depth="3">{{ t('pages.models.overview.metrics.primaryModel') }}</NText>
          <div class="models-metric-value models-metric-code">{{ primaryModelDisplay }}</div>
        </div>
      </div>

    </NCard>

    <NCard :title="t('pages.models.workbench.title')" class="models-workbench-card">
      <NGrid cols="1 xl:12" responsive="screen" :x-gap="16" :y-gap="16">
        <NGridItem class="models-workbench-item" span="1 xl:8">
          <div class="models-panel">
            <NSpace justify="space-between" align="center" :size="8" class="models-panel-toolbar">
              <NInput
                v-model:value="providerSearch"
                size="small"
                :placeholder="t('pages.models.workbench.searchPlaceholder')"
                style="width: 100%; max-width: 340px;"
              />
              <NButton size="small" type="primary" @click="handleNewProvider">
                <template #icon><NIcon :component="AddOutline" /></template>
                {{ t('pages.models.actions.createProvider') }}
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
              :description="t('pages.models.workbench.empty')"
              class="models-empty"
            >
              <template #extra>
                <NText depth="3">{{ t('pages.models.workbench.emptyHint') }}</NText>
              </template>
            </NEmpty>
          </div>
        </NGridItem>

        <NGridItem class="models-workbench-item" span="1 xl:4">
          <div class="models-panel">
            <div class="models-editor-header">
              <NText strong>{{ providerEditorTitle }}</NText>
              <NSpace v-if="selectedProviderSummary" :size="6" style="flex-wrap: wrap;">
                <NTag size="small" :bordered="false">
                  {{ t('pages.models.editor.modelsCount', { count: selectedProviderSummary.modelIds.length }) }}
                </NTag>
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
                <NTabPane name="basic" :tab="t('pages.models.tabs.basic')">
                  <NForm label-placement="left" label-width="100">
                    <NFormItem :label="t('pages.models.form.providerId')">
                      <NInput
                        v-model:value="providerForm.id"
                        :disabled="true"
                        :placeholder="t('pages.models.form.providerIdPlaceholder')"
                      />
                    </NFormItem>
                    <NFormItem :label="t('pages.models.form.apiProtocol')">
                      <NSelect v-model:value="providerForm.api" :options="apiOptions" />
                    </NFormItem>
                    <NFormItem :label="t('pages.models.form.baseUrl')">
                      <NInput v-model:value="providerForm.baseUrl" :placeholder="t('pages.models.form.baseUrlPlaceholder')" />
                    </NFormItem>
                    <NFormItem :label="t('pages.models.form.apiKey')">
                      <NSpace vertical :size="6" style="width: 100%;">
                        <NInput
                          v-model:value="providerForm.apiKey"
                          type="password"
                          show-password-on="click"
                          :placeholder="apiKeyPlaceholder"
                        />
                        <NText depth="3" style="font-size: 12px;">
                          {{ t('pages.models.form.apiKeyHint') }}
                        </NText>
                      </NSpace>
                    </NFormItem>
                    <NFormItem :label="t('pages.models.form.apiKeyStatus')">
                      <NTag size="small" :bordered="false" :type="selectedProviderHasKey ? 'success' : 'default'">
                        {{ selectedProviderHasKey ? t('pages.models.form.apiKeyStatusConfigured') : t('pages.models.form.apiKeyStatusNotConfigured') }}
                      </NTag>
                    </NFormItem>
                    <NFormItem>
                      <NSpace justify="end" style="width: 100%;">
                        <NButton @click="editActiveTab = 'models'">{{ t('pages.models.actions.nextToModels') }}</NButton>
                      </NSpace>
                    </NFormItem>
                  </NForm>
                </NTabPane>

                <NTabPane name="models" :tab="t('pages.models.tabs.models')">
                  <NForm label-placement="left" label-width="100">
                    <NFormItem :label="t('pages.models.form.modelInputTypes')">
                      <NSelect
                        v-model:value="providerForm.modelInputTypes"
                        :options="modelInputTypeOptions"
                        multiple
                        :placeholder="t('pages.models.form.modelInputTypesPlaceholder')"
                      />
                    </NFormItem>
                    <NFormItem :label="t('pages.models.form.models')">
                      <NInput
                        v-model:value="providerForm.modelIdsText"
                        type="textarea"
                        :autosize="{ minRows: 5, maxRows: 10 }"
                        :placeholder="t('pages.models.form.modelsPlaceholder')"
                      />
                    </NFormItem>
                    <NFormItem v-if="currentModelIds.length" :label="t('pages.models.form.detectedModels')">
                      <NSpace :size="6" style="flex-wrap: wrap;">
                        <NTag
                          v-for="id in currentModelIds.slice(0, 20)"
                          :key="id"
                          size="small"
                          :bordered="false"
                        >
                          {{ id }}
                        </NTag>
                        <NText depth="3" v-if="currentModelIds.length > 20">
                          {{ t('pages.models.form.modelsCount', { count: currentModelIds.length }) }}
                        </NText>
                      </NSpace>
                    </NFormItem>
                    <NFormItem>
                      <NSpace justify="space-between" style="width: 100%;">
                        <NSpace>
                          <NButton :loading="probing" @click="handleProbeModels">
                            <template #icon><NIcon :component="SearchOutline" /></template>
                            {{ t('pages.models.actions.probeModels') }}
                          </NButton>
                        </NSpace>
                        <NSpace>
                          <NButton @click="editActiveTab = 'basic'">{{ t('pages.models.actions.prev') }}</NButton>
                          <NButton type="primary" @click="editActiveTab = 'preview'">{{ t('pages.models.actions.nextToPreview') }}</NButton>
                        </NSpace>
                      </NSpace>
                    </NFormItem>
                  </NForm>
                  <NAlert v-if="probeError" type="error" :bordered="false" style="margin-top: 8px;">
                    {{ probeError }}
                  </NAlert>
                </NTabPane>

                <NTabPane name="preview" :tab="t('pages.models.tabs.preview')">
                  <NSpace vertical :size="10">
                    <div class="models-preview-grid">
                      <div class="models-preview-card" :class="{ 'is-changed': editChangePreview?.apiDiff.changed }">
                        <NText depth="3" class="models-preview-label">{{ t('pages.models.preview.apiProtocol') }}</NText>
                        <div class="models-preview-diff">
                          <code>{{ editChangePreview?.apiDiff.before || '-' }}</code>
                          <span class="models-preview-arrow">→</span>
                          <code>{{ editChangePreview?.apiDiff.after || '-' }}</code>
                        </div>
                      </div>

                      <div class="models-preview-card" :class="{ 'is-changed': editChangePreview?.baseUrlDiff.changed }">
                        <NText depth="3" class="models-preview-label">Base URL</NText>
                        <div class="models-preview-diff models-preview-diff--block">
                          <code>{{ editChangePreview?.baseUrlDiff.before || '-' }}</code>
                          <span class="models-preview-arrow">→</span>
                          <code>{{ editChangePreview?.baseUrlDiff.after || '-' }}</code>
                        </div>
                      </div>

                      <div class="models-preview-card" :class="{ 'is-changed': editChangePreview?.modelDiff.changed }">
                        <NText depth="3" class="models-preview-label">{{ t('pages.models.preview.models') }}</NText>
                        <div class="models-preview-diff">
                          <code>{{ editChangePreview?.modelDiff.beforeCount || 0 }}</code>
                          <span class="models-preview-arrow">→</span>
                          <code>{{ editChangePreview?.modelDiff.afterCount || 0 }}</code>
                        </div>
                      </div>

                      <div class="models-preview-card" :class="{ 'is-changed': editChangePreview?.inputDiff.changed }">
                        <NText depth="3" class="models-preview-label">{{ t('pages.models.preview.inputTypes') }}</NText>
                        <div class="models-preview-diff models-preview-diff--block">
                          <code>{{ editChangePreview?.inputDiff.before.join(', ') || '-' }}</code>
                          <span class="models-preview-arrow">→</span>
                          <code>{{ editChangePreview?.inputDiff.after.join(', ') || '-' }}</code>
                        </div>
                      </div>

                      <div class="models-preview-card" :class="{ 'is-changed': editChangePreview?.apiKeyAction === 'overwrite' }">
                        <NText depth="3" class="models-preview-label">API Key</NText>
                        <NTag
                          size="small"
                          :type="editChangePreview?.apiKeyAction === 'overwrite' ? 'warning' : 'default'"
                          :bordered="false"
                        >
                          {{ editChangePreview?.apiKeyAction === 'overwrite'
                            ? t('pages.models.preview.apiKeyOverwrite')
                            : t('pages.models.preview.apiKeyKeep') }}
                        </NTag>
                      </div>

                      <div class="models-preview-card" :class="{ 'is-changed': !!editChangePreview?.inferredPrimary }">
                        <NText depth="3" class="models-preview-label">{{ t('pages.models.preview.primaryModel') }}</NText>
                        <NTag size="small" :type="editChangePreview?.inferredPrimary ? 'warning' : 'default'" :bordered="false">
                          {{ editChangePreview?.inferredPrimary || t('pages.models.preview.unchanged') }}
                        </NTag>
                      </div>
                    </div>

                    <NCollapse v-if="editChangePreview?.modelDiff.changed">
                      <NCollapseItem
                        :title="t('pages.models.preview.modelDiffTitle', {
                          added: editChangePreview?.modelDiff.added.length || 0,
                          removed: editChangePreview?.modelDiff.removed.length || 0,
                        })"
                        name="edit-model-diff"
                      >
                        <NSpace vertical :size="8">
                          <div v-if="editChangePreview?.modelDiff.added.length">
                            <NText depth="3" style="font-size: 12px;">{{ t('pages.models.preview.addedModels') }}</NText>
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
                            <NText depth="3" style="font-size: 12px;">{{ t('pages.models.preview.removedModels') }}</NText>
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

                    <div class="models-preview-paths">
                      <NText depth="3" style="font-size: 12px;">{{ t('pages.models.preview.patchPaths') }}</NText>
                      <NSpace :size="6" style="margin-top: 6px; flex-wrap: wrap;">
                        <NTag
                          v-for="path in editChangePreview?.patchPaths || []"
                          :key="`edit-path-${path}`"
                          size="small"
                          :bordered="false"
                        >
                          {{ path }}
                        </NTag>
                      </NSpace>
                    </div>

                    <NAlert v-if="editChangePreview?.warnings.length" type="warning" :bordered="false">
                      <div v-for="(warning, index) in editChangePreview?.warnings" :key="index">
                        {{ warning }}
                      </div>
                    </NAlert>

                    <NAlert v-if="editChangePreview && !editChangePreview.hasChanges" type="info" :bordered="false">
                      {{ t('pages.models.preview.noChangesHint') }}
                    </NAlert>

                    <NSpace justify="space-between">
                      <NButton @click="editActiveTab = 'models'">{{ t('pages.models.actions.prev') }}</NButton>
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
                <NCollapseItem :title="t('pages.models.editor.rawConfigTitle')" name="provider-raw-json">
                  <NCode :code="selectedProviderRawText" language="json" style="font-size: 12px;" />
                </NCollapseItem>
              </NCollapse>
            </template>

            <NEmpty v-else :description="t('pages.models.editor.empty')">
              <template #extra>
                <NButton size="small" type="primary" @click="handleNewProvider">
                  <template #icon><NIcon :component="AddOutline" /></template>
                  {{ t('pages.models.actions.createProvider') }}
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
      :title="t('pages.models.createModal.title')"
      style="max-width: 720px; width: 92vw;"
      :mask-closable="false"
    >
      <NAlert type="default" :bordered="false" style="margin-bottom: 12px;">
        {{ t('pages.models.createModal.flowHint') }}
      </NAlert>

      <NTabs v-model:value="createActiveTab" type="line" animated>
        <NTabPane name="basic" :tab="t('pages.models.tabs.basic')">
          <NForm label-placement="left" label-width="100">
            <NFormItem :label="t('pages.models.form.providerId')">
              <NInput v-model:value="createProviderForm.id" :placeholder="t('pages.models.form.providerIdPlaceholder')" />
            </NFormItem>
            <NFormItem :label="t('pages.models.form.apiProtocol')">
              <NSelect v-model:value="createProviderForm.api" :options="apiOptions" />
            </NFormItem>
            <NFormItem :label="t('pages.models.form.baseUrl')">
              <NInput v-model:value="createProviderForm.baseUrl" :placeholder="t('pages.models.form.baseUrlPlaceholder')" />
            </NFormItem>
            <NFormItem :label="t('pages.models.form.apiKey')">
              <NInput
                v-model:value="createProviderForm.apiKey"
                type="password"
                show-password-on="click"
                :placeholder="t('pages.models.form.apiKeyPlaceholderCreateRequired')"
              />
            </NFormItem>
            <NFormItem>
              <NSpace justify="end" style="width: 100%;">
                <NButton type="primary" @click="createActiveTab = 'models'">{{ t('pages.models.actions.nextToModels') }}</NButton>
              </NSpace>
            </NFormItem>
          </NForm>
        </NTabPane>

        <NTabPane name="models" :tab="t('pages.models.tabs.models')">
          <NForm label-placement="left" label-width="100">
            <NFormItem :label="t('pages.models.form.modelInputTypes')">
              <NSelect
                v-model:value="createProviderForm.modelInputTypes"
                :options="modelInputTypeOptions"
                multiple
                :placeholder="t('pages.models.form.modelInputTypesPlaceholder')"
              />
            </NFormItem>
            <NFormItem :label="t('pages.models.form.models')">
              <NInput
                v-model:value="createProviderForm.modelIdsText"
                type="textarea"
                :autosize="{ minRows: 5, maxRows: 10 }"
                :placeholder="t('pages.models.form.modelsPlaceholder')"
              />
            </NFormItem>
            <NFormItem v-if="createCurrentModelIds.length" :label="t('pages.models.form.detectedModels')">
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
                  {{ t('pages.models.form.modelsCount', { count: createCurrentModelIds.length }) }}
                </NText>
              </NSpace>
            </NFormItem>
            <NFormItem>
              <NSpace justify="space-between" style="width: 100%;">
                <NButton @click="createActiveTab = 'basic'">{{ t('pages.models.actions.prev') }}</NButton>
                <NSpace>
                  <NButton :loading="probingCreateProvider" @click="handleProbeCreateProviderModels">
                    <template #icon><NIcon :component="SearchOutline" /></template>
                    {{ t('pages.models.actions.probeModels') }}
                  </NButton>
                  <NButton type="primary" @click="createActiveTab = 'preview'">{{ t('pages.models.actions.nextToPreview') }}</NButton>
                </NSpace>
              </NSpace>
            </NFormItem>
          </NForm>
          <NAlert v-if="createProbeError" type="error" :bordered="false" style="margin-top: 8px;">
            {{ createProbeError }}
          </NAlert>
        </NTabPane>

        <NTabPane name="preview" :tab="t('pages.models.tabs.preview')">
          <NSpace vertical :size="8">
            <div class="models-preview-grid">
              <div class="models-preview-card" :class="{ 'is-changed': !!createChangePreview.providerId }">
                <NText depth="3" class="models-preview-label">{{ t('pages.models.form.providerId') }}</NText>
                <NTag size="small" :type="createChangePreview.providerExists ? 'error' : 'info'" :bordered="false">
                  {{ createChangePreview.providerId || t('pages.models.preview.notProvided') }}
                </NTag>
              </div>

              <div class="models-preview-card">
                <NText depth="3" class="models-preview-label">{{ t('pages.models.preview.apiProtocol') }}</NText>
                <code>{{ createChangePreview.api }}</code>
              </div>

              <div class="models-preview-card" :class="{ 'is-changed': createChangePreview.baseUrl !== '-' }">
                <NText depth="3" class="models-preview-label">Base URL</NText>
                <code>{{ createChangePreview.baseUrl }}</code>
              </div>

              <div class="models-preview-card" :class="{ 'is-changed': createChangePreview.modelIds.length > 0 }">
                <NText depth="3" class="models-preview-label">{{ t('pages.models.preview.models') }}</NText>
                <code>{{ createChangePreview.modelIds.length }}</code>
              </div>

              <div class="models-preview-card" :class="{ 'is-changed': createChangePreview.inputTypes.length > 0 }">
                <NText depth="3" class="models-preview-label">{{ t('pages.models.preview.inputTypes') }}</NText>
                <code>{{ createChangePreview.inputTypes.join(', ') }}</code>
              </div>

              <div class="models-preview-card" :class="{ 'is-changed': createChangePreview.hasApiKey }">
                <NText depth="3" class="models-preview-label">API Key</NText>
                <NTag size="small" :type="createChangePreview.hasApiKey ? 'warning' : 'error'" :bordered="false">
                  {{ createChangePreview.hasApiKey ? t('pages.models.preview.willWriteMasked') : t('pages.models.preview.notProvided') }}
                </NTag>
              </div>

              <div class="models-preview-card" :class="{ 'is-changed': !!createChangePreview.inferredPrimary }">
                <NText depth="3" class="models-preview-label">{{ t('pages.models.preview.primaryModel') }}</NText>
                <NTag size="small" :type="createChangePreview.inferredPrimary ? 'warning' : 'default'" :bordered="false">
                  {{ createChangePreview.inferredPrimary || t('pages.models.preview.unchanged') }}
                </NTag>
              </div>
            </div>

            <NCollapse v-if="createChangePreview.modelIds.length > 0">
              <NCollapseItem :title="t('pages.models.preview.modelsListTitle', { count: createChangePreview.modelIds.length })" name="create-model-list">
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

            <div class="models-preview-paths">
              <NText depth="3" style="font-size: 12px;">{{ t('pages.models.preview.patchPaths') }}</NText>
              <NSpace :size="6" style="margin-top: 6px; flex-wrap: wrap;">
                <NTag
                  v-for="path in createChangePreview.patchPaths"
                  :key="`create-path-${path}`"
                  size="small"
                  :bordered="false"
                >
                  {{ path }}
                </NTag>
              </NSpace>
            </div>

            <NAlert v-if="createChangePreview.warnings.length" type="warning" :bordered="false">
              <div v-for="(warning, index) in createChangePreview.warnings" :key="index">
                {{ warning }}
              </div>
            </NAlert>

            <NAlert v-if="!createChangePreview.ready" type="info" :bordered="false">
              {{ t('pages.models.preview.missingRequired', {
                fields: joinDisplayList(createChangePreview.missingRequired) || t('pages.models.preview.none'),
              }) }}
            </NAlert>

            <NSpace justify="space-between">
              <NButton @click="createActiveTab = 'models'">{{ t('pages.models.actions.prev') }}</NButton>
              <NButton
                type="primary"
                :loading="configStore.saving"
                :disabled="!createChangePreview.ready"
                @click="handleCreateProviderClick"
              >
                <template #icon><NIcon :component="SaveOutline" /></template>
                {{ t('pages.models.actions.createProvider') }}
              </NButton>
            </NSpace>
          </NSpace>
        </NTabPane>
      </NTabs>

      <template #footer>
        <NSpace justify="end">
          <NButton @click="showCreateProviderModal = false">{{ t('common.cancel') }}</NButton>
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
          {{ t('pages.models.confirm.warningPrefix') }}<code>config.patch</code>{{ t('pages.models.confirm.warningSuffix') }}
        </NAlert>

        <template v-if="confirmActionType === 'edit' && editChangePreview">
          <NDescriptions bordered :column="1" size="small" label-placement="left">
            <NDescriptionsItem :label="t('pages.models.confirm.editProvider')">
              <NTag size="small" type="info" :bordered="false">
                {{ editChangePreview.providerId }}
              </NTag>
            </NDescriptionsItem>
            <NDescriptionsItem :label="t('pages.models.form.apiProtocol')">
              {{ editChangePreview.apiDiff.before }} -> {{ editChangePreview.apiDiff.after }}
            </NDescriptionsItem>
            <NDescriptionsItem :label="t('pages.models.form.baseUrl')">
              {{ editChangePreview.baseUrlDiff.before }} -> {{ editChangePreview.baseUrlDiff.after }}
            </NDescriptionsItem>
            <NDescriptionsItem :label="t('pages.models.preview.models')">
              {{ editChangePreview.modelDiff.beforeCount }} -> {{ editChangePreview.modelDiff.afterCount }}
            </NDescriptionsItem>
            <NDescriptionsItem :label="t('pages.models.preview.inputTypes')">
              {{ editChangePreview.inputDiff.before.join(', ') || '-' }} -> {{ editChangePreview.inputDiff.after.join(', ') || '-' }}
            </NDescriptionsItem>
            <NDescriptionsItem :label="t('pages.models.form.apiKey')">
              {{ editChangePreview.apiKeyAction === 'overwrite'
                ? t('pages.models.preview.apiKeyOverwrite')
                : t('pages.models.preview.apiKeyKeep') }}
            </NDescriptionsItem>
            <NDescriptionsItem :label="t('pages.models.preview.primaryModel')">
              {{ editChangePreview.inferredPrimary || t('pages.models.preview.unchanged') }}
            </NDescriptionsItem>
          </NDescriptions>

          <NCollapse v-if="editChangePreview.modelDiff.changed">
            <NCollapseItem
              :title="t('pages.models.confirm.modelDiffTitle', {
                added: editChangePreview.modelDiff.added.length,
                removed: editChangePreview.modelDiff.removed.length,
              })"
              name="confirm-edit-models"
            >
              <NSpace vertical :size="8">
                <div v-if="editChangePreview.modelDiff.added.length">
                  <NText depth="3" style="font-size: 12px;">{{ t('pages.models.preview.addedModels') }}</NText>
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
                  <NText depth="3" style="font-size: 12px;">{{ t('pages.models.preview.removedModels') }}</NText>
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
            {{ t('pages.models.preview.patchPathsWithValue', { paths: editChangePreview.patchPaths.join(', ') }) }}
          </NText>
        </template>

        <template v-else>
          <NDescriptions bordered :column="1" size="small" label-placement="left">
            <NDescriptionsItem :label="t('pages.models.confirm.createProvider')">
              <NTag size="small" type="info" :bordered="false">
                {{ createChangePreview.providerId || t('pages.models.preview.notProvided') }}
              </NTag>
            </NDescriptionsItem>
            <NDescriptionsItem :label="t('pages.models.form.apiProtocol')">
              {{ createChangePreview.api }}
            </NDescriptionsItem>
            <NDescriptionsItem :label="t('pages.models.form.baseUrl')">
              {{ createChangePreview.baseUrl }}
            </NDescriptionsItem>
            <NDescriptionsItem :label="t('pages.models.preview.models')">
              {{ createChangePreview.modelIds.length }}
            </NDescriptionsItem>
            <NDescriptionsItem :label="t('pages.models.preview.inputTypes')">
              {{ createChangePreview.inputTypes.join(', ') }}
            </NDescriptionsItem>
            <NDescriptionsItem :label="t('pages.models.form.apiKey')">
              {{ createChangePreview.hasApiKey ? t('pages.models.preview.willWriteMasked') : t('pages.models.preview.notProvided') }}
            </NDescriptionsItem>
            <NDescriptionsItem :label="t('pages.models.preview.primaryModel')">
              {{ createChangePreview.inferredPrimary || t('pages.models.preview.unchanged') }}
            </NDescriptionsItem>
          </NDescriptions>

          <NCollapse v-if="createChangePreview.modelIds.length > 0">
            <NCollapseItem :title="t('pages.models.preview.modelsListTitle', { count: createChangePreview.modelIds.length })" name="confirm-create-models">
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
            {{ t('pages.models.preview.patchPathsWithValue', { paths: createChangePreview.patchPaths.join(', ') || '-' }) }}
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
          <NButton @click="showSaveConfirmModal = false">{{ t('common.cancel') }}</NButton>
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

    <NCard :title="t('pages.models.index.title')" class="models-index-card">
      <NText depth="3" style="font-size: 12px;">
        {{ t('pages.models.index.hint') }}
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
        :description="t('pages.models.index.empty')"
        class="models-empty"
      >
        <template #extra>
          <NText depth="3">{{ t('pages.models.index.emptyHint') }}</NText>
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

.models-preview-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
  gap: 8px;
}

.models-preview-card {
  border: 1px solid var(--border-color);
  border-radius: 8px;
  padding: 8px 10px;
  background: var(--bg-primary);
  display: flex;
  flex-direction: column;
  gap: 6px;
  min-width: 0;
}

.models-preview-card.is-changed {
  border-color: rgba(24, 160, 88, 0.5);
  background: rgba(24, 160, 88, 0.08);
}

.models-preview-label {
  font-size: 12px;
}

.models-preview-card code {
  white-space: normal;
  word-break: break-all;
  font-size: 12px;
}

.models-preview-diff {
  display: flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
}

.models-preview-diff--block {
  align-items: flex-start;
}

.models-preview-arrow {
  color: var(--text-secondary);
  flex-shrink: 0;
}

.models-preview-paths {
  border: 1px solid var(--border-color);
  border-radius: 8px;
  padding: 8px 10px;
  background: var(--bg-primary);
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
