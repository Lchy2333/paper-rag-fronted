<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { approveOperation, sendChat } from '@/api/agent'
import { ApiError } from '@/api/client'
import type { ApprovalPayload, ChatResponse } from '@/api/types'
import { renderMarkdown } from '@/utils/markdown'

/** 会话条目（新建但未发送时 currentSessionId 为 null，不入列表） */
interface Session {
  id: string
  title: string
  updatedAt: number
  /** 是否置顶 */
  pinned?: boolean
  /** 置顶时间戳，用于置顶组内排序 */
  pinnedAt?: number
}

/** 单条聊天消息 */
interface ChatMessage {
  role: 'user' | 'assistant'
  content: string
  pending?: boolean
  error?: boolean
  errorText?: string
  /** HITL 待审批操作载荷（仅 assistant 消息可能有） */
  approval?: ApprovalPayload | null
  /** 该审批是否已处理过 */
  approvalResolved?: boolean
}

const SESSIONS_KEY = 'prf_sessions'

// ---------- 会话列表 ----------
const sessions = ref<Session[]>([])
const currentSessionId = ref<string | null>(null)

// ---------- 当前会话消息 ----------
const messages = ref<ChatMessage[]>([])
const input = ref('')
const sending = ref(false)
const approving = ref(false)
const listEl = ref<HTMLElement | null>(null)

// ---------- 侧边栏：宽度可拖拽调节 + 收起/展开 ----------
const SIDEBAR_WIDTH_KEY = 'prf_sidebar_width'
const SIDEBAR_COLLAPSED_KEY = 'prf_sidebar_collapsed'

function loadSidebarWidth(): number {
  try {
    const saved = Number(localStorage.getItem(SIDEBAR_WIDTH_KEY))
    if (Number.isFinite(saved) && saved >= 240 && saved <= 560) return saved
  } catch {
    /* ignore */
  }
  return 336 // 默认 240px 加宽 40%
}

function loadSidebarCollapsed(): boolean {
  try {
    return localStorage.getItem(SIDEBAR_COLLAPSED_KEY) === '1'
  } catch {
    return false
  }
}

const sidebarWidth = ref(loadSidebarWidth())
const sidebarCollapsed = ref(loadSidebarCollapsed())
const resizing = ref(false)

let resizeStartX = 0
let resizeStartWidth = 0

function startResize(e: MouseEvent) {
  e.preventDefault()
  resizeStartX = e.clientX
  resizeStartWidth = sidebarWidth.value
  resizing.value = true
  document.body.style.cursor = 'col-resize'
  document.body.style.userSelect = 'none'
  document.addEventListener('mousemove', onResize)
  document.addEventListener('mouseup', stopResize)
}

function onResize(e: MouseEvent) {
  const w = resizeStartWidth + (e.clientX - resizeStartX)
  sidebarWidth.value = Math.min(Math.max(w, 240), 560)
}

function stopResize() {
  resizing.value = false
  document.body.style.cursor = ''
  document.body.style.userSelect = ''
  document.removeEventListener('mousemove', onResize)
  document.removeEventListener('mouseup', stopResize)
  try {
    localStorage.setItem(SIDEBAR_WIDTH_KEY, String(Math.round(sidebarWidth.value)))
  } catch {
    /* ignore */
  }
}

watch(sidebarCollapsed, (v) => {
  try {
    localStorage.setItem(SIDEBAR_COLLAPSED_KEY, v ? '1' : '0')
  } catch {
    /* ignore */
  }
})

onBeforeUnmount(() => {
  stopResize()
})

function loadSessions(): Session[] {
  try {
    const raw = localStorage.getItem(SESSIONS_KEY)
    return raw ? (JSON.parse(raw) as Session[]) : []
  } catch {
    return []
  }
}
function persistSessions() {
  localStorage.setItem(SESSIONS_KEY, JSON.stringify(sessions.value))
}

function msgKey(id: string) {
  return `prf_msgs_${id}`
}
function loadMessages(id: string): ChatMessage[] {
  try {
    const raw = localStorage.getItem(msgKey(id))
    return raw ? (JSON.parse(raw) as ChatMessage[]) : []
  } catch {
    return []
  }
}
function persistMessages() {
  if (currentSessionId.value) {
    localStorage.setItem(msgKey(currentSessionId.value), JSON.stringify(messages.value))
  }
}

function newSession() {
  if (currentSessionId.value) persistMessages()
  currentSessionId.value = null
  messages.value = []
  input.value = ''
}

