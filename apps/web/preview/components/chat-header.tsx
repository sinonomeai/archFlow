"use client";

import { useState } from "react";
import { MoreHorizontal, Pencil, Trash2 } from "lucide-react";
import type { Conversation } from "@arch-flow/shared";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { ConversationDeleteDialog } from "./conversation-delete-dialog";
import { ConversationRenameDialog } from "./conversation-rename-dialog";

type ChatHeaderProps = {
  conversation: Conversation | null;
};

export const ChatHeader = ({ conversation }: ChatHeaderProps) => {
  const [renameOpen, setRenameOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);

  return (
    <header className="shrink-0 border-b border-border px-5 py-4">
      <div className="flex items-center justify-between gap-3">
        <h1 className="min-w-0 truncate text-xl font-semibold tracking-tight">
          {conversation?.title ?? "架构会话"}
        </h1>

        {conversation && (
          <>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="icon-sm" aria-label="会话操作">
                  <MoreHorizontal className="size-4" strokeWidth={1.75} />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" sideOffset={4} className="w-32">
                <DropdownMenuItem
                  className="text-xs"
                  onSelect={() => setRenameOpen(true)}
                >
                  <Pencil className="size-3.5" strokeWidth={1.75} />
                  重命名
                </DropdownMenuItem>
                <DropdownMenuItem
                  variant="destructive"
                  className="text-xs"
                  onSelect={() => setDeleteOpen(true)}
                >
                  <Trash2 className="size-3.5" strokeWidth={1.75} />
                  删除
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>

            <ConversationRenameDialog
              conversationId={conversation.id}
              initialTitle={conversation.title}
              open={renameOpen}
              onOpenChange={setRenameOpen}
            />
            <ConversationDeleteDialog
              conversationId={conversation.id}
              projectId={conversation.projectId}
              name={conversation.title}
              isActive
              open={deleteOpen}
              onOpenChange={setDeleteOpen}
            />
          </>
        )}
      </div>
    </header>
  );
};
