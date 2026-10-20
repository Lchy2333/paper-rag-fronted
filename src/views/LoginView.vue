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
    <div class="login-card">
      <div class="login-brand">
        <div class="login-logo">
          <el-icon :size="26"><Reading /></el-icon>
        </div>
        <h1>论文 RAG 助手</h1>
        <p>登录后使用基于私有论文库的智能问答</p>
      </div>

      <el-tabs v-model="mode" class="login-tabs" @tab-change="switchMode">
        <el-tab-pane label="登录" name="login" />
        <el-tab-pane label="注册" name="register" />
      </el-tabs>

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

      <p class="login-hint">账号由管理员分配或自行注册；会话与文档按用户隔离</p>
    </div>
  </div>
</template>

<style scoped>
.login-view {
  height: 100vh;
  display: flex;
  align-items: center;
  justify-content: center;
  background:
    radial-gradient(1200px 600px at 20% 0%, var(--prf-primary-soft) 0%, transparent 60%),
    radial-gradient(1000px 500px at 90% 100%, var(--prf-primary-soft) 0%, transparent 55%),
    var(--prf-bg);
  padding: 24px;
}

.login-card {
  width: 100%;
  max-width: 400px;
  background: var(--prf-surface);
  border: 1px solid var(--prf-border);
  border-radius: 16px;
  padding: 32px 32px 24px;
  box-shadow: var(--prf-shadow);
  /* 整体上移一点，避免登录框在页面中感觉偏低 */
  transform: translateY(-40px);
}

.login-brand {
  text-align: center;
  margin-bottom: 20px;
}
.login-logo {
  width: 56px;
  height: 56px;
  margin: 0 auto 12px;
  border-radius: 16px;
  background: var(--prf-primary-gradient);
  color: #fff;
  display: flex;
  align-items: center;
  justify-content: center;
  box-shadow: 0 6px 20px var(--prf-primary-soft);
}
.login-brand h1 {
  margin: 0 0 6px;
  font-size: 22px;
  background: var(--prf-primary-gradient);
  -webkit-background-clip: text;
  background-clip: text;
  -webkit-text-fill-color: transparent;
}
.login-brand p {
  margin: 0;
  font-size: 13px;
  color: var(--prf-text-3);
}

.login-tabs {
  margin-bottom: 8px;
}
.login-tabs :deep(.el-tabs__nav-wrap::after) {
  background-color: var(--prf-border);
}

.login-submit {
  width: 100%;
  margin-top: 4px;
}

.login-hint {
  margin: 16px 0 0;
  text-align: center;
  font-size: 12px;
  color: var(--prf-text-4);
}
</style>
