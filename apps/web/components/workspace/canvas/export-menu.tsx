"use client";

import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  ChevronDown,
  Download,
  FileJson,
  Image as ImageIcon,
  Loader2,
  Save,
} from "lucide-react";
import { toast } from "sonner";
import type { AssetInput, Graph } from "@arch-flow/shared";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { requestApi } from "@/lib/api-client";
import { projectQueryKey } from "@/lib/query-keys";

type ExportMenuProps = {
  projectId: string | null;
  graph: Graph | null;
  conversationTitle: string;
};

export const ExportMenu = ({
  projectId,
  graph,
  conversationTitle,
}: ExportMenuProps) => {
  const queryClient = useQueryClient();
  const [assetDialogOpen, setAssetDialogOpen] = useState(false);
  const [assetName, setAssetName] = useState("");
  const saveAsset = useMutation({
    mutationFn: async (input: AssetInput) => {
      if (!projectId) {
        throw new Error("当前会话缺少项目");
      }

      return requestApi(`/projects/${projectId}/assets`, {
        method: "POST",
        body: JSON.stringify(input),
      });
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: projectQueryKey });
      toast.success("已保存为项目资产");
    },
    onError: (error) => {
      toast.error(error.message);
    },
  });

  const openAssetDialog = () => {
    if (!graph) {
      toast.info("当前画布还没有内容");
      return;
    }

    setAssetName(conversationTitle);
    setAssetDialogOpen(true);
  };

  const handleSave = () => {
    const name = assetName.trim();

    if (!graph || !name) {
      return;
    }

    saveAsset.mutate(
      { name, graph },
      {
        onSuccess: () => setAssetDialogOpen(false),
      },
    );
  };

  const handleJson = () => {
    if (!graph) {
      return;
    }

    const blob = new Blob([JSON.stringify(graph, null, 2)], {
      type: "application/json",
    });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `${conversationTitle}.json`;
    anchor.click();
    URL.revokeObjectURL(url);
  };

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="outline" size="sm" className="group">
            <Download className="size-3.5" strokeWidth={1.75} />
            导出
            <ChevronDown
              className="size-3 text-muted-foreground transition-transform group-data-[state=open]:rotate-180"
              strokeWidth={1.75}
            />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" sideOffset={6} className="w-52">
          <DropdownMenuItem
            className="px-2.5 py-2 text-xs"
            disabled={!graph || !projectId}
            onSelect={openAssetDialog}
          >
            <Save className="size-3.5 text-muted-foreground" strokeWidth={1.75} />
            保存为项目资产
          </DropdownMenuItem>
          <DropdownMenuItem
            className="px-2.5 py-2 text-xs"
            disabled={!graph}
            onSelect={handleJson}
          >
            <FileJson className="size-3.5 text-muted-foreground" strokeWidth={1.75} />
            导出为 JSON
          </DropdownMenuItem>
          <DropdownMenuItem
            className="px-2.5 py-2 text-xs"
            onSelect={() => toast.info("PNG 导出暂未接入")}
          >
            <ImageIcon className="size-3.5 text-muted-foreground" strokeWidth={1.75} />
            导出为 PNG 图片
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <Dialog open={assetDialogOpen} onOpenChange={setAssetDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>保存为项目资产</DialogTitle>
            <DialogDescription>
              将当前画布保存为可复用的架构资产，之后可以从左侧资产库打开。
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-2">
            <label htmlFor="asset-name" className="text-xs font-medium">
              资产名称
            </label>
            <Input
              id="asset-name"
              value={assetName}
              maxLength={50}
              autoFocus
              placeholder="例如：方案 A：模块化单体"
              onChange={(event) => setAssetName(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  handleSave();
                }
              }}
            />
            <p className="text-[10px] text-muted-foreground">
              最多 50 个字符，项目内允许重名。
            </p>
          </div>

          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setAssetDialogOpen(false)}
              disabled={saveAsset.isPending}
            >
              取消
            </Button>
            <Button
              onClick={handleSave}
              disabled={!assetName.trim() || saveAsset.isPending}
            >
              {saveAsset.isPending ? (
                <Loader2 className="size-3.5 animate-spin" strokeWidth={1.75} />
              ) : (
                <Save className="size-3.5" strokeWidth={1.75} />
              )}
              保存
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
};
