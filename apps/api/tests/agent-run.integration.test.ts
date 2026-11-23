import "reflect-metadata";
import { randomUUID } from "node:crypto";
import {
  AgentStateEntity,
  ConversationEntity,
  createDataSource,
  DocumentChunkEntity,
  KnowledgeFileEntity,
  ProjectEntity,
  UserEntity,
} from "@arch-flow/db";
import { createAgentEngine } from "@arch-flow/agent";
import type { AgentTurnResult, Graph } from "@arch-flow/shared";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { AgentRunService } from "../src/modules/run/agent-run.service.js";
import { createKnowledgeSearch } from "../src/modules/run/knowledge-search.js";

const testUrl = process.env.ARCHFLOW_TEST_DATABASE_URL;

describe.runIf(Boolean(testUrl))("Agent runtime with PostgreSQL", () => {
  const dataSource = createDataSource(
    testUrl ?? "postgres://localhost/archflow_unused",
  );

  beforeAll(async () => {
    await dataSource.initialize();
    await dataSource.runMigrations();
  }, 20_000);

  afterAll(async () => {
    if (dataSource.isInitialized) await dataSource.destroy();
  });

  const createConversation = async () => {
    const owner = await dataSource.getRepository(UserEntity).save({
      email: `${randomUUID()}@archflow.test`,
      username: "tester",
      passwordHash: "fixture",
    });
    const project = await dataSource
      .getRepository(ProjectEntity)
      .save({ userId: owner.id, projectName: "测试项目" });
    const conversation = await dataSource
      .getRepository(ConversationEntity)
      .save({ projectId: project.id });
    return { owner, project, conversation };
  };

  const createService = (result: AgentTurnResult) => {
    const execute = vi
      .fn<ReturnType<typeof createAgentEngine>["execute"]>()
      .mockResolvedValue(result);
    const generateExtras = vi
      .fn<ReturnType<typeof createAgentEngine>["generateExtras"]>()
      .mockResolvedValue({ title: null, suggestedQuestions: [] });
    return {
      service: new AgentRunService({ dataSource }, { execute, generateExtras }),
      execute,
      generateExtras,
    };
  };

  const graph: Graph = {
    nodes: [{ id: "web", label: "应用", type: "client" }],
    edges: [],
  };

  it("checks ownership and replays the same accepted run for a duplicate key", async () => {
    const { owner, conversation } = await createConversation();
    const { service } = createService({
      status: "succeeded",
      graph,
      constraints: {},
      citations: [],
      text: "生成完成",
    });
    const key = randomUUID();
    const message = { content: "设计架构" };
    await expect(
      service.accept(randomUUID(), conversation.uuid, message, key),
    ).rejects.toMatchObject({ response: { code: "CONVERSATION_NOT_FOUND" } });
    const first = await service.accept(
      owner.uuid,
      conversation.uuid,
      message,
      key,
    );
    const repeated = await service.accept(
      owner.uuid,
      conversation.uuid,
      message,
      key,
    );
    expect(repeated).toMatchObject(first);
    await expect(
      service.accept(
        owner.uuid,
        conversation.uuid,
        { content: "别的请求" },
        key,
      ),
    ).rejects.toMatchObject({ response: { code: "IDEMPOTENCY_KEY_REUSED" } });
    await expect(
      service.accept(owner.uuid, conversation.uuid, message, randomUUID()),
    ).rejects.toMatchObject({ response: { code: "CONVERSATION_BUSY" } });
  });

  it("persists clarification and consumes an interrupt once on the same run", async () => {
    const { owner, conversation } = await createConversation();
    const checkpoint = {
      decision: {
        intents: ["generate_graph" as const],
        complexity: "simple" as const,
        rewrittenInput: "画图",
        question: "项目类型？",
        constraintUpdates: {},
      },
      question: "项目类型？",
      attempts: 1,
    };
    const { service, execute, generateExtras } = createService({
      status: "waiting_input",
      checkpoint,
      constraints: {},
      text: checkpoint.question,
    });
    const first = await service.accept(
      owner.uuid,
      conversation.uuid,
      { content: "画图" },
      randomUUID(),
    );
    await service.execute(owner.uuid, first.id);
    const waiting = await service.snapshot(owner.uuid, first.id);
    expect(waiting.run.status).toBe("waiting_input");
    expect(waiting.message.content).toBe(checkpoint.question);
    expect(waiting.interrupt).not.toBeNull();
    expect(generateExtras).not.toHaveBeenCalled();
    const interruptId = waiting.interrupt?.interruptId ?? "";
    const resumed = await service.accept(
      owner.uuid,
      conversation.uuid,
      { content: "库存系统" },
      randomUUID(),
    );
    expect(resumed).toMatchObject({
      id: first.id,
      userMessageId: first.userMessageId,
      assistantMessageId: first.assistantMessageId,
      status: "queued",
    });
    execute.mockResolvedValue({
      status: "succeeded",
      graph,
      constraints: { projectGoal: "库存系统" },
      citations: [],
      text: "生成完成",
    });
    await service.execute(owner.uuid, first.id);
    const replayed = await service.resume(
      owner.uuid,
      first.id,
      interruptId,
      "库存系统",
    );
    expect(replayed.status).toBe("succeeded");
    expect(execute).toHaveBeenCalledTimes(2);
    expect(execute).toHaveBeenLastCalledWith(
      expect.objectContaining({ input: "画图" }),
      expect.objectContaining({ resume: { checkpoint, answer: "库存系统" } }),
    );
    const saved = await dataSource
      .getRepository(ConversationEntity)
      .findOneByOrFail({ id: conversation.id });
    expect(saved).toMatchObject({ draftVersion: 1, currentDraftGraph: graph });
    expect(
      (
        await dataSource
          .getRepository(AgentStateEntity)
          .findOneByOrFail({ conversationId: conversation.id })
      ).constraintsData,
    ).toEqual({ projectGoal: "库存系统" });
  });

  it("keeps a newer draft when the current run finishes against a stale version", async () => {
    const { owner, conversation } = await createConversation();
    const { service, execute } = createService({
      status: "succeeded",
      graph,
      constraints: {},
      citations: [],
      text: "生成完成",
    });
    const newer: Graph = {
      nodes: [{ id: "edited", type: "service", label: "较新的画布" }],
      edges: [],
    };
    execute.mockImplementation(async () => {
      await dataSource
        .getRepository(ConversationEntity)
        .update(conversation.id, { draftVersion: 1, currentDraftGraph: newer });
      return {
        status: "succeeded",
        graph,
        constraints: {},
        citations: [],
        text: "生成完成",
      };
    });
    const run = await service.accept(
      owner.uuid,
      conversation.uuid,
      { content: "画图" },
      randomUUID(),
    );
    await service.execute(owner.uuid, run.id);
    expect((await service.snapshot(owner.uuid, run.id)).run).toMatchObject({
      status: "failed",
      error: { code: "DRAFT_VERSION_CONFLICT" },
    });
    expect(
      await dataSource
        .getRepository(ConversationEntity)
        .findOneByOrFail({ id: conversation.id }),
    ).toMatchObject({ draftVersion: 1, currentDraftGraph: newer });
  });

  it("saves suggestions after completion without overwriting a manually renamed title", async () => {
    const { owner, conversation } = await createConversation();
    const { service, generateExtras } = createService({
      status: "succeeded",
      graph,
      constraints: {},
      citations: [],
      text: "生成完成",
    });
    let resolveExtras: (extras: {
      title: string;
      suggestedQuestions: string[];
    }) => void = () => undefined;
    generateExtras.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveExtras = resolve;
        }),
    );

    const run = await service.accept(
      owner.uuid,
      conversation.uuid,
      { content: "画图" },
      randomUUID(),
    );
    await service.execute(owner.uuid, run.id);
    expect((await service.snapshot(owner.uuid, run.id)).run.status).toBe(
      "succeeded",
    );
    await dataSource
      .getRepository(ConversationEntity)
      .update(conversation.id, { title: "我的图" });
    resolveExtras({ title: "自动标题", suggestedQuestions: ["如何扩容？"] });

    await vi.waitFor(async () => {
      expect(
        (await service.snapshot(owner.uuid, run.id)).message.metadata
          ?.suggestedQuestions,
      ).toEqual(["如何扩容？"]);
    });
    expect(
      (
        await dataSource
          .getRepository(ConversationEntity)
          .findOneByOrFail({ id: conversation.id })
      ).title,
    ).toBe("我的图");
  });

  it("returns only ready chunks from the authorized project and attachment selection", async () => {
    const { project } = await createConversation();
    const other = await createConversation();
    const vector = [1, ...Array<number>(1535).fill(0)];
    const addChunk = async (
      projectId: string,
      fileName: string,
      status: string,
    ) => {
      const file = await dataSource
        .getRepository(KnowledgeFileEntity)
        .save({
          projectId,
          fileName,
          status,
          fileType: "text",
          mimeType: "text/plain",
          fileUrl: `file/${fileName}`,
        });
      await dataSource
        .getRepository(DocumentChunkEntity)
        .save({
          projectId,
          knowledgeId: file.id,
          content: fileName,
          embedding: JSON.stringify(vector),
        });
      return file;
    };
    const visible = await addChunk(project.id, "可检索.md", "ready");
    await addChunk(project.id, "未解析.md", "processing");
    const privateFile = await addChunk(
      other.project.id,
      "其他项目.md",
      "ready",
    );
    const search = createKnowledgeSearch(dataSource, async () => [vector]);
    await expect(
      search({ projectId: project.uuid, attachments: [], query: "项目需求" }),
    ).resolves.toEqual([
      {
        fileId: visible.uuid,
        fileName: "可检索.md",
        snippet: "可检索.md",
        score: 1,
      },
    ]);
    await expect(
      search({
        projectId: project.uuid,
        attachments: [privateFile.uuid],
        query: "项目需求",
      }),
    ).resolves.toEqual([]);
  });
});
