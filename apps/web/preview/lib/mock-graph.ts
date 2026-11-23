import type {
  LooseGraph,
  MockGraph,
  MockGraphEdge,
  MockGraphNode,
} from "@arch-flow/shared";

/**
 * 真实图契约 P0-13 已定稿；P0-16 切换画布前，mock 会话仍存带坐标的 MockGraph，
 * 这里用结构守卫代替 Zod 校验，避免把 zod 打进客户端首屏。
 */
const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

const isMockGraphNode = (value: unknown): value is MockGraphNode =>
  isRecord(value) &&
  typeof value.id === "string" &&
  typeof value.kind === "string" &&
  typeof value.eyebrow === "string" &&
  typeof value.label === "string" &&
  (value.meta === null || typeof value.meta === "string") &&
  typeof value.left === "number" &&
  typeof value.top === "number";

const isMockGraphEdge = (value: unknown): value is MockGraphEdge =>
  isRecord(value) &&
  typeof value.id === "string" &&
  typeof value.path === "string";

/**
 * 解析失败按“没有画布”处理；未知 kind 的兜底在渲染层完成。
 */
export const parseMockGraph = (graph: LooseGraph | null): MockGraph | null => {
  if (
    !graph ||
    !Array.isArray(graph.nodes) ||
    !Array.isArray(graph.edges) ||
    !graph.nodes.every(isMockGraphNode) ||
    !graph.edges.every(isMockGraphEdge)
  ) {
    return null;
  }

  return { nodes: graph.nodes, edges: graph.edges };
};
