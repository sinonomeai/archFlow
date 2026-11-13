"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import type {
  CanvasLayout,
  CanvasLayoutResult,
  SaveCanvasLayoutInput,
} from "@arch-flow/shared";
import { requestApi } from "@/lib/api-client";

const canvasLayoutQueryKey = (conversationId: string) =>
  ["canvas-layout", conversationId] as const;

export const useCanvasLayout = (conversationId: string | null) =>
  useQuery({
    queryKey: canvasLayoutQueryKey(conversationId ?? "none"),
    queryFn: async () => {
      if (!conversationId) {
        throw new Error("缺少 conversationId");
      }

      return requestApi<CanvasLayoutResult>(
        `/conversations/${conversationId}/layout`,
      );
    },
    enabled: conversationId !== null,
  });

export const useSaveCanvasLayout = (conversationId: string | null) => {
  const queryClient = useQueryClient();
  const queryKey = canvasLayoutQueryKey(conversationId ?? "none");

  return useMutation<CanvasLayoutResult, Error, CanvasLayout>({
    mutationFn: async (layout) => {
      if (!conversationId) {
        throw new Error("缺少 conversationId");
      }

      const current =
        queryClient.getQueryData<CanvasLayoutResult>(queryKey);

      return requestApi<CanvasLayoutResult>(
        `/conversations/${conversationId}/layout`,
        {
          method: "PUT",
          body: JSON.stringify({
            layout,
            baseVersion: current?.version ?? 0,
          } satisfies SaveCanvasLayoutInput),
        },
      );
    },
    onSuccess: (result) => {
      queryClient.setQueryData(queryKey, result);
    },
    onError: (error) => {
      toast.error(error.message);
      void queryClient.invalidateQueries({ queryKey });
    },
  });
};
