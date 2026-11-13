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
