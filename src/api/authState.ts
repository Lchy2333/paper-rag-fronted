/**
 * 认证状态（内存响应式 + localStorage 持久化）。
 *
 * 与 client.ts 的解耦点：client 的拦截器从这里读 token / user_id，
 * 而本模块不依赖 axios，避免循环引用。
 */
import { ref } from 'vue'
import type { AuthUser } from './types'

const TOKEN_KEY = 'prf_auth_token'
const USER_KEY = 'prf_auth_user'

function loadUser(): AuthUser | null {
  try {
    const raw = localStorage.getItem(USER_KEY)
    if (!raw) return null
    const u = JSON.parse(raw) as AuthUser
    if (!u || typeof u.user_id !== 'string' || typeof u.username !== 'string') return null
    return u
  } catch {
    return null
  }
}

/** 当前 JWT（响应式，UI 可直接依赖判断登录态） */
export const authToken = ref<string | null>(localStorage.getItem(TOKEN_KEY))

/** 当前登录用户（响应式） */
export const authUser = ref<AuthUser | null>(loadUser())

/** 是否已登录（有 token 即视为已登录） */
export function isAuthenticated(): boolean {
  return !!authToken.value
}

/** 登录成功后写入凭证（内存 + localStorage）。 */
export function setAuth(token: string, user: AuthUser): void {
  authToken.value = token
  authUser.value = user
  try {
    localStorage.setItem(TOKEN_KEY, token)
    localStorage.setItem(USER_KEY, JSON.stringify(user))
  } catch {
    /* 隐私模式等写失败场景不阻塞 */
  }
}

/** 登出 / 凭证失效：清空内存 + localStorage。 */
export function clearAuth(): void {
  authToken.value = null
  authUser.value = null
  try {
    localStorage.removeItem(TOKEN_KEY)
    localStorage.removeItem(USER_KEY)
  } catch {
    /* ignore */
  }
}
