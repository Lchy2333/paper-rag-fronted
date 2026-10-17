import { fileURLToPath, URL } from 'node:url'
import vue from '@vitejs/plugin-vue'
import { defineConfig, loadEnv } from 'vite'

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  const agentUrl = env.VITE_AGENT_BASE_URL || 'http://localhost:8001'
  const ragUrl = env.VITE_RAG_BASE_URL || 'http://localhost:8080'

  return {
    plugins: [vue()],
    resolve: {
      alias: {
        '@': fileURLToPath(new URL('./src', import.meta.url)),
      },
    },
    server: {
      port: 5173,
      // 开发环境代理：避免跨域（Agent 未配 CORS 中间件）
      proxy: {
        // Agent 服务：/api/chat、/api/approve、/health
        '/api': {
          target: agentUrl,
          changeOrigin: true,
          // Agent 健康检查在根路径 /health（/api/chat、/api/approve 仍原样透传）
          rewrite: (path) => path.replace(/^\/api\/health$/, '/health'),
        },
        '/health': {
          target: agentUrl,
          changeOrigin: true,
        },
        // RAG 服务：前端加 /rag 前缀，转发时剥掉，直通 RAG 原生路径 /api/v1/...
        '/rag': {
          target: ragUrl,
          changeOrigin: true,
          rewrite: (path) => path.replace(/^\/rag/, ''),
        },
      },
    },
  }
})
