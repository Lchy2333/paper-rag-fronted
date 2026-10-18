# paper-rag-fronted

论文 RAG 助手的**前端页面**。对接 `paper-rag-agent`（Agent 编排层）与 `paper-rag-backend`（RAG 能力层）两个后端服务。

技术栈：**Vue 3 + Vite + TypeScript + Element Plus**（Vue Router 4 / Axios）。

## 页面

| 路由 | 页面 | 说明 |
|---|---|---|
| `/login` | 登录 / 注册页 | 注册或登录获取 JWT；会话与文档按用户隔离 |
| `/chat` | 对话页 | 左侧会话列表（**同步后端 `/threads`**：置顶 / 改名 / 删除）+ 主聊天区；多轮会话（`thread_id`）；HITL 危险操作审批（允许/拒绝） |
| `/documents` | 文档库页 | PDF 多文件上传（异步解析）、文档列表、状态轮询、详情、**重分块**、删除 |

## 对接架构

```
浏览器 ──Vite dev proxy──► Agent :8001  (/api/auth/* /api/chat /api/approve /api/threads /health)
     └──────────────────► RAG   :8080  (/rag/api/v1/* 直连，带 X-API-Key + X-User-ID)
```

- **认证**：`/auth/register`、`/auth/login` 签发 JWT；登录态存 `localStorage`，Agent 请求自动携带 `Authorization: Bearer`，RAG 请求自动携带 `X-User-ID`。
- **对话页走 Agent**：多轮会话、会话管理（列/改名/置顶/删除）、HITL 审批都是 Agent 的职责。
- **文档库页直连 RAG**：Agent 当前没有暴露文档管理的 REST 端点（只有 LLM 工具），浏览器无法走"LLM 给文件路径"的上传流程，故前端直连 RAG 的文档 CRUD（携带当前登录用户 `user_id` 作为 `X-User-ID`）。
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
| `VITE_RAG_USER_ID` | 空 | RAG 用户身份兜底（`X-User-ID` 头）；登录后会优先用当前登录用户；未登录才回退。填 RAG 侧 `server.admin_users` 的用户 UUID 可让文档库页以管理员身份看全库 |

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
│   ├── client.ts     # Axios 实例（Agent / RAG）+ 统一错误处理 + 凭证注入拦截器
│   ├── authState.ts  # 认证状态（token / user 响应式 + localStorage 持久化）
│   ├── agent.ts      # Agent 全部接口：auth / chat / approve / threads / health
│   ├── rag.ts        # RAG 全部接口：health / documents CRUD / rechunk / search / connections / ask
│   ├── types.ts      # Agent 侧类型
│   └── ragTypes.ts   # RAG 侧类型
├── layouts/
│   └── MainLayout.vue   # 顶部导航 + 服务状态（Agent / RAG）+ 用户菜单
├── views/
│   ├── LoginView.vue    # 登录 / 注册页
│   ├── ChatView.vue     # 对话页（会话列表同步后端 /threads）
│   └── DocumentsView.vue # 文档库页（详情 / 重分块）
├── router/index.ts    # 路由 + 认证守卫
└── main.ts
```

## 接口覆盖对照（后端能力 ↔ 前端 API 层）

**Agent 服务（:8001）** — `src/api/agent.ts`：

| 端点 | 前端函数 |
|---|---|
| `POST /api/auth/register` | `register()` |
| `POST /api/auth/login` | `login()`（自动写入凭证） |
| `POST /api/chat` | `sendChat()` |
| `POST /api/approve` | `approveOperation()` |
| `GET /api/threads` | `listThreads()` |
| `PATCH /api/threads/:id` | `updateThread()` |
| `DELETE /api/threads/:id` | `deleteThread()` |
| `GET /health` | `checkAgentHealth()` |

**RAG 服务（:8080）** — `src/api/rag.ts`：

| 端点 | 前端函数 |
|---|---|
| `GET /api/v1/health` | `checkRagHealth()` |
| `GET /api/v1/documents` | `listDocuments()` |
| `GET /api/v1/documents/:id` | `getDocument()` |
| `POST /api/v1/documents` | `uploadDocuments()`（可带 `chunk_size` / `chunk_overlap`） |
| `POST /api/v1/documents/:id/rechunk` | `rechunkDocument()` |
| `DELETE /api/v1/documents/:id` | `deleteDocument()` |
| `POST /api/v1/search` | `search()` |
| `POST /api/v1/connections/test` | `testConnection()` |
| `POST /api/v1/ask`（仅管理员） | `ask()` |

## 已知边界 / 后续方向

- Agent 流式输出（SSE）上线后，对话页可接入打字机效果（目前为一次性返回）。
- Agent 未提供"读取会话历史消息"的端点：切换会话时消息内容取本地缓存（`localStorage`），换浏览器/清缓存后仅显示"服务端续接"提示，但继续提问仍会正确续接服务端上下文。
- 文档库删除经 Agent 代理以统一 HITL 审批。
- `/api/v1/ask` 为 RAG 内部测试接口（仅管理员、全局检索），前端 API 层已对齐但页面未暴露入口。
