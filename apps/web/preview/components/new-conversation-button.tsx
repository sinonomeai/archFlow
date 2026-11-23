"use client";

import { Loader2, Plus } from "lucide-react";
import { useCreateConversation } from "@/preview/hooks/use-create-conversation";

export const NewConversationButton = ({ projectId }: { projectId: string }) => {
  const createConversation = useCreateConversation();

  return (
    <button
      type="button"
      aria-label="新建会话"
      title="新建会话"
      disabled={createConversation.isPending}
      onClick={() => createConversation.mutate({ projectId })}
      className="flex size-5 shrink-0 items-center justify-center rounded-sm text-muted-foreground transition-colors hover:bg-accent hover:text-foreground disabled:opacity-50"
    >
      {createConversation.isPending ? (
        <Loader2 className="size-3.5 animate-spin" strokeWidth={1.75} />
      ) : (
        <Plus className="size-3.5" strokeWidth={1.75} />
      )}
    </button>
  );
};
