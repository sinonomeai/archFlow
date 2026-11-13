"use client";

import { useQuery } from "@tanstack/react-query";
import type { Message, Page } from "@arch-flow/shared";
import { requestApi } from "@/lib/api-client";
import { messagesQueryKey } from "@/lib/query-keys";

/** §4.4：一次取最新的 50 条（PaginationQuery 上限）。 */
export const useMessages = (conversationId: string | null) =>
  useQuery({
    queryKey: messagesQueryKey(conversationId ?? "none"),
    queryFn: async () => {
      if (!conversationId) {
        throw new Error("缺少 conversationId");
      }

      return requestApi<Page<Message>>(
        `/conversations/${conversationId}/messages?limit=50&direction=backward`,
      );
    },
    enabled: conversationId !== null,
  });
