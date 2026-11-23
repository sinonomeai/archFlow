import { describe, expect, it } from "vitest";
import { prepareChatSubmission } from "../preview/hooks/use-send-message";

const conversationId = "conversation_1";
const reference = {
  conversationId,
  messageId: "assistant_1",
  label: "10:00:00 商品查询架构",
  graphSnapshot: { nodes: [], edges: [] },
};
const input = { conversationId, content: "说明这张图的商品查询流程" };

describe("chat graph reference submissions", () => {
  it.each([
    { kind: "ordinary messages", interruptId: undefined },
    {
      kind: "clarification answers",
      interruptId: "6611ac35-7873-4c2e-a9a3-111ae6365efb",
    },
  ])("includes only the reference ID in $kind", ({ interruptId }) => {
    const { idempotencyKey, ...submission } = prepareChatSubmission(
      { ...input, interruptId },
      null,
      reference,
    );

    expect(submission).toEqual({
      conversationId,
      content: "说明这张图的商品查询流程",
      interruptId,
      graphReferenceMessageId: "assistant_1",
    });
    expect(idempotencyKey).toBeTruthy();
  });

  it("omits a selected graph from another conversation", () => {
    const submission = prepareChatSubmission(
      { ...input, conversationId: "conversation_2" },
      null,
      reference,
    );

    expect(submission.graphReferenceMessageId).toBeUndefined();
  });

  it("reuses a failed send's key only for the same reference", () => {
    const first = prepareChatSubmission(input, null, reference);
    const retry = prepareChatSubmission(input, first, reference);
    const changed = prepareChatSubmission(input, first, {
      ...reference,
      messageId: "assistant_2",
    });
    const removed = prepareChatSubmission(input, first);

    expect(retry.idempotencyKey).toBe(first.idempotencyKey);
    expect(changed.idempotencyKey).not.toBe(first.idempotencyKey);
    expect(removed.idempotencyKey).not.toBe(first.idempotencyKey);
  });
});
