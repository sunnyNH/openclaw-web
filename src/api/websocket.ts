import { ConnectionState, type RPCFrame, type RPCEvent, type RPCResponse } from './types'
import { buildConnectParams } from './connect'
import { byLocale, getActiveLocale } from '@/i18n/text'

type EventHandler = (...args: unknown[]) => void

export interface WebSocketConfig {
  url: string
  auth?: string
  reconnect?: boolean
  reconnectInterval?: number
  maxReconnectAttempts?: number
  heartbeatInterval?: number
}

const DEFAULT_CONFIG: Required<Omit<WebSocketConfig, 'auth'>> & { auth?: string } = {
  url: 'ws://127.0.0.1:18789',
  reconnect: true,
  reconnectInterval: 3000,
  maxReconnectAttempts: 20,
  heartbeatInterval: 30000,
}
const WS_CLOSE_REASON_MAX_BYTES = 123
const MAX_QUEUED_MESSAGES = 200

interface QueuedMessage {
  frame: RPCFrame
  serialized: string
}

export class OpenClawWebSocket {
  private ws: WebSocket | null = null
  private config: Required<Omit<WebSocketConfig, 'auth'>> & { auth?: string }
  private listeners = new Map<string, Set<EventHandler>>()
  private reconnectAttempts = 0
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null
  private challengeTimer: ReturnType<typeof setTimeout> | null = null
  private connectTimer: ReturnType<typeof setTimeout> | null = null
  private pendingConnectId: string | null = null
  private connectNonce: string | null = null
  private connectSent = false
  private messageQueue: QueuedMessage[] = []
  private _state: ConnectionState = ConnectionState.DISCONNECTED

  get state(): ConnectionState {
    return this._state
  }

  constructor(config?: Partial<WebSocketConfig>) {
    this.config = { ...DEFAULT_CONFIG, ...config }
  }

  connect(url?: string, auth?: string): void {
    if (url) this.config.url = url
    if (auth !== undefined) this.config.auth = auth

    this.setState(ConnectionState.CONNECTING)
    this.reconnectAttempts = 0
    this.pendingConnectId = null
    this.connectNonce = null
    this.connectSent = false

    this.createConnection()
  }

  disconnect(): void {
    this.clearTimers()
    this.pendingConnectId = null
    this.clearMessageQueue(byLocale('连接已断开，未发送请求已丢弃', 'Connection closed. Dropped unsent requests.', getActiveLocale()))
    this._state = ConnectionState.DISCONNECTED
    if (this.ws) {
      this.ws.onclose = null
      this.ws.close()
      this.ws = null
    }
    this.emit('stateChange', ConnectionState.DISCONNECTED)
  }

  send(data: RPCFrame): void {
    const serialized = JSON.stringify(data)
    if (this.ws?.readyState === WebSocket.OPEN && this._state === ConnectionState.CONNECTED) {
      this.ws.send(serialized)
    } else {
      if (data.type === 'req' && !this.shouldQueueRequest(data.method)) {
        const locale = getActiveLocale()
        this.rejectRequestImmediately(
          data.id,
          byLocale(`连接未就绪，已拒绝请求: ${data.method}`, `Connection not ready. Rejected request: ${data.method}`, locale),
        )
        return
      }

      if (this.messageQueue.length >= MAX_QUEUED_MESSAGES) {
        const dropped = this.messageQueue.shift()
        if (dropped?.frame.type === 'req') {
          this.rejectRequestImmediately(
            dropped.frame.id,
            byLocale('请求队列已满，最早请求已丢弃', 'Request queue full. Dropped the oldest request.', getActiveLocale()),
          )
        }
      }

      this.messageQueue.push({ frame: data, serialized })
    }
  }

