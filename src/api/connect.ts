export interface ConnectParams {
  minProtocol: number
  maxProtocol: number
  client: {
    id: string
    version: string
    platform: string
    mode: 'cli' | 'ui' | 'webchat' | 'operator' | 'node' | string
    displayName?: string
    instanceId?: string
  }
  role: 'operator' | 'node' | string
  scopes: string[]
  caps: string[]
  commands: string[]
  permissions: Record<string, boolean>
  auth: {
    token: string
  }
  locale?: string
  userAgent?: string
}

const DEFAULT_MIN_PROTOCOL = 3
const DEFAULT_MAX_PROTOCOL = 3
const DEFAULT_CLIENT_ID: ConnectParams['client']['id'] = 'cli'
const DEFAULT_CLIENT_MODE: ConnectParams['client']['mode'] = 'cli'

function getClientVersion(): string {
  return import.meta.env.VITE_APP_VERSION || '0.1.0'
}

function getClientPlatform(): string {
  if (typeof navigator === 'undefined') return 'web'
  const nav = navigator as Navigator & { userAgentData?: { platform?: string } }
  const raw = nav.userAgentData?.platform || navigator.platform || 'web'
  return String(raw).toLowerCase() || 'web'
}

function getClientLocale(): string | undefined {
  if (typeof navigator === 'undefined') return undefined
  return navigator.language || undefined
}

function getClientUserAgent(): string | undefined {
  if (typeof navigator === 'undefined') return undefined
  return navigator.userAgent || undefined
}

export function buildConnectParams(token: string): ConnectParams {
  return {
    minProtocol: DEFAULT_MIN_PROTOCOL,
    maxProtocol: DEFAULT_MAX_PROTOCOL,
    client: {
      id: DEFAULT_CLIENT_ID,
      version: getClientVersion(),
      platform: getClientPlatform(),
      mode: DEFAULT_CLIENT_MODE,
    },
    role: 'operator',
    scopes: ['operator.read', 'operator.write', 'operator.admin'],
    // 请求 tool-events 能力以接收 agent 工具流事件（用于前端实时状态提示/工具调用可视化）
    caps: ['tool-events'],
    commands: [],
    permissions: {},
    auth: {
      token: token || '',
    },
    locale: getClientLocale(),
    userAgent: getClientUserAgent(),
  }
}
