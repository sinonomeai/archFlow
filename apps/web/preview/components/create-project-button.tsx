"use client";

import { usePathname, useRouter } from "next/navigation";
import { Loader2, Plus } from "lucide-react";
import { toast } from "sonner";
import { Button, type ButtonProps } from "@/components/ui/button";
import {
  DEFAULT_PROJECT_NAME,
  useCreateProject,
} from "@/preview/hooks/use-projects";

type CreateProjectButtonProps = {
  label?: string;
  className?: string;
  size?: ButtonProps["size"];
  variant?: ButtonProps["variant"];
  /** 是否在请求期间切换为“正在创建…”。首页引导按钮不需要。 */
  showPendingState?: boolean;
};

export const CreateProjectButton = ({
  label = "新建项目",
  className,
  size = "default",
  variant = "default",
  showPendingState = true,
}: CreateProjectButtonProps) => {
  const router = useRouter();
  const pathname = usePathname();
  const origin = pathname;

  /**
   * 收尾回调放在 mutation options 层：
   * 首页点击后会立刻跳转、按钮随之卸载，逐次 mutate 的回调不再可靠。
   */
  const createProject = useCreateProject({
    onCreated: (project) => {
      const conversationId = project.lastActiveConversationId;

      toast.success("项目已创建");
      router.replace(
        conversationId
          ? `/workspace?conversationId=${conversationId}`
          : "/workspace",
      );
    },
    onFailed: (error) => {
      toast.error(error.message);

      if (origin !== "/workspace") {
        router.push(origin);
      }
    },
  });

  const handleCreate = () => {
    createProject.mutate({ name: DEFAULT_PROJECT_NAME });
  };

  return (
    <Button
      variant={variant}
      size={size}
      className={className}
      onClick={handleCreate}
      disabled={createProject.isPending}
    >
      {showPendingState && createProject.isPending ? (
        <Loader2 className="size-4 animate-spin" strokeWidth={1.75} />
      ) : (
        <Plus className="size-4" strokeWidth={2} />
      )}
      {showPendingState && createProject.isPending ? "正在创建…" : label}
    </Button>
  );
};