  on(event: string, handler: EventHandler): () => void {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, new Set())
    }
    this.listeners.get(event)!.add(handler)
    return () => this.off(event, handler)
  }

  off(event: string, handler: EventHandler): void {
    this.listeners.get(event)?.delete(handler)
  }

  private emit(event: string, ...args: unknown[]): void {
    this.listeners.get(event)?.forEach((handler) => {
      try {
        handler(...args)
      } catch (e) {
        console.error(`[WebSocket] Event handler error for "${event}":`, e)
      }
    })
  }

  private async sendConnect(): Promise<void> {
    if (this.connectSent) return
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return
    if (!this.pendingConnectId) return
    if (!this.connectNonce) return

    this.connectSent = true
    this.clearChallengeTimeout()

    try {
      const connectFrame: RPCFrame = {
        type: 'req',
        id: this.pendingConnectId,
        method: 'connect',
        params: await buildConnectParams(this.config.auth || '', { nonce: this.connectNonce }),
      }
      this.ws.send(JSON.stringify(connectFrame))
      this.startConnectTimeout()
    } catch (e) {
      const locale = getActiveLocale()
      const errorMessage = (e as Error)?.message || 'unknown error'
      const isSecureContextError = /crypto\.subtle|secure context/i.test(errorMessage)
      const reason = isSecureContextError
        ? byLocale(
            '设备签名需要安全上下文（HTTPS 或 localhost）',
            'Device auth requires a secure context (HTTPS or localhost).',
            locale,
          )
        : byLocale(
            `Gateway connect 参数构造失败: ${errorMessage}`,
            `Failed to build Gateway connect params: ${errorMessage}`,
            locale,
          )
      this.pendingConnectId = null
      this.setState(ConnectionState.FAILED)
      this.emit('error', reason)
      this.emit('failed', reason)
      this.safeClose(4001, reason)
    }
  }

  private createConnection(): void {
    try {
      this.ws = new WebSocket(this.buildConnectionUrl())

      this.ws.onopen = () => {
        const connectId = `connect-${Date.now()}`
        this.pendingConnectId = connectId
        this.connectNonce = null
        this.connectSent = false
        // connect.challenge nonce 是 v2 设备签名握手必需
        this.startChallengeTimeout()
      }

      this.ws.onmessage = (event: MessageEvent) => {
        this.handleIncomingData(event.data)
      }

      this.ws.onclose = (event: CloseEvent) => {
        this.clearTimers()
        this.pendingConnectId = null
        this.emit('disconnected', event.code, event.reason)

        const shouldReconnect =
          this.config.reconnect &&
          this._state !== ConnectionState.DISCONNECTED &&
          this._state !== ConnectionState.FAILED

        if (shouldReconnect) {
          this.scheduleReconnect()
        } else {
          if (this._state !== ConnectionState.FAILED) {
            this.setState(ConnectionState.DISCONNECTED)
          }
        }
      }

      this.ws.onerror = () => {
        this.emit('error', 'WebSocket connection error')
      }
    } catch (e) {
      console.error('[WebSocket] Connection failed:', e)
      if (this.config.reconnect) {
        this.scheduleReconnect()
      } else {
        this.setState(ConnectionState.FAILED)
      }
    }
  }

  private handleFrame(frame: RPCFrame): void {
    if (frame.type === 'res') {
      if (this.pendingConnectId && frame.id === this.pendingConnectId) {
        this.handleConnectResponse(frame as RPCResponse<unknown>)
      }
      this.emit(`rpc:${frame.id}`, frame)
    } else if (frame.type === 'event') {
      const evt = frame as RPCEvent
      if (evt.event === 'connect.challenge') {
        const payload = evt.payload as { nonce?: unknown } | undefined
        const nonce = payload && typeof payload.nonce === 'string' ? payload.nonce.trim() : ''
        if (nonce && !this.connectSent) {
          this.connectNonce = nonce
          this.clearChallengeTimeout()
          void this.sendConnect()
        }
      }
      this.emit('event', evt)
      this.emit(`event:${evt.event}`, evt.payload)
    }
  }

  private handleConnectResponse(frame: RPCResponse<unknown>): void {
    this.pendingConnectId = null
    if (this.connectTimer) {
      clearTimeout(this.connectTimer)
      this.connectTimer = null
    }

    if (frame.ok) {
      this.setState(ConnectionState.CONNECTED)
      this.reconnectAttempts = 0
      this.startHeartbeat()
      this.flushQueue()
      this.emit('connected', frame.payload)
      return
    }

    const locale = getActiveLocale()
    const error = (frame.error ?? {}) as {
      message?: unknown
      code?: unknown
      details?: unknown
    }
    const errorMessage = typeof error.message === 'string' ? error.message : ''
    const details = (error.details ?? {}) as { requestId?: unknown }
    const requestId = typeof details.requestId === 'string' ? details.requestId : ''
    const reason = requestId
      ? byLocale(
          `设备配对待批准，请在 Gateway 上运行 openclaw devices approve ${requestId}`,
          `Device pairing required. Approve on the Gateway: openclaw devices approve ${requestId}`,
          locale,
        )
      : errorMessage || byLocale('Gateway connect 握手失败', 'Gateway connect handshake failed', locale)
    this.setState(ConnectionState.FAILED)
    this.emit('error', reason)
    this.emit('failed', reason)
    this.safeClose(4001, reason)
  }

  private startChallengeTimeout(): void {
    if (this.challengeTimer) {
      clearTimeout(this.challengeTimer)
    }
    this.challengeTimer = setTimeout(() => {
      if (!this.pendingConnectId || this.connectSent) return
      this.pendingConnectId = null
      const reason = byLocale(
        '未收到 Gateway connect.challenge，无法开始设备签名握手，请检查网关地址/网络/代理',
        'Missing Gateway connect.challenge. Cannot start device-auth handshake. Check gateway URL/network/proxy.',
        getActiveLocale(),
      )
      this.setState(ConnectionState.FAILED)
      this.emit('error', reason)
      this.emit('failed', reason)
      this.safeClose(4002, reason)
    }, 10000)
  }

  private clearChallengeTimeout(): void {
    if (!this.challengeTimer) return
    clearTimeout(this.challengeTimer)
    this.challengeTimer = null
  }

  private startConnectTimeout(): void {
    if (this.connectTimer) {
      clearTimeout(this.connectTimer)
    }
    this.connectTimer = setTimeout(() => {
      if (!this.pendingConnectId) return
      this.pendingConnectId = null
      const reason = byLocale('Gateway connect 握手超时', 'Gateway connect handshake timeout', getActiveLocale())
      this.setState(ConnectionState.FAILED)
      this.emit('error', reason)
      this.emit('failed', reason)
      this.safeClose(4003, reason)
    }, 10000)
  }

  private buildConnectionUrl(): string {
    try {
      const parsed = new URL(this.config.url, window.location.href)
      if (this.config.auth && this.config.auth.trim()) {
        parsed.searchParams.set('auth', this.config.auth)
      } else {
        parsed.searchParams.delete('auth')
      }
      return parsed.toString()
    } catch {
      return this.config.url
    }
  }

  private scheduleReconnect(): void {
    if (this.reconnectAttempts >= this.config.maxReconnectAttempts) {
      this.setState(ConnectionState.FAILED)
      this.emit('failed', 'Max reconnect attempts reached')
      return
    }

    this.setState(ConnectionState.RECONNECTING)
    const delay = Math.min(
      this.config.reconnectInterval * Math.pow(1.5, this.reconnectAttempts),
      30000
    )
    this.reconnectAttempts++

    this.reconnectTimer = setTimeout(() => {
      this.createConnection()
    }, delay)

    this.emit('reconnecting', this.reconnectAttempts, delay)
  }

  private startHeartbeat(): void {
    this.heartbeatTimer = setInterval(() => {
      if (this.ws?.readyState === WebSocket.OPEN) {
        this.send({ type: 'req', id: `health-${Date.now()}`, method: 'health' })
      }
    }, this.config.heartbeatInterval)
  }

  private flushQueue(): void {
    while (this.messageQueue.length > 0) {
      const queued = this.messageQueue.shift()!
      this.ws?.send(queued.serialized)
    }
  }

  private setState(state: ConnectionState): void {
    this._state = state
    this.emit('stateChange', state)
  }

  private handleIncomingData(rawData: unknown): void {
    if (typeof rawData !== 'string') {
      if (rawData instanceof Blob) {
        rawData
          .text()
          .then((text) => this.handleIncomingText(text))
          .catch((err) => console.error('[WebSocket] Failed to read blob message:', err))
      }
      return
    }

    this.handleIncomingText(rawData)
  }

  private handleIncomingText(text: string): void {
    const trimmed = text.trim()
    if (!trimmed || trimmed[0] !== '{') {
      return
    }

    let frame: RPCFrame
    try {
      frame = JSON.parse(trimmed) as RPCFrame
    } catch (err) {
      console.error('[WebSocket] Failed to parse message:', err)
      return
    }

    try {
      this.handleFrame(frame)
    } catch (err) {
      console.error('[WebSocket] Failed to handle frame:', err)
    }
  }

  private safeClose(code: number, reason: string): void {
    if (!this.ws || this.ws.readyState >= WebSocket.CLOSING) {
      return
    }

    const safeReason = this.sanitizeCloseReason(reason)
    try {
      if (safeReason) {
        this.ws.close(code, safeReason)
      } else {
        this.ws.close(code)
      }
    } catch {
      try {
        this.ws.close(code)
      } catch {
        this.ws.close()
      }
    }
  }

  private sanitizeCloseReason(reason: string): string {
    let result = reason.trim()
    if (!result) return ''

    const encoder = new TextEncoder()
    while (result && encoder.encode(result).length > WS_CLOSE_REASON_MAX_BYTES) {
      result = result.slice(0, -1)
    }

    return result
  }

  private shouldQueueRequest(method: string): boolean {
    return (
      method === 'connect' ||
      method === 'health' ||
      method === 'ping' ||
      method.endsWith('.history') ||
      method.endsWith('.list') ||
      method.endsWith('.get') ||
      method.endsWith('.status')
    )
  }

  private rejectRequestImmediately(id: string, message: string): void {
    const res: RPCResponse<unknown> = {
      type: 'res',
      id,
      ok: false,
      error: {
        message,
      },
    }
    this.emit(`rpc:${id}`, res)
  }

  private clearMessageQueue(reason: string): void {
    while (this.messageQueue.length > 0) {
      const queued = this.messageQueue.shift()!
      if (queued.frame.type === 'req') {
        this.rejectRequestImmediately(queued.frame.id, reason)
      }
    }
  }

  private clearTimers(): void {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer)
      this.reconnectTimer = null
    }
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer)
      this.heartbeatTimer = null
    }
    this.clearChallengeTimeout()
    if (this.connectTimer) {
      clearTimeout(this.connectTimer)
      this.connectTimer = null
    }
  }
}
