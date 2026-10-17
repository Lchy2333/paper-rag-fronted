import axios, { AxiosError } from 'axios'

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

/** RAG 服务客户端（经 Vite 代理 /rag 转发到 :8080，剥掉前缀） */
export const ragClient = axios.create({
  baseURL: '/rag',
  timeout: 120_000,
})

// 服务间鉴权：文档库页直连 RAG，统一带 X-API-Key 头（空 = 开发模式不校验）
ragClient.interceptors.request.use((config) => {
  const key = import.meta.env.VITE_RAG_API_KEY as string | undefined
  if (key) {
    config.headers['X-API-Key'] = key
  }
  return config
})

export { handleError }
