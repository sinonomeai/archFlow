"use client";

import { useMemo } from "react";
import dagre from "dagre";
import {
  Controls,
  MarkerType,
  Position,
  ReactFlow,
  type Edge,
  type Node,
} from "@xyflow/react";
import { GraphInput, type Graph, type LooseGraph } from "@arch-flow/shared";
import "@xyflow/react/dist/style.css";

const NODE_WIDTH = 180;
const NODE_HEIGHT = 56;

const layoutGraph = (graph: Graph): { nodes: Node[]; edges: Edge[] } => {
  const layout = new dagre.graphlib.Graph({ multigraph: true })
    .setGraph({ rankdir: "LR", ranksep: 110, nodesep: 36 })
    .setDefaultEdgeLabel(() => ({}));
  graph.nodes.forEach(({ id }) =>
    layout.setNode(`node:${id}`, { width: NODE_WIDTH, height: NODE_HEIGHT }),
  );
  graph.edges.forEach(({ id, source, target }) =>
    layout.setEdge(`node:${source}`, `node:${target}`, {}, id),
  );
  dagre.layout(layout);

  return {
    nodes: graph.nodes.map(({ id, label, description }) => {
      const point = layout.node(`node:${id}`);
      return {
        id,
        position: { x: point.x - NODE_WIDTH / 2, y: point.y - NODE_HEIGHT / 2 },
        sourcePosition: Position.Right,
        targetPosition: Position.Left,
        data: { label: <span title={description}>{label}</span> },
        style: {
          width: NODE_WIDTH,
          minHeight: NODE_HEIGHT,
          background: "var(--card)",
          border: "1px solid var(--border)",
          borderRadius: 8,
          color: "var(--card-foreground)",
        },
      };
    }),
    edges: graph.edges.map(({ id, source, target, label }) => ({
      id,
      source,
      target,
      label,
      markerEnd: { type: MarkerType.ArrowClosed },
      style: { stroke: "var(--edge)" },
      labelStyle: { fill: "var(--foreground)" },
      labelBgStyle: { fill: "var(--background)" },
    })),
  };
};

export const GraphCanvas = ({ graph }: { graph: LooseGraph }) => {
  const layout = useMemo(() => {
    const parsed = GraphInput.safeParse(graph);
    return parsed.success ? layoutGraph(parsed.data) : null;
  }, [graph]);
  if (!layout) {
    return (
      <p role="status" className="p-4 text-xs text-muted-foreground">
        无法显示这张架构图。
      </p>
    );
  }

  return (
    <ReactFlow
      {...layout}
      fitView
      nodesDraggable={false}
      nodesConnectable={false}
      colorMode="system"
      proOptions={{ hideAttribution: true }}
    >
      <Controls position="bottom-right" showInteractive={false} />
    </ReactFlow>
  );
};
