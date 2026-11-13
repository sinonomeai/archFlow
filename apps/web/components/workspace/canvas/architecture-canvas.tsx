"use client";

import { useEffect, useRef } from "react";
import {
  Background,
  Controls,
  Handle,
  MarkerType,
  Position,
  ReactFlow,
  ReactFlowProvider,
  useEdgesState,
  useNodesInitialized,
  useNodesState,
  useReactFlow,
  type Edge,
  type Node,
  type NodeProps,
} from "@xyflow/react";
import dagre from "dagre";
import {
  Code2,
  Database,
  Gauge,
  Globe,
  HardDrive,
  Layers,
  ListOrdered,
  Search,
  Server,
  Shield,
  ShieldCheck,
  Table2,
  Workflow,
} from "lucide-react";
import type {
  CanvasLayout,
  Graph,
  GraphNode,
  NodeType,
  TableSchema,
} from "@arch-flow/shared";
import "@xyflow/react/dist/style.css";

const NODE_WIDTH = 220;
const NODE_HEIGHT = 120;

/** 估算节点高度，让 Dagre 给完整描述留出空间，避免节点重叠。 */
const estimateNodeHeight = (node: GraphNode): number => {
  if (node.table) {
    return Math.min(360, 64 + node.table.columns.length * 18);
  }

  const labelLines = Math.max(1, Math.ceil(node.label.length / 12));
  const descriptionLines = node.description
    ? Math.ceil(node.description.length / 16)
    : 0;

  return Math.min(
    260,
    Math.max(92, 24 + 16 + labelLines * 20 + descriptionLines * 16),
  );
};

const NODE_ICONS: Record<NodeType, typeof Workflow> = {
  client: Code2,
  gateway: Shield,
  auth: ShieldCheck,
  service: Server,
  worker: Layers,
  database: Database,
  cache: Gauge,
  queue: ListOrdered,
  storage: HardDrive,
  search: Search,
  external: Globe,
  table: Table2,
};

type ArchNodeData = {
  label: string;
  type: NodeType;
  description?: string;
  table?: TableSchema;
};

const ArchNode = ({ data }: NodeProps<Node<ArchNodeData>>) => {
  const Icon = NODE_ICONS[data.type] ?? Workflow;

  if (data.table) {
    return (
      <div className="relative w-[220px] rounded-lg border border-border bg-card shadow-sm">
        <Handle
          type="target"
          position={Position.Left}
          className="!size-2 !border !border-border !bg-muted-foreground"
        />
        <div className="flex items-center gap-2 rounded-t-lg border-b border-border bg-secondary/40 px-3 py-2">
          <Table2 className="size-3.5 shrink-0" strokeWidth={1.75} />
          <span className="min-w-0 flex-1 truncate text-[11px] font-medium">
            {data.table.name}
          </span>
        </div>
        <div className="divide-y divide-border/70">
          {data.table.columns.map((column) => (
            <div
              key={column.name}
              className="flex items-center justify-between gap-2 px-3 py-[3px] text-[9px] leading-4"
            >
              <span className="flex min-w-0 items-center gap-1">
                {column.primaryKey && (
                  <span className="text-[8px] font-semibold text-amber-500">PK</span>
                )}
                {column.foreignKey && (
                  <span className="text-[8px] font-semibold text-sky-500">FK</span>
                )}
                <span className="truncate">{column.name}</span>
              </span>
              <span className="shrink-0 text-muted-foreground">
                {column.type}
              </span>
            </div>
          ))}
        </div>
        <Handle
          type="source"
          position={Position.Right}
          className="!size-2 !border !border-border !bg-muted-foreground"
        />
      </div>
    );
  }

  return (
    <div className="relative w-[220px] rounded-lg border border-border bg-card px-3.5 py-3 shadow-sm">
      <Handle
        type="target"
        position={Position.Left}
        className="!size-2 !border !border-border !bg-muted-foreground"
      />
      <div className="flex items-start gap-2.5">
        <div className="flex size-8 shrink-0 items-center justify-center rounded-md border border-border bg-background">
          <Icon className="size-4" strokeWidth={1.6} />
        </div>
        <div className="min-w-0">
          <p className="truncate text-[10px] leading-4 text-muted-foreground">
            {data.type}
          </p>
          <p className="break-words text-[12px] font-medium leading-5">
            {data.label}
          </p>
          {data.description && (
            <p className="whitespace-pre-wrap break-words text-[10px] leading-4 text-muted-foreground">
              {data.description}
            </p>
          )}
        </div>
      </div>

      <Handle
        type="source"
        position={Position.Right}
        className="!size-2 !border !border-border !bg-muted-foreground"
      />
    </div>
  );
};

const NODE_TYPES = { arch: ArchNode };

