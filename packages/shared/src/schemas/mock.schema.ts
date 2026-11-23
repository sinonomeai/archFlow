import { z } from "zod";
import { Id } from "./common.schema.js";
import { Conversation, Message } from "./conversation.schema.js";
import { MockStoredRun } from "./mock-run.schema.js";
import { AgentCheckpoint, AgentConstraints, AgentTurn } from "./orchestration.schema.js";
import { IdempotencyKey } from "./mock-auth.schema.js";
import {
  AssetBrief,
  CreateProjectInput,
  FileBrief,
  Project,
  ProjectNode,
} from "./project.schema.js";

/**
 * 开发期 mock 契约。
 *
 * 旧版示例资产仍使用带坐标的画布格式。Agent 预览生成的数据使用 GraphInput。
 */

export const MockGraphNodeKind = z.enum([
  "client",
  "gateway",
  "auth",
  "service",
  "worker",
  "database",
  "cache",
]);
export type MockGraphNodeKind = z.infer<typeof MockGraphNodeKind>;

export const MockGraphNode = z.object({
  id: Id,
  kind: MockGraphNodeKind,
  eyebrow: z.string(),
  label: z.string(),
  meta: z.string().nullable(),
  left: z.number().min(0).max(100),
  top: z.number().min(0).max(100),
});
export type MockGraphNode = z.infer<typeof MockGraphNode>;

export const MockGraphEdge = z.object({
  id: Id,
  path: z.string(),
});
export type MockGraphEdge = z.infer<typeof MockGraphEdge>;

export const MockGraph = z.object({
  nodes: z.array(MockGraphNode),
  edges: z.array(MockGraphEdge),
});
export type MockGraph = z.infer<typeof MockGraph>;

/** mock 库中的会话：真实会话字段 + 消息列表。 */
export const MockConversationRecord = Conversation.extend({
  messages: z.array(Message),
  runs: z.array(MockStoredRun).optional(),
  titleManuallySet: z.boolean().optional(),
  agentConstraints: AgentConstraints.optional(),
  pendingAgentTurn: z.object({
    runId: Id,
    assistantMessageId: Id,
    input: AgentTurn.shape.input,
    attachments: AgentTurn.shape.attachments,
    checkpoint: AgentCheckpoint,
  }).optional(),
});
export type MockConversationRecord = z.infer<typeof MockConversationRecord>;

/** mock 库中的知识库文件：在 FileBrief 上补 projectId 便于按项目聚合。 */
export const MockFileRecord = FileBrief.extend({
  projectId: Id,
});
export type MockFileRecord = z.infer<typeof MockFileRecord>;

/** mock 库中的架构资产：在 AssetBrief 上补 projectId 与固化时的画布快照。 */
export const MockAssetRecord = AssetBrief.extend({
  projectId: Id,
  graphData: MockGraph.nullable().default(null),
});
export type MockAssetRecord = z.infer<typeof MockAssetRecord>;

/** 开发期内存/文件库。旧数据缺少 files/assets 时按空数组兼容。 */
export const MockDatabase = z.object({
  projects: z.array(Project),
  projectCreations: z.array(z.object({
    key: IdempotencyKey,
    input: CreateProjectInput,
    project: ProjectNode,
    expiresAt: z.number(),
  })).default([]),
  files: z.array(MockFileRecord).default([]),
  assets: z.array(MockAssetRecord).default([]),
  conversations: z.array(MockConversationRecord),
});
export type MockDatabase = z.infer<typeof MockDatabase>;

/**
 * POST /api/mock/conversations/:id/messages 的响应数据。
 * 启用本地 Agent 时同步返回本轮结果。标题和推荐问题由后续读取取得。
 */
export const MockSendMessageResult = z.object({
  message: Message,
  assistantMessage: Message.optional(),
  conversation: Conversation.optional(),
  extrasPending: z.boolean().optional(),
});
export type MockSendMessageResult = z.infer<typeof MockSendMessageResult>;
