"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import type {
  MockActiveRun,
  MockRunAccepted,
  MockSendMessageInput,
} from "@arch-flow/shared";
import { requestApi } from "@/preview/lib/api-client";
import {
  activeRunQueryKey,
  messagesQueryKey,
  projectQueryKey,
} from "@/preview/lib/query-keys";

type SendMessageVariables = MockSendMessageInput & {
  conversationId: string;
  idempotencyKey: string;
};

export type ChatSubmission = Pick<
  SendMessageVariables,
  | "conversationId"
  | "content"
  | "interruptId"
  | "graphReferenceMessageId"
  | "idempotencyKey"
>;

export const prepareChatSubmission = (
  {
    conversationId,
    content,
    interruptId,
  }: Omit<ChatSubmission, "graphReferenceMessageId" | "idempotencyKey">,
  previous: ChatSubmission | null,
  reference?: { conversationId: string; messageId: string },
): ChatSubmission => {
  const graphReferenceMessageId =
    reference?.conversationId === conversationId
      ? reference.messageId
      : undefined;
  const isRetry =
    previous?.conversationId === conversationId &&
    previous.content === content &&
    previous.interruptId === interruptId &&
    previous.graphReferenceMessageId === graphReferenceMessageId;

  return {
    conversationId,
    content,
    interruptId,
    graphReferenceMessageId,
    idempotencyKey: isRetry ? previous.idempotencyKey : crypto.randomUUID(),
  };
};

export const useSendMessage = (
  onAccepted: (conversationId: string) => void,
) => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      conversationId,
      idempotencyKey,
      ...input
    }: SendMessageVariables) =>
      requestApi<MockRunAccepted>(
        `/api/mock/conversations/${conversationId}/messages`,
        {
          method: "POST",
          headers: { "Idempotency-Key": idempotencyKey },
          body: JSON.stringify(input),
        },
      ),
    onSuccess: async (run, { conversationId }) => {
      const queryKey = activeRunQueryKey(conversationId);
      await queryClient.cancelQueries({ queryKey });
      queryClient.setQueryData<MockActiveRun>(queryKey, { run, latest: run });
      onAccepted(conversationId);
      void queryClient.invalidateQueries({
        queryKey: messagesQueryKey(conversationId),
      });
      void queryClient.invalidateQueries({ queryKey: projectQueryKey });
    },
    onError: (_error, { conversationId }) => {
      void queryClient.invalidateQueries({
        queryKey: activeRunQueryKey(conversationId),
      });
    },
  });
};
