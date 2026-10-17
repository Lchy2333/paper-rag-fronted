import { createRouter, createWebHistory } from 'vue-router'

const router = createRouter({
  history: createWebHistory(import.meta.env.BASE_URL),
  routes: [
    {
      path: '/',
      component: () => import('@/layouts/MainLayout.vue'),
      redirect: '/chat',
      children: [
        {
          path: 'chat',
          name: 'chat',
          component: () => import('@/views/ChatView.vue'),
          meta: { title: '对话' },
        },
        {
          path: 'documents',
          name: 'documents',
          component: () => import('@/views/DocumentsView.vue'),
          meta: { title: '文档库' },
        },
      ],
    },
  ],
})

router.afterEach((to) => {
  const title = to.meta.title as string | undefined
  document.title = title ? `${title} · 论文 RAG 助手` : '论文 RAG 助手'
})

export default router
