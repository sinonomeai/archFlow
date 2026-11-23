import { describe, expect, it, vi } from "vitest";
import type { AgentDecision, AgentTurn, GraphPatch } from "@arch-flow/shared";
import { createAgentEngine, type AgentModel } from "../src/index.js";

const draftGraph = {
  nodes: [{ id: "api", type: "service" as const, label: "应用 API" }],
  edges: [],
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
  draftVersion: 7,
  constraints: {},
  attachments: [],
  ...changes,
});

const decision = (changes: Partial<AgentDecision> = {}): AgentDecision => ({
  intents: ["edit_graph"],
  rewrittenInput: "为当前应用 API 添加缓存",
  complexity: "simple",
  question: null,
  constraintUpdates: {},
  ...changes,
});

const intentTask = (
  intent: AgentDecision["intents"][number],
  requiresKnowledge = false,
) => ({
  intent,
  instruction: intent,
  requiresKnowledge,
});

const mockModel = () => ({
  classify: vi.fn<AgentModel["classify"]>().mockResolvedValue(decision()),
  resolveClarification: vi.fn<AgentModel["resolveClarification"]>(),
  plan: vi.fn<AgentModel["plan"]>(),
  executeTask: vi
    .fn<AgentModel["executeTask"]>()
    .mockResolvedValue({ text: "应用 API 承担业务逻辑。" }),
  generateExtras: vi.fn<AgentModel["generateExtras"]>(),
});

