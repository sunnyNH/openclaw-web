export interface Channel {
  id: string
  platform: ChannelPlatform
  enabled: boolean
  status: ChannelStatus
  accountName?: string
  memberCount?: number
  dmPolicy: DMPolicy
  groups?: ChannelGroup[]
}

export type ChannelPlatform =
  | 'whatsapp'
  | 'telegram'
  | 'discord'
  | 'slack'
  | 'signal'
  | 'imessage'
  | 'webchat'
  | 'matrix'
  | string

export type ChannelStatus = 'connected' | 'disconnected' | 'authenticating' | 'error'

export type DMPolicy = 'pairing' | 'allowlist' | 'open' | 'disabled'

export interface ChannelGroup {
  id: string
  name: string
  requireMention: boolean
  allowFrom?: string[]
}

export interface ChannelAuthParams {
  channelId: string
  method?: string
}

export interface PairParams {
  channelId: string
  code: string
}
