import type { Graph, GraphEdge, GraphNode } from "@arch-flow/shared";

const NODE_TYPES = new Set([
  "client",
  "gateway",
  "auth",
  "service",
  "worker",
  "database",
  "cache",
  "queue",
  "storage",
  "search",
  "external",
  "table",
]);

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

const isNode = (value: unknown): value is GraphNode =>
  isRecord(value) &&
  typeof value.id === "string" &&
  typeof value.type === "string" &&
  NODE_TYPES.has(value.type) &&
  typeof value.label === "string" &&
  (value.description === undefined || typeof value.description === "string");

const isEdge = (value: unknown): value is GraphEdge =>
  isRecord(value) &&
  typeof value.id === "string" &&
  typeof value.source === "string" &&
  typeof value.target === "string" &&
  (value.label === undefined || typeof value.label === "string");

/** 客户端守卫：避免把 zod 打进首屏；服务端仍是权威校验。 */
export const parseGraph = (value: unknown): Graph | null => {
  if (
    !isRecord(value) ||
    !Array.isArray(value.nodes) ||
    !Array.isArray(value.edges) ||
    !value.nodes.every(isNode) ||
    !value.edges.every(isEdge)
  ) {
    return null;
  }

  return {
    nodes: value.nodes,
    edges: value.edges,
    ...(typeof value.version === "number" ? { version: value.version } : {}),
  };
};

export const emptyGraph = (): Graph => ({ nodes: [], edges: [] });
