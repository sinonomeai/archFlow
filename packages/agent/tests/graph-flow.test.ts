import type {
  AgentDecision,
  AgentTask,
  AgentTurn,
  GraphPatch,
} from "@arch-flow/shared";
import { describe, expect, it, vi } from "vitest";
import {
  AgentExecutionError,
  createAgentEngine,
  isHistoricalGraphRequest,
  type AgentModel,
} from "../src/index.js";

const draftGraph = {
  nodes: [{ id: "api", type: "service" as const, label: "应用 API" }],
  edges: [],
};

const referencedGraph = {
  messageId: "snapshot-1",
  graph: {
    nodes: [{ id: "legacy", type: "service" as const, label: "旧版 API" }],
    edges: [],
  },
};

const cachePatch: GraphPatch = {
  upsertNodes: [{ id: "cache", type: "cache", label: "Redis" }],
  removeNodeIds: [],
  upsertEdges: [{ id: "api-cache", source: "api", target: "cache" }],
  removeEdgeIds: [],
};

const turn = (input: string, changes: Partial<AgentTurn> = {}): AgentTurn => ({
  runId: "run-1",
  conversationId: "session-1",
  projectId: "project-1",
  input,
  history: [],
  draftGraph,
  draftVersion: 1,
  constraints: {},
  attachments: [],
  ...changes,
});

const modelFor = (intents: AgentDecision["intents"], taskOrder = intents) => {
  const decision: AgentDecision = {
    intents,
    rewrittenInput: "回答关于架构图的问题",
    complexity: intents.length === 1 ? "simple" : "complex",
    question: null,
    constraintUpdates: {},
  };
  const tasks: AgentTask[] = taskOrder.map((intent) => ({
    intent,
    instruction: intent,
    requiresKnowledge: false,
  }));
  return {
    classify: vi.fn<AgentModel["classify"]>().mockResolvedValue(decision),
    resolveClarification: vi
      .fn<AgentModel["resolveClarification"]>()
      .mockResolvedValue(decision),
    plan: vi.fn<AgentModel["plan"]>().mockResolvedValue({ tasks }),
    executeTask: vi
      .fn<AgentModel["executeTask"]>()
      .mockResolvedValue({ text: "API 负责业务逻辑。" }),
    generateExtras: vi.fn<AgentModel["generateExtras"]>(),
  };
};

