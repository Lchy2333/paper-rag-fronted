import { handleError, ragClient } from './client'
import type { DocumentListResponse, RagDocument, UploadResponse } from './ragTypes'

/** 列出 RAG 库中全部文档。 */
export async function listDocuments(): Promise<RagDocument[]> {
  try {
    const { data } = await ragClient.get<DocumentListResponse>('/api/v1/documents')
    return data.documents
  } catch (e) {
    return handleError(e, '获取文档列表失败')
  }
}

/**
 * 上传 PDF 文档（多文件，multipart form，字段名 file）。
 * 注意：RAG 为异步摄入，返回的 success 仅代表"已接收入队"，处理进度需轮询文档 status。
 */
export async function uploadDocuments(files: File[]): Promise<UploadResponse> {
  try {
    const form = new FormData()
    for (const f of files) {
      form.append('file', f)
    }
    const { data } = await ragClient.post<UploadResponse>('/api/v1/documents', form, {
      headers: { 'Content-Type': 'multipart/form-data' },
    })
    return data
  } catch (e) {
    return handleError(e, '上传文档失败')
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
