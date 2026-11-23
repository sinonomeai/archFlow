import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import {
  AgentExecutionError,
  createAgentEngine,
  type AgentModel,
} from "@arch-flow/agent";
import {
  GraphInput,
  MockDatabase,
  type AgentTurnResult,
  type MockSseFrame,
} from "@arch-flow/shared";
import { createFixtureAgent } from "../lib/fixture-agent";
import { readMockDatabase, updateMockDatabase } from "../lib/mock-db";
import { createMockRunRuntime } from "../lib/mock-run-runtime";

const ACCOUNT = randomUUID();
const CONVERSATION = randomUUID();
const PROJECT = randomUUID();

const pendingGate = () => {
  let resolve = () => {};
  const promise = new Promise<void>((complete) => {
    resolve = complete;
  });
  return { promise, resolve };
};

const setup = () => {
  const timestamp = new Date().toISOString();
  let database = MockDatabase.parse({
    projects: [],
    conversations: [
      {
        id: CONVERSATION,
        projectId: PROJECT,
        title: "新会话",
        updatedAt: timestamp,
        createdAt: timestamp,
        draftGraph: null,
        draftVersion: 0,
        messageCount: 0,
        lastMessage: null,
        messages: [],
      },
    ],
  });
  const empty = () => MockDatabase.parse({ projects: [], conversations: [] });

  return {
    read: async (userId: string) =>
      userId === ACCOUNT ? structuredClone(database) : empty(),
    update: async <T>(userId: string, apply: (record: MockDatabase) => T) => {
      const copy = userId === ACCOUNT ? structuredClone(database) : empty();
      const result = apply(copy);
      if (userId === ACCOUNT) database = copy;
      return result;
    },
  };
};

const success = (text: string, label?: string): AgentTurnResult => ({
  status: "succeeded",
  text,
  constraints: {},
  citations: [],
  graph: label
    ? GraphInput.parse({
        nodes: [{ id: "service", type: "service", label }],
        edges: [],
      })
    : null,
});

const setupFixtureDraft = async (
  graph = GraphInput.parse({
    nodes: [{ id: "service", type: "service", label: "订单服务" }],
    edges: [],
  }),
) => {
  const store = setup();
  const seed = createMockRunRuntime(store, {
    execute: async () => ({ ...success("已有架构图。"), graph }),
  });
  const original = await seed.accept(
    ACCOUNT,
    CONVERSATION,
    { content: "画订单服务架构图" },
    randomUUID(),
  );
  await (await seed.stream(ACCOUNT, original.runId)).text();
  return {
    store,
    runtime: createMockRunRuntime(store, createFixtureAgent()),
    graphReferenceMessageId: original.assistantMessageId,
  };
};

const readFrames = (text: string): { id: number; frame: MockSseFrame }[] =>
  text.split("\n\n").flatMap((block) => {
    const lines = block.split("\n");
    const payload = lines.find((line) => line.startsWith("data: "))?.slice(6);
    if (!payload || payload === "[DONE]") return [];
    const cursor = lines.find((line) => line.startsWith("id: "))?.slice(4);
    return [{ id: Number(cursor), frame: JSON.parse(payload) as MockSseFrame }];
  });

