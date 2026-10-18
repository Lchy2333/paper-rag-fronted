<script setup lang="ts">
import { watch } from 'vue'
import { useRouter } from 'vue-router'
import { authToken } from '@/api/authState'

const router = useRouter()

// 登录态失效（401 自动清凭证 / 主动登出）时回到登录页
watch(authToken, (token) => {
  if (!token && router.currentRoute.value.name !== 'login') {
    router.replace({ name: 'login' })
  }
})
</script>

<template>
  <router-view />
</template>
