"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import type { Page, ProjectNode } from "@arch-flow/shared";
import { requestApiVoid } from "@/lib/api-client";
import {
  conversationQueryKey,
  messagesQueryKey,
  projectQueryKey,
} from "@/lib/query-keys";

type OptimisticDeleteOptions<TVariables extends { projectId: string }> = {
  mutationFn: (variables: TVariables) => Promise<void>;
  patch: (
    project: ProjectNode,
    variables: TVariables,
  ) => ProjectNode | null;
  successMessage: (variables: TVariables) => string;
  onDeleted?: (variables: TVariables) => void;
};

/** 删除类操作的公共流程：先改缓存、失败回滚、成功后以服务端数据校准。 */
const useOptimisticDelete = <TVariables extends { projectId: string }>({
  mutationFn,
  patch,
  successMessage,
  onDeleted,
}: OptimisticDeleteOptions<TVariables>) => {
  const queryClient = useQueryClient();

  return useMutation<
    void,
    Error,
    TVariables,
    { previous: Page<ProjectNode> | undefined }
  >({
    mutationFn,
    onMutate: async (variables) => {
      await queryClient.cancelQueries({ queryKey: projectQueryKey });
      const previous =
        queryClient.getQueryData<Page<ProjectNode>>(projectQueryKey);

      queryClient.setQueryData<Page<ProjectNode>>(projectQueryKey, (current) =>
        current
          ? {
              ...current,
              items: current.items.flatMap((project) => {
                if (project.id !== variables.projectId) {
                  return [project];
                }

                const patched = patch(project, variables);
                return patched ? [patched] : [];
              }),
            }
          : current,
      );

      return { previous };
    },
    onError: (error, _variables, context) => {
      if (context?.previous) {
        queryClient.setQueryData(projectQueryKey, context.previous);
      }

      toast.error(error.message);
    },
    onSuccess: (_data, variables) => {
      // 乐观 patch 已经是最终结果；删除成功后不再 refetch 整棵项目树。
      toast.success(successMessage(variables));
      onDeleted?.(variables);
    },
  });
};

type DeleteProjectVariables = {
  projectId: string;
  name: string;
  isActive: boolean;
};

export const useDeleteProject = () => {
  const router = useRouter();

  return useOptimisticDelete<DeleteProjectVariables>({
    mutationFn: ({ projectId }) =>
      requestApiVoid(`/projects/${projectId}`, { method: "DELETE" }),
    patch: () => null,
    successMessage: ({ name }) => `已删除项目“${name}”`,
    onDeleted: ({ isActive }) => {
      if (isActive) {
        router.replace("/workspace");
      }
    },
  });
};

type DeleteFileVariables = {
  projectId: string;
  fileId: string;
  name: string;
};

export const useDeleteFile = () =>
  useOptimisticDelete<DeleteFileVariables>({
    mutationFn: ({ projectId, fileId }) =>
      requestApiVoid(`/projects/${projectId}/files/${fileId}`, {
        method: "DELETE",
      }),
    patch: (project, { fileId }) => ({
      ...project,
      files: project.files.filter((file) => file.id !== fileId),
    }),
    successMessage: ({ name }) => `已删除文件“${name}”`,
  });

type DeleteAssetVariables = {
  projectId: string;
  assetId: string;
  name: string;
};

export const useDeleteAsset = () =>
  useOptimisticDelete<DeleteAssetVariables>({
    mutationFn: ({ projectId, assetId }) =>
      requestApiVoid(`/projects/${projectId}/assets/${assetId}`, {
        method: "DELETE",
      }),
    patch: (project, { assetId }) => ({
      ...project,
      assets: project.assets.filter((asset) => asset.id !== assetId),
    }),
    successMessage: ({ name }) => `已删除资产“${name}”`,
  });

type DeleteConversationVariables = {
  projectId: string;
  conversationId: string;
  name: string;
  isActive: boolean;
};

export const useDeleteConversation = () => {
  const router = useRouter();
  const queryClient = useQueryClient();

  return useOptimisticDelete<DeleteConversationVariables>({
    mutationFn: ({ conversationId }) =>
      requestApiVoid(`/conversations/${conversationId}`, {
        method: "DELETE",
      }),
    patch: (project, { conversationId }) => {
      const conversations = project.conversations.filter(
        (conversation) => conversation.id !== conversationId,
      );

      return {
        ...project,
        conversations,
        lastActiveConversationId:
          project.lastActiveConversationId === conversationId
            ? (conversations[0]?.id ?? null)
            : project.lastActiveConversationId,
      };
    },
    successMessage: ({ name }) => `已删除会话“${name}”`,
    onDeleted: ({ conversationId, isActive }) => {
      queryClient.removeQueries({
        queryKey: conversationQueryKey(conversationId),
      });
      queryClient.removeQueries({
        queryKey: messagesQueryKey(conversationId),
      });

      if (isActive) {
        router.replace("/workspace");
      }
    },
  });
};
