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

/** GET /api/threads/:id/usage 响应体：会话累计 + 上下文占用（切换会话时恢复展示） */
export interface ThreadUsage {
  thread_id: string
  session_input: number
  session_output: number
  session_total: number
  /** 模型上下文窗口；null = 未知 */
  context_window: number | null
  /** 输入预算（占用率分母）；null = 未知 */
  context_budget: number | null
  /** 最近一次 query 的最后一轮 input_tokens（当前水位） */
  context_used: number
  /** context_used / context_budget；null = 尚未调用过模型 */
  context_ratio: number | null
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
  /** 模型上下文窗口（tokens）；null = 未配置/未知，前端隐藏指示器 */
  context_window: number | null
  /** 上下文占用率的分母：输入预算 = 窗口 − 输出预留 − 安全余量（见 agent 仓 core/model_limits.py） */
  context_budget: number | null
  /** 上下文已占用：最后一轮 LLM 的 input_tokens（每轮完整重发，取最新即当前水位） */
  context_used: number
  /** context_used / context_budget；null = 本次尚未调用模型，占用未知 */
  context_ratio: number | null
}