const layout = (
  graph: Graph,
  savedLayout: CanvasLayout | null,
): { nodes: Node<ArchNodeData>[]; edges: Edge[] } => {
  if (graph.nodes.length === 0) {
    return { nodes: [], edges: [] };
  }

  const dagreGraph = new dagre.graphlib.Graph();
  dagreGraph.setDefaultEdgeLabel(() => ({}));
  dagreGraph.setGraph({
    rankdir: "LR",
    nodesep: 36,
    ranksep: 80,
    marginx: 24,
    marginy: 24,
  });

  const heights = new Map(
    graph.nodes.map((node) => [node.id, estimateNodeHeight(node)]),
  );

  for (const node of graph.nodes) {
    dagreGraph.setNode(node.id, {
      width: NODE_WIDTH,
      height: heights.get(node.id) ?? NODE_HEIGHT,
    });
  }

  for (const edge of graph.edges) {
    dagreGraph.setEdge(edge.source, edge.target);
  }

  dagre.layout(dagreGraph);

  const nodes: Node<ArchNodeData>[] = graph.nodes.map((node) => {
    const position = dagreGraph.node(node.id) as
      | { x: number; y: number }
      | undefined;
    const height = heights.get(node.id) ?? NODE_HEIGHT;
    const savedPosition = savedLayout?.nodes[node.id];

    return {
      id: node.id,
      type: "arch",
      position: savedPosition ?? {
        x: (position?.x ?? 0) - NODE_WIDTH / 2,
        y: (position?.y ?? 0) - height / 2,
      },
      data: {
        label: node.label,
        type: node.type,
        description: node.description,
        ...(node.table ? { table: node.table } : {}),
      },
    };
  });

  const edges: Edge[] = graph.edges.map((edge) => {
    const flow = edge.dataFlow;
    const stroke =
      flow?.kind === "async"
        ? "#a78bfa"
        : flow?.kind === "data"
          ? "#38bdf8"
          : flow?.kind === "control"
            ? "#fbbf24"
            : "var(--edge)";
    const label =
      edge.label && flow?.protocol && !edge.label.includes(flow.protocol)
        ? `${edge.label} · ${flow.protocol}`
        : (edge.label ?? flow?.protocol ?? undefined);

    return {
      id: edge.id,
      source: edge.source,
      target: edge.target,
      label,
      type: "smoothstep",
      markerEnd: { type: MarkerType.ArrowClosed, color: stroke },
      style: {
        stroke,
        strokeWidth: 1.4,
        ...(flow?.kind === "async" ? { strokeDasharray: "6 4" } : {}),
      },
      labelStyle: { fill: "var(--foreground)", fontSize: 10 },
      labelBgStyle: { fill: "var(--card)" },
      labelBgPadding: [4, 2],
      labelBgBorderRadius: 3,
    };
  });

  return { nodes, edges };
};

type ArchitectureCanvasProps = {
  graph: Graph;
  layoutSignal: number;
  savedLayout: CanvasLayout | null;
  onLayoutChange: (layout: CanvasLayout) => void;
};

const CanvasInner = ({
  graph,
  layoutSignal,
  savedLayout,
  onLayoutChange,
}: ArchitectureCanvasProps) => {
  const [nodes, setNodes, onNodesChange] = useNodesState<Node<ArchNodeData>>([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([]);
  const { fitView } = useReactFlow();
  const nodesInitialized = useNodesInitialized();
  const savedLayoutRef = useRef<CanvasLayout | null>(savedLayout);
  const onLayoutChangeRef = useRef(onLayoutChange);
  const graphRef = useRef<Graph | null>(null);
  savedLayoutRef.current = savedLayout;
  onLayoutChangeRef.current = onLayoutChange;

  /** 图或已保存布局变化：优先使用用户拖拽后的坐标。 */
  useEffect(() => {
    const graphChanged = graphRef.current !== graph;
    graphRef.current = graph;
    const next = layout(graph, savedLayoutRef.current);
    setNodes(next.nodes);
    setEdges(next.edges);

    /** 拖拽保存会更新 savedLayout；只有图本身变化时才重新 fitView。 */
    if (!graphChanged) {
      return;
    }

    const timer = window.setTimeout(() => {
      void fitView({ padding: 0.2, duration: 200 });
    }, 250);

    return () => window.clearTimeout(timer);
  }, [graph, savedLayout, fitView, setEdges, setNodes]);

  /** 等所有节点测量完再 fitView，否则表节点会被当成 0 尺寸而落在视野外。 */
  useEffect(() => {
    if (!nodesInitialized) {
      return;
    }

    const timer = window.setTimeout(() => {
      void fitView({ padding: 0.2, duration: 200 });
    }, 50);

    return () => window.clearTimeout(timer);
  }, [nodesInitialized, fitView]);

  const lastAutoLayoutSignal = useRef(0);

  /** 点击“自动布局”：忽略旧坐标，按 Dagre 重排并持久化新布局。 */
  useEffect(() => {
    /**
     * 只在 layoutSignal 真正变化时执行一次；
     * 保存布局会刷新 query，进而让 graph 引用变化，不能因此再次自动布局。
     */
    if (
      layoutSignal === 0 ||
      lastAutoLayoutSignal.current === layoutSignal
    ) {
      return;
    }

    lastAutoLayoutSignal.current = layoutSignal;
    const next = layout(graph, null);
    setNodes(next.nodes);
    setEdges(next.edges);
    onLayoutChangeRef.current({
      nodes: Object.fromEntries(
        next.nodes.map((node) => [node.id, node.position]),
      ),
    });

    const timer = window.setTimeout(() => {
      void fitView({ padding: 0.2, duration: 200 });
    }, 60);

    return () => window.clearTimeout(timer);
  }, [layoutSignal, graph, fitView, setEdges, setNodes]);

  return (
    <ReactFlow
      nodes={nodes}
      edges={edges}
      nodeTypes={NODE_TYPES}
      onNodesChange={onNodesChange}
      onEdgesChange={onEdgesChange}
      onNodeDragStop={(_event, node) => {
        const positions = Object.fromEntries(
          nodes.map((item) => [
            item.id,
            item.id === node.id ? node.position : item.position,
          ]),
        );
        onLayoutChangeRef.current({ nodes: positions });
      }}
      nodesConnectable={false}
      fitView={false}
      minZoom={0.3}
      maxZoom={1.8}
      proOptions={{ hideAttribution: true }}
      style={{ width: "100%", height: "100%" }}
    >
      <Background gap={24} size={1} />
      <Controls position="bottom-right" showInteractive={false} />
    </ReactFlow>
  );
};

export const ArchitectureCanvas = (props: ArchitectureCanvasProps) => (
  <ReactFlowProvider>
    <CanvasInner {...props} />
  </ReactFlowProvider>
);
