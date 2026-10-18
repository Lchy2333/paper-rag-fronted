<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { ElMessageBox } from 'element-plus'
import { checkAgentHealth } from '@/api/agent'
import { checkRagHealth } from '@/api/rag'
import { authUser, clearAuth } from '@/api/authState'
import { THEMES, useTheme } from '@/composables/useTheme'

const route = useRoute()
const router = useRouter()

const { theme, isDark, setTheme } = useTheme()

const activeMenu = ref(route.name === 'documents' ? 'documents' : 'chat')

// Agent / RAG 服务健康状态（顶部右侧小圆点，5s 轮询）
const agentOnline = ref<boolean | null>(null)
const ragOnline = ref<boolean | null>(null)
let timer: number | undefined

async function refreshHealth() {
  agentOnline.value = await checkAgentHealth()
  ragOnline.value = await checkRagHealth()
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

async function handleLogout() {
  try {
    await ElMessageBox.confirm('确认退出登录？', '退出登录', {
      type: 'warning',
      confirmButtonText: '退出',
      cancelButtonText: '取消',
    })
  } catch {
    return
  }
  clearAuth()
  router.replace({ name: 'login' })
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
        <el-popover placement="bottom" :width="264" trigger="click" popper-class="theme-popper">
          <template #reference>
            <button
              class="theme-toggle"
              type="button"
              title="选择主题"
              aria-label="选择主题"
            >
              <el-icon :size="16"><Moon v-if="isDark" /><Sunny v-else /></el-icon>
            </button>
          </template>
          <div class="theme-picker">
            <div class="theme-picker-title">选择主题</div>
            <div class="theme-picker-grid">
              <button
                v-for="t in THEMES"
                :key="t.id"
                type="button"
                class="theme-option"
                :class="{ active: theme === t.id }"
                @click="setTheme(t.id)"
              >
                <span class="theme-swatch" :style="{ background: t.color }"></span>
                <span class="theme-label">{{ t.label }}</span>
                <el-icon v-if="theme === t.id" class="theme-check"><Check /></el-icon>
              </button>
            </div>
          </div>
        </el-popover>

        <span class="status" :class="agentOnline ? 'online' : 'offline'" :title="agentOnline ? 'Agent 服务在线' : 'Agent 服务不可达'">
          <span class="status-dot"></span>
          {{ agentOnline ? 'Agent 在线' : 'Agent 离线' }}
        </span>
        <span class="status" :class="ragOnline ? 'online' : 'offline'" :title="ragOnline ? 'RAG 服务在线' : 'RAG 服务不可达'">
          <span class="status-dot"></span>
          {{ ragOnline ? 'RAG 在线' : 'RAG 离线' }}
        </span>

        <el-dropdown trigger="click" popper-class="user-popper" @command="(cmd: string) => cmd === 'logout' && handleLogout()">
          <button class="user-btn" type="button" :title="authUser?.username">
            <span class="user-avatar">{{ authUser?.username?.slice(0, 1).toUpperCase() ?? '?' }}</span>
            <span class="user-name">{{ authUser?.username }}</span>
            <el-icon :size="12"><ArrowDown /></el-icon>
          </button>
          <template #dropdown>
            <el-dropdown-menu>
              <el-dropdown-item disabled>
                <span class="user-meta">已登录：{{ authUser?.username }}</span>
              </el-dropdown-item>
              <el-dropdown-item command="logout" divided class="danger-item">退出登录</el-dropdown-item>
            </el-dropdown-menu>
          </template>
        </el-dropdown>
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

/* 用户信息 + 退出 */
.user-btn {
  display: inline-flex;
  align-items: center;
  gap: 7px;
  height: 32px;
  padding: 0 10px;
  border: 1px solid var(--prf-border);
  border-radius: 8px;
  background: var(--prf-surface);
  color: var(--prf-text-2);
  cursor: pointer;
  font-size: 13px;
  transition:
    color 0.2s,
    border-color 0.2s,
    background-color 0.2s;
}
.user-btn:hover {
  color: var(--prf-primary);
  border-color: var(--prf-primary);
  background: var(--prf-active);
}
.user-avatar {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 20px;
  height: 20px;
  border-radius: 6px;
  background: var(--prf-primary-gradient);
  color: #fff;
  font-size: 12px;
  font-weight: 600;
}
.user-name {
  max-width: 96px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.main-body {
  flex: 1;
  min-height: 0;
}
</style>

<style>
/* 主题选择器弹窗（teleport 到 body，需非 scoped 样式） */
.theme-popper {
  padding: 6px;
}
.theme-picker-title {
  font-size: 13px;
  font-weight: 600;
  color: var(--prf-text-1);
  padding: 4px 8px 8px;
}
.theme-picker-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 4px;
}
.theme-option {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 10px;
  border: 1px solid transparent;
  border-radius: 8px;
  background: transparent;
  cursor: pointer;
  font-size: 13px;
  color: var(--prf-text-2);
  transition:
    background-color 0.15s,
    border-color 0.15s;
}
.theme-option:hover {
  background: var(--prf-hover);
}
.theme-option.active {
  border-color: var(--prf-primary);
  background: var(--prf-active);
  color: var(--prf-primary);
}
.theme-swatch {
  width: 16px;
  height: 16px;
  border-radius: 50%;
  flex-shrink: 0;
  box-shadow: inset 0 0 0 1px rgba(0, 0, 0, 0.12);
}
.theme-label {
  flex: 1;
  text-align: left;
}
.theme-check {
  font-size: 13px;
  color: var(--prf-primary);
}

/* 用户菜单（teleport 到 body，需非 scoped 样式） */
.user-popper {
  min-width: 160px;
}
.user-popper .user-meta {
  color: var(--prf-text-3);
  font-size: 13px;
}
.user-popper .danger-item {
  color: var(--prf-danger) !important;
}
.user-popper .danger-item:hover {
  background: var(--prf-danger-bg) !important;
  color: var(--prf-danger) !important;
}
</style>
