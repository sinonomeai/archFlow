"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import {
  Check,
  Languages,
  LogOut,
  Monitor,
  Moon,
  Settings2,
  Sun,
  UserRound,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { logoutRequest } from "@/lib/auth";
import { useAuthStore } from "@/lib/auth-store";
import { clearSessionHint } from "@/lib/session";
import { getThemeMode, setThemeMode, type ThemeMode } from "@/lib/theme";
import { cn } from "@/lib/utils";

type SettingsTab = "general" | "account";

const TABS: Array<{
  value: SettingsTab;
  label: string;
  icon: typeof Settings2;
}> = [
  { value: "general", label: "通用设置", icon: Settings2 },
  { value: "account", label: "账号管理", icon: UserRound },
];

const THEMES: Array<{
  value: ThemeMode;
  label: string;
  description: string;
  icon: typeof Sun;
}> = [
  { value: "dark", label: "深色", description: "适合弱光环境", icon: Moon },
  { value: "light", label: "浅色", description: "适合明亮环境", icon: Sun },
  {
    value: "system",
    label: "跟随系统",
    description: "随系统外观自动切换",
    icon: Monitor,
  },
];

const SectionTitle = ({
  title,
  description,
}: {
  title: string;
  description: string;
}) => (
  <div>
    <h3 className="text-sm font-medium">{title}</h3>
    <p className="mt-1 text-[11px] leading-5 text-muted-foreground">
      {description}
    </p>
  </div>
);

const GeneralSettings = () => {
  const [theme, setTheme] = useState<ThemeMode>("dark");

  useEffect(() => {
    setTheme(getThemeMode());
  }, []);

  const chooseTheme = (next: ThemeMode) => {
    setThemeMode(next);
    setTheme(next);
  };

  return (
    <div className="space-y-7">
      <section className="space-y-3">
        <SectionTitle
          title="主题设置"
          description="选择界面外观；跟随系统会随操作系统的深浅色自动切换。"
        />

        <div className="grid gap-2">
          {THEMES.map(({ value, label, description, icon: Icon }) => {
            const active = theme === value;

            return (
              <button
                key={value}
                type="button"
                onClick={() => chooseTheme(value)}
                className={cn(
                  "flex items-center gap-3 rounded-lg border px-3.5 py-3 text-left transition-colors",
                  active
                    ? "border-foreground/25 bg-secondary"
                    : "border-border hover:bg-secondary/60",
                )}
              >
                <span className="flex size-8 shrink-0 items-center justify-center rounded-md border border-border bg-background">
                  <Icon className="size-4" strokeWidth={1.75} />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-[12px] font-medium">{label}</span>
                  <span className="mt-0.5 block text-[10px] text-muted-foreground">
                    {description}
                  </span>
                </span>
                {active && (
                  <Check className="size-4 shrink-0" strokeWidth={2} />
                )}
              </button>
            );
          })}
        </div>
      </section>

      <section className="space-y-3">
        <SectionTitle
          title="语言"
          description="界面语言切换暂未开放，当前固定为简体中文。"
        />
        <Button variant="outline" className="w-full justify-between" disabled>
          <span className="flex items-center gap-2">
            <Languages className="size-3.5" strokeWidth={1.75} />
            简体中文
          </span>
          <span className="text-[10px] text-muted-foreground">即将支持</span>
        </Button>
      </section>
    </div>
  );
};

const AccountSettings = () => {
  const router = useRouter();
  const user = useAuthStore((state) => state.user);

  const handleLogout = async () => {
    await logoutRequest();
    clearSessionHint();
    router.replace("/login");
  };

  return (
    <div className="space-y-6">
      <SectionTitle
        title="账号管理"
        description="当前登录账号与基础信息。"
      />

      <div className="flex items-center gap-3 rounded-lg border border-border bg-card px-4 py-4">
        <div className="flex size-10 shrink-0 items-center justify-center rounded-full bg-secondary text-xs font-medium">
          {user?.username.slice(0, 2).toUpperCase() || "AF"}
        </div>
        <div className="min-w-0">
          <p className="truncate text-sm font-medium">
            {user?.username ?? "未登录"}
          </p>
          <p className="mt-0.5 truncate text-[11px] text-muted-foreground">
            {user?.email ?? "—"}
          </p>
        </div>
      </div>

      <Button
        variant="outline"
        className="w-full justify-start text-muted-foreground"
        onClick={() => {
          void handleLogout();
        }}
      >
        <LogOut className="size-3.5" strokeWidth={1.75} />
        退出登录
      </Button>
    </div>
  );
};

type SettingsDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

export const SettingsDialog = ({ open, onOpenChange }: SettingsDialogProps) => {
  const [tab, setTab] = useState<SettingsTab>("general");

  useEffect(() => {
    if (open) {
      setTab("general");
    }
  }, [open]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="overflow-hidden p-0 sm:max-w-2xl">
        <DialogHeader className="border-b border-border px-6 py-4">
          <DialogTitle>系统设置</DialogTitle>
          <DialogDescription>管理外观、登录账号与偏好。</DialogDescription>
        </DialogHeader>

        <div className="flex min-h-[340px]">
          <nav className="w-44 shrink-0 border-r border-border bg-secondary/30 p-2">
            <div className="space-y-1">
              {TABS.map(({ value, label, icon: Icon }) => {
                const active = tab === value;

                return (
                  <button
                    key={value}
                    type="button"
                    onClick={() => setTab(value)}
                    className={cn(
                      "flex w-full items-center gap-2 rounded-md px-2.5 py-2 text-left text-[12px] transition-colors",
                      active
                        ? "bg-secondary font-medium text-foreground"
                        : "text-muted-foreground hover:bg-secondary/60 hover:text-foreground",
                    )}
                  >
                    <Icon className="size-3.5 shrink-0" strokeWidth={1.75} />
                    {label}
                  </button>
                );
              })}
            </div>
          </nav>

          <div className="min-w-0 flex-1 overflow-y-auto p-6">
            {tab === "general" ? <GeneralSettings /> : <AccountSettings />}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
};
