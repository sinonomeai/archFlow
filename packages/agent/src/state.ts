import {
  AgentConstraintKey,
  GraphInput,
  mapGraphError,
  type AgentConstraints,
  type Graph,
  type GraphPatch,
} from "@arch-flow/shared";
import { AgentExecutionError } from "./ports.js";

export const mergeConstraints = (
  current: AgentConstraints,
  proposed: AgentConstraints,
  confirmedKey?: AgentConstraintKey,
) => {
  const constraints = { ...current };
  let conflictKey: AgentConstraintKey | undefined;

  for (const key of AgentConstraintKey.options) {
    const value = proposed[key];
    if (value === undefined) continue;
    if (
      key !== confirmedKey &&
      current[key] !== undefined &&
      current[key] !== value
    ) {
      conflictKey ??= key;
      continue;
    }
    constraints[key] = value;
  }

  return { constraints, conflictKey };
};

export const validateGraph = (output: unknown): Graph => {
  const graph = GraphInput.safeParse(output);
  if (!graph.success)
    throw new AgentExecutionError(
      mapGraphError(graph.error).errorCode,
      "生成的图未通过校验，草稿未更新。",
    );
  return graph.data;
};

const applyChanges = <T extends { id: string }>(
  current: T[],
  upserts: T[],
  removals: string[],
): T[] => {
  const byId = new Map(current.map((item) => [item.id, item]));
  const changed = new Set<string>();

  for (const id of removals) {
    if (!byId.delete(id))
      throw new AgentExecutionError(
        "GRAPH_INVALID",
        "修改引用了不存在的节点或边。",
      );
    changed.add(id);
  }
  for (const item of upserts) {
    if (changed.has(item.id))
      throw new AgentExecutionError(
        "GRAPH_INVALID",
        "修改重复操作了同一个节点或边。",
      );
    changed.add(item.id);
    byId.set(item.id, item);
  }
  return [...byId.values()];
};

export const applyGraphPatch = (graph: Graph, patch: GraphPatch): Graph => {
  const removedNodes = new Set(patch.removeNodeIds);
  const nodes = applyChanges(
    graph.nodes,
    patch.upsertNodes,
    patch.removeNodeIds,
  );
  const incidentEdgeIds = graph.edges
    .filter(
      ({ source, target }) =>
        removedNodes.has(source) || removedNodes.has(target),
    )
    .map(({ id }) => id);
  const edges = applyChanges(graph.edges, patch.upsertEdges, [
    ...new Set([...patch.removeEdgeIds, ...incidentEdgeIds]),
  ]);

  return validateGraph({ ...graph, nodes, edges });
};
