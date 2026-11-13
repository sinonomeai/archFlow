"use client";

import { useMemo, useState } from "react";
import { LayoutGrid, Loader2, Workflow } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  useCanvasLayout,
  useSaveCanvasLayout,
} from "@/hooks/use-canvas-layout";
import { useConversation } from "@/hooks/use-conversation";
import { parseGraph } from "@/lib/graph";
import { ArchitectureCanvas } from "./architecture-canvas";
import { ExportMenu } from "./export-menu";

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

export const CanvasPanel = ({ conversationId }: { conversationId: string | null }) => {
  const conversation = useConversation(conversationId);
  const canvasLayout = useCanvasLayout(conversationId);
  const saveCanvasLayout = useSaveCanvasLayout(conversationId);
  const [layoutSignal, setLayoutSignal] = useState(0);
  const graph = useMemo(
    () => parseGraph(conversation.data?.draftGraph ?? null),
    [conversation.data?.draftGraph],
  );
  const hasGraph = graph !== null && graph.nodes.length > 0;
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
            disabled={!hasGraph}
            onClick={() => setLayoutSignal((value) => value + 1)}
          >
            <LayoutGrid className="size-3.5" strokeWidth={1.75} />
            自动布局
          </Button>
          <ExportMenu
            projectId={conversation.data?.projectId ?? null}
            graph={graph}
            conversationTitle={title}
          />
        </div>

        <CanvasStatus
          conversationId={conversationId}
          isPending={conversation.isPending}
          isError={conversation.isError}
        />
      </div>

      <div className="relative min-h-0 flex-1 overflow-hidden">
        {/* 空状态用静态网格；有图时只保留 React Flow 会随平移移动的 Background。 */}
        {!hasGraph && <div className="canvas-grid absolute inset-0" />}

        {hasGraph && graph && (
          <div className="h-full w-full">
            <ArchitectureCanvas
              graph={graph}
              layoutSignal={layoutSignal}
              savedLayout={canvasLayout.data?.layout ?? null}
              onLayoutChange={(layout) => saveCanvasLayout.mutate(layout)}
            />
          </div>
        )}

        {hasGraph && (
          <div className="pointer-events-none absolute bottom-3 left-3 z-20 flex items-center gap-3 rounded-md border border-border bg-card/90 px-2.5 py-1.5 text-[10px] text-muted-foreground shadow-sm backdrop-blur">
            <span className="flex items-center gap-1">
              <span className="h-px w-4 bg-[var(--edge)]" />
              同步
            </span>
            <span className="flex items-center gap-1">
              <span className="h-px w-4 border-t border-dashed border-[#a78bfa]" />
              异步
            </span>
            <span className="flex items-center gap-1">
              <span className="h-px w-4 bg-[#38bdf8]" />
              数据
            </span>
            <span className="flex items-center gap-1">
              <span className="h-px w-4 bg-[#fbbf24]" />
              控制
            </span>
          </div>
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
      </div>
    </section>
  );
};