describe("local mock run lifecycle", () => {
  it("uses one execution for an idempotent message and denies other accounts the run", async () => {
    const store = setup();
    const runtime = createMockRunRuntime(store, {
      execute: async () => success("只生成一次。"),
    });
    const key = randomUUID();
    const input = { content: "解释架构" };

    const [initial, retried] = await Promise.all([
      runtime.accept(ACCOUNT, CONVERSATION, input, key),
      runtime.accept(ACCOUNT, CONVERSATION, input, key),
    ]);
    expect(retried.runId).toBe(initial.runId);
    expect(retried.assistantMessageId).toBe(initial.assistantMessageId);
    await expect(
      runtime.accept(ACCOUNT, CONVERSATION, { content: "其他问题" }, key),
    ).rejects.toMatchObject({ code: "IDEMPOTENCY_KEY_REUSED" });
    await expect(
      runtime.snapshot(randomUUID(), initial.runId),
    ).rejects.toMatchObject({
      code: "RUN_NOT_FOUND",
    });
    await vi.waitFor(async () => {
      expect((await runtime.snapshot(ACCOUNT, initial.runId)).run.status).toBe(
        "succeeded",
      );
    });
    expect((await store.read(ACCOUNT)).conversations[0]?.messages).toHaveLength(
      2,
    );
  });

  it("replays only missing frames after a closed subscriber while the run keeps executing", async () => {
    const store = setup();
    const finish = pendingGate();
    const runtime = createMockRunRuntime(store, {
      execute: async (_turn, options) => {
        await options.onTextDelta("第一段。", true);
        await finish.promise;
        await options.onTextDelta("第二段。");
        return success("第一段。第二段。");
      },
    });
    const run = await runtime.accept(
      ACCOUNT,
      CONVERSATION,
      { content: "解释" },
      randomUUID(),
    );
    const subscriber = new AbortController();
    const response = await runtime.stream(
      ACCOUNT,
      run.runId,
      undefined,
      subscriber.signal,
    );
    const reader = response.body?.getReader();
    let firstCursor: number | undefined;
    const decoder = new TextDecoder();
    while (firstCursor === undefined && reader) {
      const chunk = await reader.read();
      if (chunk.done) break;
      const frames = readFrames(decoder.decode(chunk.value));
      firstCursor = frames.find(({ frame }) => frame.type === "text-delta")?.id;
    }
    expect(firstCursor).toBeDefined();
    subscriber.abort();
    expect((await runtime.snapshot(ACCOUNT, run.runId)).run.status).toBe(
      "running",
    );
    const reconnected = await runtime.stream(ACCOUNT, run.runId, firstCursor);
    finish.resolve();
    const replay = readFrames(await reconnected.text());
    expect(
      replay
        .filter(({ frame }) => frame.type === "text-delta")
        .map(({ frame }) => frame),
    ).toMatchObject([{ content: "第二段。" }]);
    expect(replay.map(({ frame }) => frame.type)).toContain("done");
    expect(
      (await runtime.snapshot(ACCOUNT, run.runId)).assistantMessage.content,
    ).toBe("第一段。第二段。");
  });

  it("replays a historical graph from its assistant message when the event cache is lost", async () => {
    const store = setup();
    const driver = {
      execute: async (turn: { input: string }) =>
        success("架构图。", turn.input),
    };
    const runtime = createMockRunRuntime(store, driver);
    const first = await runtime.accept(
      ACCOUNT,
      CONVERSATION,
      { content: "旧版" },
      randomUUID(),
    );
    await (await runtime.stream(ACCOUNT, first.runId)).text();
    const second = await runtime.accept(
      ACCOUNT,
      CONVERSATION,
      { content: "新版" },
      randomUUID(),
    );
    await (await runtime.stream(ACCOUNT, second.runId)).text();

    const restored = createMockRunRuntime(store, driver);
    const original = readFrames(
      await (await restored.stream(ACCOUNT, first.runId)).text(),
    );
    expect(original[0]?.frame).toMatchObject({
      type: "snapshot",
      assistantMessage: { graphSnapshot: { nodes: [{ label: "旧版" }] } },
    });
    expect(
      (await store.read(ACCOUNT)).conversations[0]?.draftGraph?.nodes[0],
    ).toMatchObject({ label: "新版" });
  });

  it("continues a historical graph clarification against the selected snapshot after a restart", async () => {
    const store = setup();
    const fixture = createFixtureAgent();
    const seed = createMockRunRuntime(store, {
      execute: async ({ input }) => success("架构图。", input),
    });
    const first = await seed.accept(
      ACCOUNT,
      CONVERSATION,
      { content: "订单查询初版" },
      randomUUID(),
    );
    await (await seed.stream(ACCOUNT, first.runId)).text();
    const latest = await seed.accept(
      ACCOUNT,
      CONVERSATION,
      { content: "订单查询带缓存" },
      randomUUID(),
    );
    await (await seed.stream(ACCOUNT, latest.runId)).text();
    const runtime = createMockRunRuntime(store, fixture);
    const run = await runtime.accept(
      ACCOUNT,
      CONVERSATION,
      { content: "解释第一版架构图" },
      randomUUID(),
    );
    await (await runtime.stream(ACCOUNT, run.runId)).text();
    const waiting = await runtime.snapshot(ACCOUNT, run.runId);
    expect(waiting.run.status).toBe("waiting_input");
    expect(waiting.assistantMessage.metadata?.card?.options).toEqual([]);
    const interruptId = waiting.assistantMessage.metadata?.card?.id;
    expect(interruptId).toBeDefined();

    const restarted = createMockRunRuntime(store, fixture);
    const accepted = await restarted.accept(
      ACCOUNT,
      CONVERSATION,
      {
        content: "请求怎么走？",
        interruptId,
        graphReferenceMessageId: first.assistantMessageId,
      },
      randomUUID(),
    );
    expect(accepted.runId).toBe(run.runId);
    expect(
      await restarted.accept(
        ACCOUNT,
        CONVERSATION,
        {
          content: "请求怎么走？",
          interruptId,
          graphReferenceMessageId: first.assistantMessageId,
        },
        randomUUID(),
      ),
    ).toMatchObject({ runId: run.runId });
    await expect(
      restarted.accept(
        ACCOUNT,
        CONVERSATION,
        { content: "请求怎么走？", interruptId },
        randomUUID(),
      ),
    ).rejects.toMatchObject({ code: "IDEMPOTENCY_KEY_REUSED" });
    await expect(
      restarted.accept(
        ACCOUNT,
        CONVERSATION,
        {
          content: "请求怎么走？",
          interruptId,
          graphReferenceMessageId: latest.assistantMessageId,
        },
        randomUUID(),
      ),
    ).rejects.toMatchObject({ code: "IDEMPOTENCY_KEY_REUSED" });
    const frames = readFrames(
      await (await restarted.stream(ACCOUNT, run.runId)).text(),
    );
    expect(frames.some(({ frame }) => frame.type === "graph")).toBe(false);
    const result = await restarted.snapshot(ACCOUNT, run.runId);
    expect(result.run.status).toBe("succeeded");
    expect(result.assistantMessage.graphSnapshot).toBeNull();
    expect(result.assistantMessage.content).toContain("订单查询初版");
    expect(result.assistantMessage.content).not.toContain("订单查询带缓存");
    expect((await store.read(ACCOUNT)).conversations[0]).toMatchObject({
      draftVersion: 2,
      draftGraph: { nodes: [{ label: "订单查询带缓存" }] },
    });
  });

  it("rejects a graph result from a run bound to a read-only history reference", async () => {
    const store = setup();
    const runtime = createMockRunRuntime(store, {
      execute: async ({ input }) => success("架构图。", input),
    });
    const first = await runtime.accept(
      ACCOUNT,
      CONVERSATION,
      { content: "历史版本" },
      randomUUID(),
    );
    await (await runtime.stream(ACCOUNT, first.runId)).text();
    const run = await runtime.accept(
      ACCOUNT,
      CONVERSATION,
      {
        content: "另一张图",
        graphReferenceMessageId: first.assistantMessageId,
      },
      randomUUID(),
    );
    await (await runtime.stream(ACCOUNT, run.runId)).text();
    expect(await runtime.snapshot(ACCOUNT, run.runId)).toMatchObject({
      run: {
        status: "failed",
        error: { code: "AGENT_GRAPH_REFERENCE_READ_ONLY" },
      },
      assistantMessage: { graphSnapshot: null },
    });
    expect((await store.read(ACCOUNT)).conversations[0]).toMatchObject({
      draftVersion: 1,
      draftGraph: { nodes: [{ label: "历史版本" }] },
    });
  });

  it.each([
    { target: "当前画布", useReference: false, explanation: "当前画布" },
    { target: "历史图", useReference: true, explanation: "所选历史图" },
  ])(
    "answers whether to add a cache without modifying $target",
    async ({ useReference, explanation }) => {
      const { store, runtime, graphReferenceMessageId } =
        await setupFixtureDraft();
      const run = await runtime.accept(
        ACCOUNT,
        CONVERSATION,
        {
          content: "解释这张架构图是否需要添加缓存",
          graphReferenceMessageId: useReference
            ? graphReferenceMessageId
            : undefined,
        },
        randomUUID(),
      );
      const frames = readFrames(
        await (await runtime.stream(ACCOUNT, run.runId)).text(),
      );
      expect(frames.some(({ frame }) => frame.type === "graph")).toBe(false);
      const result = await runtime.snapshot(ACCOUNT, run.runId);
      expect(result.run.status).toBe("succeeded");
      expect(result.assistantMessage.content).toContain(explanation);
      expect(result.assistantMessage.graphSnapshot).toBeNull();
      expect((await store.read(ACCOUNT)).conversations[0]).toMatchObject({
        draftVersion: 1,
        draftGraph: { nodes: [{ label: "订单服务" }] },
      });
    },
  );

  it.each([
    "按公司缓存规范给订单查询加缓存，再解释改完的流程",
    "按项目缓存规范修改商品查询，订单链路保持原样，再解释改完的流程",
    "按规范改图，再解释",
    "按《项目缓存规范》修改当前架构图，再解释",
  ])(
    "keeps the saved diagram when a requested standard is unavailable (%s)",
    async (content) => {
      const { store, runtime } = await setupFixtureDraft();
      const run = await runtime.accept(
        ACCOUNT,
        CONVERSATION,
        { content },
        randomUUID(),
      );
      const frames = readFrames(
        await (await runtime.stream(ACCOUNT, run.runId)).text(),
      );
      expect(frames.some(({ frame }) => frame.type === "graph")).toBe(false);
      expect(await runtime.snapshot(ACCOUNT, run.runId)).toMatchObject({
        run: { status: "failed", error: { code: "AGENT_KNOWLEDGE_REQUIRED" } },
        assistantMessage: { graphSnapshot: null },
      });
      expect((await store.read(ACCOUNT)).conversations[0]).toMatchObject({
        draftVersion: 1,
        draftGraph: { nodes: [{ label: "订单服务" }] },
      });
    },
  );

  it("adds a product query cache without editing the order service named for preservation", async () => {
    const original = GraphInput.parse({
      nodes: [
        { id: "orders", type: "service", label: "订单服务" },
        { id: "products", type: "service", label: "商品服务" },
        { id: "database", type: "database", label: "业务数据库" },
      ],
      edges: [
        { id: "orders-db", source: "orders", target: "database" },
        { id: "products-db", source: "products", target: "database" },
      ],
    });
    const { store, runtime } = await setupFixtureDraft(original);
    const run = await runtime.accept(
      ACCOUNT,
      CONVERSATION,
      { content: "给商品查询加缓存，订单服务保持原样，再解释改完的流程" },
      randomUUID(),
    );
    await (await runtime.stream(ACCOUNT, run.runId)).text();
    const result = await runtime.snapshot(ACCOUNT, run.runId);
    const updated = GraphInput.parse(result.assistantMessage.graphSnapshot);
    const cache = updated.nodes.find(({ type }) => type === "cache");
    expect(cache).toBeDefined();
    expect(updated.edges.filter(({ source }) => source === "orders")).toEqual([
      { id: "orders-db", source: "orders", target: "database" },
    ]);
    expect(updated.edges).toContainEqual(
      expect.objectContaining({ source: "products", target: cache?.id }),
    );
    expect(result.assistantMessage.content).toContain(
      "商品服务后先访问查询缓存",
    );
    expect((await store.read(ACCOUNT)).conversations[0]?.draftVersion).toBe(2);
  });

  it("adds a cache to the requested query path even when a different cache exists", async () => {
    const store = setup();
    const initialGraph = GraphInput.parse({
      nodes: [
        { id: "gateway", type: "gateway", label: "API 网关" },
        { id: "service", type: "service", label: "订单服务" },
        { id: "cache", type: "cache", label: "网关缓存" },
        { id: "database", type: "database", label: "订单数据库" },
      ],
      edges: [
        { id: "entry", source: "gateway", target: "service" },
        { id: "gateway-cache", source: "gateway", target: "cache" },
        { id: "order-database", source: "service", target: "database" },
      ],
    });
    const fixture = createFixtureAgent();
    const runtime = createMockRunRuntime(store, {
      ...fixture,
      execute: async (turn, options) =>
        turn.input === "已有架构"
          ? { ...success("已有架构。"), graph: initialGraph }
          : fixture.execute(turn, options),
    });
    const original = await runtime.accept(
      ACCOUNT,
      CONVERSATION,
      { content: "已有架构" },
      randomUUID(),
    );
    await (await runtime.stream(ACCOUNT, original.runId)).text();
    const readOnly = await runtime.accept(
      ACCOUNT,
      CONVERSATION,
      { content: "解释这张架构图，不要修改缓存" },
      randomUUID(),
    );
    await (await runtime.stream(ACCOUNT, readOnly.runId)).text();
    expect(await runtime.snapshot(ACCOUNT, readOnly.runId)).toMatchObject({
      run: { status: "succeeded" },
      assistantMessage: { graphSnapshot: null },
    });
    expect((await store.read(ACCOUNT)).conversations[0]?.draftVersion).toBe(1);

    const query = { content: "给订单查询加缓存，再解释改完的流程。" };
    const edited = await runtime.accept(
      ACCOUNT,
      CONVERSATION,
      query,
      randomUUID(),
    );
    await (await runtime.stream(ACCOUNT, edited.runId)).text();
    const result = await runtime.snapshot(ACCOUNT, edited.runId);
    const graph = GraphInput.parse(result.assistantMessage.graphSnapshot);
    const queryCache = graph.nodes.find(({ label }) => label === "查询缓存");
    expect(queryCache).toBeDefined();
    expect(graph.edges).toEqual(expect.arrayContaining(initialGraph.edges));
    expect(graph.edges).toContainEqual(
      expect.objectContaining({ source: "service", target: queryCache?.id }),
    );
    expect(result.assistantMessage.content).toContain(
      "订单服务后先访问查询缓存",
    );

    const repeated = await runtime.accept(
      ACCOUNT,
      CONVERSATION,
      query,
      randomUUID(),
    );
    await (await runtime.stream(ACCOUNT, repeated.runId)).text();
    expect(await runtime.snapshot(ACCOUNT, repeated.runId)).toMatchObject({
      run: { status: "succeeded" },
      assistantMessage: { graphSnapshot: null },
    });
    expect((await store.read(ACCOUNT)).conversations[0]?.draftVersion).toBe(2);
  }, 10_000);

  it("saves one draft and one explanation after a composite task retries against its modified graph", async () => {
    const store = setup();
    let editCalls = 0;
    const explainedGraphs: (GraphInput | null)[] = [];
    const executeTask: AgentModel["executeTask"] = async (
      { turn, task },
      _signal,
      emit,
    ) => {
      if (task.intent === "edit_graph") {
        editCalls += 1;
        return {
          text: "已为订单查询添加缓存。",
          patch: {
            upsertNodes: [{ id: "cache", type: "cache", label: "查询缓存" }],
            removeNodeIds: [],
            upsertEdges: [
              { id: "read-cache", source: "service", target: "cache" },
            ],
            removeEdgeIds: [],
          },
        };
      }
      explainedGraphs.push(turn.draftGraph);
      if (explainedGraphs.length === 1) {
        expect((await store.read(ACCOUNT)).conversations[0]?.draftVersion).toBe(
          1,
        );
        await emit?.("第一次解释的半句。");
        throw new AgentExecutionError("AGENT_TASK_TIMEOUT", "模拟解释超时");
      }
      await emit?.("订单服务先查缓存。");
      return { text: "订单服务先查缓存。" };
    };
    const engine = createAgentEngine({
      model: {
        classify: async ({ input }) => ({
          intents: ["edit_graph", "explain_graph"],
          rewrittenInput: input,
          complexity: "complex",
          question: null,
          constraintUpdates: {},
        }),
        plan: async () => ({
          tasks: [
            {
              intent: "edit_graph",
              instruction: "增加查询缓存",
              requiresKnowledge: false,
            },
            {
              intent: "explain_graph",
              instruction: "说明修改后的查询",
              requiresKnowledge: false,
            },
          ],
        }),
        executeTask,
        resolveClarification: vi.fn(),
        generateExtras: vi.fn(),
      },
    });
    const runtime = createMockRunRuntime(store, {
      execute: (turn, options) =>
        turn.input === "订单服务初版"
          ? Promise.resolve(success("初版架构。", "订单服务"))
          : engine.execute(turn, options),
    });
    const original = await runtime.accept(
      ACCOUNT,
      CONVERSATION,
      { content: "订单服务初版" },
      randomUUID(),
    );
    await (await runtime.stream(ACCOUNT, original.runId)).text();
    const run = await runtime.accept(
      ACCOUNT,
      CONVERSATION,
      { content: "给订单查询加缓存，再解释修改后的流程。" },
      randomUUID(),
    );
    const frames = readFrames(
      await (await runtime.stream(ACCOUNT, run.runId)).text(),
    );
    expect(editCalls).toBe(1);
    expect(explainedGraphs).toHaveLength(2);
    expect(explainedGraphs[1]).toEqual(explainedGraphs[0]);
    expect(explainedGraphs[1]?.nodes).toContainEqual(
      expect.objectContaining({ label: "查询缓存" }),
    );
    const textInBrowser = frames.reduce((text, { frame }) => {
      if (frame.type !== "text-delta") return text;
      return frame.replace ? frame.content : text + frame.content;
    }, "");
    expect(textInBrowser).toBe("已为订单查询添加缓存。\n\n订单服务先查缓存。");
    expect(frames.filter(({ frame }) => frame.type === "graph")).toHaveLength(
      1,
    );
    expect(await runtime.snapshot(ACCOUNT, run.runId)).toMatchObject({
      run: { status: "succeeded" },
      assistantMessage: {
        content: textInBrowser,
        graphSnapshot: explainedGraphs[1],
      },
    });
    expect((await store.read(ACCOUNT)).conversations[0]).toMatchObject({
      draftVersion: 2,
      draftGraph: explainedGraphs[1],
    });
  });

  it("preserves text and releases the conversation when a process restarts mid-run", async () => {
    const store = setup();
    const finish = pendingGate();
    const previous = createMockRunRuntime(store, {
      execute: async (_turn, options) => {
        await options.onTextDelta("已写入的文字。", true);
        await finish.promise;
        return success("旧进程的迟到结果。", "旧结果");
      },
    });
    const run = await previous.accept(
      ACCOUNT,
      CONVERSATION,
      { content: "架构" },
      randomUUID(),
    );
    await vi.waitFor(async () => {
      expect(
        (await previous.snapshot(ACCOUNT, run.runId)).assistantMessage.content,
      ).toBe("已写入的文字。");
    });

    const current = createMockRunRuntime(store, {
      execute: async () => success("新任务。"),
    });
    expect(await current.active(ACCOUNT, CONVERSATION)).toMatchObject({
      run: null,
      latest: { runId: run.runId, status: "failed" },
    });
    expect(
      (await current.snapshot(ACCOUNT, run.runId)).assistantMessage.content,
    ).toBe("已写入的文字。");
    expect(
      (await store.read(ACCOUNT)).conversations[0]?.lastMessage,
    ).toMatchObject({
      id: run.assistantMessageId,
      contentPreview: "已写入的文字。",
    });
    finish.resolve();
    const retry = await current.accept(
      ACCOUNT,
      CONVERSATION,
      { content: "重新生成" },
      randomUUID(),
    );
    expect(retry.runId).not.toBe(run.runId);
    await (await current.stream(ACCOUNT, retry.runId)).text();
    expect((await store.read(ACCOUNT)).conversations[0]?.draftGraph).toBeNull();
  });

  it("persists queued text before cancel and never commits a late graph", async () => {
    const store = setup();
    const published = pendingGate();
    const finish = pendingGate();
    const runtime = createMockRunRuntime(store, {
      execute: async (turn, options) => {
        if (turn.input === "初始架构") return success("首版。", "已保存架构");
        await options.onTextDelta("取消前已经收到的文字。");
        published.resolve();
        await finish.promise;
        return success("迟到文字。", "迟到架构");
      },
    });
    const first = await runtime.accept(
      ACCOUNT,
      CONVERSATION,
      { content: "初始架构" },
      randomUUID(),
    );
    await (await runtime.stream(ACCOUNT, first.runId)).text();
    const run = await runtime.accept(
      ACCOUNT,
      CONVERSATION,
      { content: "生成新版" },
      randomUUID(),
    );
    await published.promise;
    expect(await runtime.cancel(ACCOUNT, run.runId)).toEqual({
      runId: run.runId,
      status: "canceled",
    });
    finish.resolve();

    const snapshot = await runtime.snapshot(ACCOUNT, run.runId);
    expect(snapshot.assistantMessage.content).toBe("取消前已经收到的文字。");
    expect(snapshot.assistantMessage.graphSnapshot).toBeNull();
    expect(
      (await store.read(ACCOUNT)).conversations[0]?.draftGraph?.nodes[0],
    ).toMatchObject({ label: "已保存架构" });
    expect(await runtime.cancel(ACCOUNT, run.runId)).toMatchObject({
      status: "canceled",
    });
    expect(await runtime.active(ACCOUNT, CONVERSATION)).toMatchObject({
      run: null,
    });
  });

  it("resumes a persisted option card from disk on the same run", async ({
    onTestFinished,
  }) => {
    const directory = await mkdtemp(join(tmpdir(), "archflow-mock-restart-"));
    vi.stubEnv("ARCHFLOW_MOCK_DIR", directory);
    onTestFinished(async () => {
      vi.unstubAllEnvs();
      await rm(directory, { recursive: true, force: true });
    });
    const seed = await setup().read(ACCOUNT);
    await updateMockDatabase(ACCOUNT, (database) => {
      database.conversations.push(...seed.conversations);
    });
    const store = { read: readMockDatabase, update: updateMockDatabase };
    const driver = {
      clarificationOptions: () => [{ label: "订单服务", value: "订单服务" }],
      execute: async (
        turn: { input: string },
        { resume }: { resume?: { answer: string } },
      ): Promise<AgentTurnResult> => {
        if (resume) return success(`架构属于${resume.answer}。`, resume.answer);
        const question = "给哪个系统画图？";
        return {
          status: "waiting_input",
          text: question,
          constraints: {},
          checkpoint: {
            decision: {
              intents: ["generate_graph"],
              rewrittenInput: turn.input,
              question,
              complexity: "simple",
              constraintUpdates: {},
            },
            attempts: 1,
            question,
          },
        };
      },
    };
    const initialRuntime = createMockRunRuntime(store, driver);
    const pending = await initialRuntime.accept(
      ACCOUNT,
      CONVERSATION,
      { content: "画图" },
      randomUUID(),
    );
    const before = readFrames(
      await (await initialRuntime.stream(ACCOUNT, pending.runId)).text(),
    );
    const paused = before.at(-1);
    expect(paused?.frame.type).toBe("interrupt");
    expect(before.some(({ frame }) => frame.type === "done")).toBe(false);

    const runtime = createMockRunRuntime(store, driver);
    const restored = readFrames(
      await (await runtime.stream(ACCOUNT, pending.runId)).text(),
    );
    expect(restored).toMatchObject([
      {
        id: paused?.id,
        frame: {
          type: "snapshot",
          run: { id: pending.runId, status: "waiting_input" },
          assistantMessage: {
            id: pending.assistantMessageId,
            metadata: { card: { status: "pending" } },
          },
        },
      },
    ]);
    const waiting = await runtime.snapshot(ACCOUNT, pending.runId);
    const card = waiting.assistantMessage.metadata?.card;
    expect(waiting.run.status).toBe("waiting_input");
    expect(card).toMatchObject({ kind: "single", status: "pending" });
    const answer = { content: "订单服务", interruptId: card?.id };
    const resumed = await runtime.accept(
      ACCOUNT,
      CONVERSATION,
      answer,
      randomUUID(),
    );
    const duplicate = await runtime.accept(
      ACCOUNT,
      CONVERSATION,
      answer,
      randomUUID(),
    );
    expect(resumed).toMatchObject({
      runId: pending.runId,
      assistantMessageId: pending.assistantMessageId,
    });
    expect(duplicate.runId).toBe(pending.runId);
    await expect(
      runtime.accept(
        ACCOUNT,
        CONVERSATION,
        { ...answer, content: "库存服务" },
        randomUUID(),
      ),
    ).rejects.toMatchObject({ code: "IDEMPOTENCY_KEY_REUSED" });
    const replay = readFrames(
      await (await runtime.stream(ACCOUNT, pending.runId, paused?.id)).text(),
    );
    expect(replay.some(({ frame }) => frame.type === "interrupt")).toBe(false);
    expect(replay).toContainEqual({
      id: expect.any(Number),
      frame: expect.objectContaining({ type: "run-start", resume: true }),
    });
    expect(await runtime.snapshot(ACCOUNT, pending.runId)).toMatchObject({
      run: { status: "succeeded" },
      assistantMessage: {
        content: "架构属于订单服务。",
        graphSnapshot: { nodes: [{ label: "订单服务" }] },
        metadata: {
          card: {
            status: "answered",
            answer: { values: ["订单服务"], isCustom: false },
          },
        },
      },
    });
    expect((await store.read(ACCOUNT)).conversations[0]).toMatchObject({
      lastMessage: {
        id: pending.assistantMessageId,
        contentPreview: "架构属于订单服务。",
      },
      messages: [
        { role: "user", content: "画图" },
        { role: "user", content: "订单服务" },
        {
          role: "assistant",
          id: pending.assistantMessageId,
          content: "架构属于订单服务。",
        },
      ],
    });
  });

  it("marks suggestions complete without changing the successful run when extras fail", async () => {
    const store = setup();
    const runtime = createMockRunRuntime(store, {
      execute: async () => success("已经成功的回复。"),
      generateExtras: async () => {
        throw new Error("辅助内容服务不可用");
      },
    });
    const run = await runtime.accept(
      ACCOUNT,
      CONVERSATION,
      { content: "架构" },
      randomUUID(),
    );
    await (await runtime.stream(ACCOUNT, run.runId)).text();
    await vi.waitFor(async () => {
      expect(await runtime.snapshot(ACCOUNT, run.runId)).toMatchObject({
        run: { status: "succeeded" },
        assistantMessage: { metadata: { suggestedQuestions: [] } },
      });
    });
  });
});
