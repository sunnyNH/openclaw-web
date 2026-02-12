import { ref } from 'vue'
import { defineStore } from 'pinia'
import { useWebSocketStore } from './websocket'
import type { Skill } from '@/api/types'

export const useSkillStore = defineStore('skill', () => {
  const skills = ref<Skill[]>([])
  const loading = ref(false)
  const installing = ref<string | null>(null)
  const error = ref<string | null>(null)

  const wsStore = useWebSocketStore()

  async function fetchSkills() {
    loading.value = true
    error.value = null
    try {
      skills.value = await wsStore.rpc.listSkills()
    } catch (err) {
      skills.value = []
      const message = err instanceof Error ? err.message : String(err)
      error.value = message
      console.error('[SkillStore] fetchSkills failed:', err)
    } finally {
      loading.value = false
    }
  }

  async function installSkill(name: string) {
    installing.value = name
    error.value = null
    try {
      await wsStore.rpc.installSkill(name)
      await fetchSkills()
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      error.value = message
      throw err
    } finally {
      installing.value = null
    }
  }

  async function updateSkills() {
    loading.value = true
    error.value = null
    try {
      await wsStore.rpc.updateSkills()
      await fetchSkills()
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      error.value = message
      throw err
    } finally {
      loading.value = false
    }
  }

  return {
    skills,
    loading,
    installing,
    error,
    fetchSkills,
    installSkill,
    updateSkills,
  }
})
