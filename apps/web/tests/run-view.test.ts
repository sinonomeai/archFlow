import { describe, expect, it } from "vitest";
import type { Message, MockRunAccepted } from "@arch-flow/shared";
import { applyRunFrame, createRunView } from "../preview/lib/run-view";

const accepted: MockRunAccepted = {
  runId: "run_1",
  userMessageId: "user_1",
  assistantMessageId: "assistant_1",
  status: "queued",
  streamUrl: "/api/mock/runs/run_1/stream",
};
const CREATED_AT = "2026-11-23T10:00:00.000Z";

describe("run view", () => {
  it("replaces already rendered text with the saved assistant snapshot", () => {
    const initial = createRunView(accepted, CREATED_AT);
    const partial = applyRunFrame(initial, {
      type: "text-delta",
      messageId: "assistant_1",
      content: "旧的部分文字",
    });
    const saved: Message = {
      ...initial.message,
      content: "恢复的完整文字",
      graphSnapshot: {
        nodes: [{ id: "service", type: "service", label: "旧版服务" }],
        edges: [],
      },
    };

    const restored = applyRunFrame(partial, {
      type: "snapshot",
      run: {
        id: "run_1",
        conversationId: "conversation_1",
        userMessageId: "user_1",
        assistantMessageId: "assistant_1",
        status: "succeeded",
        finishReason: "stop",
        createdAt: CREATED_AT,
        finishedAt: CREATED_AT,
        error: null,
      },
      assistantMessage: saved,
      stage: null,
    });

    expect(restored.status).toBe("succeeded");
    expect(restored.message).toEqual(saved);
  });

  it("keeps the same assistant message when a question is answered", () => {
    const started = createRunView(accepted, CREATED_AT);
    const paused = applyRunFrame(started, {
      type: "interrupt",
      interruptId: "card_1",
      kind: "clarification",
      node: "router",
      payload: {},
      expiresAt: "2026-11-24T00:00:00.000Z",
    });
    const resumed = applyRunFrame(paused, {
      type: "run-start",
      runId: "run_1",
      conversationId: "conversation_1",
      userMessageId: "user_1",
      assistantMessageId: "assistant_1",
      traceId: "trace_1",
      resume: true,
    });

    expect(paused.status).toBe("waiting_input");
    expect(resumed.status).toBe("running");
    expect(resumed.message.id).toBe("assistant_1");
    expect(
      applyRunFrame(resumed, {
        type: "done",
        assistantMessageId: "assistant_1",
        finishReason: "canceled",
      }).status,
    ).toBe("canceled");
  });
});