function switchSession(id: string) {
  if (currentSessionId.value === id) return
  if (currentSessionId.value) persistMessages()
  currentSessionId.value = id
  messages.value = loadMessages(id)
  scrollToBottom()
}

async function deleteSession(s: Session) {
  try {
    await ElMessageBox.confirm(`删除会话「${s.title}」？本地的对话记录将一并清除。`, '删除会话', {
      type: 'warning',
      confirmButtonText: '删除',
      cancelButtonText: '取消',
    })
  } catch {
    return
  }
  sessions.value = sessions.value.filter((x) => x.id !== s.id)
  localStorage.removeItem(msgKey(s.id))
  persistSessions()
  if (currentSessionId.value === s.id) newSession()
}

// ---------- 会话操作：置顶 / 重命名 / 更多菜单 ----------
/** 分组展示：置顶标题 + 置顶会话 + 分隔线 + 普通会话 */
const sessionGroups = computed<Array<{ type: 'pinned-title' | 'divider' | 'session'; s?: Session }>>(() => {
  const groups: Array<{ type: 'pinned-title' | 'divider' | 'session'; s?: Session }> = []
  const pinned = sessions.value
    .filter((s) => s.pinned)
    .sort((a, b) => (b.pinnedAt ?? 0) - (a.pinnedAt ?? 0))
  const normal = sessions.value.filter((s) => !s.pinned)
  if (pinned.length > 0) {
    groups.push({ type: 'pinned-title' })
    for (const s of pinned) groups.push({ type: 'session', s })
    groups.push({ type: 'divider' })
  }
  for (const s of normal) groups.push({ type: 'session', s })
  return groups
})

function togglePin(s: Session) {
  if (s.pinned) {
    s.pinned = false
    s.pinnedAt = undefined
  } else {
    s.pinned = true
    s.pinnedAt = Date.now()
  }
  persistSessions()
}

async function renameSession(s: Session) {
  try {
    const { value } = await ElMessageBox.prompt('请输入新的会话名称', '重命名会话', {
      inputValue: s.title,
      inputPattern: /\S+/,
      inputErrorMessage: '名称不能为空',
      confirmButtonText: '确定',
      cancelButtonText: '取消',
    })
    const title = (value ?? '').trim().slice(0, 24)
    if (title) s.title = title
    persistSessions()
  } catch {
    // 用户取消
  }
}

function handleMenu(command: string | number | object, s: Session) {
  if (command === 'pin') togglePin(s)
  else if (command === 'rename') renameSession(s)
  else if (command === 'delete') deleteSession(s)
}

// ---------- 发送 / 响应 ----------
const canSend = computed(() => {
  const text = input.value.trim()
  return text.length > 0 && !sending.value && !approving.value
})

function pushMessage(m: ChatMessage) {
  messages.value.push(m)
  scrollToBottom()
}

/** 从最新往前找第一条未处理的审批卡 */
function findUnresolvedApproval(): ChatMessage | undefined {
  for (let i = messages.value.length - 1; i >= 0; i--) {
    const m = messages.value[i]
    if (m.approval && !m.approvalResolved) return m
  }
  return undefined
}

function scrollToBottom() {
  nextTick(() => {
    if (listEl.value) {
      listEl.value.scrollTop = listEl.value.scrollHeight
    }
  })
}

function registerSession(threadId: string) {
  const title = (messages.value[0]?.content || '新会话').slice(0, 24)
  sessions.value.unshift({ id: threadId, title, updatedAt: Date.now() })
  persistSessions()
}

function handleChatResponse(res: ChatResponse, pendingMsg: ChatMessage) {
  pendingMsg.pending = false
  pendingMsg.error = false
  pendingMsg.errorText = undefined

  if (res.status === 'ok') {
    pendingMsg.content = res.reply ?? ''
  } else if (res.status === 'awaiting_approval') {
    pendingMsg.approval = res.approval_payload ?? null
    pendingMsg.content = ''
  }
}

