"use client";

import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useDeleteConversation } from "@/preview/hooks/use-delete-project-items";

type ConversationDeleteDialogProps = {
  conversationId: string;
  projectId: string;
  name: string;
  isActive: boolean;
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

export const ConversationDeleteDialog = ({
  conversationId,
  projectId,
  name,
  isActive,
  open,
  onOpenChange,
}: ConversationDeleteDialogProps) => {
  const deleteConversation = useDeleteConversation();

  const handleDelete = () => {
    deleteConversation.mutate(
      { projectId, conversationId, name, isActive },
      { onSuccess: () => onOpenChange(false) },
    );
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>删除会话？</DialogTitle>
          <DialogDescription>
            将删除“{name}”及其中的全部消息，删除后无法恢复。
          </DialogDescription>
        </DialogHeader>

        <DialogFooter className="mt-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => onOpenChange(false)}
          >
            取消
          </Button>
          <Button
            variant="destructive"
            size="sm"
            onClick={handleDelete}
            disabled={deleteConversation.isPending}
          >
            {deleteConversation.isPending && (
              <Loader2 className="size-3.5 animate-spin" strokeWidth={1.75} />
            )}
            删除
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
