"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type {
  Conversation,
  CreateProjectInput,
  Page,
  Project,
  ProjectNode,
} from "@arch-flow/shared";
import { requestApi } from "@/lib/api-client";
import { projectQueryKey } from "@/lib/query-keys";

export const DEFAULT_PROJECT_NAME = "新架构项目";

type CreateProjectCallbacks = {
  onCreated?: (project: ProjectNode) => void;
  onFailed?: (error: Error) => void;
};

export const useProjects = () =>
  useQuery({
    queryKey: projectQueryKey,
    queryFn: async () => requestApi<Page<ProjectNode>>("/projects"),
  });

/**
 * 创建项目后立刻创建首个会话（数据流 §流 3），
 * 这样调用方拿到的 ProjectNode 一定有 lastActiveConversationId。
 */
export const useCreateProject = (callbacks: CreateProjectCallbacks = {}) => {
  const queryClient = useQueryClient();

  return useMutation<ProjectNode, Error, CreateProjectInput>({
    mutationFn: async (input) => {
      const project = await requestApi<Project>("/projects", {
        method: "POST",
        body: JSON.stringify(input),
      });
      const conversation = await requestApi<Conversation>(
        `/projects/${project.id}/conversations`,
        {
          method: "POST",
          body: JSON.stringify({}),
        },
      );

      return {
        ...project,
        lastActiveConversationId: conversation.id,
        files: [],
        assets: [],
        conversations: [
          {
            id: conversation.id,
            title: conversation.title,
            updatedAt: conversation.updatedAt,
          },
        ],
      };
    },
    onSuccess: async (project) => {
      await queryClient.invalidateQueries({ queryKey: projectQueryKey });
      callbacks.onCreated?.(project);
    },
    onError: (error) => {
      callbacks.onFailed?.(error);
    },
  });
};
