import type {
  AgentCheckpoint,
  AgentDecision,
  AgentExtrasInput,
  AgentKnowledgeQuery,
  AgentTask,
  AgentTurn,
  Citation,
  RunStage,
} from "@arch-flow/shared";

/** The engine validates every model response before acting on it. */
export type AgentModel = {
  classify: (turn: AgentTurn, signal?: AbortSignal) => Promise<unknown>;
  resolveClarification: (
    input: { turn: AgentTurn; checkpoint: AgentCheckpoint; answer: string },
    signal?: AbortSignal,
  ) => Promise<unknown>;
  plan: (
    input: { turn: AgentTurn; decision: AgentDecision },
    signal?: AbortSignal,
  ) => Promise<unknown>;
  executeTask: (
    input: {
      turn: AgentTurn;
      decision: AgentDecision;
      task: AgentTask;
      evidence: Citation[];
      priorResults: string[];
    },
    signal?: AbortSignal,
    onTextDelta?: (delta: string) => void | Promise<void>,
  ) => Promise<unknown>;
  generateExtras: (
    input: AgentExtrasInput,
    signal?: AbortSignal,
  ) => Promise<unknown>;
};

export type AgentEmbedding = (
  texts: readonly string[],
  signal?: AbortSignal,
) => Promise<number[][]>;

export type CreateAgentEngineOptions = {
  model: AgentModel;
  embed?: AgentEmbedding;
  searchKnowledge?: (
    input: AgentKnowledgeQuery,
    signal?: AbortSignal,
  ) => Promise<Citation[]>;
  onRoute?: (event: {
    source: "rule" | "semantic" | "model" | "resume";
    strategy: "direct" | "planned" | "clarify";
    intents: AgentDecision["intents"];
  }) => void;
};

export type AgentExecutionOptions = {
  resume?: { checkpoint: AgentCheckpoint; answer: string };
  signal?: AbortSignal;
  deadlineAt?: number;
  onStage?: (stage: RunStage) => void;
  onTextDelta?: (delta: string, replace?: true) => void | Promise<void>;
};

export class AgentExecutionError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "AgentExecutionError";
  }
}
