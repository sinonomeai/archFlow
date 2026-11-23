"use client";

import { useEffect, useState, type FormEvent } from "react";
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
import { Input } from "@/components/ui/input";
import { useRenameConversation } from "@/preview/hooks/use-rename-conversation";

/** 与 shared 的 UpdateConversationInput 保持一致。 */
const TITLE_MAX_LENGTH = 50;

type ConversationRenameDialogProps = {
  conversationId: string;
  initialTitle: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

export const ConversationRenameDialog = ({
  conversationId,
  initialTitle,
  open,
  onOpenChange,
}: ConversationRenameDialogProps) => {
  const [title, setTitle] = useState(initialTitle);
  const renameConversation = useRenameConversation();

  useEffect(() => {
    if (open) {
      setTitle(initialTitle);
    }
  }, [open, initialTitle]);

  const trimmedTitle = title.trim();
  const canSubmit =
    trimmedTitle.length > 0 &&
    trimmedTitle.length <= TITLE_MAX_LENGTH &&
    !renameConversation.isPending;

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    if (!canSubmit) {
      return;
    }

    if (trimmedTitle === initialTitle) {
      onOpenChange(false);
      return;
    }

    renameConversation.mutate(
      { conversationId, title: trimmedTitle },
      { onSuccess: () => onOpenChange(false) },
    );
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-sm">
        <form onSubmit={handleSubmit}>
          <DialogHeader>
            <DialogTitle>重命名会话</DialogTitle>
            <DialogDescription>
              修改后会同步更新左侧会话列表与当前会话标题。
            </DialogDescription>
          </DialogHeader>

          <Input
            value={title}
            maxLength={TITLE_MAX_LENGTH}
            onChange={(event) => setTitle(event.target.value)}
            placeholder="会话标题"
            aria-label="会话标题"
            className="mt-4"
          />

          <DialogFooter className="mt-5">
            <Button
              variant="outline"
              size="sm"
              onClick={() => onOpenChange(false)}
            >
              取消
            </Button>
            <Button type="submit" size="sm" disabled={!canSubmit}>
              {renameConversation.isPending && (
                <Loader2 className="size-3.5 animate-spin" strokeWidth={1.75} />
              )}
              保存
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
};
