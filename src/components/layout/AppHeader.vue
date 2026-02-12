<script setup lang="ts">
import { computed } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { NBreadcrumb, NBreadcrumbItem, NButton, NSpace, NTooltip, NIcon } from 'naive-ui'
import { SunnyOutline, MoonOutline, LogOutOutline } from '@vicons/ionicons5'
import { useTheme } from '@/composables/useTheme'
import { useAuthStore } from '@/stores/auth'
import ConnectionStatus from '@/components/common/ConnectionStatus.vue'

const route = useRoute()
const router = useRouter()
const { isDark, toggle } = useTheme()
const authStore = useAuthStore()

const breadcrumbs = computed(() => {
  const items: { label: string; name?: string }[] = [{ label: '首页', name: 'Dashboard' }]
  if (route.name !== 'Dashboard') {
    items.push({ label: (route.meta.title as string) || '' })
  }
  return items
})

function handleLogout() {
  authStore.logout()
  router.push({ name: 'Login' })
}
</script>

<template>
  <div style="display: flex; align-items: center; justify-content: space-between; width: 100%;">
    <NBreadcrumb>
      <NBreadcrumbItem
        v-for="(item, index) in breadcrumbs"
        :key="index"
        @click="item.name ? router.push({ name: item.name }) : undefined"
      >
        {{ item.label }}
      </NBreadcrumbItem>
    </NBreadcrumb>

    <NSpace :size="8" align="center">
      <ConnectionStatus />

      <NTooltip>
        <template #trigger>
          <NButton quaternary circle @click="toggle">
            <template #icon>
              <NIcon :component="isDark ? SunnyOutline : MoonOutline" />
            </template>
          </NButton>
        </template>
        {{ isDark ? '切换浅色模式' : '切换深色模式' }}
      </NTooltip>

      <NTooltip>
        <template #trigger>
          <NButton quaternary circle @click="handleLogout">
            <template #icon>
              <NIcon :component="LogOutOutline" />
            </template>
          </NButton>
        </template>
        退出登录
      </NTooltip>
    </NSpace>
  </div>
</template>
