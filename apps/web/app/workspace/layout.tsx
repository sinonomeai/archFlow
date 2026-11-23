import type { ReactNode } from "react";
import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from "@/components/ui/resizable";
import { Sidebar } from "@/components/workspace/sidebar/sidebar";
import { Sidebar as PreviewSidebar } from "@/preview/components/sidebar";
import { SessionGate } from "@/preview/components/session-gate";

export const dynamic = "force-dynamic";

const WorkspaceLayout = ({ children }: { children: ReactNode }) => {
  const preview = process.env.MOCK_API === "1";
  const content = (
  <div className="h-dvh overflow-x-auto bg-background text-foreground">
    <div className="h-full min-w-[1180px]">
      <ResizablePanelGroup
        direction="horizontal"
        autoSaveId="archflow-workspace"
        className="h-full"
      >
        <ResizablePanel
          defaultSize={20}
          minSize={15}
          maxSize={30}
          className="min-w-0"
        >
          {preview ? <PreviewSidebar /> : <Sidebar />}
        </ResizablePanel>
        <ResizableHandle />
        <ResizablePanel defaultSize={80} minSize={50} className="min-w-0">
          {children}
        </ResizablePanel>
      </ResizablePanelGroup>
    </div>
  </div>
  );

  return preview ? <SessionGate>{content}</SessionGate> : content;
};

export default WorkspaceLayout;
