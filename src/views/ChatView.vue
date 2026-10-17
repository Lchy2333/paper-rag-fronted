<script setup lang="ts">
import { computed, nextTick, onMounted, ref, watch } from 'vue'
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

async function sendMessage() {
  const text = input.value.trim()
  if (!canSend.value) return
  input.value = ''

  pushMessage({ role: 'user', content: text })
  const pendingMsg: ChatMessage = { role: 'assistant', content: '', pending: true }
  pushMessage(pendingMsg)

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
const sampleQuestions = [
  '当前数据库中有哪些已向量化的文档？',
  '帮我检索关于 "retrieval augmented generation" 的论文片段',
  '总结一下论文库中与注意力机制相关的内容',
]

function askSample(q: string) {
  input.value = q
  sendMessage()
}

watch(messages, () => scrollToBottom(), { deep: false })

onMounted(() => {
  sessions.value = loadSessions()
})
</script>

<template>
  <div class="chat-view">
    <!-- 左侧会话栏 -->
    <aside class="session-panel">
      <div class="session-head">
        <el-button type="primary" class="new-btn" @click="newSession">
          <el-icon><Plus /></el-icon>
          <span>新建会话</span>
        </el-button>
      </div>
      <div class="session-list">
        <div
          v-for="s in sessions"
          :key="s.id"
          class="session-item"
          :class="{ active: s.id === currentSessionId }"
          @click="switchSession(s.id)"
        >
          <el-icon class="session-ico"><ChatDotRound /></el-icon>
          <span class="session-title">{{ s.title }}</span>
          <el-icon class="session-del" title="删除会话" @click.stop="deleteSession(s)"><Delete /></el-icon>
        </div>
        <div v-if="sessions.length === 0" class="session-empty">
          暂无历史会话<br />开始你的第一次提问吧
        </div>
      </div>
    </aside>

    <!-- 主对话区 -->
    <section class="chat-main">
      <div ref="listEl" class="message-list">
        <!-- 空状态引导 -->
        <div v-if="messages.length === 0" class="chat-hero">
          <el-icon :size="40" color="#4f6ef7"><Reading /></el-icon>
          <h2>论文 RAG 助手</h2>
          <p>基于你的私有论文库提问，Agent 会检索相关片段并综合回答</p>
          <div class="sample-list">
            <el-tag
              v-for="q in sampleQuestions"
              :key="q"
              class="sample-tag"
              effect="plain"
              round
              @click="askSample(q)"
            >
              {{ q }}
            </el-tag>
          </div>
        </div>

        <!-- 消息流 -->
        <template v-else>
          <div v-for="(m, i) in messages" :key="i" class="msg-row" :class="m.role">
            <div v-if="m.role === 'assistant'" class="msg-avatar">
              <el-icon><Reading /></el-icon>
            </div>
            <div class="msg-bubble" :class="{ 'is-error': m.error }">
              <!-- 思考中 -->
              <div v-if="m.pending" class="msg-pending">
                <el-icon class="is-loading"><Loading /></el-icon>
                <span>思考中…</span>
              </div>
              <template v-else>
                <!-- Agent 回复按 Markdown 渲染；用户消息保持纯文本 -->
                <div
                  v-if="m.content && m.role === 'assistant'"
                  class="msg-text markdown-body"
                  v-html="renderMarkdown(m.content)"
                ></div>
                <div v-else-if="m.content" class="msg-text">{{ m.content }}</div>
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
              </template>
            </div>
          </div>
        </template>
      </div>

      <!-- 输入区 -->
      <div class="input-bar">
        <el-input
          v-model="input"
          type="textarea"
          :autosize="{ minRows: 2, maxRows: 6 }"
          placeholder="向你的论文库提问…（Enter 发送，Shift + Enter 换行）"
          resize="none"
          @keydown.enter.exact.prevent="sendMessage"
        />
        <el-button
          type="primary"
          class="send-btn"
          :disabled="!canSend"
          :loading="sending"
          @click="sendMessage"
        >
          <el-icon><Promotion /></el-icon>
          <span>发送</span>
        </el-button>
      </div>
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
  width: 260px;
  flex-shrink: 0;
  display: flex;
  flex-direction: column;
  background: #fff;
  border-right: 1px solid var(--prf-border);
}
.session-head {
  padding: 12px;
  border-bottom: 1px solid var(--prf-border);
}
.new-btn {
  width: 100%;
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
  border-radius: 8px;
  cursor: pointer;
  color: #4e5969;
  transition: background 0.15s;
}
.session-item:hover {
  background: #f2f3f5;
}
.session-item.active {
  background: #eef1fd;
  color: var(--prf-primary);
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
.session-del {
  flex-shrink: 0;
  font-size: 14px;
  color: #c0c4cc;
  visibility: hidden;
}
.session-item:hover .session-del {
  visibility: visible;
}
.session-del:hover {
  color: #f56c6c;
}
.session-empty {
  padding: 32px 12px;
  text-align: center;
  font-size: 13px;
  color: #c0c4cc;
  line-height: 1.8;
}

/* ---------- 对话区 ---------- */
.chat-main {
  flex: 1;
  display: flex;
  flex-direction: column;
  min-width: 0;
}
.message-list {
  flex: 1;
  overflow-y: auto;
  padding: 20px 24px;
}
.chat-hero {
  height: 100%;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 8px;
  color: #4e5969;
}
.chat-hero h2 {
  margin: 8px 0 0;
  font-size: 22px;
  color: #1f2329;
}
.chat-hero p {
  margin: 0 0 16px;
  font-size: 14px;
  color: #86909c;
}
.sample-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
  max-width: 520px;
}
.sample-tag {
  cursor: pointer;
  height: 34px;
  font-size: 13px;
}
.sample-tag:hover {
  color: var(--prf-primary);
  border-color: var(--prf-primary);
}

