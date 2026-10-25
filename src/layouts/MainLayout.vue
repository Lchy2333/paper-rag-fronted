<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { ElMessageBox } from 'element-plus'
import { checkAgentHealth } from '@/api/agent'
import { authUser, clearAuth } from '@/api/authState'
import { useServiceHealth } from '@/composables/useServiceHealth'
import { THEMES, useTheme } from '@/composables/useTheme'

const route = useRoute()
const router = useRouter()

const { theme, isDark, setTheme } = useTheme()

const navItems = [
  { key: 'chat', label: '对话', icon: 'ChatDotRound' },
  { key: 'documents', label: '文档库', icon: 'FolderOpened' },
] as const

const activeNav = computed(() => (route.name === 'documents' ? 'documents' : 'chat'))

// 服务健康状态（全部来自 agent 分层 /health，前端零直连）
const agentOnline = ref<boolean | null>(null)
const healthChecks = ref<{
  rag?: { status?: string; error?: string }
  llm?: { status?: string; error?: string }
} | null>(null)
let timer: number | undefined

const { rag: ragView, llm: llmView } = useServiceHealth(healthChecks)

const agentCls = computed(() =>
  agentOnline.value === null ? 'unknown' : agentOnline.value ? 'online' : 'offline',
)
const agentDesc = computed(() =>
  agentOnline.value === null
    ? '正在检测 Agent 服务'
    : agentOnline.value
      ? 'Agent 服务在线'
      : 'Agent 服务不可达',
)

async function refreshHealth() {
  const h = await checkAgentHealth()
  if (!h) {
    agentOnline.value = false
    healthChecks.value = null
    return
  }
  agentOnline.value = h.status === 'ok'
  healthChecks.value = h.checks
}

onMounted(() => {
  refreshHealth()
  timer = window.setInterval(refreshHealth, 5000)
})

onBeforeUnmount(() => {
  if (timer) window.clearInterval(timer)
})

function go(key: string) {
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
        <span class="brand-mark">
          <el-icon :size="17"><Reading /></el-icon>
        </span>
        <span class="brand-name">Maclaosty</span>
      </div>

      <nav class="main-nav" aria-label="主导航">
        <button
          v-for="item in navItems"
          :key="item.key"
          type="button"
          class="nav-item"
          :class="{ active: activeNav === item.key }"
          :aria-current="activeNav === item.key ? 'page' : undefined"
          @click="go(item.key)"
        >
          <el-icon :size="15"><component :is="item.icon" /></el-icon>
          <span>{{ item.label }}</span>
        </button>
      </nav>

      <div class="header-right">
        <div class="health" role="status" aria-label="服务状态">
          <span class="health-item" :class="agentCls" :title="agentDesc">
            <span class="dot"></span>
            <span class="health-name">Agent</span>
          </span>
          <span class="health-item" :class="ragView.cls" :title="ragView.desc">
            <span class="dot"></span>
            <span class="health-name">RAG</span>
          </span>
          <span class="health-item" :class="llmView.cls" :title="llmView.desc">
            <span class="dot"></span>
            <span class="health-name">LLM</span>
          </span>
        </div>

        <span class="header-divider"></span>

        <el-popover placement="bottom-end" :width="252" trigger="click" popper-class="theme-popper">
          <template #reference>
            <button class="icon-btn" type="button" title="选择主题" aria-label="选择主题">
              <el-icon :size="16"><Moon v-if="isDark" /><Sunny v-else /></el-icon>
            </button>
          </template>
          <div class="theme-picker">
            <div class="theme-picker-title">外观主题</div>
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

        <el-dropdown
          trigger="click"
          popper-class="user-popper"
          @command="(cmd: string) => cmd === 'logout' && handleLogout()"
        >
          <button class="user-btn" type="button" :title="authUser?.username">
            <span class="user-avatar">{{ authUser?.username?.slice(0, 1).toUpperCase() ?? '?' }}</span>
            <span class="user-name">{{ authUser?.username }}</span>
            <el-icon class="user-caret" :size="11"><ArrowDown /></el-icon>
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
  gap: 26px;
  height: 58px;
  padding: 0 20px;
  flex-shrink: 0;
  background: var(--prf-surface);
  border-bottom: 1px solid var(--prf-border);
}

.brand {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-shrink: 0;
}
.brand-mark {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 30px;
  height: 30px;
  border-radius: 9px;
  background: var(--prf-primary);
  color: #fff;
  box-shadow:
    0 2px 6px color-mix(in srgb, var(--prf-primary) 32%, transparent),
    inset 0 0 0 1px rgba(255, 255, 255, 0.18);
}
.brand-name {
  font-size: 15px;
  font-weight: 650;
  letter-spacing: -0.015em;
  color: var(--prf-text-1);
  white-space: nowrap;
}

