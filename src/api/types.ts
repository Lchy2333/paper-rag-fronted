/** Agent 服务（FastAPI + LangGraph，端口 8001）的请求 / 响应类型。 */

/** POST /api/chat 请求体 */
export interface ChatRequest {
  query: string
  /** 会话 ID；不传则新建会话 */
  thread_id?: string | null
}

/** 待审批的操作载荷（HITL） */
export interface ApprovalPayload {
  tool?: string
  args?: Record<string, unknown>
  [key: string]: unknown
}

/** POST /api/chat 响应体 */
export interface ChatResponse {
  status: 'ok' | 'awaiting_approval'
  reply?: string
  thread_id?: string
  approval_payload?: ApprovalPayload | null
}

/** POST /api/approve 响应体 */
export interface ApproveResponse {
  status: 'done' | 'awaiting_approval'
  reply?: string
  thread_id: string
  approval_payload?: ApprovalPayload | null
}

/** Agent 全局异常处理器的响应体 */
export interface ApiErrorBody {
  status?: string
  error_code?: string
  message?: string
  detail?: string
}

// ---------- 认证 ----------

/** POST /api/auth/register 请求体 */
export interface RegisterRequest {
  username: string
  password: string
}

/** POST /api/auth/login 请求体 */
export interface LoginRequest {
  username: string
  password: string
}

/** POST /api/auth/login 响应体（JWT 签发） */
export interface TokenResponse {
  access_token: string
  token_type: string
  user_id: string
}

/** POST /api/auth/register 响应体 */
export interface UserOut {
  user_id: string
  username: string
}

/** 前端持久化的登录用户 */
export interface AuthUser {
  user_id: string
  username: string
}

// ---------- 会话（threads） ----------

/** GET /api/threads 列表项 / PATCH /api/threads/:id 响应体 */
export interface ThreadOut {
  thread_id: string
  title: string
  pinned: boolean
  created_at: string
  updated_at: string
}

/** PATCH /api/threads/:id 请求体（title / pinned 至少传一个） */
export interface UpdateThreadRequest {
  title?: string
  pinned?: boolean
}

/** DELETE /api/threads/:id 响应体 */
export interface DeleteThreadResponse {
  status: string
  thread_id: string
}

// ---------- token 用量（SSE event: usage） ----------

/** SSE event: usage 载荷：单次 query 增量 + 会话累计（见 agent 仓 architecture.md §14.6） */
export interface UsageSnapshot {
  thread_id: string
  /** 本次 query 已完成的 LLM 调用次数 */
  calls: number
  /** 本次 query 累计输入 tokens */
  query_input: number
  /** 本次 query 累计输出 tokens */
  query_output: number
  /** 本次 query 累计 = query_input + query_output */
  query_total: number
  /** 会话累计输入（含本次） */
  session_input: number
  /** 会话累计输出（含本次） */
  session_output: number
  /** 会话累计 = session_input + session_output */
  session_total: number
}
