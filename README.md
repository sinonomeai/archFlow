# ArchFlow (架构决策助手)

面向缺乏架构经验的学生和独立开发者的**约束驱动架构决策助手**。把模糊的项目 idea 转化为可调整、可沉淀、可复用的架构方案。

## 🎯 一、 MVP (最小可行性产品) 边界

**核心目标**：跑通“输入 Idea → AI 追问约束 → 生成架构图 → 用户微调 → 保存为资产”的端到端单机闭环。
**核心原则**：追求极致的流程闭环与代码透明度，绝不提前做高并发、多端协作等非核心功能。

### ✅ MVP 必须要做的功能：
1. **Auth 认证**：邮箱密码登录、注册，基于 Redis 的双 Token 无感刷新。
2. **侧边栏管理**：新建项目、项目树渲染，支持新建 / 重命名 / 删除会话，以及删除项目、知识库文件与资产；当无项目时显示全局引导页（Empty State）。
3. **Agent 对话**：原生 SSE 流式输出，大模型基于约束推演方案，并抛出交互卡片。
4. **卡片交互**：用户点选卡片（支持自定义输入）后原地变灰，Agent 继续推流。
5. **React Flow 画布**：渲染图数据，支持拖拽、Dagre 自动布局、防抖乐观锁保存；已支持数据库表节点与数据流边（同步/异步/数据/控制）。MVP 不包含节点/边内容编辑，后续规划见 [`specs/架构规划.md`](specs/架构规划.md) §13。
6. **基础 RAG**：支持上传 `.md` / `.txt` 文件，后端切片存入 `pgvector`，Agent 能基于文档回答；图片可解析并生成 caption（caption 入 RAG 为 P1）。
7. **资产与回溯**：保存当前画布为资产；基于历史消息恢复快照或物理复制开启新分支。

### ❌ MVP 明确**不做**的功能：
1. **重格式解析**：PDF / DOCX 仅上传存储、不解析；图片属于 MVP 范围，可上传并解析（以 `specs/mvp.md` 与 API 能力矩阵为准）。
2. **异步队列**：MVP 不使用 BullMQ / RabbitMQ，纯靠 Node 异步流直推；post-MVP 统一用 RabbitMQ，不引入 BullMQ。
3. **多人协作**：不引入 WebSocket/Yjs 实时同步。
4. **复杂 Agent 框架**：不引入 LangChain/LangGraph，采用手写状态机 + 原生 Function Calling。
5. **微服务拆分**：MVP 所有业务逻辑放在 NestJS 单体；post-MVP 只拆一个 Go 文档解析服务，不做整体微服务。

---

## 🚀 二、 技术栈 (纯原生白盒架构)

本项目追求极致的工程透明度，**抛弃了重型 AI 封装框架**，全部采用原生 API 和自研状态机。

### 🎨 前端 (apps/web)
- **核心框架**：Next.js (App Router) —— 利用 SSR 做首屏骨架与中间件鉴权。
- **样式与 UI**：Tailwind CSS + Shadcn/ui + 系统字体栈。
- **状态管理**：Zustand (客户端状态) + TanStack Query (服务端状态与缓存、乐观更新)。
- **分屏布局**：`react-resizable-panels` (会话区与画布区可拖拽调节宽度，布局比例通过 `autoSaveId` 自动持久化)。
- **核心画布**：React Flow (`@xyflow/react`) + Dagre (计算节点坐标自动布局)。
- **流式通信**：`@microsoft/fetch-event-source` (基于 fetch，可带 Authorization 与 `Last-Event-ID`，支持断线重试；不手写 SSE 解析，无 AI SDK 依赖)。
- **契约校验**：Zod (表单验证 + SSE 事件流解析校验)。

### ⚙️ 后端 (apps/api)
- **核心框架**：NestJS (ESM 规范) + TypeORM (ORM)。
- **数据库**：PostgreSQL + pgvector (存关系型业务数据与向量检索)。
- **缓存与凭证**：Redis (存双 Token 无感刷新状态、防刷限流)。
- **对象存储**：MinIO (兼容 S3 协议，存用户上传的文本 / 图片 / PDF / DOCX 文件)。
- **模型接入**：OpenAI 兼容 Node.js SDK 直连模型接口；主链路用 DeepSeek chat，图片理解与 Embedding 用千问；`packages/agent/src/llm/` 做 Provider 适配，不绑定单一供应商。
- **接口安全**：全局 Zod 验证管道、全局异常过滤器 (ErrorResponse)、TraceId 链路追踪。

