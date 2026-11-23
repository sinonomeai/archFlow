import { WorkspaceView } from "@/components/workspace/workspace-view";
import { PreviewWorkspaceView } from "@/preview/components/preview-workspace-view";

export const dynamic = "force-dynamic";

type WorkspacePageProps = {
  searchParams: Promise<{ conversationId?: string | string[] }>;
};

const WorkspacePage = async ({ searchParams }: WorkspacePageProps) => {
  const { conversationId } = await searchParams;
  const resolvedConversationId = Array.isArray(conversationId)
    ? (conversationId[0] ?? null)
    : (conversationId ?? null);

  return process.env.MOCK_API === "1" ? (
    <PreviewWorkspaceView conversationId={resolvedConversationId} />
  ) : (
    <WorkspaceView conversationId={resolvedConversationId} />
  );
};

export default WorkspacePage;
