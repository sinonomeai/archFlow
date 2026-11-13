"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import type { FileBrief, Page, ProjectNode } from "@arch-flow/shared";
import { requestApi } from "@/lib/api-client";
import { projectQueryKey } from "@/lib/query-keys";

type UploadFileVariables = {
  projectId: string;
  file: File;
};

export const useUploadFile = () => {
  const queryClient = useQueryClient();

  return useMutation<FileBrief, Error, UploadFileVariables>({
    mutationFn: async ({ projectId, file }) => {
      const body = new FormData();
      body.append("file", file);

      return requestApi<FileBrief>(`/projects/${projectId}/files`, {
        method: "POST",
        body,
      });
    },
    onSuccess: (file, { projectId }) => {
      queryClient.setQueryData<Page<ProjectNode>>(projectQueryKey, (current) =>
        current
          ? {
              ...current,
              items: current.items.map((project) =>
                project.id === projectId
                  ? {
                      ...project,
                      files: [file, ...project.files].slice(0, 20),
                    }
                  : project,
              ),
            }
          : current,
      );

      toast.success(`已上传文档“${file.fileName}”`);
    },
    onError: (error) => {
      toast.error(error.message);
    },
  });
};
