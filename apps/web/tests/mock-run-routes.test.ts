import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  ApiResponseSchema,
  AuthResult,
  ERROR_CODES,
  MockActiveRun,
  MockRunAccepted,
  MockRunSnapshot,
  ProjectNode,
  parseMockSseData,
  type Message,
} from "@arch-flow/shared";
import { describe, expect, it, vi } from "vitest";
import { POST as register } from "../app/api/mock/auth/[action]/route";
import { POST as sendMessage } from "../app/api/mock/conversations/[conversationId]/messages/route";
import { GET as getActive } from "../app/api/mock/conversations/[conversationId]/run/route";
import { POST as cancelRun } from "../app/api/mock/runs/[runId]/cancel/route";
import { GET as getRun } from "../app/api/mock/runs/[runId]/route";
import { GET as getStream } from "../app/api/mock/runs/[runId]/stream/route";
import { POST as createProject } from "../app/api/mock/projects/route";
import {
  createConversation,
  createProject as createStoredProject,
  readMockDatabase,
  updateMockDatabase,
} from "../lib/mock-db";

const ORIGIN = "http://localhost:3000";

const request = (path: string, options: RequestInit = {}) => {
  const headers = new Headers(options.headers);
  headers.set("Origin", ORIGIN);
  if (options.body) headers.set("Content-Type", "application/json");
  return new Request(`${ORIGIN}${path}`, { ...options, headers });
};

const registerAccount = async (email: string) => {
  const response = await register(
    request("/api/mock/auth/register", {
      method: "POST",
      headers: { "Idempotency-Key": randomUUID() },
      body: JSON.stringify({
        username: "AC2 test",
        email,
        password: "test-password",
      }),
    }),
    { params: Promise.resolve({ action: "register" }) },
  );
  expect(response.status).toBe(201);
  const { data } = ApiResponseSchema(AuthResult).parse(await response.json());
  if (!data) throw new Error("注册未返回数据");
  return {
    userId: data.user.id,
    headers: { Authorization: `Bearer ${data.accessToken}` },
  };
};

const historicalMessage = (
  id: string,
  graphSnapshot: Message["graphSnapshot"],
  role: Message["role"] = "assistant",
): Message => ({
  id,
  graphSnapshot,
  role,
  content: id,
  metadata: null,
  createdAt: new Date().toISOString(),
});

const seedHistory = (
  userId: string,
  conversationId: string,
  messages: Message[],
) =>
  updateMockDatabase(userId, (database) => {
    const conversation = database.conversations.find(
      ({ id }) => id === conversationId,
    );
    if (!conversation) throw new Error("测试会话不存在");
    conversation.messages.push(...messages);
    conversation.messageCount = conversation.messages.length;
  });

const historicalGraph = {
  nodes: [{ id: "orders", type: "service", label: "历史订单服务" }],
  edges: [],
};

const createReferenceProject = async (userId: string) => {
  const project = await createStoredProject(
    userId,
    { name: "历史图测试" },
    randomUUID(),
  );
  if (!project?.lastActiveConversationId)
    throw new Error("创建项目没有返回会话");
  return {
    conversationId: project.lastActiveConversationId,
    projectId: project.id,
  };
};

const submitReference = (
  headers: Record<string, string>,
  conversationId: string,
  graphReferenceMessageId: string,
  key = randomUUID(),
) =>
  sendMessage(
    request(`/api/mock/conversations/${conversationId}/messages`, {
      method: "POST",
      headers: { ...headers, "Idempotency-Key": key },
      body: JSON.stringify({ content: "解释这张图", graphReferenceMessageId }),
    }),
    { params: Promise.resolve({ conversationId }) },
  );