describe("Graph targets", () => {
  it.each(["解释第一版", "解释那张架构图的读写路径"])(
    "waits for a selected version before explaining a graph (%s)",
    async (input) => {
      const model = modelFor(["explain_graph"]);
      const engine = createAgentEngine({ model, embed: vi.fn() });
      const original = turn(input);
      const pending = await engine.execute(original);
      expect(pending).toMatchObject({ status: "waiting_input" });
      if (pending.status !== "waiting_input")
        throw new Error("expected a graph reference clarification");
      expect(pending.text).toContain("用这张图提问");
      expect(model.classify).not.toHaveBeenCalled();

      const stillPending = await engine.execute(original, {
        resume: { checkpoint: pending.checkpoint, answer: "就是那一张" },
      });
      if (stillPending.status !== "waiting_input")
        throw new Error("expected the missing reference to remain pending");
      expect(stillPending.checkpoint.attempts).toBe(2);
      expect(model.executeTask).not.toHaveBeenCalled();

      model.resolveClarification.mockResolvedValueOnce({
        ...stillPending.checkpoint.decision,
        intents: ["explain_graph"],
      });
      await expect(
        engine.execute(
          { ...original, referencedGraph },
          {
            resume: { checkpoint: stillPending.checkpoint, answer: "解释这张" },
          },
        ),
      ).resolves.toMatchObject({ status: "succeeded", graph: null });
      expect(model.executeTask).toHaveBeenCalledTimes(1);
      expect(model.executeTask.mock.calls[0]?.[0]).toMatchObject({
        task: { intent: "explain_graph" },
        turn: { draftGraph, referencedGraph },
      });
    },
  );

  it("preserves a version reference first introduced by a clarification answer", async () => {
    const model = modelFor(["explain_graph"]);
    const engine = createAgentEngine({ model });
    const original = turn("解释图", { draftGraph: null });
    const pending = await engine.execute(original);
    if (pending.status !== "waiting_input")
      throw new Error("expected an empty canvas clarification");

    const needsSelection = await engine.execute(original, {
      resume: { checkpoint: pending.checkpoint, answer: "上一版" },
    });
    if (needsSelection.status !== "waiting_input")
      throw new Error("expected a graph reference clarification");
    expect(needsSelection.text).toContain("用这张图提问");

    await expect(
      engine.execute(turn(original.input), {
        resume: { checkpoint: needsSelection.checkpoint, answer: "就是那张" },
      }),
    ).resolves.toMatchObject({ status: "waiting_input" });
    expect(model.executeTask).not.toHaveBeenCalled();
  });

  it("uses selected history for a read-only question with an empty current draft", async () => {
    const model = modelFor(["general_chat"]);
    const result = await createAgentEngine({ model }).execute(
      turn("为什么这样设计？", { draftGraph: null, referencedGraph }),
    );

    expect(result).toMatchObject({ status: "succeeded", graph: null });
    expect(model.executeTask.mock.calls[0]?.[0]).toMatchObject({
      task: { intent: "explain_graph" },
      turn: { draftGraph: null, referencedGraph },
    });
  });

  it("preserves the original comparison when a clarification selects just one graph", async () => {
    const model = modelFor(["explain_graph"]);
    const engine = createAgentEngine({ model });
    const original = turn("第一版与当前的差别");
    const pending = await engine.execute(original);
    if (pending.status !== "waiting_input")
      throw new Error("expected a graph reference clarification");

    await expect(
      engine.execute(
        { ...original, referencedGraph },
        { resume: { checkpoint: pending.checkpoint, answer: "这张" } },
      ),
    ).rejects.toMatchObject({ code: "AGENT_GRAPH_REFERENCE_READ_ONLY" });
    expect(model.executeTask).not.toHaveBeenCalled();
  });

  it.each(["改完缓存再解释这张图", "解释当前架构图", "第一版与当前的差别"])(
    "blocks a request that conflicts with the selected reference (%s)",
    async (input) => {
      const model = modelFor(
        input.startsWith("改完")
          ? ["edit_graph", "explain_graph"]
          : ["explain_graph"],
      );
      await expect(
        createAgentEngine({ model }).execute(turn(input, { referencedGraph })),
      ).rejects.toMatchObject({
        code: "AGENT_GRAPH_REFERENCE_READ_ONLY",
        message: expect.stringContaining("移除引用"),
      });
      expect(model.plan).not.toHaveBeenCalled();
      expect(model.executeTask).not.toHaveBeenCalled();
    },
  );

  it.each([
    "解释上面那张图",
    "解释刚刚生成的图",
    "解释 v1",
    "请解释 v2 的系统图",
    "请帮我看看那一幅系统图",
    "Could you explain that architecture diagram?",
  ])("requires a selection for a historical graph request (%s)", (input) =>
    expect(isHistoricalGraphRequest(input)).toBe(true),
  );

  it.each([
    "再解释修改后的流程",
    "创建第一版架构图",
    "基于项目需求生成初版架构图",
    "生成架构图，然后解释刚刚生成的图",
    "如何兼容 v1 和 v2 的接口？",
    "给用 Vue v3 的订单服务画架构图",
  ])(
    "does not read a candidate or first-time graph as a stored version (%s)",
    (input) => expect(isHistoricalGraphRequest(input)).toBe(false),
  );

  it.each([
    "解释当前那张架构图的读写路径",
    "解释这张架构图",
    "生成那张架构图",
    "生成一张架构图，再解释那张架构图",
    "Explain the current architecture diagram.",
    "Explain that the architecture diagram is ready to review.",
    "Draw that architecture diagram.",
    "翻译「解释那张架构图的读写路径」",
    'Translate "Explain that architecture diagram" into Chinese.',
  ])(
    "does not mistake other uses of a graph phrase for an unresolved reference (%s)",
    (input) => expect(isHistoricalGraphRequest(input)).toBe(false),
  );
});

