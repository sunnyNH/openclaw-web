import type { RouteRecordRaw } from 'vue-router'

export const routes: RouteRecordRaw[] = [
  {
    path: '/login',
    name: 'Login',
    component: () => import('@/views/Login.vue'),
    meta: { title: '登录', public: true },
  },
  {
    path: '/',
    component: () => import('@/layouts/DefaultLayout.vue'),
    meta: { requiresAuth: true },
    children: [
      {
        path: '',
        name: 'Dashboard',
        component: () => import('@/views/Dashboard.vue'),
        meta: { title: '仪表盘', icon: 'GridOutline' },
      },
      {
        path: 'chat',
        name: 'Chat',
        component: () => import('@/views/chat/ChatPage.vue'),
        meta: { title: '在线对话', icon: 'ChatboxEllipsesOutline' },
      },
      {
        path: 'sessions',
        name: 'Sessions',
        component: () => import('@/views/sessions/SessionsPage.vue'),
        meta: { title: '会话管理', icon: 'ChatbubblesOutline' },
      },
      {
        path: 'sessions/:key',
        name: 'SessionDetail',
        component: () => import('@/views/sessions/SessionDetailPage.vue'),
        meta: { title: '会话详情', hidden: true },
      },
      {
        path: 'memory',
        name: 'Memory',
        component: () => import('@/views/memory/MemoryPage.vue'),
        meta: { title: '记忆管理', icon: 'BookOutline' },
      },
      {
        path: 'cron',
        name: 'Cron',
        component: () => import('@/views/cron/CronPage.vue'),
        meta: { title: 'Cron 管理', icon: 'CalendarOutline' },
      },
      {
        path: 'models',
        name: 'Models',
        component: () => import('@/views/models/ModelsPage.vue'),
        meta: { title: 'Model 管理', icon: 'SparklesOutline' },
      },
      {
        path: 'channels',
        name: 'Channels',
        component: () => import('@/views/channels/ChannelsPage.vue'),
        meta: { title: '频道管理', icon: 'GitNetworkOutline' },
      },
      {
        path: 'config',
        redirect: { name: 'Models' },
        meta: { hidden: true },
      },
      {
        path: 'skills',
        name: 'Skills',
        component: () => import('@/views/skills/SkillsPage.vue'),
        meta: { title: '技能管理', icon: 'ExtensionPuzzleOutline' },
      },
      {
        path: 'tools',
        redirect: { name: 'Skills' },
        meta: { hidden: true },
      },
      {
        path: 'monitor',
        name: 'Monitor',
        component: () => import('@/views/monitor/MonitorPage.vue'),
        meta: { title: '运维中心', icon: 'PulseOutline' },
      },
      {
        path: 'settings',
        name: 'Settings',
        component: () => import('@/views/settings/SettingsPage.vue'),
        meta: { title: '系统设置', icon: 'CogOutline' },
      },
    ],
  },
]