/** 向 Agent 请求一次回复并更新 pendingMsg（sendMessage 与 regenerate 共用） */
async function requestReply(text: string, pendingMsg: ChatMessage) {
  sending.value = true
  try {
    const res = await sendChat(text, currentSessionId.value)
    // 新会话：拿到 thread_id 后注册会话条目，并把草稿消息落到该会话下
    if (currentSessionId.value === null && res.thread_id) {
      currentSessionId.value = res.thread_id
      registerSession(res.thread_id)
    }
    handleChatResponse(res, pendingMsg)
    persistMessages()
  } catch (e) {
    const err = e as ApiError
    pendingMsg.pending = false
    if (err.status === 409) {
      // 该会话正挂起等待审批，拒绝新命令
      pendingMsg.error = true
      pendingMsg.errorText = '该会话正在等待审批，请先在下方完成审批，或开启新会话'
      ElMessage.warning(pendingMsg.errorText)
      // 若历史里已有未处理的审批卡，滚动过去提醒用户
      const unresolved = findUnresolvedApproval()
      if (unresolved) {
        ElMessage.warning(`存在待审批操作：${unresolved.approval?.tool ?? '未知工具'}`)
      }
    } else {
      pendingMsg.error = true
      pendingMsg.errorText = err.message
    }
    persistMessages()
  } finally {
    sending.value = false
    scrollToBottom()
  }
}

async function sendMessage() {
  const text = input.value.trim()
  if (!canSend.value) return
  input.value = ''

  pushMessage({ role: 'user', content: text })
  const pendingMsg: ChatMessage = { role: 'assistant', content: '', pending: true }
  pushMessage(pendingMsg)

  await requestReply(text, pendingMsg)
}

// ---------- 消息操作：复制 / 重新生成 ----------
function copyMessage(m: ChatMessage) {
  if (!m.content) return
  navigator.clipboard
    ?.writeText(m.content)
    .then(() => ElMessage.success('已复制'))
    .catch(() => ElMessage.warning('复制失败，请手动选择复制'))
}

async function regenerate(m: ChatMessage) {
  if (m.pending || sending.value || approving.value) return
  const idx = messages.value.indexOf(m)
  if (idx < 0) return
  // 找到该回复之前最近的一条用户消息，作为重新生成的问题
  let userText = ''
  for (let i = idx - 1; i >= 0; i--) {
    if (messages.value[i].role === 'user' && messages.value[i].content) {
      userText = messages.value[i].content
      break
    }
  }
  if (!userText) {
    ElMessage.warning('没有可重新生成的上下文')
    return
  }
  // 移除当前回复，原地插入待生成消息
  messages.value.splice(idx, 1)
  const pendingMsg: ChatMessage = { role: 'assistant', content: '', pending: true }
  messages.value.splice(idx, 0, pendingMsg)
  scrollToBottom()
  await requestReply(userText, pendingMsg)
}

// ---------- HITL 审批 ----------
async function handleApprove(approved: boolean, msg: ChatMessage) {
  if (!currentSessionId.value) {
    ElMessage.warning('会话尚未建立，无法审批')
    return
  }
  approving.value = true
  try {
    const res = await approveOperation(currentSessionId.value, approved)
    msg.approvalResolved = true
    const actionText = approved ? '允许' : '拒绝'
    pushMessage({ role: 'assistant', content: `—— 已${actionText}该操作 ——` })
    if (res.status === 'done') {
      pushMessage({ role: 'assistant', content: res.reply ?? '' })
    } else if (res.status === 'awaiting_approval') {
      // 链式审批：还有下一个危险操作
      pushMessage({ role: 'assistant', content: '', approval: res.approval_payload ?? null })
    }
    persistMessages()
  } catch (e) {
    const err = e as ApiError
    ElMessage.error(`审批失败：${err.message}`)
  } finally {
    approving.value = false
    scrollToBottom()
  }
}

// ---------- 示例问题 ----------
// 首页不再展示推荐问题，功能保留：
// sampleQuestions / askSample 通过 defineExpose 暴露，后续需要时可重新接入 UI
const sampleQuestions = [
  '当前数据库中有哪些已向量化的文档？',
  '帮我检索关于 "retrieval augmented generation" 的论文片段',
  '总结一下论文库中与注意力机制相关的内容',
]

function askSample(q: string) {
  input.value = q
  sendMessage()
}

defineExpose({ sampleQuestions, askSample })

watch(messages, () => scrollToBottom(), { deep: false })

onMounted(() => {
  sessions.value = loadSessions()
})
</script>