.main-nav {
  display: flex;
  align-items: center;
  gap: 2px;
  padding: 3px;
  border-radius: 11px;
  background: var(--prf-surface-2);
  border: 1px solid var(--prf-border);
}
.nav-item {
  display: inline-flex;
  align-items: center;
  gap: 7px;
  height: 30px;
  padding: 0 13px;
  border: none;
  border-radius: 8px;
  background: transparent;
  color: var(--prf-text-3);
  font-size: 13.5px;
  font-weight: 500;
  cursor: pointer;
  transition:
    color 0.18s ease,
    background-color 0.18s ease,
    box-shadow 0.18s ease;
}
.nav-item :deep(.el-icon) {
  opacity: 0.75;
  transition: color 0.18s ease, opacity 0.18s ease;
}
.nav-item:hover {
  color: var(--prf-text-1);
}
.nav-item.active {
  background: var(--prf-surface);
  color: var(--prf-text-1);
  box-shadow: var(--prf-shadow-sm);
}
.nav-item.active :deep(.el-icon) {
  color: var(--prf-primary);
  opacity: 1;
}

.header-right {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-left: auto;
  flex-shrink: 0;
}

.health {
  display: flex;
  align-items: center;
  gap: 1px;
}
.health-item {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 5px 8px;
  border-radius: 7px;
  font-size: 13px;
  font-weight: 500;
  color: var(--prf-text-3);
  cursor: default;
  transition: background-color 0.18s ease, color 0.18s ease;
}
.health-item:hover {
  background: var(--prf-surface-2);
  color: var(--prf-text-2);
}
.dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--prf-text-4);
  flex-shrink: 0;
}
.health-item.online .dot {
  background: var(--prf-success);
  box-shadow: 0 0 0 3px color-mix(in srgb, var(--prf-success) 16%, transparent);
}
.health-item.offline .dot {
  background: var(--prf-danger);
  box-shadow: 0 0 0 3px color-mix(in srgb, var(--prf-danger) 16%, transparent);
}
.health-item.unknown .dot {
  background: var(--prf-warning);
  box-shadow: 0 0 0 3px color-mix(in srgb, var(--prf-warning) 16%, transparent);
}

.header-divider {
  width: 1px;
  height: 18px;
  background: var(--prf-border);
  margin: 0 2px;
}

.icon-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 34px;
  height: 34px;
  border: 1px solid transparent;
  border-radius: 9px;
  background: transparent;
  color: var(--prf-text-3);
  cursor: pointer;
  transition:
    color 0.18s ease,
    background-color 0.18s ease,
    transform 0.25s ease;
}
.icon-btn:hover {
  color: var(--prf-text-1);
  background: var(--prf-surface-2);
  transform: rotate(-14deg);
}

.user-btn {
  display: inline-flex;
  align-items: center;
  gap: 7px;
  height: 34px;
  padding: 0 8px 0 4px;
  border: 1px solid transparent;
  border-radius: 10px;
  background: transparent;
  color: var(--prf-text-2);
  cursor: pointer;
  font-size: 13px;
  transition:
    color 0.18s ease,
    background-color 0.18s ease;
}
.user-btn:hover {
  background: var(--prf-surface-2);
  color: var(--prf-text-1);
}
.user-avatar {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 26px;
  height: 26px;
  border-radius: 8px;
  background: var(--prf-primary-soft);
  color: var(--prf-primary);
  font-size: 12px;
  font-weight: 650;
}
.user-name {
  max-width: 96px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.user-caret {
  color: var(--prf-text-4);
}

.main-body {
  flex: 1;
  min-height: 0;
}

@media (max-width: 1080px) {
  .health-name {
    display: none;
  }
  .health-item {
    padding: 5px 6px;
  }
}
@media (max-width: 860px) {
  .user-name,
  .user-caret {
    display: none;
  }
  .main-header {
    gap: 14px;
    padding: 0 14px;
  }
}
@media (max-width: 620px) {
  .brand-name {
    display: none;
  }
  .health {
    display: none;
  }
  .header-divider {
    display: none;
  }
}
</style>

<style>
/* 主题选择器弹窗（teleport 到 body，需非 scoped 样式） */
.theme-popper {
  padding: 10px !important;
}
.theme-picker-title {
  font-size: 12px;
  font-weight: 600;
  letter-spacing: 0.04em;
  color: var(--prf-text-3);
  padding: 2px 6px 10px;
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
  padding: 8px 9px;
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
  border-color: color-mix(in srgb, var(--prf-primary) 42%, transparent);
  background: var(--prf-active);
  color: var(--prf-primary);
}
.theme-swatch {
  width: 15px;
  height: 15px;
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
  min-width: 168px;
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