describe("Dependent graph tasks", () => {
  it("does not explain the old draft when the plan reverses an explicit edit dependency", async () => {
    const model = modelFor(
      ["edit_graph", "explain_graph"],
      ["explain_graph", "edit_graph"],
    );

    await expect(
      createAgentEngine({ model }).execute(
        turn("添加 Redis 缓存，再解释改完的流程"),
      ),
    ).rejects.toMatchObject({ code: "AGENT_INVALID_PLAN" });
    expect(model.executeTask).not.toHaveBeenCalled();
  });

  it("rejects a plan that edits the candidate after the explanation", async () => {
    const model = modelFor(
      ["edit_graph", "explain_graph"],
      ["edit_graph", "explain_graph", "edit_graph"],
    );

    await expect(
      createAgentEngine({ model }).execute(
        turn("添加 Redis 缓存，再解释改完的流程"),
      ),
    ).rejects.toMatchObject({ code: "AGENT_INVALID_PLAN" });
    expect(model.executeTask).not.toHaveBeenCalled();
  });

  it.each(["应用 API 通过 Redis 读取缓存。", "Redis 缓存商品查询。"])(
    "retries against the same candidate and reconciles streamed text (%s)",
    async (answer) => {
      const model = modelFor(["edit_graph", "explain_graph"]);
      model.executeTask.mockResolvedValueOnce({
        text: "为查询加缓存。",
        patch: cachePatch,
      });
      model.executeTask.mockImplementationOnce(
        async (_input, _signal, emit) => {
          await emit?.("应用 API ");
          throw new AgentExecutionError("AGENT_TASK_TIMEOUT", "解释步骤超时");
        },
      );
      model.executeTask.mockImplementationOnce(
        async (_input, _signal, emit) => {
          await emit?.(answer.slice(0, 4));
          await emit?.(answer.slice(4));
          return { text: answer };
        },
      );
      let visible = "";
      const onTextDelta = vi.fn((delta: string, replace?: true) => {
        visible = replace ? delta : visible + delta;
      });

      const result = await createAgentEngine({ model }).execute(
        turn("添加 Redis 缓存，然后解释改后的图"),
        { onTextDelta, deadlineAt: Date.now() + 30_000 },
      );

      expect(
        model.executeTask.mock.calls.map(([{ task }]) => task.intent),
      ).toEqual(["edit_graph", "explain_graph", "explain_graph"]);
      const firstCandidate =
        model.executeTask.mock.calls[1]?.[0].turn.draftGraph;
      expect(model.executeTask.mock.calls[2]?.[0].turn.draftGraph).toBe(
        firstCandidate,
      );
      expect(result).toMatchObject({
        status: "succeeded",
        graph: firstCandidate,
      });
      expect(visible).toBe(`为查询加缓存。\n\n${answer}`);
      expect(result.text).toBe(visible);
      expect(
        onTextDelta.mock.calls.filter(([, replace]) => replace),
      ).toHaveLength(answer.startsWith("应用 API ") ? 0 : 1);
    },
  );

  it.each(["canceled", "elapsed", "too little remaining", "second timeout"])(
    "stops at the explanation cancellation, time or attempt limit (%s)",
    async (condition) => {
      const model = modelFor(["edit_graph", "explain_graph"]);
      const controller = new AbortController();
      const cancelReason = new DOMException("用户取消", "AbortError");
      const deadlineReason = new DOMException("运行超时", "TimeoutError");
      model.executeTask.mockResolvedValueOnce({
        text: "方案变更",
        patch: cachePatch,
      });
      model.executeTask.mockImplementation(async () => {
        if (condition === "canceled") controller.abort(cancelReason);
        if (condition === "elapsed") controller.abort(deadlineReason);
        throw new DOMException("单次解释超时", "TimeoutError");
      });

      const result = createAgentEngine({ model }).execute(
        turn("添加 Redis 缓存，然后解释改后的图"),
        {
          signal: controller.signal,
          deadlineAt:
            Date.now() + (condition === "too little remaining" ? 50 : 30_000),
        },
      );

      if (condition === "canceled")
        await expect(result).rejects.toBe(cancelReason);
      else if (condition === "elapsed")
        await expect(result).rejects.toBe(deadlineReason);
      else
        await expect(result).rejects.toMatchObject({
          code: "AGENT_TASK_TIMEOUT",
          message: expect.stringContaining("解释"),
        });
      expect(model.executeTask).toHaveBeenCalledTimes(
        condition === "second timeout" ? 3 : 2,
      );
    },
  );

  it("leaves the dependent explanation incomplete when a modification patch is invalid", async () => {
    const model = modelFor(["edit_graph", "explain_graph"]);
    model.executeTask.mockResolvedValueOnce({
      text: "方案变更。",
      patch: { ...cachePatch, removeNodeIds: ["missing-node"] },
    });
    const onTextDelta = vi.fn();

    await expect(
      createAgentEngine({ model }).execute(turn("修改并解释改完的图"), {
        onTextDelta,
      }),
    ).rejects.toMatchObject({
      code: "GRAPH_INVALID",
      message: expect.stringContaining("解释未完成"),
    });
    expect(model.executeTask).toHaveBeenCalledTimes(1);
    expect(onTextDelta).not.toHaveBeenCalled();
  });
});
