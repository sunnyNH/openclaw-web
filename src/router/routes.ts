import type { RouteRecordRaw } from 'vue-router'

export const routes: RouteRecordRaw[] = [
  {
    path: '/login',
    name: 'Login',
    component: () => import('@/views/Login.vue'),
    meta: { titleKey: 'routes.login', public: true },
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
        meta: { titleKey: 'routes.dashboard', icon: 'GridOutline' },
      },
      {
        path: 'chat',
        name: 'Chat',
        component: () => import('@/views/chat/ChatPage.vue'),
        meta: { titleKey: 'routes.chat', icon: 'ChatboxEllipsesOutline' },
      },
      {
        path: 'sessions',
        name: 'Sessions',
        component: () => import('@/views/sessions/SessionsPage.vue'),
        meta: { titleKey: 'routes.sessions', icon: 'ChatbubblesOutline' },
      },
      {
        path: 'sessions/:key',
        name: 'SessionDetail',
        component: () => import('@/views/sessions/SessionDetailPage.vue'),
        meta: { titleKey: 'routes.sessionDetail', hidden: true },
      },
      {
        path: 'memory',
        name: 'Memory',
        component: () => import('@/views/memory/MemoryPage.vue'),
        meta: { titleKey: 'routes.memory', icon: 'BookOutline' },
      },
      {
        path: 'cron',
        name: 'Cron',
        component: () => import('@/views/cron/CronPage.vue'),
        meta: { titleKey: 'routes.cron', icon: 'CalendarOutline' },
      },
      {
        path: 'models',
        name: 'Models',
        component: () => import('@/views/models/ModelsPage.vue'),
        meta: { titleKey: 'routes.models', icon: 'SparklesOutline' },
      },
      {
        path: 'channels',
        name: 'Channels',
        component: () => import('@/views/channels/ChannelsPage.vue'),
        meta: { titleKey: 'routes.channels', icon: 'GitNetworkOutline' },
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
        meta: { titleKey: 'routes.skills', icon: 'ExtensionPuzzleOutline' },
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
        meta: { titleKey: 'routes.monitor', icon: 'PulseOutline' },
      },
      {
        path: 'settings',
        name: 'Settings',
        component: () => import('@/views/settings/SettingsPage.vue'),
        meta: { titleKey: 'routes.settings', icon: 'CogOutline' },
      },
    ],
  },
]
