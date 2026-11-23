"use client";

import { useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { cn } from "@/lib/utils";
import { ConversationDeleteDialog } from "@/preview/components/conversation-delete-dialog";
import { ConversationRenameDialog } from "@/preview/components/conversation-rename-dialog";
import { ItemActionsMenu } from "@/components/workspace/sidebar/item-actions-menu";

type ConversationLinkProps = {
  projectId: string;
  conversationId: string;
  title: string;
};

export const ConversationLink = ({
  projectId,
  conversationId,
  title,
}: ConversationLinkProps) => {
  const searchParams = useSearchParams();
  const [renameOpen, setRenameOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const active = searchParams.get("conversationId") === conversationId;

  return (
    <>
      <div
        className={cn(
          "group/item flex h-7 items-center rounded-md pl-8 pr-1 text-[11px] text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground",
          active && "bg-secondary text-foreground",
        )}
      >
        <Link
          href={`/workspace?conversationId=${conversationId}`}
          className="flex min-w-0 flex-1 items-center self-stretch"
        >
          <span className="truncate">{title}</span>
        </Link>
        <ItemActionsMenu
          itemName={title}
          onRename={() => setRenameOpen(true)}
          onDelete={() => setDeleteOpen(true)}
        />
      </div>

      <ConversationRenameDialog
        conversationId={conversationId}
        initialTitle={title}
        open={renameOpen}
        onOpenChange={setRenameOpen}
      />
      <ConversationDeleteDialog
        conversationId={conversationId}
        projectId={projectId}
        name={title}
        isActive={active}
        open={deleteOpen}
        onOpenChange={setDeleteOpen}
      />
    </>
  );
};
