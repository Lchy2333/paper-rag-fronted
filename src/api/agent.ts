import { agentClient, agentHealthClient, handleError } from './client'
import type { ApproveResponse, ChatResponse } from './types'

/**
 * 发送对话消息到 Agent（多轮会话）。
 * @param query 用户问题
 * @param threadId 会话 ID；不传则新建会话
 * @returns ChatResponse —— status 为 awaiting_approval 时带 approval_payload，需走审批
 */
export async function sendChat(query: string, threadId?: string | null): Promise<ChatResponse> {
  try {
    const { data } = await agentClient.post<ChatResponse>('/chat', { query, thread_id: threadId ?? null })
    return data
  } catch (e) {
    return handleError(e, '发送消息失败')
  }
}

/**
 * 审批 HITL 挂起的危险操作（如删除文档）。
 * @param threadId 待审批会话的 thread_id
 * @param approved true=允许 / false=拒绝
 */
export async function approveOperation(threadId: string, approved: boolean): Promise<ApproveResponse> {
  try {
    const { data } = await agentClient.post<ApproveResponse>('/approve', { thread_id: threadId, approved })
    return data
  } catch (e) {
    return handleError(e, '审批操作失败')
  }
}

/** Agent 健康检查（经代理直通根路径 /health，注意不带 /api 前缀）。 */
export async function checkAgentHealth(): Promise<boolean> {
  try {
    const { data } = await agentHealthClient.get<{ status: string }>('/health')
    return data.status === 'ok'
  } catch {
    return false
  }
}
