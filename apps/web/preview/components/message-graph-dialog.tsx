"use client";

import dynamic from "next/dynamic";
import type { LooseGraph } from "@arch-flow/shared";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { parseMockGraph } from "@/preview/lib/mock-graph";
import { ArchitectureCanvas } from "./architecture-canvas";

const GraphCanvas = dynamic(
  async () => (await import("./graph-canvas")).GraphCanvas,
  { ssr: false },
);

export const MessageGraphDialog = ({ graph }: { graph: LooseGraph }) => {
  const legacy = parseMockGraph(graph);

  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button type="button" variant="outline" size="sm">
          查看这次的架构图
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>这次回答的架构图</DialogTitle>
          <DialogDescription>这张图与当前画布分别保存。</DialogDescription>
        </DialogHeader>
        <div className="relative h-[50vh] min-h-48 overflow-hidden rounded-md border border-border">
          {legacy ? (
            <ArchitectureCanvas graph={legacy} />
          ) : (
            <GraphCanvas graph={graph} />
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
};
