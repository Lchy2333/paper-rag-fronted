# paper-rag-fronted

论文 RAG 助手的**前端页面**。对接 `paper-rag-agent`（Agent 编排层）与 `paper-rag-backend`（RAG 能力层）两个后端服务。

技术栈：**Vue 3 + Vite + TypeScript + Element Plus**（Vue Router 4 / Axios）。

## 页面

| 路由 | 页面 | 说明 |
|---|---|---|
| `/chat` | 对话页 | 左侧会话列表 + 主聊天区；多轮会话（`thread_id`）；HITL 危险操作审批（允许/拒绝） |
| `/documents` | 文档库页 | PDF 多文件上传（异步解析）、文档列表、状态轮询、删除 |

## 对接架构

```
浏览器 ──Vite dev proxy──► Agent :8001  (/api/chat /api/approve /health)
     └──────────────────► RAG   :8080  (/rag/api/v1/documents 直连，带 X-API-Key)
```

- **对话页**走 Agent：多轮会话、HITL 审批都是 Agent 的职责。
- **文档库页直连 RAG**：Agent 当前没有暴露文档管理的 REST 端点（只有 LLM 工具），浏览器无法走"LLM 给文件路径"的上传流程，故前端直连 RAG 的文档 CRUD。
- 开发环境通过 Vite 代理避免跨域（Agent 未配 CORS 中间件）；生产构建需在 Nginx/网关层做同样转发。

> ⚠️ 注意：文档库页的**删除走 RAG 直连，不经过 Agent 的 HITL 审批**（前端仅做了二次确认）。若需统一审批，后续应改为经 Agent 代理。

## 快速开始

```bash
# 1. 安装依赖
npm install

# 2. 配置环境（复制 .env.example → .env，按需修改）
copy .env.example .env

# 3. 启动开发服务器（默认 5173，自动代理到 8001 / 8080）
npm run dev
```

## 环境变量（.env）

| 变量 | 默认值 | 说明 |
|---|---|---|
| `VITE_AGENT_BASE_URL` | `http://localhost:8001` | Agent 服务地址 |
| `VITE_RAG_BASE_URL` | `http://localhost:8080` | RAG 服务地址 |
| `VITE_RAG_API_KEY` | 空 | RAG 服务鉴权 Key（`X-API-Key` 头）；留空 = RAG 开发模式不校验 |

## 常用命令

```bash
npm run dev      # 开发
npm run build    # 类型检查 + 生产构建
npm run preview  # 预览生产构建
```

## 目录结构

```
src/
├── api/
│   ├── client.ts     # Axios 实例（Agent / RAG 两个客户端）+ 统一错误处理
│   ├── agent.ts      # /api/chat、/api/approve、/health
│   ├── rag.ts        # RAG 文档 CRUD
│   ├── types.ts      # Agent 侧类型
│   └── ragTypes.ts   # RAG 侧类型
├── layouts/
│   └── MainLayout.vue   # 顶部导航 + 服务状态
├── views/
│   ├── ChatView.vue     # 对话页
│   └── DocumentsView.vue # 文档库页
├── router/index.ts
└── main.ts
```

## 已知边界 / 后续方向

- Agent 流式输出（SSE）上线后，对话页可接入打字机效果（目前为一次性返回）。
- Agent 鉴权（JWT 登录）落地后，前端需加登录页与 token 携带。
- 文档库删除经 Agent 代理以统一 HITL 审批。
- 回答内容暂为纯文本渲染，可后续引入 Markdown 渲染。
