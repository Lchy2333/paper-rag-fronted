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