.msg-row {
  display: flex;
  gap: 10px;
  margin-bottom: 16px;
}
.msg-row.user {
  flex-direction: row-reverse;
}
.msg-avatar {
  flex-shrink: 0;
  width: 32px;
  height: 32px;
  border-radius: 8px;
  background: #eef1fd;
  color: var(--prf-primary);
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 16px;
}
.msg-bubble {
  max-width: 72%;
  padding: 10px 14px;
  border-radius: 10px;
  font-size: 14px;
  line-height: 1.7;
  background: #fff;
  border: 1px solid var(--prf-border);
  word-break: break-word;
}
/* Agent 回复含代码块 / 表格，放宽宽度 */
.msg-row.assistant .msg-bubble {
  max-width: 86%;
}
.msg-row.user .msg-bubble {
  background: var(--prf-primary);
  border-color: var(--prf-primary);
  color: #fff;
}
.msg-bubble.is-error {
  border-color: #fde2e2;
  background: #fef0f0;
}
.msg-text {
  white-space: pre-wrap;
}
.msg-error {
  color: #f56c6c;
  white-space: pre-wrap;
}

/* ---------- Markdown 渲染 ---------- */
.msg-text.markdown-body {
  white-space: normal;
}
.msg-text.markdown-body :deep(p) {
  margin: 0 0 8px;
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
  margin: 14px 0 8px;
  font-size: 16px;
  line-height: 1.5;
  font-weight: 600;
}
.msg-text.markdown-body :deep(h1) {
  font-size: 19px;
}
.msg-text.markdown-body :deep(h2) {
  font-size: 18px;
}
.msg-text.markdown-body :deep(h3) {
  font-size: 17px;
}
.msg-text.markdown-body :deep(h4) {
  font-size: 15px;
}
.msg-text.markdown-body :deep(ul),
.msg-text.markdown-body :deep(ol) {
  margin: 0 0 8px;
  padding-left: 22px;
}
.msg-text.markdown-body :deep(li) {
  margin: 2px 0;
}
.msg-text.markdown-body :deep(a) {
  color: var(--prf-primary);
  text-decoration: none;
}
.msg-text.markdown-body :deep(a:hover) {
  text-decoration: underline;
}
.msg-text.markdown-body :deep(blockquote) {
  margin: 8px 0;
  padding: 4px 12px;
  border-left: 3px solid var(--prf-primary);
  background: #f7f8fa;
  color: #4e5969;
}
.msg-text.markdown-body :deep(blockquote p) {
  margin: 4px 0;
}
.msg-text.markdown-body :deep(code) {
  background: #f2f3f5;
  padding: 1px 6px;
  border-radius: 4px;
  font-family: Consolas, Monaco, 'Courier New', monospace;
  font-size: 13px;
  color: #d56167;
}
.msg-text.markdown-body :deep(pre) {
  margin: 8px 0;
  padding: 10px 12px;
  background: #f6f8fa;
  border: 1px solid var(--prf-border);
  border-radius: 8px;
  overflow-x: auto;
  font-size: 13px;
  line-height: 1.6;
}
.msg-text.markdown-body :deep(pre code) {
  background: transparent;
  padding: 0;
  color: #24292e;
}
.msg-text.markdown-body :deep(pre code.hljs) {
  background: transparent;
  padding: 0;
}
.msg-text.markdown-body :deep(table) {
  border-collapse: collapse;
  margin: 8px 0;
  width: 100%;
  display: block;
  overflow-x: auto;
}
.msg-text.markdown-body :deep(th),
.msg-text.markdown-body :deep(td) {
  border: 1px solid var(--prf-border);
  padding: 6px 10px;
  text-align: left;
  white-space: nowrap;
}
.msg-text.markdown-body :deep(th) {
  background: #f7f8fa;
  font-weight: 600;
}
.msg-text.markdown-body :deep(hr) {
  border: none;
  border-top: 1px solid var(--prf-border);
  margin: 12px 0;
}
.msg-text.markdown-body :deep(img) {
  max-width: 100%;
  border-radius: 6px;
}
.msg-pending {
  display: flex;
  align-items: center;
  gap: 8px;
  color: #86909c;
}

/* ---------- 审批卡 ---------- */
.approval-card {
  margin-top: 10px;
  padding: 12px;
  border: 1px solid #f3d19e;
  border-radius: 8px;
  background: #fdf6ec;
  color: #6b4b1f;
}
.approval-card.resolved {
  border-color: var(--prf-border);
  background: #f7f8fa;
  color: #86909c;
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
  background: #fff;
  padding: 1px 6px;
  border-radius: 4px;
  font-size: 12px;
}
.approval-args {
  margin: 0 0 10px;
  padding: 8px 10px;
  background: #fff;
  border-radius: 6px;
  font-size: 12px;
  max-height: 160px;
  overflow: auto;
  color: #4e5969;
}
.approval-actions {
  display: flex;
  gap: 8px;
  justify-content: flex-end;
}

/* ---------- 输入区 ---------- */
.input-bar {
  display: flex;
  gap: 10px;
  align-items: flex-end;
  padding: 14px 24px;
  border-top: 1px solid var(--prf-border);
  background: #fff;
}
.input-bar :deep(.el-textarea__inner) {
  font-size: 14px;
}
.send-btn {
  height: 44px;
  min-width: 96px;
}
</style>
