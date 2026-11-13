import { describe, expect, it } from "vitest";
import type { z } from "zod";
import { Graph, GraphInput, Interrupt, RunStatus, SseFrame } from "../src/index.js";

const validGraph = {
  nodes: [
    { id: "node-web", type: "client", label: "Web / App" },
    {
      id: "node-order",
      type: "service",
      label: "订单服务",
      description: "订单领域逻辑",
    },
  ],
  edges: [
    { id: "edge-web-order", source: "node-web", target: "node-order", label: "HTTPS" },
  ],
};

const issueMessages = (schema: z.ZodType, value: unknown): string[] => {
  const result = schema.safeParse(value);

  return result.success ? [] : result.error.issues.map((issue) => issue.message);
};

describe("Graph（P0-13）", () => {
  it("接受合法的节点与边", () => {
    expect(() => Graph.parse(validGraph)).not.toThrow();
    expect(() => GraphInput.parse(validGraph)).not.toThrow();
  });

  it("拒绝未知节点类型", () => {
    const result = Graph.safeParse({
      ...validGraph,
      nodes: [{ id: "node-bus", type: "message-bus", label: "消息总线" }],
      edges: [],
    });

    expect(result.success).toBe(false);
  });

  it("拒绝重复节点 id", () => {
    const messages = issueMessages(GraphInput, {
      nodes: [
        { id: "node-a", type: "service", label: "A" },
        { id: "node-a", type: "database", label: "B" },
      ],
      edges: [],
    });

    expect(messages.some((message) => message.includes("节点 id 重复"))).toBe(true);
  });

  it("拒绝悬空边", () => {
    const messages = issueMessages(GraphInput, {
      ...validGraph,
      edges: [
        { id: "edge-1", source: "node-web", target: "node-missing" },
      ],
    });

    expect(
      messages.some((message) => message.includes("终点节点不存在")),
    ).toBe(true);
  });

  it("拒绝自环边", () => {
    const messages = issueMessages(GraphInput, {
      ...validGraph,
      edges: [{ id: "edge-1", source: "node-web", target: "node-web" }],
    });

    expect(messages.some((message) => message.includes("边不能指向自身"))).toBe(
      true,
    );
  });

  it("拒绝未声明的额外字段", () => {
    const result = Graph.safeParse({
      nodes: [{ id: "node-a", type: "service", label: "A", left: 10 }],
      edges: [],
    });

    expect(result.success).toBe(false);
  });
});

describe("RunStatus / HITL 契约（P0-01）", () => {
  it("waiting_input 是合法状态", () => {
    expect(RunStatus.parse("waiting_input")).toBe("waiting_input");
    expect(RunStatus.safeParse("paused").success).toBe(false);
  });

  it("interrupt 帧可被 SSE 解析", () => {
    const frame = {
      type: "interrupt",
      interruptId: "int-1",
      kind: "clarification",
      node: "clarify",
      payload: { question: "团队规模？" },
      expiresAt: "2026-11-12T21:00:00+08:00",
    };

    expect(Interrupt.parse(frame)).toMatchObject({ kind: "clarification" });
    expect(SseFrame.parse(frame).type).toBe("interrupt");
  });

  it("run-start 支持 resume 标记", () => {
    const frame = {
      type: "run-start",
      runId: "run-1",
      conversationId: "cnv-1",
      userMessageId: "msg-1",
      assistantMessageId: "msg-2",
      traceId: "trace-12345678",
      resume: true,
    };

    expect(SseFrame.parse(frame)).toMatchObject({ resume: true });
  });
});
