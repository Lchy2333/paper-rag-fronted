<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { approveOperation, cancelChat, deleteThread, listThreads, streamChat, updateThread } from '@/api/agent'
import { ApiError } from '@/api/client'
import type { ApprovalPayload, ThreadOut, UsageSnapshot } from '@/api/types'
import { renderMarkdown } from '@/utils/markdown'

/** 会话条目（新建但未发送时 currentSessionId 为 null，不入列表）。
 *  会话元数据（标题/置顶/活跃时间）以 Agent 服务端 /threads 为准，本地仅缓存消息内容。 */
interface Session {
  id: string
  title: string
  updatedAt: number
  /** 是否置顶 */
  pinned?: boolean
  /** 置顶时间戳，用于置顶组内排序 */
  pinnedAt?: number
}

/** 阶段进度行：done=false 表示正在进行（闪烁点），done=true 表示已完成（绿色对号） */
interface StageItem {
  label: string
  done: boolean
}

/** 单条聊天消息 */
interface ChatMessage {
  role: 'user' | 'assistant'
  content: string
  pending?: boolean
  error?: boolean
  errorText?: string
  /** 流式过程中的阶段进度行（如"正在检索论文库…""命中 5 条"） */
  stages?: StageItem[]
  /** 用户主动停止生成 */
  cancelled?: boolean
  /** HITL 待审批操作载荷（仅 assistant 消息可能有） */
  approval?: ApprovalPayload | null
  /** 该审批是否已处理过 */
  approvalResolved?: boolean
  /** 本次 query 的 token 用量快照（流式中逐轮更新，持久化随消息缓存） */
  usage?: UsageSnapshot
}

// ---------- 会话列表 ----------
const sessions = ref<Session[]>([])
const currentSessionId = ref<string | null>(null)

/** 把后端线程转换为前端会话条目（标题为空时用占位文案）。 */
function toSession(t: ThreadOut): Session {
  const updatedAt = new Date(t.updated_at).getTime() || Date.now()
  return {
    id: t.thread_id,
    title: t.title || '新会话',
    updatedAt,
    pinned: t.pinned,
    pinnedAt: t.pinned ? updatedAt : undefined,
  }
}

/** 从 Agent 拉取当前用户的会话列表（服务端为会话元数据唯一来源）。 */
async function syncSessions() {
  try {
    sessions.value = (await listThreads()).map(toSession)
  } catch {
    /* 列表拉取失败不阻塞；发消息/操作时会带出错误提示 */
  }
}

// ---------- 当前会话消息 ----------
const messages = ref<ChatMessage[]>([])
const input = ref('')
const sending = ref(false)
const approving = ref(false)
const listEl = ref<HTMLElement | null>(null)
/** 当前会话累计 token 消耗（SSE event: usage 实时更新，切换会话时重置） */
const sessionTotal = ref(0)

// 正在生成的请求句柄：用于"停止"（abort 断开 + 后端置取消标记）
const abortController = ref<AbortController | null>(null)
const stopFallbackTimer = ref<ReturnType<typeof setTimeout> | null>(null)

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
  sessionTotal.value = 0
}

async function switchSession(id: string) {
  if (currentSessionId.value === id) return
  if (currentSessionId.value) persistMessages()
  currentSessionId.value = id
  messages.value = loadMessages(id)
  sessionTotal.value = 0 // 会话累计以服务端为准，下一次 usage 事件（含基线）会重新填
  scrollToBottom()
}

