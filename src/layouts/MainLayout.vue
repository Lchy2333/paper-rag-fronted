<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { checkAgentHealth } from '@/api/agent'
import { useTheme } from '@/composables/useTheme'

const route = useRoute()
const router = useRouter()

const { isDark, toggleTheme } = useTheme()

const activeMenu = ref(route.name === 'documents' ? 'documents' : 'chat')

// Agent 服务健康状态（顶部右侧小圆点，5s 轮询）
const agentOnline = ref<boolean | null>(null)
let timer: number | undefined

async function refreshHealth() {
  agentOnline.value = await checkAgentHealth()
}

onMounted(() => {
  refreshHealth()
  timer = window.setInterval(refreshHealth, 5000)
})

onBeforeUnmount(() => {
  if (timer) window.clearInterval(timer)
})

function handleSelect(key: string) {
  router.push(`/${key}`)
}
</script>

<template>
  <div class="main-layout">
    <header class="main-header">
      <div class="brand">
        <el-icon :size="20" color="#fff"><Reading /></el-icon>
        <span class="brand-name">论文 RAG 助手</span>
      </div>

      <el-menu
        class="main-nav"
        mode="horizontal"
        :default-active="activeMenu"
        :ellipsis="false"
        @select="handleSelect"
      >
        <el-menu-item index="chat">
          <el-icon><ChatDotRound /></el-icon>对话
        </el-menu-item>
        <el-menu-item index="documents">
          <el-icon><FolderOpened /></el-icon>文档库
        </el-menu-item>
      </el-menu>

      <div class="header-right">
        <button
          class="theme-toggle"
          type="button"
          :title="isDark ? '切换到浅色模式' : '切换到暗色模式'"
          :aria-label="isDark ? '切换到浅色模式' : '切换到暗色模式'"
          @click="toggleTheme"
        >
          <el-icon :size="16"><Moon v-if="isDark" /><Sunny v-else /></el-icon>
        </button>
        <span class="status" :class="agentOnline ? 'online' : 'offline'" :title="agentOnline ? 'Agent 服务在线' : 'Agent 服务不可达'">
          <span class="status-dot"></span>
          {{ agentOnline ? 'Agent 在线' : 'Agent 离线' }}
        </span>
      </div>
    </header>

    <main class="main-body">
      <router-view />
    </main>
  </div>
</template>

<style scoped>
.main-layout {
  display: flex;
  flex-direction: column;
  height: 100vh;
}

.main-header {
  display: flex;
  align-items: center;
  gap: 24px;
  height: 52px;
  padding: 0 16px;
  background: var(--prf-surface);
  border-bottom: 1px solid var(--prf-border);
  box-shadow: var(--prf-shadow-sm);
}

.brand {
  display: flex;
  align-items: center;
  gap: 9px;
  flex-shrink: 0;
}
.brand .el-icon {
  background: var(--prf-primary-gradient);
  border-radius: 8px;
  padding: 5px;
  color: #fff;
  box-shadow: 0 2px 8px var(--prf-primary-soft);
}
.brand-name {
  font-size: 15px;
  font-weight: 600;
  background: var(--prf-primary-gradient);
  -webkit-background-clip: text;
  background-clip: text;
  -webkit-text-fill-color: transparent;
}

.main-nav {
  flex: 1;
  border-bottom: none !important;
  background: transparent !important;
}
.main-nav :deep(.el-menu-item) {
  height: 52px;
  line-height: 52px;
}
.main-nav :deep(.el-menu-item.is-active) {
  color: var(--prf-primary);
}

.header-right {
  display: flex;
  align-items: center;
  gap: 14px;
  flex-shrink: 0;
}

.theme-toggle {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 30px;
  height: 30px;
  border-radius: 8px;
  border: 1px solid var(--prf-border);
  background: var(--prf-surface);
  color: var(--prf-text-2);
  cursor: pointer;
  transition:
    color 0.2s,
    border-color 0.2s,
    background-color 0.2s,
    transform 0.2s;
}
.theme-toggle:hover {
  color: var(--prf-primary);
  border-color: var(--prf-primary);
  background: var(--prf-active);
  transform: rotate(15deg);
}

.status {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-size: 12px;
  color: var(--prf-text-3);
}
.status-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: var(--prf-text-4);
}
.status.online .status-dot {
  background: var(--prf-success);
  box-shadow: 0 0 0 3px rgba(103, 194, 58, 0.2);
}
.status.offline .status-dot {
  background: var(--prf-danger);
  box-shadow: 0 0 0 3px rgba(245, 108, 108, 0.2);
}

.main-body {
  flex: 1;
  min-height: 0;
}
</style>
