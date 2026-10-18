/**
 * 服务健康状态分类（统一封装，供顶栏状态灯使用）。
 *
 * 输入：agent 分层 /health 返回的 checks.status（ok / error / unknown）+ 可选 error 详情。
 * 输出：统一的展示视图（样式类 / 文案 / tooltip 描述），避免各组件散落判断。
 */
import { computed, type Ref } from 'vue'

export type ServiceState = 'ok' | 'error' | 'unknown' | 'offline'

export interface ServiceHealthView {
  /** 状态灯样式类：online / offline / unknown */
  cls: 'online' | 'offline' | 'unknown'
  /** 短文案（状态灯旁显示） */
  label: string
  /** tooltip 详情（含真实错误原因） */
  desc: string
}

const LABELS: Record<ServiceState, { label: string; cls: 'online' | 'offline' | 'unknown' }> = {
  ok: { label: '正常', cls: 'online' },
  error: { label: '异常', cls: 'offline' },
  unknown: { label: '未使用', cls: 'unknown' },
  offline: { label: '未知', cls: 'unknown' },
}

/** 把后端 checks.status 归一化为前端展示状态（null = 后端没返回该字段） */
export function normalizeState(s?: string | null): ServiceState {
  if (!s) return 'offline'
  return (s as ServiceState) in LABELS ? (s as ServiceState) : 'offline'
}

/** 根据状态 + 错误详情，生成状态灯展示视图 */
export function toHealthView(name: string, state: ServiceState, error?: string | null): ServiceHealthView {
  const base = LABELS[state] ?? LABELS.offline
  const descMap: Record<ServiceState, string> = {
    ok: `${name} 服务正常`,
    error: error ? `${name} 服务异常：${error}` : `${name} 服务异常`,
    unknown: `${name} 最近未使用`,
    offline: `无法获取 ${name} 状态`,
  }
  return { cls: base.cls, label: `${name} ${base.label}`, desc: descMap[state] }
}

/**
 * 组合式函数：把 agent /health 的 checks 转为各服务的展示视图。
 * @param checksRef 后端 checks 的响应式引用（可能为 null）
 * @returns rag / llm 的展示视图 computed
 */
export function useServiceHealth(checksRef: Ref<{
  rag?: { status?: string; error?: string }
  llm?: { status?: string; error?: string }
} | null>) {
  const rag = computed<ServiceHealthView>(() => {
    const c = checksRef.value?.rag
    return toHealthView('RAG', normalizeState(c?.status), c?.error)
  })
  const llm = computed<ServiceHealthView>(() => {
    const c = checksRef.value?.llm
    return toHealthView('LLM', normalizeState(c?.status), c?.error)
  })
  return { rag, llm }
}