async function deleteSession(s: Session) {
  try {
    await ElMessageBox.confirm(`删除会话「${s.title}」？服务端对话快照与本地缓存将一并清除。`, '删除会话', {
      type: 'warning',
      confirmButtonText: '删除',
      cancelButtonText: '取消',
    })
  } catch {
    return
  }
  try {
    await deleteThread(s.id)
  } catch (e) {
    ElMessage.error((e as ApiError).message)
    return
  }
  sessions.value = sessions.value.filter((x) => x.id !== s.id)
  localStorage.removeItem(msgKey(s.id))
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

async function togglePin(s: Session) {
  const pinned = !s.pinned
  try {
    await updateThread(s.id, { pinned })
  } catch (e) {
    ElMessage.error((e as ApiError).message)
    return
  }
  s.pinned = pinned
  s.pinnedAt = pinned ? Date.now() : undefined
}

async function renameSession(s: Session) {
  let title = ''
  try {
    const { value } = await ElMessageBox.prompt('请输入新的会话名称', '重命名会话', {
      inputValue: s.title,
      inputPattern: /\S+/,
      inputErrorMessage: '名称不能为空',
      confirmButtonText: '确定',
      cancelButtonText: '取消',
    })
    title = (value ?? '').trim().slice(0, 24)
  } catch {
    // 用户取消
    return
  }
  if (!title) return
  try {
    await updateThread(s.id, { title })
  } catch (e) {
    ElMessage.error((e as ApiError).message)
    return
  }
  s.title = title
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

/** 把消息推进响应式数组，返回 Vue 的响应式代理对象。
 * 注意：不能返回入参 m 本身——push 后 Vue 会把 m 包装成 Proxy，原对象仍是普通对象，
 * 直接改它不会触发重绘（流式更新必须拿代理来改）。 */
function pushMessage(m: ChatMessage): ChatMessage {
  messages.value.push(m)
  const proxy = messages.value[messages.value.length - 1]
  scrollToBottom()
  return proxy
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
  // 新会话服务端标题默认为空，用首条消息同步标题（失败不影响本地展示）
  updateThread(threadId, { title }).catch(() => {
    /* ignore */
  })
}

/** 活跃会话置顶到普通会话组的最近位置（服务端按 updated_at 倒序，本地近似同步）。 */
function bumpSession(id: string) {
  const s = sessions.value.find((x) => x.id === id)
  if (!s) return
  s.updatedAt = Date.now()
  sessions.value = sessions.value.filter((x) => x.id !== id)
  sessions.value.unshift(s)
}

/** 把所有阶段标记为已完成（全部变绿色对号、停止闪烁）。 */
function markStagesDone(msg: ChatMessage) {
  if (msg.stages) {
    for (const s of msg.stages) s.done = true
  }
}

/** 向 Agent 请求一次回复并更新 pendingMsg（sendMessage 与 regenerate 共用）。
 * 走 SSE 流式：阶段进度 → 检索中 → 逐字回答；审批挂起 / 失败 / 用户停止也在此收敛。 */
async function requestReply(text: string, pendingMsg: ChatMessage) {
  sending.value = true
  const wasNew = currentSessionId.value === null
  // 新建本次请求的取消句柄：停止按钮用它 abort + 后端置位
  const controller = new AbortController()
  abortController.value = controller
  try {
    await streamChat(
      text,
      currentSessionId.value,
      {
        // 会话 ID（最先到）：新会话时前端据此才拿到 thread_id，才能调用取消
        onSession(tid) {
          if (wasNew && tid) {
            currentSessionId.value = tid
            registerSession(tid)
          }
        },
        // 阶段进度：累积成状态行展示（不阻塞回答内容）
        onStage(data) {
          const label = String(data.label ?? '').trim()
          if (label) {
            if (!pendingMsg.stages) pendingMsg.stages = []
            // 新阶段开始 → 之前的阶段都算"已完成"（变成对号）
            for (const s of pendingMsg.stages) s.done = true
            pendingMsg.stages.push({ label, done: false })
            scrollToBottom()
          }
        },
        // LLM 逐字输出：追加到内容，进入"打字机"状态；生成开始即所有阶段完成
        onToken(delta) {
          if (delta) {
            pendingMsg.pending = false
            pendingMsg.error = false
            pendingMsg.errorText = undefined
            markStagesDone(pendingMsg)
            pendingMsg.content += delta
            scrollToBottom()
          }
        },
        // token 用量：会话累计实时更新 + 记录本次 query 用量（全段展示）
        onUsage(data) {
          sessionTotal.value = Number(data.session_total ?? 0)
          pendingMsg.usage = data
        },
        // HITL 挂起：展示审批卡
        onApproval(payload, tid) {
          if (wasNew && tid) {
            currentSessionId.value = tid
            registerSession(tid)
          }
          pendingMsg.pending = false
          markStagesDone(pendingMsg)
          pendingMsg.approval = payload
          scrollToBottom()
        },
        // 用户主动停止：标记"已停止生成"
        onCancel() {
          pendingMsg.pending = false
          pendingMsg.error = false
          pendingMsg.errorText = undefined
          pendingMsg.cancelled = true
          markStagesDone(pendingMsg)
          scrollToBottom()
        },
        // 正常跑完
        onDone(tid) {
          if (wasNew && tid) {
            currentSessionId.value = tid
            registerSession(tid)
          }
          pendingMsg.pending = false
          pendingMsg.error = false
          pendingMsg.errorText = undefined
          markStagesDone(pendingMsg)
          bumpSession(tid)
          scrollToBottom()
        },
      },
      controller.signal,
    )
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
    // 清理本次请求的取消句柄与兜底定时器
    if (stopFallbackTimer.value) {
      clearTimeout(stopFallbackTimer.value)
      stopFallbackTimer.value = null
    }
    abortController.value = null
    scrollToBottom()
  }
}

/** 用户点击"停止"：通知后端置位取消标记 + 断开连接，前端标记"已停止生成"。 */
async function stopGeneration() {
  if (!sending.value) return
  const controller = abortController.value
  // 1) 先让后端知道要停（后端在下一个 token/工具边界停下，发 event: cancel）
  if (currentSessionId.value) {
    cancelChat(currentSessionId.value).catch(() => {
      /* 失败则靠下面的 abort 兜底 */
    })
  }
  // 2) 兜底：后端若迟迟不回应（如卡在长工具调用），3 秒后强制断开
  if (controller && !stopFallbackTimer.value) {
    stopFallbackTimer.value = setTimeout(() => {
      controller.abort()
      stopFallbackTimer.value = null
    }, 3000)
  }
  // 若连 thread_id 都没有（session 事件未到），只能立即断开
  if (!currentSessionId.value && controller) {
    controller.abort()
  }
}

async function sendMessage() {
  const text = input.value.trim()
  if (!canSend.value) return
  input.value = ''

  pushMessage({ role: 'user', content: text })
  // 用 pushMessage 返回的响应式代理，流式回调改它才能触发逐字重绘
  const pendingMsg = pushMessage({ role: 'assistant', content: '', pending: true })

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
  // 移除当前回复，原地插入待生成消息；从响应式数组里取回代理对象供流式回调修改
  messages.value.splice(idx, 1)
  messages.value.splice(idx, 0, { role: 'assistant', content: '', pending: true })
  const pendingMsg = messages.value[idx]
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
// 空会话欢迎页展示的建议问题，点按即发送
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
  syncSessions()
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
            <span class="hero-eyebrow">
              <span class="hero-dot"></span>
              私有论文库 · RAG 检索
            </span>
            <h2>让论文里的细节<br />随问随答。</h2>
            <p>基于你的私有论文库检索相关片段，再由 Agent 综合成有依据的回答。</p>
          </div>
          <p v-if="currentSessionId" class="hero-note">
            此会话历史保存在服务端，当前浏览器无本地缓存；继续提问将从服务端续接上下文
          </p>

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

          <!-- 示例问题：点按即问 -->
          <div class="hero-samples">
            <button v-for="q in sampleQuestions" :key="q" class="sample-chip" type="button" @click="askSample(q)">
              <span class="sample-text">{{ q }}</span>
              <el-icon class="sample-arrow" :size="13"><ArrowRight /></el-icon>
            </button>
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
                  <span class="assistant-label">Maclaosty</span>
                </div>

                <div v-if="m.stages && m.stages.length" class="msg-stages">
                  <div v-for="(s, j) in m.stages" :key="j" class="msg-stage" :class="{ done: s.done }">
                    <span v-if="s.done" class="stage-check">✓</span>
                    <span v-else class="stage-dot"></span>
                    <span>{{ s.label }}</span>
                  </div>
                </div>

                <div v-if="m.pending" class="msg-pending">
                  <el-icon class="is-loading"><Loading /></el-icon>
                  <span>思考中…</span>
                </div>
                <div v-else-if="m.cancelled" class="msg-cancelled">
                  <span>已停止生成</span>
                </div>

                <template v-else>
                  <div
                    v-if="m.content"
                    class="assistant-body msg-text markdown-body"
                    v-html="renderMarkdown(m.content)"
                  ></div>
                  <div v-if="m.error && m.errorText" class="msg-error">{{ m.errorText }}</div>

                  <!-- 本次 query 的 token 用量（流式中逐轮增长，全段可见） -->
                  <div v-if="m.usage && m.usage.query_total > 0" class="msg-usage">
                    本次消耗 {{ m.usage.query_total.toLocaleString() }} tokens · {{ m.usage.calls }} 次模型调用
                  </div>

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
              <!-- 生成中：显示"停止"按钮，可随时中断 -->
              <el-button
                v-if="sending"
                type="danger"
                plain
                circle
                class="chat-send stop-btn"
                title="停止生成"
                :disabled="!sending"
                @click="stopGeneration"
              >
                <el-icon :size="16"><Close /></el-icon>
              </el-button>
              <el-button
                v-else
                type="primary"
                circle
                class="chat-send"
                :class="{ 'is-sending': sending }"
                :disabled="!canSend"
                @click="sendMessage"
              >
                <el-icon :size="16"><Promotion /></el-icon>
              </el-button>
            </div>
            <p class="input-hint">
              <span>内容由 AI 生成，仅供论文检索与研究参考</span>
              <span v-if="sessionTotal > 0" class="session-usage">
                本会话已用 {{ sessionTotal.toLocaleString() }} tokens
              </span>
            </p>
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
  padding: 14px 12px 12px;
  border-bottom: 1px solid var(--prf-border);
}
.session-actions {
  display: flex;
  align-items: center;
  gap: 8px;
}
.new-btn {
  flex: 1;
  height: 36px;
  border-radius: var(--prf-radius-sm);
}
.collapse-btn {
  flex-shrink: 0;
  width: 36px;
  height: 36px;
  padding: 0;
  border-radius: var(--prf-radius-sm);
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
  padding: 10px;
}
.session-item {
  display: flex;
  align-items: center;
  gap: 9px;
  padding: 10px 11px;
  margin-bottom: 2px;
  border-radius: var(--prf-radius-sm);
  cursor: pointer;
  color: var(--prf-text-2);
  transition: background-color 0.18s ease, color 0.18s ease;
}
.session-item:hover {
  background: var(--prf-hover);
}
.session-item.active {
  background: var(--prf-active);
  color: var(--prf-primary);
  font-weight: 550;
}
.session-ico {
  flex-shrink: 0;
  font-size: 15px;
  opacity: 0.75;
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
  border-radius: var(--prf-radius-xs);
  font-size: 15px;
  color: var(--prf-text-4);
  visibility: hidden;
}
.session-item:hover .session-more,
.session-item.active .session-more {
  visibility: visible;
}
.session-more:hover {
  color: var(--prf-primary);
  background: var(--prf-surface);
}
.session-group-title {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 12px 11px 6px;
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: var(--prf-text-4);
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
  gap: 24px;
  /* 空会话整体略微上移，视觉更居中 */
  transform: translateY(-64px);
}

/* ---------- 空会话欢迎 ---------- */
.chat-hero {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 14px;
  text-align: center;
  color: var(--prf-text-2);
  animation: prf-fade-up 0.5s cubic-bezier(0.22, 1, 0.36, 1) both;
}
.hero-eyebrow {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  padding: 5px 12px 5px 10px;
  border: 1px solid var(--prf-border);
  border-radius: 999px;
  background: var(--prf-surface);
  font-size: 11px;
  font-weight: 550;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--prf-text-3);
}
.hero-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--prf-primary);
  box-shadow: 0 0 0 3px var(--prf-primary-soft);
}
.chat-hero h2 {
  margin: 4px 0 0;
  font-size: 34px;
  line-height: 1.24;
  font-weight: 650;
  letter-spacing: -0.03em;
  color: var(--prf-text-1);
}
.chat-hero p {
  margin: 0;
  max-width: 430px;
  font-size: 14px;
  line-height: 1.75;
  color: var(--prf-text-3);
}
.hero-note {
  margin: -12px 0 0;
  font-size: 12px;
  color: var(--prf-text-4);
}

