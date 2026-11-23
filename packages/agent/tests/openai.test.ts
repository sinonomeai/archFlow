import { AgentTaskResult, type AgentTurn } from "@arch-flow/shared";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createAgentEngine, createOpenAIAdapter } from "../src/index.js";

const turn: AgentTurn = {
  runId: "run-1",
  conversationId: "session-1",
  projectId: "project-1",
  input: "解释当前架构图",
  history: [],
  draftGraph: {
    nodes: [{ id: "api", type: "service", label: "应用 API" }],
    edges: [],
  },
  draftVersion: 1,
  constraints: {},
  attachments: [],
};

const completion = {
  id: "completion-1",
  model: "mock-chat",
  created: 1,
};

const providerStream = () => {
  const encoder = new TextEncoder();
  let output: ReadableStreamDefaultController<Uint8Array>;
  const body = new ReadableStream<Uint8Array>({
    start: (controller) => {
      output = controller;
    },
  });
  const send = (text: string | null, finishReason: string | null = null) => {
    const chunk = {
      ...completion,
      object: "chat.completion.chunk",
      choices: [
        { index: 0, delta: { content: text }, finish_reason: finishReason },
      ],
    };
    output.enqueue(encoder.encode(`data: ${JSON.stringify(chunk)}\n\n`));
  };
  const close = () => {
    output.enqueue(encoder.encode("data: [DONE]\n\n"));
    output.close();
  };
  return {
    send,
    close,
    response: new Response(body, {
      headers: { "Content-Type": "text/event-stream" },
    }),
  };
};

const setup = (
  stream: Response,
  bufferedResult: unknown = { text: "应用 API 接收请求并返回结果。" },
) => {
  const fetch = vi.fn<typeof globalThis.fetch>(async (_input, init) => {
    const body: unknown = JSON.parse(String(init?.body));
    if (typeof body === "object" && body && "stream" in body && body.stream)
      return stream;

    return Response.json({
      ...completion,
      object: "chat.completion",
      choices: [
        {
          index: 0,
          finish_reason: "stop",
          message: {
            role: "assistant",
            content: JSON.stringify(bufferedResult),
          },
        },
      ],
    });
  });
  vi.stubGlobal("fetch", fetch);
  const engine = createAgentEngine(
    createOpenAIAdapter({ chat: { apiKey: "test-only", model: "mock-chat" } }),
  );
  return { engine, fetch };
};

afterEach(() => vi.unstubAllGlobals());

