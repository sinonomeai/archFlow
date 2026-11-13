import { z } from "zod";
import { FinishReason, Id, ISODateTime, RunStatus } from "./common.schema.js";
import { ConstraintCard } from "./conversation.schema.js";

/** 运行失败明细：code 是 §1.5 的常量表，message 只承载展示文案。 */
export const RunError = z.object({
  code: z.string(),
  message: z.string(),
});
export type RunError = z.infer<typeof RunError>;

/** 一次 agent 运行（§6.3）：状态与结束原因均走枚举，未知值解析即失败。 */
export const Run = z.object({
  id: Id,
  conversationId: Id,
  userMessageId: Id,
  assistantMessageId: Id,
  status: RunStatus,
  finishReason: FinishReason.nullable(),
  createdAt: ISODateTime,
  finishedAt: ISODateTime.nullable(),
  error: RunError.nullable(),
});
export type Run = z.infer<typeof Run>;

/* ───────────────────────── HITL 中断（§5.1） ───────────────────────── */

/** 中断类型：澄清、副作用审批、结果复核。 */
export const InterruptKind = z.enum(["clarification", "approval", "review"]);
export type InterruptKind = z.infer<typeof InterruptKind>;

/**
 * 中断载荷：MVP 只用 clarification + 约束卡片。
 * approval / review 先保留结构，post-MVP 再扩展。
 */
export const InterruptPayload = z.object({
  question: z.string().optional(),
  /** clarification 对应的约束字段，resume 时按此字段回写。 */
  field: z.string().optional(),
  card: ConstraintCard.optional(),
  toolName: z.string().optional(),
  toolArguments: z.record(z.string(), z.unknown()).optional(),
  /** 架构生成后的设计取舍追问轮次（持久化到 runs.metadata）。 */
  designRounds: z.number().int().nonnegative().optional(),
});
export type InterruptPayload = z.infer<typeof InterruptPayload>;

/**
 * HITL 中断：落 `runs.metadata.interrupt`，重连时从库里重放。
 */
export const Interrupt = z.object({
  interruptId: Id,
  kind: InterruptKind,
  node: z.string().min(1).max(50),
  payload: InterruptPayload,
  expiresAt: ISODateTime,
});
export type Interrupt = z.infer<typeof Interrupt>;

/** runs.metadata 的内部结构；不直接暴露给前端。 */
export const RunMetadata = z.object({
  interrupt: Interrupt.nullable().optional(),
  /** 已执行过的工具调用 ID，恢复时用于幂等跳过。 */
  executedToolCalls: z.array(z.string()).optional(),
  resumeCount: z.number().int().nonnegative().optional(),
  traceId: z.string().optional(),
  resume: z.boolean().optional(),
  /** 已完成的架构后设计取舍轮次。 */
  designRounds: z.number().int().nonnegative().optional(),
});
export type RunMetadata = z.infer<typeof RunMetadata>;

/* ───────────────────────── 运行阶段与受理响应（§5.1 / §5.2） ───────────────────────── */

/** 生成阶段（§5.2 的 status 帧）。 */
export const RunStage = z.enum([
  "thinking",
  "searching_knowledge",
  "drafting_graph",
  "finalizing",
]);
export type RunStage = z.infer<typeof RunStage>;

/**
 * SSE 地址的唯一生成入口（§5.1）：服务端按 runId 拼出，前端必须原样使用。
 * 不允许前端自行拼接——反代 / 网关可能改写前缀。
 */
export const runStreamUrl = (runId: string): string =>
  `/api/v1/runs/${runId}/stream`;

/** 服务端生成的流地址；解析响应时只校验形态，不信任客户端传入。 */
const StreamUrl = z
  .string()
  .regex(
    /^\/api\/v1\/runs\/[A-Za-z0-9_-]+\/stream$/,
    "streamUrl 由服务端按 runId 生成",
  )
  .describe("SSE 地址（服务端生成）");

/** 受理响应（§5.1 的 202）。 */
export const RunAccepted = z.object({
  runId: Id,
  userMessageId: Id,
  assistantMessageId: Id,
  streamUrl: StreamUrl,
  status: RunStatus,
});
export type RunAccepted = z.infer<typeof RunAccepted>;

/** 取消响应（§5.4）：取消是异步的，返回当前状态。 */
export const CancelResult = z.object({
  runId: Id,
  status: RunStatus,
});
export type CancelResult = z.infer<typeof CancelResult>;
