"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import type {
  Conversation,
  CreateConversationInput,
  Page,
  ProjectNode,
} from "@arch-flow/shared";
import { requestApi } from "@/lib/api-client";
import { projectQueryKey } from "@/lib/query-keys";

type CreateConversationVariables = CreateConversationInput & {
  projectId: string;
};

/** 在项目下新建会话，并进入对应的空白画布。 */
export const useCreateConversation = () => {
  const queryClient = useQueryClient();
  const router = useRouter();

  return useMutation<Conversation, Error, CreateConversationVariables>({
    mutationFn: ({ projectId, ...input }) =>
      requestApi<Conversation>(`/projects/${projectId}/conversations`, {
          method: "POST",
          body: JSON.stringify(input),
        },
      ),
    onSuccess: (conversation) => {
      queryClient.setQueryData<Page<ProjectNode>>(projectQueryKey, (current) =>
        current
          ? {
              ...current,
              items: current.items.map((project) =>
                project.id === conversation.projectId
                  ? {
                      ...project,
                      lastActiveConversationId: conversation.id,
                      conversations: [
                        {
                          id: conversation.id,
                          title: conversation.title,
                          updatedAt: conversation.updatedAt,
                        },
                        ...project.conversations,
                      ],
                    }
                  : project,
              ),
            }
          : current,
      );

      // 会话已写入项目树缓存；跳转由 RSC 负责，不再立即 refetch 项目列表。
      toast.success("已创建新会话");
      router.push(`/workspace?conversationId=${conversation.id}`);
    },
    onError: (error) => {
      toast.error(error.message);
    },
  });
};
