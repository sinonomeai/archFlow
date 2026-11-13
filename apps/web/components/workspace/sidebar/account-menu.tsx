"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { LogOut, Settings, Settings2 } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { logoutRequest } from "@/lib/auth";
import { clearSessionHint } from "@/lib/session";
import { SettingsDialog } from "./settings-dialog";

export const AccountMenu = () => {
  const router = useRouter();
  const [settingsOpen, setSettingsOpen] = useState(false);

  const handleLogout = async () => {
    await logoutRequest();
    clearSessionHint();
    router.replace("/login");
  };

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            aria-label="设置"
            className="flex size-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
          >
            <Settings className="size-3.5" strokeWidth={1.75} />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent
          side="top"
          align="end"
          sideOffset={6}
          className="w-40"
        >
          <DropdownMenuItem
            className="text-xs"
            onSelect={() => setSettingsOpen(true)}
          >
            <Settings2 className="size-3.5" strokeWidth={1.75} />
            系统设置
          </DropdownMenuItem>
          <DropdownMenuItem
            className="text-xs"
            onSelect={() => {
              void handleLogout();
            }}
          >
            <LogOut className="size-3.5" strokeWidth={1.75} />
            退出登录
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <SettingsDialog open={settingsOpen} onOpenChange={setSettingsOpen} />
    </>
  );
};
