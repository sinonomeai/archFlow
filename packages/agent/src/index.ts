/**
 * @arch-flow/agent
 *
 * Agent 核心引擎出口：手写 workflow + 原生 Function Calling。
 * 禁止引入 LangChain / LangGraph / Vercel AI SDK。
 */
export { AgentEngine } from "./engine.js";
export type { AgentConfig, AgentEvent, AgentInput } from "./engine.js";
export {
  ArchitectureGraph,
  ArchitectureOutput,
  ConstraintsSchema,
  GeneratedEdge,
  GeneratedNode,
} from "./schemas.js";
export type {
  ArchitectureGraph as ArchitectureGraphType,
  ArchitectureOutput as ArchitectureOutputType,
  Constraints,
} from "./schemas.js";
export { createAgentEngine } from "./orchestration-engine.js";
export {
  GRAPH_REFERENCE_QUESTION,
  GRAPH_REFERENCE_READ_ONLY_MESSAGE,
  isCurrentGraphRequest,
  isHistoricalGraphRequest,
} from "./graph-reference.js";
export { createOpenAIAdapter } from "./llm/openai.js";
export { AgentExecutionError } from "./ports.js";
export type {
  AgentEmbedding,
  AgentModel,
  CreateAgentEngineOptions,
  AgentExecutionOptions,
} from "./ports.js";
export const AGENT_PACKAGE_NAME = "@arch-flow/agent" as const;
