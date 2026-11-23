import {
  AgentDecision,
  type AgentIntent,
  type AgentTurn,
} from "@arch-flow/shared";
import { AgentExecutionError, type CreateAgentEngineOptions } from "./ports.js";

const EXACT_COMMANDS: ReadonlyArray<{
  intent: AgentIntent;
  phrases: readonly string[];
}> = [
  {
    intent: "explain_graph",
    phrases: [
      "解释当前架构图",
      "解释这张架构图",
      "explain the current diagram",
    ],
  },
  {
    intent: "generate_graph",
    phrases: ["画个架构图", "生成架构图", "generate an architecture diagram"],
  },
  {
    intent: "query_knowledge",
    phrases: ["搜索项目知识库", "查询项目文档", "search the project documents"],
  },
  { intent: "general_chat", phrases: ["你好", "hi", "hello"] },
];

// Contrast examples participate in the margin even when their intent cannot short-circuit.
const INTENT_EXAMPLES: ReadonlyArray<{ intent: AgentIntent; text: string }> = [
  { intent: "explain_graph", text: "解释当前架构图" },
  { intent: "explain_graph", text: "说明这张图里的组件关系" },
  { intent: "explain_graph", text: "Explain the current diagram" },
  { intent: "query_knowledge", text: "查询项目知识库里的资料" },
  { intent: "query_knowledge", text: "在上传的项目文档中找相关内容" },
  { intent: "query_knowledge", text: "Search the uploaded project documents" },
  { intent: "generate_graph", text: "根据项目需求生成一张架构图" },
  { intent: "edit_graph", text: "修改当前架构图并添加一个缓存节点" },
  { intent: "general_chat", text: "你好，你能做什么" },
];

const SEMANTIC_MIN_SIMILARITY = 0.87;
const SEMANTIC_MIN_MARGIN = 0.09;

const normalizeForMatch = (input: string): string =>
  input
    .normalize("NFKC")
    .toLowerCase()
    .trim()
    .replace(/[。.!?？]+$/u, "")
    .trim();

const safeForSemanticMatch = (input: string): boolean =>
  input.length <= 96 &&
  !/[\r\n,，、;；。.!?？/\d]/u.test(input) &&
  !/(再|并|同时|另外|顺便|顺手|以及|之后|而且|否则|对比|比较|不要|不用|别|不能|不需要|修改|添加|加个|加上|补上|删除|替换|生成|重画)/u.test(
    input,
  ) &&
  !/\b(and|then|also|versus|vs|or|not|don't|without|change|edit|add|remove|replace)\b/u.test(
    input,
  );

const vectorUnit = (vector: number[]): number[] | null => {
  if (vector.length === 0 || !vector.every(Number.isFinite)) return null;
  const norm = Math.sqrt(vector.reduce((sum, value) => sum + value * value, 0));
  return norm > 0 && Number.isFinite(norm)
    ? vector.map((value) => value / norm)
    : null;
};

const decisionFor = (intent: AgentIntent, input: string): AgentDecision => ({
  intents: [intent],
  rewrittenInput: input,
  complexity: "simple",
  question: null,
  constraintUpdates: {},
});

export const parseAgentDecision = (output: unknown): AgentDecision => {
  const decision = AgentDecision.safeParse(output);
  if (!decision.success)
    throw new AgentExecutionError(
      "AGENT_INVALID_DECISION",
      "意图识别结果格式不正确。",
    );
  return { ...decision.data, intents: [...new Set(decision.data.intents)] };
};

export const createIntentRouter = ({
  model,
  embed,
}: CreateAgentEngineOptions) => {
  let exampleVectors: Promise<(number[] | null)[]> | undefined;

  const loadExampleVectors = async () => {
    if (!embed) return [];
    // Shared warmup has a provider timeout of its own. A canceled turn must not cancel other turns' warmup.
    const vectors = await embed(
      INTENT_EXAMPLES.map(({ text }) => text),
      AbortSignal.timeout(6_000),
    );
    if (vectors.length !== INTENT_EXAMPLES.length)
      throw new Error("Unexpected intent vector count");
    return vectors.map(vectorUnit);
  };

  const matchSemantic = async (
    text: string,
    signal?: AbortSignal,
  ): Promise<AgentIntent | undefined> => {
    if (!embed || !safeForSemanticMatch(text)) return undefined;

    try {
      exampleVectors ??= loadExampleVectors();
      const vectors = await exampleVectors;
      signal?.throwIfAborted();
      const budget = AbortSignal.timeout(6_000);
      const [input] = await embed(
        [text],
        signal ? AbortSignal.any([signal, budget]) : budget,
      );
      const query = input && vectorUnit(input);
      if (
        !query ||
        vectors.some((vector) => !vector || vector.length !== query.length)
      )
        return undefined;

      const bestByIntent = new Map<AgentIntent, number>();
      INTENT_EXAMPLES.forEach(({ intent }, index) => {
        const vector = vectors[index];
        if (!vector) return;
        const score = vector.reduce(
          (sum, value, dimension) => sum + value * (query[dimension] ?? 0),
          0,
        );
        bestByIntent.set(
          intent,
          Math.max(bestByIntent.get(intent) ?? -1, score),
        );
      });
      const [top, next] = [...bestByIntent].sort((a, b) => b[1] - a[1]);
      if (
        !top ||
        !next ||
        top[1] < SEMANTIC_MIN_SIMILARITY ||
        top[1] - next[1] < SEMANTIC_MIN_MARGIN
      )
        return undefined;

      // Text similarity alone cannot authorize a graph edit or extract deployment constraints.
      if (
        top[0] === "explain_graph" &&
        /(图|画布|graph|diagram|canvas)/u.test(text)
      )
        return top[0];
      if (
        top[0] === "query_knowledge" &&
        /(知识库|文档|资料|document|knowledge base)/u.test(text)
      )
        return top[0];
    } catch {
      exampleVectors = undefined;
      signal?.throwIfAborted();
    }
    return undefined;
  };

  return async (
    turn: AgentTurn,
    signal?: AbortSignal,
  ): Promise<{
    source: "rule" | "semantic" | "model";
    decision: AgentDecision;
  }> => {
    const text = normalizeForMatch(turn.input);
    const rule = EXACT_COMMANDS.find(({ phrases }) => phrases.includes(text));
    if (rule)
      return { source: "rule", decision: decisionFor(rule.intent, turn.input) };

    const semantic = await matchSemantic(text, signal);
    if (semantic)
      return {
        source: "semantic",
        decision: decisionFor(semantic, turn.input),
      };

    signal?.throwIfAborted();
    return {
      source: "model",
      decision: parseAgentDecision(await model.classify(turn, signal)),
    };
  };
};
