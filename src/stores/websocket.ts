import { ref, shallowRef } from 'vue'
import { defineStore } from 'pinia'
import { OpenClawWebSocket } from '@/api/websocket'
import { RPCClient } from '@/api/rpc-client'
import { ConnectionState } from '@/api/types'

export const useWebSocketStore = defineStore('websocket', () => {
  const state = ref<ConnectionState>(ConnectionState.DISCONNECTED)
  const lastError = ref<string | null>(null)
  const reconnectAttempts = ref(0)
  let listenersBound = false

  const ws = shallowRef<OpenClawWebSocket>(new OpenClawWebSocket())
  const rpc = shallowRef<RPCClient>(new RPCClient(ws.value))

  function bindListeners() {
    if (listenersBound) return

    ws.value.on('stateChange', (newState: unknown) => {
      state.value = newState as ConnectionState
    })

    ws.value.on('reconnecting', (attempts: unknown) => {
      reconnectAttempts.value = attempts as number
    })

    ws.value.on('error', (error: unknown) => {
      lastError.value = error as string
    })

    ws.value.on('failed', (reason: unknown) => {
      lastError.value = reason as string
    })

    ws.value.on('disconnected', (code: unknown, reason: unknown) => {
      if (state.value !== ConnectionState.DISCONNECTED && state.value !== ConnectionState.FAILED) {
        lastError.value = `连接断开 (code: ${String(code)}, reason: ${String(reason || 'n/a')})`
      }
    })

    listenersBound = true
  }

  function connect(url: string, auth?: string) {
    lastError.value = null
    bindListeners()
    ws.value.connect(url, auth)
  }

  function disconnect() {
    ws.value.disconnect()
  }

  function subscribe(event: string, handler: (...args: unknown[]) => void): () => void {
    return ws.value.on(event, handler)
  }

  return {
    state,
    lastError,
    reconnectAttempts,
    ws,
    rpc,
    connect,
    disconnect,
    subscribe,
  }
})
