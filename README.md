# paper-rag-fronted

论文 RAG 助手的**前端页面**。对接 `paper-rag-agent`（Agent 编排层）与 `paper-rag-backend`（RAG 能力层）两个后端服务。

技术栈：**Vue 3 + Vite + TypeScript + Element Plus**（Vue Router 4 / Axios）。

> **生产部署**：已容器化（`Dockerfile`：Node 构建 dist → Nginx 托管 + 反代 `/api`、`/health` 到 agent）。
> 完整编排在 [paper-rag-deploy](https://github.com/Lchy2333/paper-rag-deploy) 仓，`docker compose up -d --build` 一键拉起。
> BFF 改造后前端零直连 RAG，Nginx 只认 agent 一个上游，无 `/rag` 反代规则。

## 页面

| 路由 | 页面 | 说明 |
|---|---|---|
| `/login` | 登录 / 注册页 | 注册或登录获取 JWT；会话与文档按用户隔离 |
| `/chat` | 对话页 | 左侧会话列表（**同步后端 `/threads`**：置顶 / 改名 / 删除）+ 主聊天区；多轮会话（`thread_id`）；**SSE 流式输出**（阶段进度 + 逐字打字机 + 随时停止 + **token 用量展示**）；HITL 危险操作审批（允许/拒绝） |
| `/documents` | 文档库页 | PDF 多文件上传（异步解析）、文档列表、状态轮询、详情、**重分块**、删除 |

## 对接架构

```
浏览器 ──Vite dev proxy──► Agent :8001  （唯一入口）
     /api/auth/* /api/chat /api/approve /api/threads   → 对话/会话/审批
     /api/documents/*                                   → 文档管理（BFF 转发 RAG）
     /health                                            → 分层健康检查（含 db/rag/llm 状态）
```

- **认证**：`/auth/register`、`/auth/login` 签发 JWT；登录态存 `localStorage`，所有请求自动携带 `Authorization: Bearer`。
- **对话页走 Agent**：多轮会话、会话管理（列/改名/置顶/删除）、HITL 审批都是 Agent 的职责。
- **文档库页经 Agent 转发（BFF）**：文档 CRUD 走 Agent 的 `/api/documents/*`，由 Agent 注入可信 `X-User-ID`（从 JWT 验签）+ `X-API-Key`（服务端持有）再转发 RAG。**前端不再直连 RAG、不持有任何 RAG 密钥**。
- **健康状态读 Agent**：顶栏状态灯全部来自 `/health` 的 `checks`（database / rag / llm 各自 ok/error/unknown），前端零直连。
- 开发环境通过 Vite 代理避免跨域（Agent 未配 CORS 中间件）；生产构建需在 Nginx 层做同样转发。

> ✅ **安全改进（BFF）**：前端不再携带 `X-API-Key`（避免打进 bundle 泄露），也无法伪造 `X-User-ID`（由 Agent 从 JWT 注入可信身份）。文档删除经 Agent 转发 + `audit_logs` 留痕。

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
| `VITE_AGENT_BASE_URL` | `http://localhost:8001` | Agent 服务地址（唯一入口，Vite dev proxy 转发目标） |

> ⚠️ 前端只连 Agent（BFF）：不持有 RAG 密钥、不直连 RAG，因此 **不再需要 `VITE_RAG_BASE_URL` / `VITE_RAG_API_KEY` / `VITE_RAG_USER_ID`**（历史版本有，已移除）。

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

**Agent 服务（:8001，唯一入口）** — `src/api/agent.ts`：

| 端点 | 前端函数 |
|---|---|
| `POST /api/auth/register` | `register()` |
| `POST /api/auth/login` | `login()`（自动写入凭证） |
| `POST /api/chat` | `sendChat()`（一次性，兼容） |
| `POST /api/chat/stream` | `streamChat()`（**SSE 流式**：session/usage/stage/token/approval/cancel/done/error 回调） |
| `POST /api/chat/cancel` | `cancelChat()`（**停止生成**，与停止按钮/AbortController 配合） |
| `POST /api/approve` | `approveOperation()` |
| `GET /api/threads` | `listThreads()` |
| `GET /api/threads/:id/usage` | `getThreadUsage()`（切换会话时恢复用量 + 上下文环） |
| `PATCH /api/threads/:id` | `updateThread()` |
| `DELETE /api/threads/:id` | `deleteThread()` |
| `GET /health` | `checkAgentHealth()`（分层健康检查，含 db/rag/llm 状态） |

**文档管理（经 Agent BFF 转发 RAG）** — `src/api/rag.ts`：

| 前端路径（Agent） | 转发目标（RAG） | 前端函数 |
|---|---|---|
| `GET /api/documents` | `GET /api/v1/documents` | `listDocuments()` |
| `GET /api/documents/:id` | `GET /api/v1/documents/:id` | `getDocument()` |
| `POST /api/documents` | `POST /api/v1/documents` | `uploadDocuments()`（可带 `chunk_size` / `chunk_overlap`） |
| `POST /api/documents/:id/rechunk` | `POST /api/v1/documents/:id/rechunk` | `rechunkDocument()` |
| `DELETE /api/documents/:id` | `DELETE /api/v1/documents/:id` | `deleteDocument()` |

> `search` / `testConnection` / `ask` 已从前端 API 层移除（无页面调用方；检索由 Agent 的 LLM 工具 `search_rag` 提供，ask/test 属 RAG 内部能力）。

## 已知边界 / 后续方向

- **流式输出 ✅ 已接入（2026-10）**：对话页走 `/api/chat/stream`（`fetch` + `ReadableStream` 逐事件解析）——阶段进度行（进行中闪烁点 / 完成变绿色对号）+ 逐字打字机 + 红色停止按钮（`/api/chat/cancel` + 3s 兜底 abort）。已修复两个关键坑：① `pushMessage` 必须返回 Vue 响应式代理（否则流式回调改原始对象不触发重绘，内容一次性出现）；② `nginx.conf` `/api/` 需关 `proxy_buffering`（否则 SSE 被缓冲、失去逐字效果）。
- **Token 用量展示 ✅ 已接入（2026-10）**：消费 `event: usage`——每条回复下方显示"本次消耗 X tokens · N 次模型调用"（`query_total` / `calls`），底部输入栏右侧显示"本会话已用 X tokens"（`session_total`，流式中逐轮增长）。切换会话时以服务端 `GET /api/threads/:id/usage` 为准恢复（`query_usage` 表累计）。
- **上下文占用指示器 ✅ 已接入（2026-10）**：底部输入栏右侧的 16px 环形进度 + 百分比（`ctx-meter`），数据来自 `event: usage` 的 `context_ratio`（= `context_used` 最近一轮 input / `context_budget` 输入预算）。配色三档：<60% 常规主色 / 60–85% `--prf-warning` / >85% `--prf-danger`；悬停 `title` 显示 `已用 / 预算（输入预算口径，模型窗口 X）`。`context_ratio` 为 `null`（未调用模型或预算未知）时不渲染；切换会话时调 `GET /api/threads/:id/usage` 恢复（`last_input_tokens` 水位已落库，带 `currentSessionId` 竞态守卫，拉取失败则保持隐藏、等下一次 usage 事件覆盖）；新建会话复位。
- Agent 未提供"读取会话历史消息"的端点：切换会话时消息内容取本地缓存（`localStorage`），换浏览器/清缓存后仅显示"服务端续接"提示，但继续提问仍会正确续接服务端上下文。
- 文档删除已改为经 Agent 转发 + `audit_logs` 留痕（前端确认框 + Agent 审计）；Chat 场景删除仍走 Agent 的 HITL 审批。
- `/api/v1/ask` 为 RAG 内部测试接口（仅管理员、全局检索），前端不暴露、也不经 Agent 转发。
