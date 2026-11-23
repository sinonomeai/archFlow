# ArchFlow (架构决策助手)

面向缺乏架构经验的学生和独立开发者的**约束驱动架构决策助手**。把模糊的项目 idea 转化为可调整、可沉淀、可复用的架构方案。

## 🎯 一、 MVP (最小可行性产品) 边界

**核心目标**：跑通“输入 Idea → AI 追问约束 → 生成架构图 → 用户微调 → 保存为资产”的端到端单机闭环。
**产品边界**：每个项目仅供其所有者使用。多人协作已退出产品路线，详见[架构规划](specs/架构规划.md#0-总览)。

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
3. **复杂 Agent 框架**：不引入 LangChain/LangGraph，采用手写状态机 + 原生 Function Calling。
4. **微服务拆分**：MVP 所有业务逻辑放在 NestJS 单体；post-MVP 只拆一个 Go 文档解析服务，不做整体微服务。

---

## 🚀 二、 技术栈 (纯原生白盒架构)

本项目追求极致的工程透明度，**抛弃了重型 AI 封装框架**，全部采用原生 API 和自研状态机。

### 🎨 前端 (apps/web)
- **核心框架**：Next.js (App Router)，本地工作台在浏览器恢复登录后加载项目与会话。
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
以下级联路由、计划与图补丁来自新编排实现，尚未接入正式 `/api/v1` 运行入口；正式服务目前仍使用原有的约束收集、设计复核与图生成流程。
- **意图识别**：同一个输入入口，按整句规则、意图样例向量、LLM 结构化判断依次匹配。向量层优先处理明确的读请求，模型结合近期消息、约束与画布补全复杂请求。
- **执行方式**：明确的单任务直接调用对应能力。复合任务先生成短计划，再按顺序执行。读写画布和查资料是显式能力，图数据经 `GraphInput` 校验后才提交。
- **澄清与恢复**：信息缺失时暂停，保留原任务和已知约束。下一条澄清回答从检查点继续。标题和推荐问题在答案结束后单独生成。
- **模型接入**：通过原生 OpenAI SDK 获取结构化结果并用 Zod 校验。解释、知识问答和通用聊天支持直接流式输出正文。业务状态、画布版本与项目资料由运行服务提供。

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
```

## 🌊 四、 正式 API 数据流摘要

以下是 `/api/v1` 的目标流程。完整契约见 [数据流](specs/数据流.md)。

认证与无感刷新：AccessToken 过期返回 `401 TOKEN_EXPIRED`。前端用 HttpOnly Cookie 里的 RefreshToken 静默刷新，成功后重发原请求一次。

冷启动与空状态：无项目返回空列表（`items: []`），前端渲染引导页；有项目则拉取 ProjectNode 树，并自动加载最近活跃的会话。

新建项目与会话：点击“新建项目”调 POST /api/v1/projects，成功后自动调 POST /api/v1/projects/:projectId/conversations 创建首个空会话；进入项目后，侧边栏“历史会话”右侧的 + 也会调用该接口为新会话创建空白画布。

SSE 流式推演：POST /api/v1/conversations/:conversationId/messages 返回 202 + runId，再用 GET /api/v1/runs/:runId/stream 取流；收到 run-start 建空气泡；依次接收 status、text-delta、graph 实时渲染；最后 done + [DONE] 结束。断线时用 `Last-Event-ID` 续传；缓冲失效后服务端按 `runId` 查库合成快照重放，前端再拉消息列表校准。

约束卡片交互：SSE 推 constraint-card，用户作答后调 POST /api/v1/conversations/:conversationId/messages/:messageId/answer，后端更新状态并推 card-updated，继续推流；重复提交幂等重放。

乐观锁防抖保存：拖拽画布防抖 3 秒后，带 baseVersion 调 PUT /api/v1/conversations/:conversationId/draft。版本不一致返回 409 冲突。

资产懒加载：保存资产不返回图；点击资产时调 GET /api/v1/projects/:projectId/assets/:assetId?includeGraph=true 懒加载渲染。

文件上传与解析：正式链路可解析 text 并用于项目 RAG；图片目前仅上传存储，caption 入库仍在 P1-04；pdf / docx 仅存储。Agent 只引用 ready 的文件。

历史分支与回溯：基于消息开启新分支，调 POST /api/v1/conversations/:conversationId/fork，后端物理复制历史记录并关联画布快照。

## 🛠️ 五、 快速开始

### 正式 API 工作台

准备 Node.js 20.12+、pnpm 9+、Docker。将根目录 `.env.example` 复制为 `.env` 并配置服务端变量。前端默认连接 `http://localhost:3001/api/v1`；其他地址设置 `NEXT_PUBLIC_API_BASE_URL`。从仓库根目录启动，使用终端给出的 Web 地址访问。

```sh
pnpm install
docker compose up -d
pnpm db:migrate
pnpm dev
```

正式工作台已有注册登录、项目和会话、文件上传与文本入库、消息 SSE、约束卡片、架构图、布局保存、资产与历史分支。上游的本地验证见 [MVP 主链路实现记录](specs/问题记录/2026-11-13-MVP主链路实现.md)。新编排的多意图执行、图补丁和历史图引用尚需与这条正式链路整合。

### 隔离的本地预览

将 `MOCK_API=1` 写入 `apps/web/.env.local`，运行 `pnpm dev:web`。此时同一工作台路径使用同源 `/api/mock`，不需要启动 NestJS；请使用独立账号和数据目录，避免把预览结果当作正式 API 验收。默认使用固定响应，数据保存在 Web 应用的 `.mock` 目录。设置 `ARCHFLOW_MOCK_DIR` 可指定独立目录。复测步骤见 [接手说明](specs/Agent架构讨论交接.md#5-本地体验与正式验收)。

### 真实模型预览

在隔离预览的基础上，把以下服务端变量写入 `apps/web/.env.local`，再启动 `pnpm dev:web`。

```dotenv
MOCK_API=1
ARCHFLOW_PREVIEW_AGENT=1
OPENAI_API_KEY=你的模型服务密钥
OPENAI_MODEL=支持 JSON 对象输出和流式对话的模型名
# 使用 OpenAI 兼容服务时设置，例如 https://你的服务/v1
OPENAI_BASE_URL=
# 配置后启用意图样例向量匹配
OPENAI_EMBEDDING_MODEL=
```

预览沿用 Mock 登录、数据与 SSE。完成一张图后发送「解释当前架构图」，可体验模型正文逐段返回。生成和修改图时先校验结构化结果。预览环境目前没有接入正式项目资料检索；上传、入库和检索应走正式 API 并按 [AC7](specs/mvp.md#ac7-根据项目资料回答) 验收。

### 本地生产构建预览

运行 `pnpm build:web`，然后用 `MOCK_API=1 pnpm start:web` 启用本地 Mock。PowerShell 可运行 `$env:MOCK_API='1'; pnpm start:web`。若生产构建需要在客户端选择预览入口，应在构建时也配置该变量；以最终客户端路由实现为准。部署正式服务时不要设置 `MOCK_API`。

### 后端开发环境

模型变量与服务配置见根目录 `.env.example`。单独开发 API 时：

```sh
docker compose up -d
pnpm db:migrate
pnpm dev:api
```

Compose 启动 PostgreSQL、Redis 和 MinIO。新编排与正式接口的整合进度见 [待做清单](specs/待做清单.md)。

Compose 的 MinIO 使用 `bitnamilegacy/minio:latest` 供本地开发。

## 👥 六、 团队协作规范
主干开发：main 分支始终可运行。每次 push 走 PR，至少 1 人 Review 才能合并。

契约驱动：所有接口字段必须先改 packages/shared 里的 Zod Schema，再改代码。

决策记录：工程问题记录到 `specs/DECISIONS.md`，架构演进与服务边界记录到 `specs/架构规划.md`，可执行事项记录到 `specs/待做清单.md`。
