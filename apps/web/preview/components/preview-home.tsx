"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { BrandMark } from "@/components/logo";
import { ThemeToggle } from "@/components/theme-toggle";
import { Button } from "@/components/ui/button";
import { useProjects } from "@/preview/hooks/use-projects";
import { CreateProjectButton } from "./create-project-button";
import { SessionGate } from "./session-gate";

const ProjectHome = () => {
  const router = useRouter();
  const projects = useProjects();
  const firstProject = projects.data?.items[0];
  const conversationId = firstProject?.lastActiveConversationId;

  useEffect(() => {
    if (!firstProject) return;
    router.replace(conversationId ? `/workspace?conversationId=${encodeURIComponent(conversationId)}` : "/workspace");
  }, [conversationId, firstProject, router]);

  if (projects.isPending || firstProject) {
    return <main className="grid min-h-dvh place-content-center text-sm text-muted-foreground" role="status">正在加载项目…</main>;
  }

  if (projects.isError) {
    return (
      <main className="grid min-h-dvh place-content-center justify-items-center gap-4" role="alert">
        <p className="text-sm text-muted-foreground">项目加载失败</p>
        <Button variant="outline" onClick={() => void projects.refetch()}>重试</Button>
      </main>
    );
  }

  return (
    <main className="dot-grid mask-fade relative flex min-h-dvh items-center justify-center overflow-hidden bg-background px-6">
      <ThemeToggle className="absolute right-6 top-6" />
      <div className="relative flex w-full max-w-lg flex-col items-center text-center">
        <BrandMark className="size-12" />
        <h1 className="mt-8 text-4xl font-semibold tracking-tight">欢迎来到 ArchFlow</h1>
        <p className="mt-4 text-balance text-sm leading-7 text-muted-foreground">从一句模糊的 Idea 开始，让 AI 帮你推演并画出可落地的系统架构。</p>
        <CreateProjectButton label="创建你的第一个项目" size="lg" className="mt-9 h-11 px-6" showPendingState={false} />
      </div>
    </main>
  );
};

export const PreviewHome = () => <SessionGate><ProjectHome /></SessionGate>;
