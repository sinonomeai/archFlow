import { z } from "zod";
import {
  Count,
  GRAPH_MAX_EDGES,
  GRAPH_MAX_NODES,
  Graph,
  GraphEdge,
  GraphInput,
  GraphNode,
  Id,
} from "./common.schema.js";
import {
  Citation,
  SendMessageInput,
  SuggestedQuestions,
} from "./conversation.schema.js";

export const AGENT_HISTORY_LIMIT = 10;
export const AGENT_PLAN_LIMIT = 6;
export const AGENT_CLARIFICATION_LIMIT = 3;

export const AgentIntent = z.enum([
  "generate_graph",
  "edit_graph",
  "explain_graph",
  "query_knowledge",
  "general_chat",
]);
export type AgentIntent = z.infer<typeof AgentIntent>;

export const AgentConstraintKey = z.enum([
  "projectGoal",
  "usersAndScale",
  "teamAndBudget",
  "technology",
  "deployment",
  "requirements",
]);
export type AgentConstraintKey = z.infer<typeof AgentConstraintKey>;

export const AgentConstraints = z.partialRecord(
  AgentConstraintKey,
  z.string().trim().min(1).max(500),
);
export type AgentConstraints = z.infer<typeof AgentConstraints>;

export const AgentTurn = z.strictObject({
  runId: Id,
  conversationId: Id,
  projectId: Id,
  input: SendMessageInput.shape.content,
  history: z
    .array(
      z.strictObject({
        role: z.enum(["user", "assistant"]),
        content: z.string(),
      }),
    )
    .max(AGENT_HISTORY_LIMIT),
  draftGraph: GraphInput.nullable(),
  draftVersion: Count,
  referencedGraph: z
    .strictObject({
      messageId: Id,
      graph: GraphInput,
    })
    .optional(),
  constraints: AgentConstraints,
  attachments: SendMessageInput.shape.attachments.unwrap(),
});
export type AgentTurn = z.infer<typeof AgentTurn>;

export const AgentDecision = z.strictObject({
  intents: z.array(AgentIntent).max(AgentIntent.options.length),
  rewrittenInput: SendMessageInput.shape.content,
  complexity: z.enum(["simple", "complex"]),
  question: z.string().trim().min(1).max(500).nullable(),
  constraintUpdates: AgentConstraints,
  knowledgeDependentIntents: z
    .array(AgentIntent)
    .max(AgentIntent.options.length)
    .optional(),
});
export type AgentDecision = z.infer<typeof AgentDecision>;

export const AgentCheckpoint = z.strictObject({
  decision: AgentDecision,
  question: AgentDecision.shape.question.unwrap(),
  attempts: Count.max(AGENT_CLARIFICATION_LIMIT),
  conflictKey: AgentConstraintKey.optional(),
});
export type AgentCheckpoint = z.infer<typeof AgentCheckpoint>;

export const AgentResume = z.strictObject({
  checkpoint: AgentCheckpoint,
  answer: SendMessageInput.shape.content,
});
export type AgentResume = z.infer<typeof AgentResume>;

export const AgentTask = z.strictObject({
  intent: AgentIntent,
  instruction: z.string().trim().min(1).max(20000),
  requiresKnowledge: z.boolean(),
});
export type AgentTask = z.infer<typeof AgentTask>;

export const AgentPlan = z.strictObject({
  tasks: z.array(AgentTask).min(1).max(AGENT_PLAN_LIMIT),
});
export type AgentPlan = z.infer<typeof AgentPlan>;

export const GraphPatch = z.strictObject({
  upsertNodes: z.array(GraphNode).max(GRAPH_MAX_NODES),
  removeNodeIds: z.array(Id).max(GRAPH_MAX_NODES),
  upsertEdges: z.array(GraphEdge).max(GRAPH_MAX_EDGES),
  removeEdgeIds: z.array(Id).max(GRAPH_MAX_EDGES),
});
export type GraphPatch = z.infer<typeof GraphPatch>;

export const AgentTaskResult = z.strictObject({
  text: z.string().trim().min(1).max(12000),
  graph: Graph.optional(),
  patch: GraphPatch.optional(),
});
export type AgentTaskResult = z.infer<typeof AgentTaskResult>;

export const AgentTurnResult = z.discriminatedUnion("status", [
  z.strictObject({
    status: z.literal("waiting_input"),
    checkpoint: AgentCheckpoint,
    constraints: AgentConstraints,
    text: AgentCheckpoint.shape.question,
  }),
  z.strictObject({
    status: z.literal("succeeded"),
    text: z.string().min(1),
    constraints: AgentConstraints,
    citations: z.array(Citation),
    graph: GraphInput.nullable(),
  }),
]);
export type AgentTurnResult = z.infer<typeof AgentTurnResult>;

export const AgentExtrasInput = z.strictObject({
  userInput: SendMessageInput.shape.content,
  assistantText: z.string().trim().min(1),
  includeTitle: z.boolean(),
});
export type AgentExtrasInput = z.infer<typeof AgentExtrasInput>;

export const AgentExtras = z.strictObject({
  title: z.string().trim().min(1).max(50).nullable(),
  suggestedQuestions: SuggestedQuestions,
});
export type AgentExtras = z.infer<typeof AgentExtras>;

export const AgentKnowledgeQuery = z.strictObject({
  projectId: Id,
  attachments: AgentTurn.shape.attachments,
  query: AgentTask.shape.instruction,
});
export type AgentKnowledgeQuery = z.infer<typeof AgentKnowledgeQuery>;