describe("ArchFlow execution", () => {
  it("runs an explicit whole-turn request without embedding, classifying or planning", async () => {
    const model = mockModel();
    const embed = vi.fn();
    const onRoute = vi.fn();
    const engine = createAgentEngine({ model, embed, onRoute });

    const result = await engine.execute(turn("解释当前架构图。"));

    expect(result).toMatchObject({ status: "succeeded", graph: null });
    expect(onRoute).toHaveBeenCalledWith(
      expect.objectContaining({ source: "rule", strategy: "direct" }),
    );
    expect(embed).not.toHaveBeenCalled();
    expect(model.classify).not.toHaveBeenCalled();
    expect(model.plan).not.toHaveBeenCalled();
    expect(model.executeTask.mock.calls[0]?.[0].task.intent).toBe(
      "explain_graph",
    );
  });

  it("accepts an isolated semantic match and falls back to the LLM for ambiguous matches", async () => {
    const model = mockModel();
    const onRoute = vi.fn();
    let tied = false;
    const embed = vi.fn(async (texts: readonly string[]) =>
      texts.map((text) =>
        tied || text === "讲讲这张系统图" || text === "解释当前架构图"
          ? [1, 0]
          : [0, 1],
      ),
    );
    const engine = createAgentEngine({ model, embed, onRoute });
    const message = turn("讲讲这张系统图");

    await engine.execute(message);
    expect(model.classify).not.toHaveBeenCalled();
    expect(onRoute).toHaveBeenLastCalledWith(
      expect.objectContaining({ source: "semantic", strategy: "direct" }),
    );

    tied = true;
    const ambiguousEngine = createAgentEngine({ model, embed, onRoute });
    model.classify.mockResolvedValue(decision({ intents: ["explain_graph"] }));
    await ambiguousEngine.execute(message);
    expect(model.classify).toHaveBeenCalledTimes(1);
    expect(onRoute).toHaveBeenLastCalledWith(
      expect.objectContaining({ source: "model", strategy: "direct" }),
    );
  });

  it("preserves both goals in a compound request and passes edits to the next task", async () => {
    const model = mockModel();
    const embed = vi.fn();
    const received: string[] = [];
    const original = turn("添加 Redis 缓存，并解释当前架构图");
    model.classify.mockResolvedValue(
      decision({ intents: ["edit_graph", "explain_graph"] }),
    );
    model.plan.mockResolvedValue({
      tasks: [intentTask("edit_graph"), intentTask("explain_graph")],
    });
    model.executeTask.mockResolvedValueOnce({
      text: "已添加缓存。",
      patch: cachePatch,
    });
    model.executeTask.mockImplementationOnce(async (_input, _signal, emit) => {
      await emit?.("应用 API ");
      await emit?.("通过 Redis 读取缓存。");
      return { text: "应用 API 通过 Redis 读取缓存。" };
    });

    const result = await createAgentEngine({ model, embed }).execute(original, {
      onTextDelta: (delta) => {
        received.push(delta);
      },
    });

    expect(embed).not.toHaveBeenCalled();
    expect(model.classify).toHaveBeenCalledTimes(1);
    expect(model.plan).toHaveBeenCalledTimes(1);
    expect(result).toMatchObject({
      status: "succeeded",
      graph: { nodes: [draftGraph.nodes[0], { id: "cache" }] },
    });
    expect(
      model.executeTask.mock.calls[1]?.[0].turn.draftGraph?.nodes.map(
        ({ id }) => id,
      ),
    ).toEqual(["api", "cache"]);
    expect(original.draftGraph).toEqual(draftGraph);
    expect(received).toEqual([
      "已添加缓存。",
      "\n\n应用 API ",
      "通过 Redis 读取缓存。",
    ]);
    expect(result.text).toBe("已添加缓存。\n\n应用 API 通过 Redis 读取缓存。");
  });

  it.each([
    [
      "加上 Redis 缓存，并说说新方案的读写路径",
      ["explain_graph", "edit_graph"],
    ],
    ["加上 Redis 缓存，然后解释读写路径", ["explain_graph", "edit_graph"]],
    ["加上 Redis 缓存，并解释新版的读写路径", ["explain_graph", "edit_graph"]],
    [
      "先解释当前架构图，再加上 Redis 缓存，并说说新方案的读写路径",
      ["edit_graph", "explain_graph"],
    ],
  ] as const)(
    "rejects a plan that does not explain the requested version (%s)",
    async (input, order) => {
      const model = mockModel();
      model.classify.mockResolvedValue(
        decision({ intents: ["edit_graph", "explain_graph"] }),
      );
      model.plan.mockResolvedValue({
        tasks: order.map((intent) => intentTask(intent)),
      });
      model.executeTask.mockImplementation(async ({ task }) =>
        task.intent === "edit_graph"
          ? { text: "为查询加缓存。", patch: cachePatch }
          : { text: "应用 API 承担业务逻辑。" },
      );

      await expect(
        createAgentEngine({ model }).execute(turn(input)),
      ).rejects.toMatchObject({ code: "AGENT_INVALID_PLAN" });
      expect(model.executeTask).not.toHaveBeenCalled();
    },
  );

  it("can explain both the initial diagram and the new design in order", async () => {
    const model = mockModel();
    const original = turn(
      "先解释当前架构图，再加上 Redis 缓存，并说说新方案的读写路径",
    );
    model.classify.mockResolvedValue(
      decision({ intents: ["explain_graph", "edit_graph"] }),
    );
    model.plan.mockResolvedValue({
      tasks: [
        intentTask("explain_graph"),
        intentTask("edit_graph"),
        intentTask("explain_graph"),
      ],
    });
    model.executeTask.mockImplementation(async ({ task, turn }) => {
      if (task.intent === "edit_graph")
        return { text: "为查询加缓存。", patch: cachePatch };
      return {
        text: turn.draftGraph?.nodes.map(({ label }) => label).join("、"),
      };
    });

    const result = await createAgentEngine({ model }).execute(original);

    expect(result.text).toBe("应用 API\n\n为查询加缓存。\n\n应用 API、Redis");
  });

  it("resumes a clarification from the saved decision without routing the answer as a new message", async () => {
    const model = mockModel();
    const engine = createAgentEngine({ model });
    const original = turn("画个架构图", { draftGraph: null });
    const pending = await engine.execute(original);
    if (pending.status !== "waiting_input")
      throw new Error("expected a clarification");
    expect(pending.checkpoint.decision.intents).toEqual(["generate_graph"]);
    expect(model.plan).not.toHaveBeenCalled();

    model.resolveClarification.mockResolvedValue(
      decision({
        intents: ["generate_graph"],
        rewrittenInput: "生成校园二手交易平台架构图",
        constraintUpdates: { projectGoal: "校园二手交易平台" },
      }),
    );
    model.executeTask.mockResolvedValue({
      text: "已生成架构图。",
      graph: draftGraph,
    });
    const result = await engine.execute(original, {
      resume: { checkpoint: pending.checkpoint, answer: "校园二手交易平台" },
    });

    expect(result).toMatchObject({
      status: "succeeded",
      graph: draftGraph,
      constraints: { projectGoal: "校园二手交易平台" },
    });
    expect(model.classify).not.toHaveBeenCalled();
    expect(model.resolveClarification).toHaveBeenCalledTimes(1);
    expect(model.resolveClarification.mock.calls[0]?.[0].turn.runId).toBe(
      original.runId,
    );
  });

  it("does not accept a plan that introduces a graph write or leaves out a requested task", async () => {
    const model = mockModel();
    model.classify.mockResolvedValue(
      decision({ intents: ["explain_graph", "general_chat"] }),
    );
    model.plan.mockResolvedValue({
      tasks: [intentTask("generate_graph"), intentTask("explain_graph")],
    });

    await expect(
      createAgentEngine({ model }).execute(
        turn("先解释架构图，再说说 API 设计原则"),
      ),
    ).rejects.toMatchObject({ code: "AGENT_INVALID_PLAN" });
    expect(model.executeTask).not.toHaveBeenCalled();
  });

  it("rejects dangling edges from model graph output before producing a draft", async () => {
    const model = mockModel();
    const onTextDelta = vi.fn();
    model.classify.mockResolvedValue(
      decision({
        intents: ["generate_graph"],
        constraintUpdates: { projectGoal: "校内活动平台" },
      }),
    );
    model.executeTask.mockImplementation(async (_input, _signal, emit) => {
      await emit?.("已生成。");
      return {
        text: "已生成。",
        graph: {
          ...draftGraph,
          edges: [{ id: "bad-edge", source: "api", target: "missing" }],
        },
      };
    });

    await expect(
      createAgentEngine({ model }).execute(turn("为校内活动平台生成架构图"), {
        onTextDelta,
      }),
    ).rejects.toMatchObject({ code: "GRAPH_INVALID" });
    expect(draftGraph.edges).toHaveLength(0);
    expect(onTextDelta).not.toHaveBeenCalled();
  });

  it("uses the authorized project scope for evidence and does not invent a source when none is found", async () => {
    const model = mockModel();
    const searchKnowledge = vi.fn().mockResolvedValue([]);
    const result = await createAgentEngine({ model, searchKnowledge }).execute(
      turn("搜索项目知识库", { attachments: ["file-1"] }),
    );

    expect(searchKnowledge).toHaveBeenCalledWith(
      expect.objectContaining({
        projectId: "project-1",
        attachments: ["file-1"],
      }),
      undefined,
    );
    expect(model.executeTask).not.toHaveBeenCalled();
    expect(result).toMatchObject({
      status: "succeeded",
      citations: [],
      graph: null,
    });
  });

  it("leaves an unresolved deployment conflict unchanged and bounds repeated clarification", async () => {
    const model = mockModel();
    const changes = { deployment: "分布式部署" };
    model.classify.mockResolvedValue(decision({ constraintUpdates: changes }));
    model.resolveClarification.mockResolvedValue(
      decision({
        constraintUpdates: changes,
        question: "请确认采用哪种部署方式。",
      }),
    );
    const engine = createAgentEngine({ model });
    const input = turn("添加缓存并改为分布式部署", {
      constraints: { deployment: "单机部署" },
    });
    let result = await engine.execute(input);
    for (let index = 0; index < 3; index += 1) {
      if (result.status !== "waiting_input")
        throw new Error("expected pending clarification");
      expect(result.constraints.deployment).toBe("单机部署");
      expect(result.checkpoint.conflictKey).toBe("deployment");
      result = await engine.execute(input, {
        resume: { checkpoint: result.checkpoint, answer: "我还未决定" },
      });
    }
    expect(result).toMatchObject({
      status: "succeeded",
      graph: null,
      constraints: input.constraints,
    });
    expect(model.executeTask).not.toHaveBeenCalled();
  });

  it("does not assemble a diagram from unrelated evidence or fall through to an old draft", async () => {
    const model = mockModel();
    const citation = {
      fileId: "file-1",
      fileName: "limits.md",
      snippet: "单机运行",
      score: 0.95,
    };
    const searchKnowledge = vi
      .fn()
      .mockResolvedValueOnce([citation])
      .mockResolvedValueOnce([]);
    const input = turn("查一下部署限制，再根据文档生成交易架构并解释它");
    model.classify.mockResolvedValue(
      decision({
        intents: ["query_knowledge", "generate_graph", "explain_graph"],
        constraintUpdates: { projectGoal: "交易平台" },
        knowledgeDependentIntents: ["generate_graph"],
      }),
    );
    model.plan.mockResolvedValue({
      tasks: [
        { ...intentTask("query_knowledge", true), instruction: "部署限制" },
        { ...intentTask("generate_graph"), instruction: "交易架构" },
        intentTask("explain_graph"),
      ],
    });

    await expect(
      createAgentEngine({ model, searchKnowledge }).execute(input),
    ).rejects.toMatchObject({
      code: "AGENT_KNOWLEDGE_REQUIRED",
      message: expect.stringContaining("解释未完成"),
    });
    expect(searchKnowledge).toHaveBeenCalledTimes(2);
    expect(model.executeTask).toHaveBeenCalledTimes(1);
  });

  it.each(["omitted", "assigned to the lookup"] as const)(
    "leaves the draft unchanged when the required project standard is missing and the classifier flag is %s",
    async (flag) => {
      const model = mockModel();
      const searchKnowledge = vi.fn().mockResolvedValue([]);
      const original = turn(
        "按项目缓存规范修改商品查询，订单链路保持原样，再解释改完的流程",
      );
      model.classify.mockResolvedValue(
        decision({
          intents: ["query_knowledge", "edit_graph", "explain_graph"],
          ...(flag === "assigned to the lookup"
            ? { knowledgeDependentIntents: ["query_knowledge"] }
            : {}),
        }),
      );
      model.plan.mockResolvedValue({
        tasks: [
          intentTask("query_knowledge"),
          intentTask("edit_graph"),
          intentTask("explain_graph"),
        ],
      });
      model.executeTask.mockResolvedValueOnce({
        text: "为查询加缓存。",
        patch: cachePatch,
      });

      await expect(
        createAgentEngine({ model, searchKnowledge }).execute(original),
      ).rejects.toMatchObject({
        code: "AGENT_KNOWLEDGE_REQUIRED",
        message: expect.stringContaining("解释未完成"),
      });
      expect(model.executeTask).not.toHaveBeenCalled();
      expect(original.draftGraph).toEqual(draftGraph);
    },
  );

  it.each([
    "根据附件中的部署规范生成交易架构图",
    "按项目的部署规范文档，为交易服务生成架构图",
    "按《项目部署规范》生成架构图",
  ])(
    "blocks source-bound generation without an evidence provider (%s)",
    async (input) => {
      const model = mockModel();
      model.classify.mockResolvedValue(
        decision({
          intents: ["generate_graph"],
          rewrittenInput: "生成交易架构图",
          constraintUpdates: { projectGoal: "交易平台" },
        }),
      );
      model.executeTask.mockResolvedValue({
        text: "交易系统。",
        graph: draftGraph,
      });

      await expect(
        createAgentEngine({ model }).execute(
          turn(input, { attachments: ["file-1"] }),
        ),
      ).rejects.toMatchObject({ code: "AGENT_KNOWLEDGE_REQUIRED" });
      expect(model.executeTask).not.toHaveBeenCalled();
    },
  );

  it("does not edit the draft when a requested standard is missing", async () => {
    const model = mockModel();
    model.executeTask.mockResolvedValue({
      text: "为查询加缓存。",
      patch: cachePatch,
    });

    await expect(
      createAgentEngine({ model }).execute(turn("按规范改图")),
    ).rejects.toMatchObject({ code: "AGENT_KNOWLEDGE_REQUIRED" });
    expect(model.executeTask).not.toHaveBeenCalled();
  });

  it("uses evidence for the explicit edit basis even when the classifier omits the dependency", async () => {
    const model = mockModel();
    const citation = {
      fileId: "file-1",
      fileName: "cache.md",
      snippet: "商品查询使用 Redis 缓存。",
      score: 0.95,
    };
    const searchKnowledge = vi.fn().mockResolvedValue([citation]);
    model.executeTask.mockResolvedValueOnce({
      text: "为查询加缓存。",
      patch: cachePatch,
    });

    const result = await createAgentEngine({ model, searchKnowledge }).execute(
      turn("按项目的缓存规范给商品查询加 Redis", { attachments: ["file-1"] }),
    );

    expect(searchKnowledge).toHaveBeenCalledWith(
      {
        projectId: "project-1",
        attachments: ["file-1"],
        query: expect.stringContaining("缓存规范"),
      },
      undefined,
    );
    expect(model.executeTask.mock.calls[0]?.[0].evidence).toEqual([citation]);
    expect(result).toMatchObject({
      status: "succeeded",
      citations: [citation],
    });
  });

  it("can generate an independent example after a standalone search returns no evidence", async () => {
    const model = mockModel();
    const searchKnowledge = vi.fn().mockResolvedValue([]);
    model.classify.mockResolvedValue(
      decision({
        intents: ["query_knowledge", "generate_graph"],
        constraintUpdates: { projectGoal: "订单服务" },
      }),
    );
    model.plan.mockResolvedValue({
      tasks: [intentTask("query_knowledge"), intentTask("generate_graph")],
    });
    model.executeTask.mockResolvedValue({
      text: "订单服务示例。",
      graph: draftGraph,
    });

    const result = await createAgentEngine({ model, searchKnowledge }).execute(
      turn("查一下项目缓存规范，再另外画一个订单服务架构图示例"),
    );

    expect(result).toMatchObject({
      status: "succeeded",
      graph: draftGraph,
      citations: [],
    });
    expect(searchKnowledge).toHaveBeenCalledTimes(1);
  });
});
