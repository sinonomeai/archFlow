"use client";

import { useProjects } from "@/preview/hooks/use-projects";
import { Button } from "@/components/ui/button";
import { ProjectGroup } from "./project-group";

export const ProjectList = () => {
  const projects = useProjects();
  const items = projects.data?.items ?? [];

  if (projects.isPending) return <p className="px-3 text-xs text-muted-foreground" role="status">正在加载项目…</p>;

  if (projects.isError) {
    return (
      <div className="flex items-center justify-between gap-2 px-3" role="alert">
        <p className="text-xs text-muted-foreground">项目加载失败</p>
        <Button variant="ghost" size="sm" onClick={() => void projects.refetch()}>重试</Button>
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
