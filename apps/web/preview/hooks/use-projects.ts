"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type {
  CreateProjectInput,
  Page,
  ProjectNode,
} from "@arch-flow/shared";
import { requestApi } from "@/preview/lib/api-client";
import { projectQueryKey } from "@/preview/lib/query-keys";

export const DEFAULT_PROJECT_NAME = "新架构项目";

type CreateProjectCallbacks = {
  onCreated?: (project: ProjectNode) => void;
  onFailed?: (error: Error) => void;
};

export const useProjects = () =>
  useQuery({
    queryKey: projectQueryKey,
    queryFn: async ({ signal }) => requestApi<Page<ProjectNode>>("/api/mock/projects", { signal }),
  });

/**
 * 创建项目。导航、提示等收尾动作通过 options 级回调注入，
 * 这样即使触发创建的组件已卸载（例如首页跳转到工作台），回调仍会执行。
 */
export const useCreateProject = (callbacks: CreateProjectCallbacks = {}) => {
  const queryClient = useQueryClient();

  return useMutation<ProjectNode, Error, CreateProjectInput>({
    mutationFn: async (input) =>
      requestApi<ProjectNode>("/api/mock/projects", {
        method: "POST",
        headers: { "Idempotency-Key": crypto.randomUUID() },
        body: JSON.stringify(input),
      }),
    onError: (error) => callbacks.onFailed?.(error),
    onSuccess: (project) => {
      queryClient.setQueryData<Page<ProjectNode>>(projectQueryKey, (current) => ({
        items: [project, ...(current?.items.filter((item) => item.id !== project.id) ?? [])],
        nextCursor: current?.nextCursor ?? null,
        hasMore: current?.hasMore ?? false,
      }));
      callbacks.onCreated?.(project);
    },
  });
};