<template>
  <div class="chat-view">
    <!-- 左侧会话栏 -->
    <aside
      class="session-panel"
      :class="{ collapsed: sidebarCollapsed, resizing }"
      :style="{ width: sidebarCollapsed ? '0px' : sidebarWidth + 'px' }"
    >
      <div class="session-head">
        <div class="session-actions">
          <el-button type="primary" class="new-btn" @click="newSession">
            <el-icon><Plus /></el-icon>
            <span>新建会话</span>
          </el-button>
          <el-tooltip content="收起侧边栏" placement="bottom">
            <el-button class="collapse-btn" @click="sidebarCollapsed = true">
              <el-icon><Fold /></el-icon>
            </el-button>
          </el-tooltip>
        </div>
      </div>
      <div class="session-list">
        <template v-for="g in sessionGroups" :key="g.type === 'session' ? g.s!.id : g.type">
          <!-- 置顶分组标题 -->
          <div v-if="g.type === 'pinned-title'" class="session-group-title">
            <el-icon class="group-ico">
              <svg viewBox="0 0 24 24" aria-hidden="true">
                <path
                  fill="currentColor"
                  d="M16 9V4h1c.55 0 1-.45 1-1s-.45-1-1-1H7c-.55 0-1 .45-1 1s.45 1 1 1h1v5c0 1.66-1.34 3-3 3v2h5.97v7l1 1 1-1v-7H19v-2c-1.66 0-3-1.34-3-3z"
                />
              </svg>
            </el-icon>
            <span>置顶</span>
          </div>
          <!-- 置顶与普通会话之间的分隔线 -->
          <div v-else-if="g.type === 'divider'" class="session-divider"></div>
          <!-- 会话项 -->
          <div
            v-else
            class="session-item"
            :class="{ active: g.s!.id === currentSessionId }"
            @click="switchSession(g.s!.id)"
          >
            <el-icon class="session-ico"><ChatDotRound /></el-icon>
            <span class="session-title">{{ g.s!.title }}</span>
            <el-dropdown
              trigger="click"
              popper-class="session-more-popper"
              @command="(cmd: string | number | object) => handleMenu(cmd, g.s!)"
              @click.stop
            >
              <span class="session-more" title="更多操作">
                <el-icon><MoreFilled /></el-icon>
              </span>
              <template #dropdown>
                <el-dropdown-menu>
                  <el-dropdown-item command="pin">
                    {{ g.s!.pinned ? '取消置顶' : '置顶' }}
                  </el-dropdown-item>
                  <el-dropdown-item command="rename">重命名</el-dropdown-item>
                  <el-dropdown-item command="delete" class="danger-item">删除</el-dropdown-item>
                </el-dropdown-menu>
              </template>
            </el-dropdown>
          </div>
        </template>
        <div v-if="sessions.length === 0" class="session-empty">
          暂无历史会话<br />开始你的第一次提问吧
        </div>
      </div>

      <!-- 拖拽调宽手柄 -->
      <div v-if="!sidebarCollapsed" class="resize-handle" title="拖动调整宽度" @mousedown="startResize"></div>
    </aside>

    <!-- 中央单栏对话区 -->
    <section class="chat-main">
      <!-- 侧边栏收起时的展开按钮 -->
      <button v-if="sidebarCollapsed" class="sidebar-expand" type="button" title="展开侧边栏" @click="sidebarCollapsed = false">
        <el-icon><Expand /></el-icon>
      </button>
      <!-- 空会话：居中欢迎 + 中央输入框 -->
      <div v-if="messages.length === 0" class="chat-empty">
        <div class="chat-column chat-empty-column">
          <div class="chat-hero">
            <div class="hero-icon">
              <el-icon :size="30"><Reading /></el-icon>
            </div>
            <h2>论文 RAG 助手</h2>
            <p>基于你的私有论文库提问，Agent 会检索相关片段并综合回答</p>
          </div>

          <!-- 中央输入框 -->
          <div class="hero-input">
            <el-input
              v-model="input"
              type="textarea"
              :autosize="{ minRows: 2, maxRows: 6 }"
              placeholder="向你的论文库提问…（Enter 发送，Shift + Enter 换行）"
              resize="none"
              class="hero-textarea"
              @keydown.enter.exact.prevent="sendMessage"
            />
            <el-button
              type="primary"
              circle
              class="hero-send"
              :class="{ 'is-sending': sending }"
              :disabled="!canSend"
              @click="sendMessage"
            >
              <el-icon v-if="sending" class="is-loading" :size="22"><Loading /></el-icon>
              <el-icon v-else :size="16"><Promotion /></el-icon>
            </el-button>
          </div>
        </div>
      </div>

      <!-- 有消息：消息流 + 底部输入栏 -->
      <template v-else>
        <div ref="listEl" class="chat-scroll">
          <div class="chat-column">
            <div v-for="(m, i) in messages" :key="i" class="msg-block" :class="m.role">
              <!-- 用户消息：右对齐浅色圆角块 -->
              <div v-if="m.role === 'user'" class="user-msg">{{ m.content }}</div>

              <!-- AI 回复：正文式排版 -->
              <template v-else>
                <div class="assistant-head">
                  <span class="assistant-icon"><el-icon :size="13"><Reading /></el-icon></span>
                  <span class="assistant-label">论文 RAG 助手</span>
                </div>

                <div v-if="m.pending" class="msg-pending">
                  <el-icon class="is-loading"><Loading /></el-icon>
                  <span>思考中…</span>
                </div>

                <template v-else>
                  <div
                    v-if="m.content"
                    class="assistant-body msg-text markdown-body"
                    v-html="renderMarkdown(m.content)"
                  ></div>
                  <div v-if="m.error && m.errorText" class="msg-error">{{ m.errorText }}</div>

                  <!-- HITL 审批卡 -->
                  <div v-if="m.approval" class="approval-card" :class="{ resolved: m.approvalResolved }">
                    <div class="approval-title">
                      <el-icon><WarningFilled /></el-icon>
                      <span>{{ m.approvalResolved ? '审批已完成' : '需要审批的危险操作' }}</span>
                    </div>
                    <div class="approval-tool">
                      工具：<code>{{ m.approval.tool }}</code>
                    </div>
                    <pre v-if="m.approval.args" class="approval-args">{{ JSON.stringify(m.approval.args, null, 2) }}</pre>
                    <div v-if="!m.approvalResolved" class="approval-actions">
                      <el-button type="danger" size="small" :loading="approving" @click="handleApprove(false, m)">
                        拒绝
                      </el-button>
                      <el-button type="success" size="small" :loading="approving" @click="handleApprove(true, m)">
                        允许
                      </el-button>
                    </div>
                    <el-tag v-else size="small" type="info">已审批</el-tag>
                  </div>

                  <!-- 操作按钮：复制 / 重新生成 -->
                  <div v-if="m.content" class="msg-actions">
                    <el-tooltip content="复制" placement="top">
                      <button class="action-btn" type="button" @click="copyMessage(m)">
                        <el-icon><CopyDocument /></el-icon>
                      </button>
                    </el-tooltip>
                    <el-tooltip content="重新生成" placement="top">
                      <button class="action-btn" type="button" @click="regenerate(m)">
                        <el-icon><RefreshLeft /></el-icon>
                      </button>
                    </el-tooltip>
                  </div>
                </template>
              </template>
            </div>
          </div>
        </div>

        <!-- 底部输入栏：固定于页面底部，居中同一栏宽 -->
        <div class="input-dock">
          <div class="input-column">
            <div class="chat-input">
              <el-input
                v-model="input"
                type="textarea"
                :autosize="{ minRows: 2, maxRows: 8 }"
                placeholder="向你的论文库提问…（Enter 发送，Shift + Enter 换行）"
                resize="none"
                class="chat-textarea"
                @keydown.enter.exact.prevent="sendMessage"
              />
              <el-button
                type="primary"
                circle
                class="chat-send"
                :class="{ 'is-sending': sending }"
                :disabled="!canSend"
                @click="sendMessage"
              >
                <el-icon v-if="sending" class="is-loading" :size="22"><Loading /></el-icon>
                <el-icon v-else :size="16"><Promotion /></el-icon>
              </el-button>
            </div>
            <p class="input-hint">内容由 AI 生成，仅供论文检索与研究参考</p>
          </div>
        </div>
      </template>
    </section>
  </div>
