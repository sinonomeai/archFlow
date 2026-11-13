import type { ReactNode } from "react";
import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from "@/components/ui/resizable";
import { Sidebar } from "@/components/workspace/sidebar/sidebar";

export const dynamic = "force-dynamic";

const WorkspaceLayout = ({ children }: { children: ReactNode }) => (
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
          <Sidebar />
        </ResizablePanel>
        <ResizableHandle />
        <ResizablePanel defaultSize={80} minSize={50} className="min-w-0">
          {children}
        </ResizablePanel>
      </ResizablePanelGroup>
    </div>
  </div>
);

export default WorkspaceLayout;
