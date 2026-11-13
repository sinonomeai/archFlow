import { WorkspaceView } from "@/components/workspace/workspace-view";

export const dynamic = "force-dynamic";

type WorkspacePageProps = {
  searchParams: Promise<{ conversationId?: string | string[] }>;
};

const WorkspacePage = async ({ searchParams }: WorkspacePageProps) => {
  const { conversationId } = await searchParams;
  const resolvedConversationId = Array.isArray(conversationId)
    ? (conversationId[0] ?? null)
    : (conversationId ?? null);

  return <WorkspaceView conversationId={resolvedConversationId} />;
};

export default WorkspacePage;