</template>

<style scoped>
.chat-view {
  display: flex;
  height: 100%;
  min-height: 0;
}

/* ---------- 会话栏 ---------- */
.session-panel {
  width: 336px;
  flex-shrink: 0;
  display: flex;
  flex-direction: column;
  background: var(--prf-surface);
  border-right: 1px solid var(--prf-border);
  position: relative;
  overflow: hidden;
  transition: width 0.25s ease;
}
.session-panel.resizing {
  transition: none;
}
.session-panel.collapsed {
  border-right: none;
}
.session-head {
  padding: 12px;
  border-bottom: 1px solid var(--prf-border);
}
.session-actions {
  display: flex;
  align-items: center;
  gap: 8px;
}
.new-btn {
  flex: 1;
}
.collapse-btn {
  flex-shrink: 0;
  width: 32px;
  padding: 0;
}
/* 拖拽调宽手柄 */
.resize-handle {
  position: absolute;
  top: 0;
  right: -3px;
  bottom: 0;
  width: 6px;
  cursor: col-resize;
  z-index: 5;
}
.resize-handle::after {
  content: '';
  position: absolute;
  top: 0;
  bottom: 0;
  right: 2px;
  width: 2px;
  background: transparent;
  transition: background 0.2s;
}
.resize-handle:hover::after {
  background: var(--prf-primary);
}
.session-list {
  flex: 1;
  overflow-y: auto;
  padding: 8px;
}
.session-item {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 10px 12px;
  margin-bottom: 4px;
  border-radius: 10px;
  cursor: pointer;
  color: var(--prf-text-2);
}
.session-item:hover {
  background: var(--prf-hover);
}
.session-item.active {
  background: var(--prf-active);
  color: var(--prf-primary);
  font-weight: 500;
}
.session-ico {
  flex-shrink: 0;
  font-size: 16px;
}
.session-title {
  flex: 1;
  font-size: 13px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.session-more {
  flex-shrink: 0;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 24px;
  height: 24px;
  border-radius: 6px;
  font-size: 15px;
  color: var(--prf-text-4);
  visibility: hidden;
}
.session-item:hover .session-more {
  visibility: visible;
}
.session-more:hover {
  color: var(--prf-primary);
  background: var(--prf-hover);
}
.session-group-title {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 10px 12px 6px;
  font-size: 12px;
  font-weight: 500;
  color: var(--prf-text-3);
}
.group-ico {
  font-size: 13px;
  color: var(--prf-primary);
}
.session-divider {
  margin: 6px 12px 8px;
  border-top: 1px solid var(--prf-border);
}
.session-empty {
  padding: 32px 12px;
  text-align: center;
  font-size: 13px;
  color: var(--prf-text-4);
  line-height: 1.8;
}

/* ---------- 中央单栏 ---------- */
.chat-main {
  flex: 1;
  display: flex;
  flex-direction: column;
  min-width: 0;
  position: relative;
}
/* 侧边栏收起时的展开按钮：与收起按钮同高度对齐（会话栏头部行） */
.sidebar-expand {
  position: absolute;
  top: 13px;
  left: 10px;
  z-index: 10;
  width: 30px;
  height: 30px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border-radius: 8px;
  border: 1px solid var(--prf-border);
  background: var(--prf-surface);
  color: var(--prf-text-2);
  cursor: pointer;
  font-size: 15px;
  box-shadow: var(--prf-shadow-sm);
  transition:
    color 0.2s,
    border-color 0.2s,
    background-color 0.2s;
}
.sidebar-expand:hover {
  color: var(--prf-primary);
  border-color: var(--prf-primary);
  background: var(--prf-active);
}
.chat-scroll {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  padding: 32px 24px 24px;
}
.chat-column {
  width: 100%;
  max-width: 760px;
  margin: 0 auto;
}
/* 空会话：整块垂直水平居中 */
.chat-empty {
  flex: 1;
  min-height: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 24px;
}
.chat-empty-column {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 28px;
  /* 空会话整体略微上移，视觉更居中 */
  transform: translateY(-40px);
}

/* ---------- 空会话欢迎 ---------- */
.chat-hero {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 10px;
  color: var(--prf-text-2);
}
.chat-hero .hero-icon {
  width: 64px;
  height: 64px;
  border-radius: 18px;
  background: var(--prf-primary-soft);
  color: var(--prf-primary);
  display: flex;
  align-items: center;
  justify-content: center;
  box-shadow: var(--prf-shadow);
}
.chat-hero h2 {
  margin: 8px 0 0;
  font-size: 24px;
  background: var(--prf-primary-gradient);
  -webkit-background-clip: text;
  background-clip: text;
  -webkit-text-fill-color: transparent;
}
.chat-hero p {
  margin: 0;
  font-size: 14px;
  color: var(--prf-text-3);
}

/* 中央输入框卡片 */
.hero-input {
  position: relative;
  width: 100%;
  max-width: 640px;
  background: var(--prf-surface);
  border: 1px solid var(--prf-border-strong);
  border-radius: 16px;
  padding: 12px 14px;
  box-shadow: var(--prf-shadow);
  transition:
    border-color 0.25s ease,
    box-shadow 0.25s ease,
    background-color 0.25s ease;
}
.hero-input:focus-within {
  border-color: var(--prf-primary);
  box-shadow: 0 0 0 3px var(--prf-primary-soft), var(--prf-shadow);
}
.hero-input :deep(.el-textarea__inner) {
  background: transparent;
  border: none;
  box-shadow: none !important;
  padding: 4px 52px 4px 2px;
  font-size: 15px;
  line-height: 1.6;
}
.hero-input :deep(.el-textarea__inner:focus) {
  box-shadow: none !important;
}
.hero-send {
  position: absolute;
  right: 12px;
  bottom: 12px;
  width: 40px;
  height: 40px;
  padding: 0;
}
/* 发送中：按钮保持主色，仅显示旋转动画（填满按钮，无小飞机） */
.hero-send.is-sending,
.chat-send.is-sending {
  background: var(--prf-primary);
  border-color: var(--prf-primary);
  color: #fff;
  opacity: 1;
  cursor: default;
}

/* ---------- 消息流：上下流式块 ---------- */
.msg-block {
  margin-bottom: 28px;
}

/* 用户消息：右对齐浅色圆角块，宽度随内容自适应 */
.user-msg {
  width: fit-content;
  max-width: 78%;
  margin-left: auto;
  padding: 10px 14px;
  background: var(--prf-surface-2);
  border: 1px solid var(--prf-border);
  border-radius: 12px;
  color: var(--prf-text-1);
  font-size: 15px;
  line-height: 1.7;
  white-space: pre-wrap;
  word-break: break-word;
}

/* AI 回复：无背景正文排版 */
.assistant-head {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 10px;
}
.assistant-icon {
  width: 22px;
  height: 22px;
  border-radius: 7px;
  background: var(--prf-primary-gradient);
  color: #fff;
  display: inline-flex;
  align-items: center;
  justify-content: center;
}
.assistant-label {
  font-size: 13px;
  font-weight: 600;
  color: var(--prf-text-2);
}
.assistant-body {
  font-size: 15px;
  line-height: 1.85;
  color: var(--prf-text-1);
}
.assistant-body.markdown-body {
  white-space: normal;
}
.msg-error {
  color: var(--prf-danger);
  white-space: pre-wrap;
}
.msg-pending {
  display: flex;
  align-items: center;
  gap: 8px;
  color: var(--prf-text-3);
  padding: 8px 0;
}

/* 操作按钮：悬停显示 */
.msg-actions {
  display: flex;
  gap: 6px;
  margin-top: 10px;
  opacity: 0;
  transition: opacity 0.2s;
}
.msg-block.assistant:hover .msg-actions {
  opacity: 1;
}
.action-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  border-radius: 8px;
  border: 1px solid var(--prf-border);
  background: var(--prf-surface);
  color: var(--prf-text-3);
  cursor: pointer;
  font-size: 14px;
  transition:
    color 0.2s,
    border-color 0.2s,
    background-color 0.2s;
}
.action-btn:hover {
  color: var(--prf-primary);
  border-color: var(--prf-primary);
  background: var(--prf-active);
}

