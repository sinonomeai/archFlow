"use client";

export type ThemeMode = "dark" | "light" | "system";

const THEME_KEY = "archflow-theme";

const systemPrefersDark = (): boolean =>
  typeof window !== "undefined" &&
  window.matchMedia("(prefers-color-scheme: dark)").matches;

export const resolveDark = (mode: ThemeMode): boolean => {
  if (mode === "system") {
    return systemPrefersDark();
  }

  return mode === "dark";
};

export const applyTheme = (mode: ThemeMode): void => {
  if (typeof document === "undefined") {
    return;
  }

  const isDark = resolveDark(mode);
  document.documentElement.classList.toggle("dark", isDark);
  document.documentElement.style.colorScheme = isDark ? "dark" : "light";
};

export const getThemeMode = (): ThemeMode => {
  if (typeof window === "undefined") {
    return "dark";
  }

  const stored = window.localStorage.getItem(THEME_KEY);

  return stored === "light" || stored === "system" || stored === "dark"
    ? stored
    : "dark";
};

export const setThemeMode = (mode: ThemeMode): void => {
  if (typeof window !== "undefined") {
    window.localStorage.setItem(THEME_KEY, mode);
  }

  applyTheme(mode);
};

/** 跟随系统模式下，监听系统深浅色变化；返回取消订阅函数。 */
export const watchSystemTheme = (): (() => void) => {
  if (typeof window === "undefined") {
    return () => undefined;
  }

  const media = window.matchMedia("(prefers-color-scheme: dark)");
  const handler = (): void => {
    if (getThemeMode() === "system") {
      applyTheme("system");
    }
  };

  media.addEventListener("change", handler);

  return () => media.removeEventListener("change", handler);
};
