"use client";

import { useState } from "react";
import dynamic from "next/dynamic";
import {
  CircleHelp,
  LayoutGrid,
  Loader2,
  Minus,
  Plus,
  Workflow,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { useConversation } from "@/preview/hooks/use-conversation";
import { parseMockGraph } from "@/preview/lib/mock-graph";
import { useWorkspaceStore } from "@/store/workspace-store";
import { ArchitectureCanvas } from "./architecture-canvas";
import { ExportMenu } from "./export-menu";

const GraphCanvas = dynamic(
  async () => (await import("./graph-canvas")).GraphCanvas,
  { ssr: false },
);

const CanvasStatus = ({
  conversationId,
  isPending,
  isError,
}: {
  conversationId: string | null;
  isPending: boolean;
  isError: boolean;
}) => {
  if (!conversationId) {
    return (
      <div className="flex shrink-0 items-center gap-1.5 text-[11px] text-muted-foreground">
        <span className="size-1.5 rounded-full bg-border" />
        未选择会话
      </div>
    );
  }

  if (isPending) {
    return (
      <div className="flex shrink-0 items-center gap-1.5 text-[11px] text-muted-foreground">
        <Loader2 className="size-3 animate-spin" strokeWidth={1.75} />
        加载中
      </div>
    );
  }

  if (isError) {
    return (
      <div className="flex shrink-0 items-center gap-1.5 text-[11px] text-muted-foreground">
        <span className="size-1.5 rounded-full bg-muted-foreground" />
        加载失败
      </div>
    );
  }

  return (
    <div className="flex shrink-0 items-center gap-1.5 text-[11px] text-muted-foreground">
      <span className="size-1.5 rounded-full bg-success" />
      已保存
    </div>
  );
};

export const CanvasPanel = ({
  conversationId,
}: {
  conversationId: string | null;
}) => {
  const conversation = useConversation(conversationId);
  const zoom = useWorkspaceStore((state) => state.zoom);
  const increaseZoom = useWorkspaceStore((state) => state.increaseZoom);
  const decreaseZoom = useWorkspaceStore((state) => state.decreaseZoom);
  const [layoutRevision, setLayoutRevision] = useState(0);
  const draftGraph = conversation.data?.draftGraph ?? null;
  const graph = parseMockGraph(draftGraph);
  const hasGraph = Boolean(draftGraph?.nodes.length);
  const title = conversation.data?.title ?? "未命名画布";

  return (
    <section className="flex h-full min-h-0 min-w-0 flex-col bg-background">
      <div className="flex h-14 shrink-0 items-center justify-between gap-4 border-b border-border px-4">
        <div className="flex min-w-0 items-center gap-3">
          <div className="hidden min-w-0 items-center gap-1.5 text-xs md:flex">
            <span className="text-muted-foreground">当前画布：</span>
            <span className="truncate font-medium">{title}</span>
          </div>
          <span className="hidden h-4 w-px bg-border md:block" />
          <Button
            variant="outline"
            size="sm"
            disabled={!hasGraph || Boolean(graph)}
            onClick={() => setLayoutRevision((revision) => revision + 1)}
          >
            <LayoutGrid className="size-3.5" strokeWidth={1.75} />
            自动布局
          </Button>
          <ExportMenu />
        </div>

        <CanvasStatus
          conversationId={conversationId}
          isPending={conversation.isPending}
          isError={conversation.isError}
        />
      </div>

      <div className="relative min-h-0 flex-1 overflow-hidden">
        <div className="canvas-grid absolute inset-0" />

        {hasGraph && graph && (
          <div
            className="relative h-full w-full transition-transform duration-200"
            style={{ transform: `scale(${zoom / 100})` }}
          >
            <ArchitectureCanvas graph={graph} />
          </div>
        )}

        {hasGraph && draftGraph && !graph && (
          <GraphCanvas
            key={`${conversationId}:${conversation.data?.draftVersion}:${layoutRevision}`}
            graph={draftGraph}
          />
        )}

        {!hasGraph && (
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center px-8">
            <div className="max-w-[280px] text-center">
              <div className="mx-auto flex size-9 items-center justify-center rounded-md border border-border bg-card">
                <Workflow
                  className="size-4 text-muted-foreground"
                  strokeWidth={1.75}
                />
              </div>
              <p className="mt-3 text-sm font-medium">
                {conversationId ? "画布还是空的" : "还没有选择会话"}
              </p>
              <p className="mt-1 text-[11px] leading-5 text-muted-foreground">
                {conversationId
                  ? "在左侧对话中确认约束并生成方案后，架构节点会显示在这里。"
                  : "从左侧项目树选择一个会话，或新建项目开始。"}
              </p>
            </div>
          </div>
        )}

        {(!hasGraph || graph) && (
          <div className="absolute bottom-3 right-3 z-20 flex items-center overflow-hidden rounded-md border border-border bg-card">
            <button
              type="button"
              aria-label="缩小画布"
              onClick={decreaseZoom}
              className="flex size-8 items-center justify-center text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
            >
              <Minus className="size-3.5" strokeWidth={1.75} />
            </button>
            <span className="w-12 text-center text-[11px] tabular-nums text-muted-foreground">
              {zoom}%
            </span>
            <button
              type="button"
              aria-label="放大画布"
              onClick={increaseZoom}
              className="flex size-8 items-center justify-center text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
            >
              <Plus className="size-3.5" strokeWidth={1.75} />
            </button>
            <span className="h-4 w-px bg-border" />
            <button
              type="button"
              aria-label="画布帮助"
              className="flex size-8 items-center justify-center text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
            >
              <CircleHelp className="size-3.5" strokeWidth={1.75} />
            </button>
          </div>
        )}
      </div>
    </section>
  );
};
