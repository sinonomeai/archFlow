import { z } from "zod";
import { Interrupt, Run, RunAccepted, RunStage } from "./agent.schema.js";
import { Count, Id, TraceId } from "./common.schema.js";
import { Message, SendMessageInput } from "./conversation.schema.js";
import { IdempotencyKey } from "./mock-auth.schema.js";
import { AgentResume } from "./orchestration.schema.js";
import { SSE_DONE, SseFrame } from "./sse.schema.js";

export const MockSendMessageInput = SendMessageInput.extend({
  interruptId: z.uuid().optional(),
}).strict();
export type MockSendMessageInput = z.infer<typeof MockSendMessageInput>;

export const MockStreamCursor = z
  .string()
  .regex(/^(0|[1-9][0-9]*)$/)
  .transform(Number)
  .pipe(Count);

export const mockRunStreamUrl = (runId: string): string =>
  `/api/mock/runs/${runId}/stream`;

export const MockRunAccepted = RunAccepted.extend({
  streamUrl: z.string().regex(/^\/api\/mock\/runs\/[A-Za-z0-9_-]+\/stream$/),
});
export type MockRunAccepted = z.infer<typeof MockRunAccepted>;

export const MockActiveRun = z.object({
  run: MockRunAccepted.nullable(),
  latest: MockRunAccepted.nullable(),
});
export type MockActiveRun = z.infer<typeof MockActiveRun>;

export const MockRunSnapshot = z.object({
  run: Run,
  assistantMessage: Message,
  stage: RunStage.nullable(),
});
export type MockRunSnapshot = z.infer<typeof MockRunSnapshot>;

export const MockSseFrame = z.union([
  MockRunSnapshot.extend({ type: z.literal("snapshot") }),
  SseFrame,
]);
export type MockSseFrame = z.infer<typeof MockSseFrame>;

export const parseMockSseData = (raw: string): MockSseFrame | null =>
  raw === SSE_DONE ? null : MockSseFrame.parse(JSON.parse(raw) as unknown);

export const MockStoredRun = Run.extend({
  traceId: TraceId,
  cursor: Count,
  stage: RunStage.nullable(),
  workerId: Id.nullable(),
  attachments: SendMessageInput.shape.attachments.unwrap(),
  graphReferenceMessageId: SendMessageInput.shape.graphReferenceMessageId,
  receipts: z.array(z.object({ key: IdempotencyKey, hash: z.string() })),
  answeredInterrupts: z
    .array(
      z.object({
        id: z.uuid(),
        answer: z.string(),
        graphReferenceMessageId: SendMessageInput.shape.graphReferenceMessageId,
      }),
    )
    .default([]),
  interrupt: Interrupt.optional(),
  checkpoint: AgentResume.shape.checkpoint.optional(),
  resume: AgentResume.optional(),
  responseMessageId: Id.optional(),
});
export type MockStoredRun = z.infer<typeof MockStoredRun>;
