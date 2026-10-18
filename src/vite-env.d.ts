/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Agent 服务地址（Vite dev proxy 转发目标） */
  readonly VITE_AGENT_BASE_URL?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
