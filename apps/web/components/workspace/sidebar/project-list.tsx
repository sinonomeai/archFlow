"use client";

import { Loader2 } from "lucide-react";
import { useProjects } from "@/hooks/use-projects";
import { ProjectGroup } from "./project-group";

export const ProjectList = () => {
  const projects = useProjects();
  const items = projects.data?.items ?? [];

  if (projects.isPending) {
    return (
      <div className="mx-1 flex items-center gap-2 rounded-lg border border-dashed border-border px-3 py-4 text-[11px] text-muted-foreground">
        <Loader2 className="size-3.5 animate-spin" strokeWidth={1.75} />
        正在加载项目…
      </div>
    );
  }

  if (projects.isError) {
    return (
      <div className="mx-1 rounded-lg border border-dashed border-border px-3 py-4">
        <p className="text-xs font-medium">项目加载失败</p>
        <p className="mt-1 text-[11px] leading-5 text-muted-foreground">
          {projects.error.message}
        </p>
      </div>
    );
  }

  if (items.length === 0) {
    return (
      <div className="mx-1 rounded-lg border border-dashed border-border px-3 py-4">
        <p className="text-xs font-medium">还没有项目</p>
        <p className="mt-1 text-[11px] leading-5 text-muted-foreground">
          点击上方“新建项目”，开始描述你的架构约束。
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {items.map((project) => (
        <ProjectGroup key={project.id} project={project} />
      ))}
    </div>
  );
};