### 🧠 Agent 核心引擎 (packages/agent)
- **流程控制**：自研手写 `while` 循环 / 状态机 (完全抛弃 LangChain/LangGraph)。
- **交互机制**：原生 Function Calling + Zod 强约束输出 (确保大模型返回 100% 合法的 JSON)。
- **干预机制**：基于 `interrupt` 理念的 HITL (Human-in-the-Loop) 强制阻断与断点恢复机制。
- **记忆组织**：滑动窗口截断 + `agent_states` 结构化状态注入；MVP 不做滚动摘要，避免把“记忆”做成不可控的黑盒。

### 🏗️ 基础设施与工程化 (Infra & DevOps)
- **包管理与构建**：pnpm Workspaces + Turborepo (Monorepo 架构)。
- **本地基础设施**：Docker Compose (一键拉起 PostgreSQL + Redis + MinIO)。
- **生产环境部署**：
  - **服务器**：自有云服务器 (Linux)。
  - **容器化**：前后端及基础设施全部使用 Docker 打包。
  - **反向代理**：Nginx (负责静态资源分发、HTTPS 证书配置、以及为 SSE 配置长连接 `proxy_read_timeout`)。
  - **CI/CD**：GitHub Actions (通过 SSH 自动拉取代码并执行 `docker compose up -d --build`)。
- **测试体系**：Vitest (前后端统一) + Supertest (后端接口测试)。
- **未来扩展（post-MVP）**：RabbitMQ + 一个 Go 文档解析服务；只拆专用计算服务，不引入 BullMQ，不做整体微服务。

---

## 📁 三、 Monorepo 结构 (Turborepo + pnpm)