/* ---------- Markdown 渲染（正文排版） ---------- */
.msg-text.markdown-body {
  white-space: normal;
}
.msg-text.markdown-body :deep(p) {
  margin: 0 0 10px;
}
.msg-text.markdown-body :deep(p:last-child) {
  margin-bottom: 0;
}
.msg-text.markdown-body :deep(h1),
.msg-text.markdown-body :deep(h2),
.msg-text.markdown-body :deep(h3),
.msg-text.markdown-body :deep(h4),
.msg-text.markdown-body :deep(h5),
.msg-text.markdown-body :deep(h6) {
  margin: 18px 0 10px;
  font-size: 17px;
  line-height: 1.5;
  font-weight: 600;
}
.msg-text.markdown-body :deep(h1) {
  font-size: 21px;
}
.msg-text.markdown-body :deep(h2) {
  font-size: 20px;
}
.msg-text.markdown-body :deep(h3) {
  font-size: 18px;
}
.msg-text.markdown-body :deep(h4) {
  font-size: 16px;
}
.msg-text.markdown-body :deep(ul),
.msg-text.markdown-body :deep(ol) {
  margin: 0 0 10px;
  padding-left: 24px;
}
.msg-text.markdown-body :deep(li) {
  margin: 3px 0;
}
.msg-text.markdown-body :deep(a) {
  color: var(--prf-primary);
  text-decoration: none;
}
.msg-text.markdown-body :deep(a:hover) {
  text-decoration: underline;
}
.msg-text.markdown-body :deep(blockquote) {
  margin: 10px 0;
  padding: 6px 14px;
  border-left: 3px solid var(--prf-primary);
  background: var(--prf-surface-2);
  color: var(--prf-text-2);
}
.msg-text.markdown-body :deep(blockquote p) {
  margin: 4px 0;
}
.msg-text.markdown-body :deep(code) {
  background: var(--prf-hover);
  padding: 1px 6px;
  border-radius: 4px;
  font-family: Consolas, Monaco, 'Courier New', monospace;
  font-size: 13px;
  color: var(--prf-code-text);
}
.msg-text.markdown-body :deep(pre) {
  margin: 10px 0;
  padding: 12px 14px;
  background: var(--prf-code-bg);
  border: 1px solid var(--prf-border);
  border-radius: 10px;
  overflow-x: auto;
  font-size: 13px;
  line-height: 1.6;
}
.msg-text.markdown-body :deep(pre code) {
  background: transparent;
  padding: 0;
  color: var(--prf-text-1);
}
.msg-text.markdown-body :deep(pre code.hljs) {
  background: transparent;
  padding: 0;
}
.msg-text.markdown-body :deep(table) {
  border-collapse: collapse;
  margin: 10px 0;
  width: 100%;
  display: block;
  overflow-x: auto;
}
.msg-text.markdown-body :deep(th),
.msg-text.markdown-body :deep(td) {
  border: 1px solid var(--prf-border);
  padding: 8px 12px;
  text-align: left;
  white-space: nowrap;
}
.msg-text.markdown-body :deep(th) {
  background: var(--prf-surface-2);
  font-weight: 600;
}
.msg-text.markdown-body :deep(hr) {
  border: none;
  border-top: 1px solid var(--prf-border);
  margin: 16px 0;
}
.msg-text.markdown-body :deep(img) {
  max-width: 100%;
  border-radius: 6px;
}