describe("local mock run endpoints", () => {
  it("accepts a run, scopes its stream and cancel to the owner, and persists the streamed answer", async () => {
    const directory = await mkdtemp(join(tmpdir(), "archflow-mock-runs-"));
    vi.stubEnv("ARCHFLOW_MOCK_DIR", directory);
    try {
      const { headers: owner } = await registerAccount("owner@example.com");
      const { headers: outsider } = await registerAccount("other@example.com");
      const projectResponse = await createProject(
        request("/api/mock/projects", {
          method: "POST",
          headers: { ...owner, "Idempotency-Key": randomUUID() },
          body: JSON.stringify({ name: "运行测试" }),
        }),
      );
      const { data: project } = ApiResponseSchema(ProjectNode).parse(
        await projectResponse.json(),
      );
      const conversationId = project?.lastActiveConversationId;
      if (!conversationId) throw new Error("创建项目没有返回会话");
      const conversationContext = {
        params: Promise.resolve({ conversationId }),
      };
      const conversationPath = `/api/mock/conversations/${conversationId}`;
      const acceptedResponse = await sendMessage(
        request(`${conversationPath}/messages`, {
          method: "POST",
          headers: { ...owner, "Idempotency-Key": randomUUID() },
          body: JSON.stringify({ content: "请帮我设计订单服务的架构图" }),
        }),
        conversationContext,
      );
      expect(acceptedResponse.status).toBe(202);
      const { data: accepted } = ApiResponseSchema(MockRunAccepted).parse(
        await acceptedResponse.json(),
      );
      if (!accepted) throw new Error("受理未返回运行句柄");

      const activeResponse = await getActive(
        request(`${conversationPath}/run`, { headers: owner }),
        conversationContext,
      );
      const { data: active } = ApiResponseSchema(MockActiveRun).parse(
        await activeResponse.json(),
      );
      expect(active?.run?.runId).toBe(accepted.runId);
      const runContext = { params: Promise.resolve({ runId: accepted.runId }) };
      const runPath = `/api/mock/runs/${accepted.runId}`;
      expect(
        (await getStream(request(accepted.streamUrl), runContext)).status,
      ).toBe(401);
      expect(
        (
          await getStream(
            request(accepted.streamUrl, { headers: outsider }),
            runContext,
          )
        ).status,
      ).toBe(404);
      expect(
        (
          await cancelRun(
            request(`${runPath}/cancel`, { method: "POST", headers: outsider }),
            runContext,
          )
        ).status,
      ).toBe(404);
      const stream = await getStream(
        request(accepted.streamUrl, { headers: owner }),
        runContext,
      );
      expect(stream.headers.get("Content-Type")).toContain("text/event-stream");
      const frames = (await stream.text())
        .split("\n")
        .filter((line) => line.startsWith("data: "))
        .map((line) => parseMockSseData(line.slice(6)));
      expect(
        frames.filter((frame) => frame?.type === "text-delta").length,
      ).toBeGreaterThan(1);
      expect(frames.at(-2)).toMatchObject({
        type: "done",
        finishReason: "stop",
      });

      const snapshotResponse = await getRun(
        request(runPath, { headers: owner }),
        runContext,
      );
      const { data: snapshot } = ApiResponseSchema(MockRunSnapshot).parse(
        await snapshotResponse.json(),
      );
      expect(snapshot).toMatchObject({
        run: { id: accepted.runId, status: "succeeded" },
        assistantMessage: {
          id: accepted.assistantMessageId,
          content: expect.stringContaining("订单服务"),
        },
      });
      expect(snapshot?.assistantMessage.graphSnapshot?.nodes).toContainEqual(
        expect.objectContaining({ label: "订单服务" }),
      );
      await vi.waitFor(async () => {
        const response = await getRun(
          request(runPath, { headers: owner }),
          runContext,
        );
        const { data } = ApiResponseSchema(MockRunSnapshot).parse(
          await response.json(),
        );
        expect(
          data?.assistantMessage.metadata?.suggestedQuestions,
        ).toBeDefined();
      });
    } finally {
      vi.unstubAllEnvs();
      await rm(directory, { recursive: true, force: true });
    }
  }, 10_000);

  it("rejects unavailable graph references before writing a message or run", async () => {
    const directory = await mkdtemp(join(tmpdir(), "archflow-mock-runs-"));
    vi.stubEnv("ARCHFLOW_MOCK_DIR", directory);
    try {
      const owner = await registerAccount("owner@example.com");
      const outsider = await registerAccount("other@example.com");
      const { conversationId, projectId } = await createReferenceProject(
        owner.userId,
      );
      const outsiderProject = await createReferenceProject(outsider.userId);
      const otherConversation = await createConversation(
        owner.userId,
        projectId,
        {},
      );
      if (otherConversation.status !== "created")
        throw new Error("创建另一会话失败");

      await seedHistory(owner.userId, conversationId, [
        historicalMessage("user-graph", historicalGraph, "user"),
        historicalMessage("no-graph", null),
        historicalMessage("invalid-graph", {
          ...historicalGraph,
          edges: [{ id: "broken", source: "orders", target: "missing-node" }],
        }),
      ]);
      await seedHistory(owner.userId, otherConversation.conversation.id, [
        historicalMessage("other-session", historicalGraph),
      ]);
      await seedHistory(outsider.userId, outsiderProject.conversationId, [
        historicalMessage("other-account", historicalGraph),
      ]);

      const invalidId = await submitReference(
        owner.headers,
        conversationId,
        "not/an/id",
      );
      expect(invalidId.status).toBe(400);
      expect(await invalidId.json()).toMatchObject({
        code: ERROR_CODES.VALIDATION_FAILED,
        errors: [expect.objectContaining({ field: "graphReferenceMessageId" })],
      });

      for (const reference of [
        "missing",
        "other-session",
        "other-account",
        "user-graph",
        "no-graph",
        "invalid-graph",
      ]) {
        const response = await submitReference(
          owner.headers,
          conversationId,
          reference,
        );
        expect(response.status, reference).toBe(404);
        expect(await response.json()).toMatchObject({
          code: ERROR_CODES.MESSAGE_NOT_FOUND,
          data: null,
        });
      }

      const database = await readMockDatabase(owner.userId);
      const conversation = database.conversations.find(
        ({ id }) => id === conversationId,
      );
      expect(conversation?.messages.map(({ id }) => id)).toEqual([
        "user-graph",
        "no-graph",
        "invalid-graph",
      ]);
      expect(conversation?.runs ?? []).toEqual([]);
    } finally {
      vi.unstubAllEnvs();
      await rm(directory, { recursive: true, force: true, maxRetries: 3 });
    }
  });

  it("accepts opaque legacy message IDs and detects changed references on idempotent retry", async () => {
    const directory = await mkdtemp(join(tmpdir(), "archflow-mock-runs-"));
    vi.stubEnv("ARCHFLOW_MOCK_DIR", directory);
    try {
      const owner = await registerAccount("owner@example.com");
      const { conversationId } = await createReferenceProject(owner.userId);
      await seedHistory(owner.userId, conversationId, [
        historicalMessage("example-message_01", {
          nodes: [
            {
              id: "old-orders",
              kind: "service",
              eyebrow: "应用层",
              label: "旧版订单服务",
              meta: null,
              left: 30,
              top: 50,
            },
            {
              id: "old-data",
              kind: "database",
              eyebrow: "存储层",
              label: "旧版数据库",
              meta: null,
              left: 60,
              top: 50,
            },
          ],
          edges: [{ id: "old-query", path: "M 30.0,50 L 60 50.0" }],
        }),
        historicalMessage("example-message_02", historicalGraph),
      ]);

      const key = randomUUID();
      const response = await submitReference(
        owner.headers,
        conversationId,
        "example-message_01",
        key,
      );
      expect(response.status).toBe(202);
      const { data: accepted } = ApiResponseSchema(MockRunAccepted).parse(
        await response.json(),
      );
      if (!accepted) throw new Error("受理未返回运行句柄");

      const replay = await submitReference(
        owner.headers,
        conversationId,
        "example-message_01",
        key,
      );
      expect(replay.status).toBe(202);
      expect(await replay.json()).toMatchObject({
        data: { runId: accepted.runId },
      });

      const conflict = await submitReference(
        owner.headers,
        conversationId,
        "example-message_02",
        key,
      );
      expect(conflict.status).toBe(422);
      expect(await conflict.json()).toMatchObject({
        code: ERROR_CODES.IDEMPOTENCY_KEY_REUSED,
      });

      await vi.waitFor(
        async () => {
          const database = await readMockDatabase(owner.userId);
          const conversation = database.conversations.find(
            ({ id }) => id === conversationId,
          );
          const assistant = conversation?.messages.find(
            ({ id }) => id === accepted.assistantMessageId,
          );
          expect(conversation?.runs).toMatchObject([
            {
              id: accepted.runId,
              status: "succeeded",
              graphReferenceMessageId: "example-message_01",
            },
          ]);
          expect(assistant?.content).toContain("旧版订单服务");
          expect(assistant?.content).toContain("旧版订单服务 → 旧版数据库");
          expect(assistant?.metadata?.suggestedQuestions).toBeDefined();
        },
        { timeout: 7000 },
      );
    } finally {
      vi.unstubAllEnvs();
      await rm(directory, { recursive: true, force: true });
    }
  }, 10_000);
});
