import { agentClient, agentHealthClient, ApiError, handleError } from './client'
import { authToken, setAuth } from './authState'
import type {
  ApproveResponse,
  ApprovalPayload,
  ChatResponse,
  DeleteThreadResponse,
  ThreadOut,
  TokenResponse,
  UpdateThreadRequest,
  UserOut,
} from './types'

/**
 * 注册新用户。
 * @returns UserOut —— 注册成功后仍需调用 login 获取 JWT。
 */
export async function register(username: string, password: string): Promise<UserOut> {
  try {
    const { data } = await agentClient.post<UserOut>('/auth/register', { username, password })
    return data
  } catch (e) {
    return handleError(e, '注册失败')
  }
}

/**
 * 登录并保存凭证（JWT + user_id）。
 * 后续所有 Agent / RAG 请求会自动携带 Bearer / X-User-ID（见 client.ts 拦截器）。
 */
export async function login(username: string, password: string): Promise<TokenResponse> {
  try {
    const { data } = await agentClient.post<TokenResponse>('/auth/login', { username, password })
    setAuth(data.access_token, { user_id: data.user_id, username })
    return data
  } catch (e) {
    return handleError(e, '登录失败')
  }
}

/**
 * 发送对话消息到 Agent（多轮会话）。
 * @param query 用户问题
 * @param threadId 会话 ID；不传则新建会话
 * @returns ChatResponse —— status 为 awaiting_approval 时带 approval_payload，需走审批
 */
export async function sendChat(query: string, threadId?: string | null): Promise<ChatResponse> {
  try {
    const { data } = await agentClient.post<ChatResponse>('/chat', { query, thread_id: threadId ?? null })
    return data
  } catch (e) {
    return handleError(e, '发送消息失败')
  }
}

/**
 * SSE 流式对话（POST /api/chat/stream）。
 * 后端按事件协议实时推送：session（会话ID）/ stage（阶段进度）/ token（逐字）/
 * approval（HITL 挂起）/ cancel（用户停止）/ done / error。
 * 这里用 fetch + ReadableStream 逐事件解析，边收边回调，让 UI 有"打字机 + 进度"效果。
 */
export interface StreamChatHandlers {
  /** 会话 ID（最先到达；新会话时前端据此才拿到 thread_id，才能调用取消） */
  onSession: (threadId: string) => void
  /** 阶段进度（如"正在检索论文库…""检索完成 · 命中 5 条"） */
  onStage: (data: Record<string, unknown>) => void
  /** 最终回答的 token 增量 */
  onToken: (delta: string) => void
  /** 图挂起等待审批（HITL） */
  onApproval: (payload: ApprovalPayload | null, threadId: string) => void
  /** 用户主动停止（POST /chat/cancel 触发，或本地 abort 兜底） */
  onCancel: () => void
  /** 正常跑完 */
  onDone: (threadId: string) => void
}

