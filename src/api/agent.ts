import { agentClient, agentHealthClient, handleError } from './client'
import { setAuth } from './authState'
import type {
  ApproveResponse,
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
