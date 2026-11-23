# AGENTS.md - ArchFlow 项目 AI 开发规范

> **给所有 AI 编码助手的最高指令：**
> 本项目是一个纯原生（Zero-AI-Framework）的 AI 架构决策助手。在生成任何代码之前，请务必严格遵守以下规范，绝对不要引入 LangChain、Vercel AI SDK 等重框架。

## 1. 核心架构原则
- **契约驱动**：所有前后端的数据结构，必须以 `packages/shared/src/schemas/` 里的 Zod Schema 为唯一真理。严禁手写 Interface 或 `any`。字段长度、格式、枚举取值同样只在这里定义，API 文档不重复数值。
- **零重型 AI 框架**：`packages/agent` 内必须手写大模型请求和状态机流转。直接使用原生的 OpenAI Node.js SDK，服务端推流使用原生的 SSE（Server-Sent Events），客户端统一用 `@microsoft/fetch-event-source` 消费。
- **状态外置**：Agent 的记忆（当前收集的约束、当前画布状态）不能只存在内存里，必须通过 `agent_states` 表持久化，以便断点恢复。
- **服务边界**：MVP 保持模块化单体；post-MVP 只拆一个 Go 文档解析服务，异步任务统一用 RabbitMQ，不引入 BullMQ，不做整体微服务。
- **多包联动**：Monorepo 的包引用必须使用 `workspace:*`，跨包引用的类型必须来自 `@arch-flow/shared`。
- **断线恢复以数据库为准**：SSE 断开不终止 run；生成过程中节流写入 `messages.content`，事件缓冲（MVP 进程内存，10 分钟）只用于逐帧重放；缓冲失效时按 `runId` 从 `runs` / `messages` 合成快照重放。

## 2. 通用代码编写规范 (TypeScript)
- **函数定义**：全局强制使用 **箭头函数 (Arrow Functions)**，禁止使用 `function` 关键字声明函数。
  - 正确：`export const fetchData = async () => { ... }`
  - 错误：`export async function fetchData() { ... }`
- **变量作用域（内聚）**：对于只在某函数内部使用的“关键变量、中间件配置、实例”，必须**直接定义在该函数内部**，禁止毫无意义地提升到模块顶层（除非是全局单例或常量）。
- **类型声明**：绝对禁止使用 `any`。如果类型未知，使用 `unknown` 并进行类型收窄。
- **异步处理**：统一使用 `async/await`，避免使用裸的 `.then().catch()` 链式调用。
- **命名规范**：
  - 变量/函数：`camelCase` (如 `handleSendMessage`)
  - 类/类型/组件：`PascalCase` (如 `AgentState`, `ChatPanel`)
  - 数据库字段：`snake_case` (如 `created_at`)
  - 常量/枚举：`UPPER_SNAKE_CASE` (如 `ERROR_CODES`)

## 3. 目录结构与职责边界
- `apps/web`：只负责 UI 渲染（React Flow、Shadcn）、Zustand 状态管理、SSE 原生流解析和 Fetch 请求。
- `apps/api`：只负责 HTTP 路由、鉴权（双 Token）、数据库 CRUD、调用 `packages/agent`。
- `packages/agent`：负责所有与 LLM 相关的逻辑（拼装 Prompt、手写 while 循环、Tool Calling、Zod 强约束输出）。
- `packages/db`：只存放 TypeORM 实体和迁移脚本。
- `packages/shared`：所有 Zod Schema 和前后端共享的常量。

## 4. 前后端技术栈与规范
- **前端**：Next.js (App Router), Tailwind CSS, Shadcn/ui。**严禁使用 `@ai-sdk/react` 的 `useChat` 钩子**；SSE 消费统一使用 `@microsoft/fetch-event-source` 封装（参考 `apps/web/lib/sse-client.ts`），**不得使用原生 `EventSource`**。
- **导出规范（前端）**：所有导出必须在声明处使用命名式导出（`export const X = ...` / `export type X = ...`），不得在文件末尾集中写 `export { X }`，禁止 `export default`；仅 Next.js / 构建工具约定必须默认导出的文件（如 `page.tsx`、`layout.tsx`、`next.config.ts`）例外。
- **后端**：NestJS (ESM), TypeORM。Controller 内部不要写大量 `try-catch`，抛出异常交由全局过滤器处理。
- **验证**：所有 Controller 的入参必须使用 `ZodValidationPipe` 校验。
- **错误处理**：统一使用 `ApiResponseSchema` 外壳返回 `{ code, message, data, errors?, traceId }`；失败时 `data` 为 `null`，`code` 取 `ERROR_CODES` 的大写常量。

## 5. 数据库核心规范
- **内外键分离**：所有表的主键必须是内部自增的 `BIGINT`（命名为 `id`），对外暴露的必须是 `UUID`（命名为 `uuid`）。
- **乐观锁**：画布草稿保存（`PUT /api/v1/conversations/:conversationId/draft`）必须带 `baseVersion`，版本不一致必须返回 `409 DRAFT_VERSION_CONFLICT`。
- **JSONB 应用**：画布数据（API 字段 `graph`；资产列 `graph_data`，会话草稿列 `current_draft_graph`）、消息元数据（`metadata`）、Agent 状态（`constraints_data`）必须使用 `JSONB` 类型存储。
- **向量检索**：`documents_chunks` 表默认包含 `VECTOR(1536)` 字段，并使用 HNSW 索引。若所选 Embedding 模型不支持 1536 维，必须在灌入数据前统一改 schema，禁止新旧维度混用。查向量时**必须带上 `project_id` 过滤**，防止跨项目数据污染。

## 6. 不实现的功能（产品与 MVP 边界）
- ❌ 多人协作已退出产品路线：不做项目成员、项目角色或多人实时编辑，不用 WebSocket / Yjs 做画布同步。保留项目所有者校验与草稿版本检查。
- ❌ 不要写 PDF / DOCX 的解析逻辑（仅上传存储，不可被 Agent 引用）。图片（`image`）属于 MVP 范围，可上传可解析。
- ❌ 不要引入 Redis 队列（BullMQ）处理异步任务。
- ❌ 不要在 MVP 中生成 RabbitMQ / Go 文档解析服务代码；它们是 post-MVP 扩展，见 `specs/架构规划.md`。
- ❌ 不要使用 LangGraph 或 LangChain。

## 7. 常用命令
- 安装依赖：`pnpm install`
- 本地启动基础设施：`docker compose up -d`
- 同时启动前后端：`pnpm dev`
- 仅启动前端：`pnpm dev:web`
- 仅启动后端（连带 agent/db/shared 的 watch）：`pnpm dev:api`
- 仅启动 agent 包：`pnpm dev:agent`
- 测试：Vitest（前后端统一）+ Supertest（后端接口）；`pnpm test` 已接入，接口测试随 P0-11 补

---
*如果对某个具体业务流有疑问，请优先阅读 `specs/数据流.md`、`specs/API文档/`（接口契约）、`specs/架构规划.md`（架构边界）和 `specs/待做清单.md`（执行优先级）；工程问题排查见 `specs/DECISIONS.md`，不要自己瞎猜。*
