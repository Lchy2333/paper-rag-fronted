/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Agent 服务地址（Vite dev proxy 转发目标） */
  readonly VITE_AGENT_BASE_URL?: string
  /** RAG 服务地址（Vite dev proxy 转发目标） */
  readonly VITE_RAG_BASE_URL?: string
  /** RAG 服务 API Key（X-API-Key 头，留空 = 开发模式不校验） */
  readonly VITE_RAG_API_KEY?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
