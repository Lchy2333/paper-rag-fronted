import axios, { AxiosError } from 'axios'
import { authToken, clearAuth } from './authState'

/** 统一错误：从 Agent / RAG 的各种错误结构里提取可读 message。 */
export class ApiError extends Error {
  status?: number
  code?: string

  constructor(message: string, status?: number, code?: string) {
    super(message)
    this.name = 'ApiError'
    this.status = status
    this.code = code
  }
}

function extractErrorMessage(body: unknown, fallback: string): string {
  if (!body || typeof body !== 'object') return fallback
  const b = body as Record<string, unknown>
  // FastAPI HTTPException：{detail: "..."}
  if (typeof b.detail === 'string') return b.detail
  // Agent 全局异常处理器：{status, error_code, message}
  if (typeof b.message === 'string') return b.message
  // RAG：{error: "..."}
  if (typeof b.error === 'string') return b.error
  return fallback
}

function handleError(e: unknown, fallback: string): never {
  if (axios.isAxiosError(e)) {
    const err = e as AxiosError
    const status = err.response?.status
    const body = err.response?.data
    // 后端未返回任何可读信息时，axios 的网络错误（代理目标未启动等）
    if (!body && err.code === 'ERR_NETWORK') {
      throw new ApiError('无法连接后端服务，请确认 Agent / RAG 服务已启动', status)
    }
    throw new ApiError(extractErrorMessage(body, fallback), status)
  }
  throw e instanceof Error ? e : new ApiError(fallback)
}

/** Agent 服务客户端（经 Vite 代理转发到 :8001） */
export const agentClient = axios.create({
  baseURL: '/api',
  timeout: 180_000, // Agent 对话含 LLM 推理，放宽超时
})

/** Agent 健康检查客户端：健康检查挂在 Agent 根路径 /health（不带 /api 前缀） */
export const agentHealthClient = axios.create({
  baseURL: '/',
  timeout: 5_000,
})

/**
 * RAG 服务客户端 —— BFF 改造后统一经 Agent 中转。
 * 文档管理请求发到 Agent 的 /api/documents/*，由 Agent 注入可信
 * X-User-ID + X-API-Key 再转发 RAG；前端不再持有 RAG 的 API Key、
 * 也无法伪造用户身份（见 architecture.md §12）。
 */
export const ragClient = axios.create({
  baseURL: '/api', // 走 Agent 网关；文档管理路径见 rag.ts（/documents/...）
  timeout: 300_000, // 上传等大请求对齐 Agent 转发层的 300s 超时
})

// ---------- 请求拦截器：注入凭证 ----------
// Agent：JWT（Authorization: Bearer）
agentClient.interceptors.request.use((config) => {
  if (authToken.value) {
    config.headers['Authorization'] = `Bearer ${authToken.value}`
  }
  return config
})

// ragClient 不再注入 X-API-Key / X-User-ID —— 全部由 Agent 转发层统一处理。

// ---------- 响应拦截器：登录态失效自动登出 ----------
// 业务接口 401 = 凭证过期/无效；登录/注册接口自身的 401（如密码错误）此时清除也无副作用。
// Agent 与 RAG（经中转）请求都会触发；登录/注册接口自身除外。
function unauthorizedInterceptor(error: unknown) {
  if (axios.isAxiosError(error) && error.response?.status === 401) {
    clearAuth()
  }
  return Promise.reject(error)
}

agentClient.interceptors.response.use((res) => res, unauthorizedInterceptor)
ragClient.interceptors.response.use((res) => res, unauthorizedInterceptor)

export { handleError }
