import { randomUUID } from "node:crypto";
import {
  ERROR_CODES,
  GraphInput,
  MockGraph,
  Run,
  mockRunStreamUrl,
  type AgentTurn,
  type LooseGraph,
  type Message,
  type MockConversationRecord,
  type MockDatabase,
  type MockRunAccepted,
  type MockRunSnapshot,
  type MockStoredRun,
} from "@arch-flow/shared";

export class MockRunError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

export const getRunConversation = (database: MockDatabase, id: string) => {
  const conversation = database.conversations.find(
    (record) => record.id === id,
  );
  if (!conversation)
    throw new MockRunError(
      404,
      ERROR_CODES.CONVERSATION_NOT_FOUND,
      "会话不存在",
    );
  return conversation;
};

export const getStoredRun = (database: MockDatabase, id: string) => {
  for (const conversation of database.conversations) {
    const run = conversation.runs?.find((record) => record.id === id);
    if (run) return { conversation, run };
  }
  throw new MockRunError(404, ERROR_CODES.RUN_NOT_FOUND, "运行不存在");
};

export const getRunMessage = (
  conversation: MockConversationRecord,
  id: string,
) => {
  const message = conversation.messages.find((record) => record.id === id);
  if (!message)
    throw new MockRunError(
      409,
      ERROR_CODES.RUN_NOT_RESUMABLE,
      "运行缺少关联消息",
    );
  return message;
};

export const makeRunMessage = (
  role: Message["role"],
  content: string,
): Message => ({
  id: randomUUID(),
  role,
  content,
  graphSnapshot: null,
  metadata: null,
  createdAt: new Date().toISOString(),
});

export const updateConversationMessages = (
  conversation: MockConversationRecord,
  last: Message,
) => {
  conversation.messageCount = conversation.messages.length;
  conversation.lastMessage = {
    id: last.id,
    role: last.role,
    contentPreview: last.content.slice(0, 80),
    createdAt: last.createdAt,
  };
  conversation.updatedAt = new Date().toISOString();
};

export const activeStatus = (status: Run["status"]) =>
  status === "queued" || status === "running" || status === "waiting_input";

export const acceptedRun = (run: MockStoredRun): MockRunAccepted => ({
  runId: run.id,
  userMessageId: run.userMessageId,
  assistantMessageId: run.assistantMessageId,
  streamUrl: mockRunStreamUrl(run.id),
  status: run.status,
});

export const snapshotRun = (
  conversation: MockConversationRecord,
  run: MockStoredRun,
): MockRunSnapshot => ({
  run: Run.parse(run),
  assistantMessage: getRunMessage(conversation, run.assistantMessageId),
  stage: run.stage,
});

const SVG_COORDINATE = String.raw`([+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?)`;
const SVG_POINT = String.raw`${SVG_COORDINATE}(?:\s*,\s*|\s+)${SVG_COORDINATE}`;
const SVG_STRAIGHT_EDGE = new RegExp(
  String.raw`^M\s*${SVG_POINT}\s*L\s*${SVG_POINT}$`,
  "u",
);

export const readMockGraph = (graph: LooseGraph | null): GraphInput | null => {
  const canonical = GraphInput.safeParse(graph);
  if (canonical.success) return canonical.data;

  const legacy = MockGraph.safeParse(graph);
  if (!legacy.success) return null;
  const { nodes, edges } = legacy.data;
  const nodesByPosition = new Map(
    nodes.map(({ id, left, top }) => [`${left} ${top}`, id]),
  );
  if (nodesByPosition.size !== nodes.length) return null;

  const convertedEdges = edges.flatMap(({ id, path }) => {
    const coordinates = SVG_STRAIGHT_EDGE.exec(path.trim());
    if (!coordinates) return [];
    const [, startX, startY, endX, endY] = coordinates;
    const source = nodesByPosition.get(`${Number(startX)} ${Number(startY)}`);
    const target = nodesByPosition.get(`${Number(endX)} ${Number(endY)}`);
    return source && target ? [{ id, source, target }] : [];
  });
  if (convertedEdges.length !== edges.length) return null;

  const converted = GraphInput.safeParse({
    nodes: nodes.map(({ id, kind, label, meta }) => ({
      id,
      type: kind,
      label,
      description: meta ?? undefined,
    })),
    edges: convertedEdges,
  });
  return converted.success ? converted.data : null;
};

export const getReferencedGraph = (
  conversation: MockConversationRecord,
  messageId: string,
): NonNullable<AgentTurn["referencedGraph"]> => {
  const message = conversation.messages.find(
    ({ id, role }) => id === messageId && role === "assistant",
  );
  const graph = readMockGraph(message?.graphSnapshot ?? null);
  if (!graph) {
    throw new MockRunError(
      404,
      ERROR_CODES.MESSAGE_NOT_FOUND,
      "找不到可引用的历史图，请从当前会话重新选择。",
    );
  }
  return { messageId, graph };
};
