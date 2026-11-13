"use client";

import { useQuery } from "@tanstack/react-query";
import type { Conversation } from "@arch-flow/shared";
import { requestApi } from "@/lib/api-client";
import { conversationQueryKey } from "@/lib/query-keys";

export const useConversation = (conversationId: string | null) =>
  useQuery({
    queryKey: conversationQueryKey(conversationId ?? "none"),
    queryFn: async () => {
      if (!conversationId) {
        throw new Error("缺少 conversationId");
      }

      return requestApi<Conversation>(`/conversations/${conversationId}`);
    },
    enabled: conversationId !== null,
  });
