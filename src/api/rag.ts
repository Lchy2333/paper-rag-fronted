import { handleError, ragClient } from './client'
import type {
  AskRequest,
  AskResponse,
  ConnectionResult,
  ConnectionTestRequest,
  DocumentDetailResponse,
  DocumentListResponse,
  IngestOptions,
  RagDocument,
  RechunkResponse,
  SearchRequest,
  SearchResponse,
  UploadResponse,
} from './ragTypes'

/** RAG 服务健康检查（/health 豁免鉴权）。 */
export async function checkRagHealth(): Promise<boolean> {
  try {
    const { data } = await ragClient.get<{ status: string }>('/api/v1/health')
    return data.status === 'ok'
  } catch {
    return false
  }
}

/** 列出 RAG 库中当前用户可见的全部文档（admin 全库）。 */
export async function listDocuments(): Promise<RagDocument[]> {
  try {
    const { data } = await ragClient.get<DocumentListResponse>('/api/v1/documents')
    return data.documents
  } catch (e) {
    return handleError(e, '获取文档列表失败')
  }
}

/** 查询单个文档详情（上传后轮询进度：pending → processing → ready / failed）。 */
export async function getDocument(id: string): Promise<RagDocument> {
  try {
    const { data } = await ragClient.get<DocumentDetailResponse>(`/api/v1/documents/${encodeURIComponent(id)}`)
    return data.document
  } catch (e) {
    return handleError(e, '获取文档详情失败')
  }
}

/**
 * 上传 PDF 文档（多文件，multipart form，字段名 file）。
 * 可选分块参数 chunk_size / chunk_overlap 作用于本次上传的全部文件。
 * 注意：RAG 为异步摄入，返回的 success 仅代表"已接收入队"，处理进度需轮询文档 status。
 */
export async function uploadDocuments(files: File[], opts?: IngestOptions): Promise<UploadResponse> {
  try {
    const form = new FormData()
    for (const f of files) {
      form.append('file', f)
    }
    if (opts?.chunk_size != null) form.append('chunk_size', String(opts.chunk_size))
    if (opts?.chunk_overlap != null) form.append('chunk_overlap', String(opts.chunk_overlap))
    const { data } = await ragClient.post<UploadResponse>('/api/v1/documents', form, {
      headers: { 'Content-Type': 'multipart/form-data' },
    })
    return data
  } catch (e) {
    return handleError(e, '上传文档失败')
  }
}

/** 用新分块参数对指定文档重新分块入库（慢，期间旧 chunk 一直可用）。 */
export async function rechunkDocument(id: string, opts?: IngestOptions): Promise<RagDocument> {
  try {
    const { data } = await ragClient.post<RechunkResponse>(
      `/api/v1/documents/${encodeURIComponent(id)}/rechunk`,
      opts ?? {},
    )
    return data.document
  } catch (e) {
    return handleError(e, '重新分块失败')
  }
}

/** 删除指定文档及其向量。 */
export async function deleteDocument(id: string): Promise<void> {
  try {
    await ragClient.delete(`/api/v1/documents/${encodeURIComponent(id)}`)
  } catch (e) {
    return handleError(e, '删除文档失败')
  }
}

/** 纯检索（不调 LLM），返回结构化命中片段，供 Agent 自拼上下文回答。 */
export async function search(req: SearchRequest): Promise<SearchResponse> {
  try {
    const { data } = await ragClient.post<SearchResponse>('/api/v1/search', req)
    return data
  } catch (e) {
    return handleError(e, '检索失败')
  }
}

/** 手动测试 LLM 连通性（kind: embedding / chat / formula）。 */
export async function testConnection(req: ConnectionTestRequest): Promise<ConnectionResult> {
  try {
    const { data } = await ragClient.post<ConnectionResult>('/api/v1/connections/test', req)
    return data
  } catch (e) {
    return handleError(e, '连接测试失败')
  }
}

/** RAG 问答（仅管理员可用：全局检索 + LLM 生成带引用回答）。 */
export async function ask(req: AskRequest): Promise<AskResponse> {
  try {
    const { data } = await ragClient.post<{ answer: AskResponse }>('/api/v1/ask', req)
    return data.answer
  } catch (e) {
    return handleError(e, '提问失败')
  }
}
