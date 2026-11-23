"use client";

import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from "@/components/ui/resizable";
import type { WorkspaceViewProps } from "@/types/workspace";
import { CanvasPanel } from "./canvas-panel";
import { ChatPanel } from "./chat-panel";

export const PreviewWorkspaceView = ({ conversationId }: WorkspaceViewProps) => (
  <ResizablePanelGroup
    direction="horizontal"
    autoSaveId="archflow-preview-workspace-split"
    className="h-full"
  >
    <ResizablePanel defaultSize={52} minSize={32} className="min-w-0">
      <ChatPanel conversationId={conversationId} />
    </ResizablePanel>
    <ResizableHandle />
    <ResizablePanel defaultSize={48} minSize={30} className="min-w-0">
      <CanvasPanel conversationId={conversationId} />
    </ResizablePanel>
  </ResizablePanelGroup>
);
