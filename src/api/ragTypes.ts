/** RAG 服务（Go + Gin，端口 8080）的请求 / 响应类型。 */

/** RAG 文档模型 */
export interface RagDocument {
  id: string
  user_id: string
  filename: string
  title: string
  page_count: number
  size_bytes: number
  chunk_count: number
  /** pending / processing / ready / failed */
  status: string
  error?: string
  content_hash?: string
  chunk_size: number
  chunk_overlap: number
  created_at: string
}

/** 多文件上传时单个文件的结果 */
export interface UploadResult {
  filename: string
  /** 已接收并入队（异步处理中），非"已入库" */
  success: boolean
  duplicate?: boolean
  document_id?: string
  /** 接收成功时为 pending；重复时为已有文档状态 */
  status?: string
  size_bytes: number
  duration_ms: number
  error?: string
}

/** POST /api/v1/documents（多文件上传）响应体 */
export interface UploadResponse {
  total: number
  success_count: number
  failed_count: number
  duplicate_count: number
  results: UploadResult[]
}

/** GET /api/v1/documents 响应体 */
export interface DocumentListResponse {
  documents: RagDocument[]
}

/** GET /api/v1/documents/:id 响应体 */
export interface DocumentDetailResponse {
  document: RagDocument
}

/** POST /api/v1/documents/:id/rechunk 响应体 */
export interface RechunkResponse {
  document: RagDocument
}

/** 上传 / 重分块时可选的分块参数（缺省走后端全局配置） */
export interface IngestOptions {
  chunk_size?: number
  chunk_overlap?: number
}

/** POST /api/v1/search 请求体 */
export interface SearchRequest {
  query: string
  /** 检索片段数，默认后端配置 */
  top_k?: number
  /** 限定在指定文档范围内检索；空则全库 */
  document_ids?: string[]
  /** 请求级精排开关；不传跟随后端配置 */
  rerank?: boolean
}

/** /search 命中的片段（content = 完整 chunk，供 Agent 自拼上下文） */
export interface SearchItem {
  chunk_id: string
  document_id: string
  filename: string
  page: number
  score: number
  content: string
}

/** POST /api/v1/search 响应体 */
export interface SearchResponse {
  results: SearchItem[]
  total_chunks: number
  latency_ms: number
}

/** POST /api/v1/connections/test 请求体 */
export interface ConnectionTestRequest {
  /** embedding / chat / formula */
  kind: 'embedding' | 'chat' | 'formula'
  base_url: string
  api_key?: string
  model: string
}

/** POST /api/v1/connections/test 响应体 */
export interface ConnectionResult {
  ok: boolean
  kind: string
  latency_ms: number
  /** chat 测试时模型的回复 */
  reply?: string
  error?: string
}

/** POST /api/v1/ask 请求体（仅管理员可用，全局检索） */
export interface AskRequest {
  query: string
  top_k?: number
  document_ids?: string[]
  rerank?: boolean
}

/** 回答引用的来源片段 */
export interface Citation {
  chunk_id: string
  document_id: string
  filename: string
  page: number
  score: number
  snippet: string
}

/** POST /api/v1/ask 响应体 */
export interface AskResponse {
  answer: string
  citations: Citation[]
  total_chunks: number
  latency_ms: number
  created_at: string
}