/* 示例问题芯片 */
.hero-samples {
  display: flex;
  flex-direction: column;
  gap: 8px;
  width: 100%;
  max-width: 560px;
  animation: prf-fade-up 0.5s cubic-bezier(0.22, 1, 0.36, 1) 0.12s both;
}
.sample-chip {
  display: flex;
  align-items: center;
  gap: 10px;
  width: 100%;
  padding: 11px 14px;
  border: 1px solid var(--prf-border);
  border-radius: var(--prf-radius-md);
  background: var(--prf-surface);
  color: var(--prf-text-2);
  font-size: 13px;
  text-align: left;
  cursor: pointer;
  transition:
    color 0.2s ease,
    border-color 0.2s ease,
    background-color 0.2s ease,
    transform 0.2s ease;
}
.sample-chip:hover {
  color: var(--prf-text-1);
  border-color: color-mix(in srgb, var(--prf-primary) 34%, var(--prf-border));
  background: var(--prf-surface-2);
  transform: translateX(2px);
}
.sample-text {
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.sample-arrow {
  flex-shrink: 0;
  color: var(--prf-text-4);
  transition: color 0.2s ease, transform 0.2s ease;
}
.sample-chip:hover .sample-arrow {
  color: var(--prf-primary);
  transform: translateX(2px);
}

/* 中央输入框卡片 */
.hero-input {
  position: relative;
  width: 100%;
  max-width: 560px;
  background: var(--prf-surface);
  border: 1px solid var(--prf-border);
  border-radius: var(--prf-radius-xl);
  padding: 12px 14px;
  box-shadow: var(--prf-shadow);
  transition:
    border-color 0.25s ease,
    box-shadow 0.25s ease,
    background-color 0.25s ease;
}
.hero-input:focus-within {
  border-color: var(--prf-primary);
  box-shadow: var(--prf-ring), var(--prf-shadow-lg);
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
  margin-bottom: 30px;
  animation: prf-fade-up 0.36s cubic-bezier(0.22, 1, 0.36, 1) both;
}

/* 用户消息：右对齐主色柔和底气泡 */
.user-msg {
  width: fit-content;
  max-width: 78%;
  margin-left: auto;
  padding: 11px 15px;
  background: var(--prf-primary-soft);
  border-radius: 16px 16px 4px 16px;
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
  background: var(--prf-surface);
  border: 1px solid var(--prf-border);
  color: var(--prf-primary);
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
.msg-cancelled {
  padding: 8px 0;
  font-size: 13px;
  color: var(--prf-text-3);
}
.msg-cancelled span::before {
  content: '■';
  margin-right: 6px;
  color: var(--prf-danger);
  font-size: 10px;
}

/* 本次 query 的 token 用量 */
.msg-usage {
  margin-top: 8px;
  font-size: 12px;
  color: var(--prf-text-4);
  font-variant-numeric: tabular-nums;
}

/* 流式阶段进度行：检索中 / 命中 N 条 等 */
.msg-stages {
  display: flex;
  flex-direction: column;
  gap: 4px;
  margin: 10px 0;
  padding: 8px 10px;
  background: var(--prf-surface-2);
  border: 1px solid var(--prf-border);
  border-radius: 8px;
  font-size: 12.5px;
  line-height: 1.5;
  color: var(--prf-text-3);
}
.msg-stage {
  display: flex;
  align-items: flex-start;
  gap: 6px;
}
/* 进行中的阶段：闪烁圆点 */
.stage-dot {
  width: 6px;
  height: 6px;
  margin-top: 5px;
  border-radius: 50%;
  background: var(--prf-primary);
  flex-shrink: 0;
  animation: prf-stage-blink 1s ease-in-out infinite;
}
/* 已完成的阶段：绿色对号（不再闪烁） */
.stage-check {
  width: 14px;
  height: 14px;
  margin-top: 1px;
  border-radius: 50%;
  background: var(--prf-success);
  color: #fff;
  font-size: 10px;
  line-height: 14px;
  text-align: center;
  flex-shrink: 0;
}
.msg-stage.done {
  color: var(--prf-text-2);
}
@keyframes prf-stage-blink {
  0%,
  100% {
    opacity: 1;
  }
  50% {
    opacity: 0.35;
  }
}

/* 操作按钮：悬停显示 */
.msg-actions {
  display: flex;
  gap: 4px;
  margin-top: 10px;
  opacity: 0;
  transform: translateY(-2px);
  transition: opacity 0.2s ease, transform 0.2s ease;
}
.msg-block.assistant:hover .msg-actions,
.msg-actions:focus-within {
  opacity: 1;
  transform: translateY(0);
}
.action-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  border-radius: var(--prf-radius-sm);
  border: 1px solid transparent;
  background: transparent;
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
  border-color: var(--prf-border);
  background: var(--prf-surface);
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
  margin: 20px 0 10px;
  font-size: 16px;
  line-height: 1.5;
  font-weight: 650;
  letter-spacing: -0.015em;
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
  margin: 12px 0;
  padding: 10px 14px;
  border-left: 2px solid var(--prf-primary);
  border-radius: 0 var(--prf-radius-sm) var(--prf-radius-sm) 0;
  background: var(--prf-surface-2);
  color: var(--prf-text-2);
}
.msg-text.markdown-body :deep(blockquote p) {
  margin: 4px 0;
}
.msg-text.markdown-body :deep(code) {
  background: var(--prf-code-bg);
  padding: 1px 6px;
  border-radius: var(--prf-radius-xs);
  font-family: var(--prf-font-mono);
  font-size: 13px;
  color: var(--prf-code-text);
}
.msg-text.markdown-body :deep(pre) {
  margin: 12px 0;
  padding: 14px 16px;
  background: var(--prf-code-bg);
  border: 1px solid var(--prf-border);
  border-radius: var(--prf-radius-md);
  overflow-x: auto;
  font-size: 13px;
  line-height: 1.65;
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
  margin-top: 14px;
  padding: 14px;
  border: 1px solid var(--prf-warning-border);
  border-radius: var(--prf-radius-md);
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
  gap: 7px;
  font-size: 13px;
  font-weight: 600;
  color: var(--prf-text-1);
  margin-bottom: 8px;
}
.approval-title .el-icon {
  color: var(--prf-warning);
}
.approval-card.resolved .approval-title {
  color: var(--prf-text-3);
}
.approval-card.resolved .approval-title .el-icon {
  color: var(--prf-text-4);
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
  padding: 18px 24px 14px;
  background: linear-gradient(to top, var(--prf-bg) 62%, color-mix(in srgb, var(--prf-bg) 0%, transparent));
}
.input-column {
  width: 100%;
  max-width: 760px;
  margin: 0 auto;
}
.chat-input {
  position: relative;
  background: var(--prf-surface);
  border: 1px solid var(--prf-border);
  border-radius: var(--prf-radius-xl);
  padding: 12px 14px;
  box-shadow: var(--prf-shadow);
  transition:
    border-color 0.25s ease,
    box-shadow 0.25s ease,
    background-color 0.25s ease;
}
.chat-input:focus-within {
  border-color: var(--prf-primary);
  box-shadow: var(--prf-ring), var(--prf-shadow-lg);
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
.chat-send.stop-btn {
  /* 生成时替换发送按钮（v-if/v-else 互斥），同一位置显示停止 */
  background: var(--prf-danger-bg, rgba(245, 108, 108, 0.12));
  border-color: var(--prf-danger);
  color: var(--prf-danger);
}
.chat-send.stop-btn:hover {
  background: var(--prf-danger);
  border-color: var(--prf-danger);
  color: #fff;
}
.input-hint {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  margin: 8px 0 0;
  font-size: 12px;
  color: var(--prf-text-4);
}
.session-usage {
  color: var(--prf-text-3);
  font-weight: 550;
  font-variant-numeric: tabular-nums;
}

/* ---------- 响应式 ---------- */
@media (max-width: 900px) {
  .chat-scroll {
    padding: 24px 18px 16px;
  }
  .input-dock {
    padding: 14px 16px 12px;
  }
  .chat-empty {
    padding: 18px;
  }
  .chat-hero h2 {
    font-size: 28px;
  }
}
@media (max-width: 560px) {
  .chat-hero h2 {
    font-size: 25px;
  }
  .sample-chip {
    padding: 10px 12px;
    font-size: 12.5px;
  }
  .user-msg {
    max-width: 88%;
  }
  .input-hint {
    display: none;
  }
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