describe("OpenAI narrative streaming", () => {
  it("publishes a provider chunk before the next chunk or terminal result exists", async () => {
    const provider = providerStream();
    const { engine, fetch } = setup(provider.response);
    let visible = "";
    let finished = false;
    provider.send("应用 API 接收请求");
    const execution = engine.execute(turn, {
      onTextDelta: (delta, replace) => {
        visible = replace ? delta : visible + delta;
      },
      onStage: (stage) => {
        if (stage === "finalizing") finished = true;
      },
    });

    try {
      await vi.waitFor(() => expect(visible).toBe("应用 API 接收请求"));
      expect(finished).toBe(false);
    } finally {
      provider.send("并返回结果。  ");
      provider.send(null, "stop");
      provider.close();
    }

    await expect(execution).resolves.toMatchObject({
      status: "succeeded",
      text: "应用 API 接收请求并返回结果。",
    });
    expect(visible).toBe("应用 API 接收请求并返回结果。");
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("stops delivering text immediately when the caller cancels", async () => {
    const provider = providerStream();
    provider.send("应用 API 接收请求");
    provider.send("并返回结果。");
    provider.send(null, "stop");
    provider.close();
    const { engine, fetch } = setup(provider.response);
    const controller = new AbortController();
    const canceled = new Error("用户取消生成");
    const received: string[] = [];

    await expect(
      engine.execute(turn, {
        signal: controller.signal,
        onTextDelta: (delta) => {
          received.push(delta);
          controller.abort(canceled);
        },
      }),
    ).rejects.toBe(canceled);
    expect(received).toEqual(["应用 API 接收请求"]);
    expect(fetch.mock.calls[0]?.[1]?.signal?.aborted).toBe(true);
  });

  it("distinguishes provider explanation timeout from cancellation of the run", async () => {
    const provider = providerStream();
    provider.send("应用 API 接收请求");
    provider.send(null, "stop");
    provider.close();
    const { engine } = setup(provider.response);
    const timeout = new AbortController();
    const timeouts = vi
      .spyOn(AbortSignal, "timeout")
      .mockReturnValueOnce(timeout.signal);

    try {
      await expect(
        engine.execute(turn, {
          onTextDelta: () =>
            timeout.abort(new DOMException("提供方超时", "TimeoutError")),
        }),
      ).rejects.toMatchObject({ code: "AGENT_TASK_TIMEOUT" });
    } finally {
      timeouts.mockRestore();
    }
  });

  it("gives the explanation model only the selected read-only graph", async () => {
    const provider = providerStream();
    provider.close();
    const { engine, fetch } = setup(provider.response);
    const referencedGraph = {
      messageId: "snapshot-1",
      graph: {
        nodes: [{ id: "old", type: "service" as const, label: "旧版 API" }],
        edges: [],
      },
    };

    await expect(
      engine.execute({ ...turn, input: "解释这张架构图", referencedGraph }),
    ).resolves.toMatchObject({ status: "succeeded", graph: null });

    const requestBody = String(fetch.mock.calls[0]?.[1]?.body);
    expect(requestBody).toContain("只读");
    expect(requestBody).toContain("snapshot-1");
    expect(requestBody).toContain("旧版 API");
    expect(requestBody).not.toContain("应用 API");
  });

  it.each([null, "length"])(
    "rejects a partial answer without a successful finish (%s)",
    async (finishReason) => {
      const provider = providerStream();
      provider.send("应用 API 接收请求");
      if (finishReason) provider.send(null, finishReason);
      provider.close();
      const { engine, fetch } = setup(provider.response);
      const received: string[] = [];

      await expect(
        engine.execute(turn, {
          onTextDelta: (delta) => {
            received.push(delta);
          },
        }),
      ).rejects.toMatchObject({ code: "AGENT_INVALID_RESPONSE" });
      expect(received).toEqual(["应用 API 接收请求"]);
      expect(fetch).toHaveBeenCalledTimes(1);
    },
  );

  it("applies the same trimmed length limit as the shared text contract", async () => {
    const provider = providerStream();
    const text = "架".repeat(AgentTaskResult.shape.text.maxLength ?? 0);
    provider.send(`  ${text}  `);
    provider.send(null, "stop");
    provider.close();
    const { engine } = setup(provider.response);
    let received = "";

    await expect(
      engine.execute(turn, {
        onTextDelta: (delta, replace) => {
          received = replace ? delta : received + delta;
        },
      }),
    ).resolves.toMatchObject({ text });
    expect(received).toBe(text);
  });

  it("uses one buffered request for callers without a text sink", async () => {
    const provider = providerStream();
    provider.close();
    const { engine, fetch } = setup(provider.response);

    await expect(engine.execute(turn)).resolves.toMatchObject({
      text: "应用 API 接收请求并返回结果。",
    });
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(JSON.parse(String(fetch.mock.calls[0]?.[1]?.body))).toMatchObject({
      response_format: { type: "json_object" },
    });
  });

  it("publishes validated graph narration from one structured request", async () => {
    const provider = providerStream();
    provider.close();
    const { engine, fetch } = setup(provider.response, {
      text: "方案使用应用 API 提供服务。",
      graph: turn.draftGraph,
    });
    const received: string[] = [];

    await expect(
      engine.execute(
        {
          ...turn,
          input: "生成架构图",
          constraints: { projectGoal: "校内活动平台" },
        },
        {
          onTextDelta: (delta) => {
            received.push(delta);
          },
        },
      ),
    ).resolves.toMatchObject({
      text: "方案使用应用 API 提供服务。",
      graph: turn.draftGraph,
    });
    expect(received).toEqual(["方案使用应用 API 提供服务。"]);
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(JSON.parse(String(fetch.mock.calls[0]?.[1]?.body))).toMatchObject({
      response_format: { type: "json_object" },
    });
  });
});
