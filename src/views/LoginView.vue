<script setup lang="ts">
import { reactive, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { ElMessage, type FormInstance, type FormRules } from 'element-plus'
import { Lock, User } from '@element-plus/icons-vue'
import { login, register } from '@/api/agent'
import { ApiError } from '@/api/client'

const route = useRoute()
const router = useRouter()

const mode = ref<'login' | 'register'>('login')
const loading = ref(false)
const formRef = ref<FormInstance>()

const form = reactive({
  username: '',
  password: '',
  confirm: '',
})

const rules: FormRules = {
  username: [
    { required: true, message: '请输入用户名', trigger: 'blur' },
    { min: 3, max: 64, message: '用户名长度为 3-64 个字符', trigger: 'blur' },
  ],
  password: [
    { required: true, message: '请输入密码', trigger: 'blur' },
    { min: 8, max: 64, message: '密码长度为 8-64 个字符', trigger: 'blur' },
  ],
  confirm: [
    {
      validator: (_rule, value, callback) => {
        if (mode.value === 'register' && value !== form.password) {
          callback(new Error('两次输入的密码不一致'))
        } else {
          callback()
        }
      },
      trigger: 'blur',
    },
  ],
}

function switchMode(m: 'login' | 'register') {
  if (mode.value === m) return
  mode.value = m
  form.confirm = ''
  formRef.value?.clearValidate()
}

async function submit() {
  if (!formRef.value) return
  try {
    await formRef.value.validate()
  } catch {
    return
  }

  loading.value = true
  try {
    if (mode.value === 'register') {
      await register(form.username, form.password)
      ElMessage.success('注册成功，正在登录…')
    }
    await login(form.username, form.password)
    ElMessage.success(mode.value === 'login' ? '欢迎回来' : '登录成功')
    const redirect = (route.query.redirect as string) || '/chat'
    router.replace(redirect)
  } catch (e) {
    ElMessage.error((e as ApiError).message)
  } finally {
    loading.value = false
  }
}
</script>

<template>
  <div class="login-view">
    <div class="login-shell">
      <!-- 品牌面板：桌面端左侧，移动端隐藏 -->
      <aside class="brand-panel">
        <div class="brand-top">
          <span class="brand-mark">
            <el-icon :size="17"><Reading /></el-icon>
          </span>
          <span class="brand-name">论文 RAG 助手</span>
        </div>

        <div class="brand-copy">
          <span class="brand-eyebrow">Private Research Copilot</span>
          <h1>让你的论文库<br />开口说话。</h1>
          <p>基于私有论文库的检索增强问答，Agent 自动规划检索路径，给出可追溯、可核对的回答。</p>
        </div>

        <ul class="brand-points">
          <li>检索增强生成，回答附带原文出处</li>
          <li>会话、文档按用户隔离</li>
          <li>支持对话中的人机协作审批</li>
        </ul>

        <p class="brand-foot">会话记录与文档仅对当前账号可见</p>
      </aside>

      <!-- 表单面板 -->
      <section class="form-panel">
        <div class="form-head">
          <span class="form-eyebrow">{{ mode === 'login' ? '欢迎回来' : '创建账号' }}</span>
          <h2>{{ mode === 'login' ? '登录你的工作台' : '注册并开始使用' }}</h2>
          <p>{{ mode === 'login' ? '继续你的论文问答与研究整理。' : '注册成功后将自动登录。' }}</p>
        </div>

        <div class="mode-switch" role="tablist">
          <button
            type="button"
            role="tab"
            class="mode-btn"
            :class="{ active: mode === 'login' }"
            :aria-selected="mode === 'login'"
            @click="switchMode('login')"
          >
            登录
          </button>
          <button
            type="button"
            role="tab"
            class="mode-btn"
            :class="{ active: mode === 'register' }"
            :aria-selected="mode === 'register'"
            @click="switchMode('register')"
          >
            注册
          </button>
        </div>

        <el-form ref="formRef" :model="form" :rules="rules" label-position="top" size="large" @keyup.enter="submit">
          <el-form-item label="用户名" prop="username">
            <el-input v-model="form.username" placeholder="3-64 个字符" :prefix-icon="User" clearable />
          </el-form-item>
          <el-form-item label="密码" prop="password">
            <el-input v-model="form.password" type="password" placeholder="8-64 个字符" :prefix-icon="Lock" show-password />
          </el-form-item>
          <el-form-item v-if="mode === 'register'" label="确认密码" prop="confirm">
            <el-input v-model="form.confirm" type="password" placeholder="再次输入密码" :prefix-icon="Lock" show-password />
          </el-form-item>
          <el-button type="primary" size="large" class="login-submit" :loading="loading" @click="submit">
            {{ mode === 'login' ? '登 录' : '注册并登录' }}
          </el-button>
        </el-form>

        <p class="login-hint">账号由管理员分配或自行注册</p>
      </section>
    </div>
  </div>
</template>

<style scoped>
.login-view {
  min-height: 100vh;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 32px 24px;
  background:
    radial-gradient(900px 520px at 12% -10%, var(--prf-primary-soft) 0%, transparent 62%),
    radial-gradient(760px 440px at 92% 110%, var(--prf-primary-soft) 0%, transparent 58%),
    var(--prf-bg);
}

.login-shell {
  width: 100%;
  max-width: 960px;
  min-height: 588px;
  display: grid;
  grid-template-columns: 1.02fr 1fr;
  background: var(--prf-surface);
  border: 1px solid var(--prf-border);
  border-radius: 24px;
  overflow: hidden;
  box-shadow: var(--prf-shadow-lg);
  animation: prf-fade-up 0.5s cubic-bezier(0.22, 1, 0.36, 1) both;
  /* 整体上移一点，避免登录框在页面中感觉偏低 */
  transform: translateY(-32px);
}

/* ---------- 品牌面板 ---------- */
.brand-panel {
  position: relative;
  display: flex;
  flex-direction: column;
  gap: 34px;
  padding: 38px 40px;
  color: #fff;
  background:
    radial-gradient(520px 380px at 82% 8%, color-mix(in srgb, var(--prf-primary) 42%, transparent) 0%, transparent 68%),
    radial-gradient(420px 320px at 8% 96%, color-mix(in srgb, var(--prf-primary) 24%, transparent) 0%, transparent 70%),
    #141721;
  isolation: isolate;
}

/* 细网格纹理 */
.brand-panel::before {
  content: '';
  position: absolute;
  inset: 0;
  z-index: -1;
  background-image:
    linear-gradient(to right, rgba(255, 255, 255, 0.045) 1px, transparent 1px),
    linear-gradient(to bottom, rgba(255, 255, 255, 0.045) 1px, transparent 1px);
  background-size: 34px 34px;
  mask-image: radial-gradient(120% 100% at 30% 0%, #000 25%, transparent 78%);
  opacity: 0.9;
}

.brand-top {
  display: flex;
  align-items: center;
  gap: 10px;
}
.brand-mark {
  width: 32px;
  height: 32px;
  border-radius: 10px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  background: #fff;
  color: #141721;
}
.brand-name {
  font-size: 13.5px;
  font-weight: 600;
  letter-spacing: 0.01em;
  color: rgba(255, 255, 255, 0.92);
}

.brand-copy {
  margin-top: auto;
}
.brand-eyebrow {
  display: inline-block;
  margin-bottom: 16px;
  padding: 4px 10px;
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 0.09em;
  text-transform: uppercase;
  color: rgba(255, 255, 255, 0.66);
  border: 1px solid rgba(255, 255, 255, 0.16);
  border-radius: 999px;
}
.brand-copy h1 {
  margin: 0 0 14px;
  font-size: 34px;
  line-height: 1.22;
  font-weight: 650;
  letter-spacing: -0.03em;
  color: #fff;
}
.brand-copy p {
  margin: 0;
  max-width: 34ch;
  font-size: 13.5px;
  line-height: 1.72;
  color: rgba(255, 255, 255, 0.62);
}

.brand-points {
  margin: 0;
  padding: 0;
  list-style: none;
  display: flex;
  flex-direction: column;
  gap: 9px;
}
.brand-points li {
  position: relative;
  padding-left: 22px;
  font-size: 12.5px;
  line-height: 1.6;
  color: rgba(255, 255, 255, 0.56);
}
.brand-points li::before {
  content: '';
  position: absolute;
  left: 2px;
  top: 7px;
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--prf-primary);
  box-shadow: 0 0 0 3px color-mix(in srgb, var(--prf-primary) 22%, transparent);
}

.brand-foot {
  margin: auto 0 0;
  padding-top: 18px;
  font-size: 11.5px;
  color: rgba(255, 255, 255, 0.34);
  border-top: 1px solid rgba(255, 255, 255, 0.08);
}

/* ---------- 表单面板 ---------- */
.form-panel {
  display: flex;
  flex-direction: column;
  justify-content: center;
  gap: 20px;
  padding: 46px 46px 40px;
  background: var(--prf-surface);
}

.form-head .form-eyebrow {
  display: block;
  margin-bottom: 8px;
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 0.1em;
  text-transform: uppercase;
  color: var(--prf-text-4);
}
.form-head h2 {
  margin: 0 0 6px;
  font-size: 23px;
  font-weight: 650;
  letter-spacing: -0.022em;
  color: var(--prf-text-1);
}
.form-head p {
  margin: 0;
  font-size: 13px;
  color: var(--prf-text-3);
}

.mode-switch {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 4px;
  padding: 4px;
  background: var(--prf-surface-2);
  border: 1px solid var(--prf-border);
  border-radius: var(--prf-radius-md);
}
.mode-btn {
  height: 34px;
  border: 0;
  border-radius: var(--prf-radius-sm);
  background: transparent;
  color: var(--prf-text-3);
  font-family: inherit;
  font-size: 13px;
  font-weight: 550;
  cursor: pointer;
  transition:
    background-color 0.18s ease,
    color 0.18s ease,
    box-shadow 0.18s ease;
}
.mode-btn:hover {
  color: var(--prf-text-1);
}
.mode-btn.active {
  background: var(--prf-surface);
  color: var(--prf-text-1);
  box-shadow: var(--prf-shadow-sm);
}
.mode-btn:focus-visible {
  outline: none;
  box-shadow: var(--prf-ring);
}

.form-panel :deep(.el-form-item) {
  margin-bottom: 18px;
}
.form-panel :deep(.el-form-item__label) {
  font-size: 12.5px;
  font-weight: 550;
  color: var(--prf-text-2);
  padding-bottom: 6px;
}

.login-submit {
  width: 100%;
  height: 44px;
  margin-top: 6px;
  font-size: 14px;
  letter-spacing: 0.04em;
}

.login-hint {
  margin: 0;
  text-align: center;
  font-size: 11.5px;
  color: var(--prf-text-4);
}

/* ---------- 响应式 ---------- */
@media (max-width: 860px) {
  .login-view {
    padding: 20px 16px;
  }
  .login-shell {
    max-width: 420px;
    min-height: 0;
    grid-template-columns: 1fr;
    border-radius: 20px;
    transform: none;
  }
  .brand-panel {
    display: none;
  }
  .form-panel {
    padding: 32px 26px 28px;
    gap: 18px;
  }
}

@media (max-width: 420px) {
  .form-panel {
    padding: 26px 20px 22px;
  }
  .form-head h2 {
    font-size: 20px;
  }
}
</style>