export async function streamChat(
  query: string,
  threadId: string | null,
  handlers: StreamChatHandlers,
  signal?: AbortSignal,
): Promise<void> {
  let res: Response
  try {
    res = await fetch('/api/chat/stream', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(authToken.value ? { Authorization: `Bearer ${authToken.value}` } : {}),
      },
      body: JSON.stringify({ query, thread_id: threadId ?? null }),
      signal,
    })
  } catch (e) {
    if ((e as Error)?.name === 'AbortError') return // 用户主动停止，正常结束
    throw new ApiError('无法连接后端服务，请确认 Agent 服务已启动')
  }

  // 非 200（如 409 待审批 / 403 / 404）→ 后端返回 JSON 错误体，直接抛
  if (!res.ok) {
    let message = '发送消息失败'
    try {
      const body = (await res.json()) as { detail?: unknown; message?: unknown }
      if (typeof body.detail === 'string') message = body.detail
      else if (typeof body.message === 'string') message = body.message
    } catch {
      /* 非 JSON 错误体忽略 */
    }
    throw new ApiError(message, res.status)
  }

  // 解析 SSE 流：event: X 行 + data: {...} 行 + 空行分隔
  const reader = res.body!.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  let evt = ''
  while (true) {
    let value: Uint8Array | undefined
    let done = false
    try {
      const r = await reader.read()
      done = r.done
      value = r.value
    } catch (e) {
      if ((e as Error)?.name === 'AbortError') {
        handlers.onCancel() // 本地 abort 兜底 → 也标记"已停止生成"
        break
      }
      throw e
    }
    if (done) break
    buffer += decoder.decode(value, { stream: true })
    let sep = buffer.indexOf('\n\n')
    while (sep >= 0) {
      const block = buffer.slice(0, sep)
      buffer = buffer.slice(sep + 2)
      for (const line of block.split('\n')) {
        if (line.startsWith('event:')) evt = line.slice(6).trim()
        else if (line.startsWith('data:')) {
          let data: Record<string, unknown>
          try {
            data = JSON.parse(line.slice(5).trim())
          } catch {
            continue
          }
          if (evt === 'session') handlers.onSession(String(data.thread_id ?? ''))
          else if (evt === 'stage') handlers.onStage(data)
          else if (evt === 'token') handlers.onToken(String(data.delta ?? ''))
          else if (evt === 'approval')
            handlers.onApproval((data.approval_payload as ApprovalPayload | null) ?? null, String(data.thread_id ?? ''))
          else if (evt === 'cancel') handlers.onCancel()
          else if (evt === 'done') handlers.onDone(String(data.thread_id ?? ''))
          else if (evt === 'error') {
            const msg = typeof data.message === 'string' ? data.message : '请求失败'
            throw new ApiError(msg, res.status)
          }
        }
      }
      evt = ''
      sep = buffer.indexOf('\n\n')
    }
  }
}

/** 中断指定会话的生成（POST /api/chat/cancel）。后端会在下一个 token/工具边界停下。 */
export async function cancelChat(threadId: string): Promise<void> {
  try {
    await agentClient.post('/chat/cancel', { thread_id: threadId })
  } catch (e) {
    return handleError(e, '停止失败')
  }
}

/**
 * 审批 HITL 挂起的危险操作（如删除文档）。
 * @param threadId 待审批会话的 thread_id
 * @param approved true=允许 / false=拒绝
 */
export async function approveOperation(threadId: string, approved: boolean): Promise<ApproveResponse> {
  try {
    const { data } = await agentClient.post<ApproveResponse>('/approve', { thread_id: threadId, approved })
    return data
  } catch (e) {
    return handleError(e, '审批操作失败')
  }
}

/** 列出当前用户全部会话（服务端置顶优先，其次按最后活跃倒序）。 */
export async function listThreads(): Promise<ThreadOut[]> {
  try {
    const { data } = await agentClient.get<ThreadOut[]>('/threads')
    return data
  } catch (e) {
    return handleError(e, '获取会话列表失败')
  }
}

/** 改名 / 置顶会话（title 与 pinned 至少传一个）。 */
export async function updateThread(threadId: string, patch: UpdateThreadRequest): Promise<ThreadOut> {
  try {
    const { data } = await agentClient.patch<ThreadOut>(`/threads/${encodeURIComponent(threadId)}`, patch)
    return data
  } catch (e) {
    return handleError(e, '更新会话失败')
  }
}

/** 删除会话（连带服务端对话快照 checkpoints）。 */
export async function deleteThread(threadId: string): Promise<void> {
  try {
    await agentClient.delete<DeleteThreadResponse>(`/threads/${encodeURIComponent(threadId)}`)
  } catch (e) {
    return handleError(e, '删除会话失败')
  }
}

/** 服务健康状态（agent 分层 /health，见 agent 仓 architecture.md §13）。 */
export interface HealthResponse {
  /** 存活判定：agent + database，供编排 healthcheck */
  status: 'ok' | 'error'
  checks: {
    database: { status: 'ok' | 'error'; error?: string; latency_ms?: number }
    rag: { status: 'ok' | 'error'; error?: string; latency_ms?: number }
    llm: { status: 'ok' | 'error' | 'unknown'; error?: string }
  }
}

/** Agent 健康检查（经代理直通根路径 /health，注意不带 /api 前缀）。 */
export async function checkAgentHealth(): Promise<HealthResponse | null> {
  try {
    const { data } = await agentHealthClient.get<HealthResponse>('/health')
    return data
  } catch {
    return null
  }
}