```text
arch-flow/
├── .agents/                        # AI 辅助开发用的 Skill 配置
├── apps/
│   ├── web/                        # 【Next.js 前端】
│   │   ├── app/                    # 页面路由 (登录、工作台)
│   │   ├── components/
│   │   │   ├── workspace/
│   │   │   │   ├── sidebar/        # 侧边栏、项目树、会话列表
│   │   │   │   ├── chat/           # 聊天区、约束卡片
│   │   │   │   ├── canvas/         # React Flow 画布
│   │   │   │   └── workspace-view.tsx  # 可拖拽分屏容器
│   │   │   ├── project/            # 项目创建入口
│   │   │   └── ui/                 # Shadcn/ui 基础组件
│   │   ├── hooks/                  # TanStack Query 数据钩子
│   │   ├── lib/
│   │   │   ├── sse-client.ts       # ★ SSE 连接封装 (@microsoft/fetch-event-source)
│   │   │   ├── api-client.ts       # 全局 Fetch 封装与契约校验
│   │   │   └── mock-*.ts           # 本地 Mock 数据层
│   │   ├── store/                  # Zustand 全局状态
│   │   └── package.json
│   └── api/                        # 【NestJS 后端】
│       ├── src/
│       │   ├── modules/            
│       │   │   ├── auth/           # 认证 (双 Token)
│       │   │   ├── project/        # 项目树骨架
│       │   │   ├── conversation/   # 会话、消息、草稿
│       │   │   ├── run/            # Agent 任务生命周期
│       │   │   ├── file/           # 文件解析 (MinIO)
│       │   │   └── asset/          # 架构资产
│       │   ├── common/             # 全局异常过滤器、Zod 验证
│       │   └── main.ts
│       └── package.json
├── packages/
│   ├── agent/                      # 【Agent 核心引擎】
│   │   ├── src/
│   │   │   ├── engine.ts           # ★ 手写 while 循环 / 状态机
│   │   │   ├── state.ts            # 约束与画布状态
│   │   │   ├── tools/              # 原生工具 (查 pgvector)
│   │   │   ├── prompts/            # 手写系统提示词
│   │   │   └── llm/                # 原生 SDK 封装
│   │   └── package.json
│   ├── db/                         # 【数据库层】
│   │   ├── src/
│   │   │   ├── entities/           # TypeORM 实体 (9 张核心表)
│   │   │   └── migrations/         # 迁移脚本
│   │   └── package.json
│   └── shared/                     # 【前后端共享契约】
│       ├── src/
│       │   └── schemas/            # ★ Zod Schema
│       └── package.json
├── specs/                          # 团队开发文档 (API、数据流、DB)
├── docker-compose.yml              # 本地跑 PG / Redis / MinIO
├── turbo.json
├── pnpm-workspace.yaml
└── package.json
🌊 四、 核心数据流摘要 (Data Flow)
系统包含 9 条核心链路，前后端严格遵循契约：

认证与无感刷新：AccessToken 过期返回 401，前端拦截器暂停请求，用 httpOnly Cookie 里的 RefreshToken 静默刷新后重发请求。

冷启动与空状态：无项目返回空列表（`items: []`），前端渲染引导页；有项目则拉取 ProjectNode 树，并自动加载最近活跃的会话。

新建项目与会话：点击“新建项目”调 POST /api/v1/projects，成功后自动调 POST /api/v1/projects/:projectId/conversations 创建首个空会话；进入项目后，侧边栏“历史会话”右侧的 + 也会调用该接口为新会话创建空白画布。

SSE 流式推演：POST /api/v1/conversations/:conversationId/messages 返回 202 + runId，再用 GET /api/v1/runs/:runId/stream 取流；收到 run-start 建空气泡；依次接收 status、text-delta、graph 实时渲染；最后 done + [DONE] 结束。断线时用 `Last-Event-ID` 续传；缓冲失效后服务端按 `runId` 查库合成快照重放，前端再拉消息列表校准。

约束卡片交互：SSE 推 constraint-card，用户作答后调 POST /api/v1/conversations/:conversationId/messages/:messageId/answer，后端更新状态并推 card-updated，继续推流；重复提交幂等重放。

乐观锁防抖保存：拖拽画布防抖 3 秒后，带 baseVersion 调 PUT /api/v1/conversations/:conversationId/draft。版本不一致返回 409 冲突。

资产懒加载：保存资产不返回图；点击资产时调 GET /api/v1/projects/:projectId/assets/:assetId?includeGraph=true 懒加载渲染。

文件上传与解析：上传后 text / image 进入解析（processing → ready / failed），pdf / docx 直接 stored；Agent 只引用 ready 的文件。

历史分支与回溯：基于消息开启新分支，调 POST /api/v1/conversations/:conversationId/fork，后端物理复制历史记录并关联画布快照。

🛠️ 五、 快速开始
1. 环境准备
确保已安装 Node.js 20.12+、pnpm 9+ 和 Docker。

2. 启动本地基础设施
bash
docker compose up -d
(将启动 PostgreSQL + pgvector、Redis、MinIO)

> 官方 `minio/minio` 已从 Docker Hub 移除，Compose 改用 `bitnamilegacy/minio:latest`，仅用于本地开发。

3. 安装依赖
bash
pnpm install
4. 配置环境变量
分别在各应用目录下创建 .env 文件：

apps/api/.env (DB URL、JWT_SECRET、Redis 配置、OPENAI_API_KEY)

apps/web/.env (后端 API 地址)

5. 初始化数据库（首次启动或新增迁移后）
bash
pnpm db:migrate

6. 启动开发环境
bash
pnpm dev          # 前后端一起启动
pnpm dev:web      # 只启动前端
pnpm dev:api      # 只启动后端（连带 agent/db/shared 的 watch）

> 本地 production 预览（Mock API）：
> `pnpm --filter @arch-flow/web build`，然后 `MOCK_API=1 pnpm --filter @arch-flow/web start`。
> PowerShell 用 `$env:MOCK_API='1'; pnpm --filter @arch-flow/web start`；线上部署不要设置 `MOCK_API`。
👥 六、 团队协作规范
主干开发：main 分支始终可运行。每次 push 走 PR，至少 1 人 Review 才能合并。

契约驱动：所有接口字段必须先改 packages/shared 里的 Zod Schema，再改代码。

决策记录：工程问题记录到 `specs/DECISIONS.md`，架构演进与服务边界记录到 `specs/架构规划.md`，可执行事项记录到 `specs/待做清单.md`。