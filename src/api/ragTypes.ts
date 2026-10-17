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
