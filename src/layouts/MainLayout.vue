<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { checkAgentHealth } from '@/api/agent'

const route = useRoute()
const router = useRouter()

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
  padding: 0 20px;
  background: #fff;
  border-bottom: 1px solid var(--prf-border);
}

.brand {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-shrink: 0;
}
.brand .el-icon {
  background: var(--prf-primary);
  border-radius: 6px;
  padding: 3px;
}
.brand-name {
  font-size: 15px;
  font-weight: 600;
  color: #1f2329;
}

.main-nav {
  flex: 1;
  border-bottom: none !important;
}
.main-nav :deep(.el-menu-item) {
  height: 52px;
  line-height: 52px;
}
.main-nav :deep(.el-menu-item.is-active) {
  color: var(--prf-primary);
}

.header-right {
  flex-shrink: 0;
}
.status {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-size: 12px;
  color: #909399;
}
.status-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: #c0c4cc;
}
.status.online .status-dot {
  background: #67c23a;
}
.status.offline .status-dot {
  background: #f56c6c;
}

.main-body {
  flex: 1;
  min-height: 0;
}
</style>
