import { handleError, ragClient } from './client'
import type {
  DocumentDetailResponse,
  DocumentListResponse,
  IngestOptions,
  RagDocument,
  RechunkResponse,
  UploadResponse,
} from './ragTypes'

/** 列出 RAG 库中当前用户可见的全部文档（admin 全库）。 */
export async function listDocuments(): Promise<RagDocument[]> {
  try {
    const { data } = await ragClient.get<DocumentListResponse>('/documents')
    return data.documents
  } catch (e) {
    return handleError(e, '获取文档列表失败')
  }
}

/** 查询单个文档详情（上传后轮询进度：pending → processing → ready / failed）。 */
export async function getDocument(id: string): Promise<RagDocument> {
  try {
    const { data } = await ragClient.get<DocumentDetailResponse>(`/documents/${encodeURIComponent(id)}`)
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
    const { data } = await ragClient.post<UploadResponse>('/documents', form, {
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
      `/documents/${encodeURIComponent(id)}/rechunk`,
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
    await ragClient.delete(`/documents/${encodeURIComponent(id)}`)
  } catch (e) {
    return handleError(e, '删除文档失败')
  }
}

