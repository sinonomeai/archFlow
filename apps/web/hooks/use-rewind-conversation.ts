"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import type { Conversation, RewindInput } from "@arch-flow/shared";
import { requestApi } from "@/lib/api-client";
import {
  conversationQueryKey,
  messagesQueryKey,
  projectQueryKey,
} from "@/lib/query-keys";

type RewindVariables = {
  conversationId: string;
  sourceMessageId: string;
};

/** 原地回退：截断该消息之后的历史，并恢复当时的画布。 */
export const useRewindConversation = () => {
  const queryClient = useQueryClient();

  return useMutation<Conversation, Error, RewindVariables>({
    mutationFn: ({ conversationId, sourceMessageId }) =>
      requestApi<Conversation>(`/conversations/${conversationId}/rewind`, {
        method: "POST",
        body: JSON.stringify({ sourceMessageId } satisfies RewindInput),
      }),
    onSuccess: (conversation) => {
      queryClient.setQueryData(
        conversationQueryKey(conversation.id),
        conversation,
      );
      void queryClient.invalidateQueries({
        queryKey: messagesQueryKey(conversation.id),
      });
      void queryClient.invalidateQueries({ queryKey: projectQueryKey });
      toast.success("已回退到该消息");
    },
    onError: (error) => {
      toast.error(error.message);
    },
  });
};
