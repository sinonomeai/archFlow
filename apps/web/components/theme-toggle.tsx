"use client";

import { Moon, Sun } from "lucide-react";
import { setThemeMode } from "@/lib/theme";
import { cn } from "@/lib/utils";

export type ThemeToggleProps = {
  className?: string;
};

export const ThemeToggle = ({ className }: ThemeToggleProps) => {
  const handleToggle = () => {
    const isDark = document.documentElement.classList.contains("dark");
    setThemeMode(isDark ? "light" : "dark");
  };

  return (
    <button
      type="button"
      onClick={handleToggle}
      aria-label="切换主题"
      className={cn(
        "flex size-9 items-center justify-center rounded-md border border-border text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground",
        className,
      )}
    >
      <Sun className="hidden size-4 dark:block" strokeWidth={1.75} />
      <Moon className="size-4 dark:hidden" strokeWidth={1.75} />
    </button>
  );
};
