"use client";

import { useQuery } from "@tanstack/react-query";
import type { Conversation } from "@arch-flow/shared";
import { requestApi } from "@/preview/lib/api-client";
import { conversationQueryKey } from "@/preview/lib/query-keys";

export const useConversation = (conversationId: string | null) =>
  useQuery({
    queryKey: conversationQueryKey(conversationId ?? "none"),
    queryFn: async () => {
      if (!conversationId) {
        throw new Error("缺少 conversationId");
      }

      return requestApi<Conversation>(
        `/api/mock/conversations/${conversationId}`,
      );
    },
    enabled: conversationId !== null,
  });
