import "server-only";

import {
  AgentExecutionError,
  createAgentEngine,
  createOpenAIAdapter,
} from "@arch-flow/agent";
import { ERROR_CODES } from "@arch-flow/shared";
import { createFixtureAgent } from "./fixture-agent";
import { readMockDatabase, updateMockDatabase } from "./mock-db";
import { MockRunError } from "./mock-run-data";
import { createMockRunRuntime, type MockRunDriver } from "./mock-run-runtime";

const PREVIEW_AGENT_ENABLED =
  process.env.NODE_ENV === "development" &&
  process.env.ARCHFLOW_PREVIEW_AGENT === "1";

let engine: ReturnType<typeof createAgentEngine> | undefined;

const getEngine = () => {
  if (engine) return engine;

  const apiKey = process.env.OPENAI_API_KEY;
  const model = process.env.OPENAI_MODEL;
  if (!apiKey || !model) {
    throw new MockRunError(
      503,
      ERROR_CODES.SERVICE_UNAVAILABLE,
      "请先在 Web 服务中配置 Agent 的模型和 API Key。",
    );
  }

  const baseURL = process.env.OPENAI_BASE_URL || undefined;
  const embeddingModel = process.env.OPENAI_EMBEDDING_MODEL;
  engine = createAgentEngine(
    createOpenAIAdapter({
      chat: { apiKey, model, baseURL },
      embedding: embeddingModel
        ? {
            apiKey: process.env.OPENAI_EMBEDDING_API_KEY || apiKey,
            baseURL: process.env.OPENAI_EMBEDDING_BASE_URL || baseURL,
            model: embeddingModel,
          }
        : undefined,
    }),
  );
  return engine;
};

const modelDriver: MockRunDriver = {
  execute: async (turn, options) => {
    try {
      return await getEngine().execute(turn, options);
    } catch (error) {
      if (error instanceof AgentExecutionError)
        throw new MockRunError(502, error.code, error.message);
      throw error;
    }
  },
  generateExtras: async (input, signal) =>
    getEngine().generateExtras(input, signal),
};

const shared = globalThis as typeof globalThis & {
  archFlowMockRunRuntime?: ReturnType<typeof createMockRunRuntime>;
};

export const getMockRunRuntime = () =>
  (shared.archFlowMockRunRuntime ??= createMockRunRuntime(
    { read: readMockDatabase, update: updateMockDatabase },
    PREVIEW_AGENT_ENABLED ? modelDriver : createFixtureAgent(),
  ));