/* ---------- 审批卡 ---------- */
.approval-card {
  margin-top: 12px;
  padding: 12px;
  border: 1px solid var(--prf-warning-border);
  border-radius: 10px;
  background: var(--prf-warning-bg);
  color: var(--prf-text-2);
}
.approval-card.resolved {
  border-color: var(--prf-border);
  background: var(--prf-surface-2);
  color: var(--prf-text-3);
}
.approval-title {
  display: flex;
  align-items: center;
  gap: 6px;
  font-weight: 600;
  margin-bottom: 8px;
}
.approval-tool {
  font-size: 13px;
  margin-bottom: 6px;
}
.approval-tool code {
  background: var(--prf-hover);
  padding: 1px 6px;
  border-radius: 4px;
  font-size: 12px;
}
.approval-args {
  margin: 0 0 10px;
  padding: 8px 10px;
  background: var(--prf-surface);
  border-radius: 6px;
  font-size: 12px;
  max-height: 160px;
  overflow: auto;
  color: var(--prf-text-2);
}
.approval-actions {
  display: flex;
  gap: 8px;
  justify-content: flex-end;
}

/* ---------- 底部输入栏 ---------- */
.input-dock {
  flex-shrink: 0;
  padding: 12px 24px 14px;
  background: var(--prf-bg);
}
.input-column {
  width: 100%;
  max-width: 760px;
  margin: 0 auto;
}
.chat-input {
  position: relative;
  background: var(--prf-surface);
  border: 1px solid var(--prf-border-strong);
  border-radius: 16px;
  padding: 12px 14px;
  box-shadow: var(--prf-shadow);
  transition:
    border-color 0.25s ease,
    box-shadow 0.25s ease,
    background-color 0.25s ease;
}
.chat-input:focus-within {
  border-color: var(--prf-primary);
  box-shadow: 0 0 0 3px var(--prf-primary-soft), var(--prf-shadow);
}
.chat-input :deep(.el-textarea__inner) {
  background: transparent;
  border: none;
  box-shadow: none !important;
  padding: 4px 52px 4px 2px;
  font-size: 15px;
  line-height: 1.6;
}
.chat-input :deep(.el-textarea__inner:focus) {
  box-shadow: none !important;
}
.chat-send {
  position: absolute;
  right: 12px;
  bottom: 12px;
  width: 40px;
  height: 40px;
  padding: 0;
}
.input-hint {
  margin: 8px 0 0;
  text-align: center;
  font-size: 12px;
  color: var(--prf-text-4);
}
</style>

<style>
/* 会话更多操作下拉菜单（teleport 到 body，需非 scoped 样式）：删除项红字 */
.session-more-popper .danger-item {
  color: var(--prf-danger) !important;
}
.session-more-popper .danger-item:hover {
  background: var(--prf-danger-bg) !important;
  color: var(--prf-danger) !important;
}
</style>
