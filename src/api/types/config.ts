export interface OpenClawConfig {
  agents?: AgentConfig
  channels?: Record<string, ChannelConfig>
  bindings?: Binding[]
  tools?: ToolsConfig
  session?: SessionConfig
  gateway?: GatewayConfig
  models?: ModelsConfig
}

export interface AgentConfig {
  defaults?: AgentDefaults
  list?: AgentInstance[]
}

export interface AgentDefaults {
  workspace?: string
  model?: ModelConfig
  tools?: ToolPolicyConfig
}

export interface AgentInstance {
  id: string
  workspace?: string
  model?: ModelConfig
  tools?: ToolPolicyConfig
  sandbox?: SandboxConfig
}

export interface ModelConfig {
  primary: string
  fallback?: string[]
}

export interface ToolPolicyConfig {
  allow?: string[]
  deny?: string[]
  profile?: 'minimal' | 'coding' | 'full'
}

export interface ChannelConfig {
  enabled?: boolean
  dmPolicy?: string
  allowFrom?: string[]
  groups?: Record<string, unknown>
}

export interface Binding {
  channel: string
  agentId: string
}

export interface ToolsConfig {
  allow?: string[]
  deny?: string[]
  profile?: string
  sandbox?: SandboxConfig
}

export interface SandboxConfig {
  enabled: boolean
  docker?: Record<string, unknown>
}

export interface SessionConfig {
  reset?: { mode: string; hour?: number; idleMinutes?: number }
  queue?: { mode: string }
}

export interface GatewayConfig {
  port?: number
  bind?: string
  auth?: { token?: string; allowTailscale?: boolean }
  controlUi?: { basePath?: string }
}

export interface ModelsConfig {
  primary?: string
  fallback?: string[]
  mode?: 'merge' | 'replace' | string
  providers?: Record<string, ModelProviderConfig>
}

export interface ModelProviderConfig {
  api?: 'openai-completions' | 'openai-responses' | 'anthropic-messages' | 'google-generative-ai' | string
  baseUrl?: string
  apiKey?: string
  authHeader?: boolean
  headers?: Record<string, string>
  modelPrefix?: string
  models?: ModelProviderModel[]
}

export interface ModelProviderModel {
  id: string
  name?: string
  enabled?: boolean
  contextWindow?: number
  tags?: string[]
}

export interface ConfigPatch {
  path: string
  value: unknown
}
