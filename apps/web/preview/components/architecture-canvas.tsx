import type { LucideIcon } from "lucide-react";
import {
  Code2,
  Database,
  Gauge,
  Layers,
  Server,
  Shield,
  ShieldCheck,
  Workflow,
} from "lucide-react";
import type {
  MockGraph,
  MockGraphNodeKind,
} from "@arch-flow/shared";

const NODE_ICONS: Record<MockGraphNodeKind, LucideIcon> = {
  client: Code2,
  gateway: Shield,
  auth: ShieldCheck,
  service: Server,
  worker: Layers,
  database: Database,
  cache: Gauge,
};

export const ArchitectureCanvas = ({ graph }: { graph: MockGraph }) => (
  <div className="relative h-full w-full">
    <svg
      className="pointer-events-none absolute inset-0 z-0 h-full w-full"
      viewBox="0 0 100 100"
      preserveAspectRatio="none"
      aria-hidden="true"
    >
      {graph.edges.map((edge) => (
        <path
          key={edge.id}
          d={edge.path}
          fill="none"
          stroke="var(--edge)"
          strokeWidth={1.25}
          strokeLinecap="round"
          vectorEffect="non-scaling-stroke"
        />
      ))}
    </svg>

    {graph.nodes.map((node) => {
      /** 未知 kind 不阻塞整张图，退回通用图标。 */
      const Icon = NODE_ICONS[node.kind] ?? Workflow;

      return (
        <div
          key={node.id}
          className="absolute z-10 w-[172px] -translate-x-1/2 -translate-y-1/2"
          style={{ left: `${node.left}%`, top: `${node.top}%` }}
        >
          <div className="rounded-lg border border-border bg-card px-3.5 py-3">
            <div className="flex items-start gap-2.5">
              <div className="flex size-8 shrink-0 items-center justify-center rounded-md border border-border bg-background">
                <Icon className="size-4" strokeWidth={1.6} />
              </div>
              <div className="min-w-0">
                <p className="truncate text-[10px] leading-4 text-muted-foreground">
                  {node.eyebrow}
                </p>
                <p className="truncate text-[12px] font-medium leading-5">
                  {node.label}
                </p>
                {node.meta && (
                  <p className="truncate text-[10px] leading-4 text-muted-foreground">
                    {node.meta}
                  </p>
                )}
              </div>
            </div>
          </div>
        </div>
      );
    })}
  </div>
);
