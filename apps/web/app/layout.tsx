import type { Metadata } from "next";
import type { ReactNode } from "react";
import { Toaster } from "@/components/ui/sonner";
import { harmonySans } from "./fonts";
import { Providers } from "./providers";
import "./globals.css";

export const metadata: Metadata = {
  title: "ArchFlow · 架构决策助手",
  description: "约束驱动的 AI 架构决策助手",
};

const themeScript = `(() => {
  try {
    const stored = window.localStorage.getItem("archflow-theme");
    const isDark =
      stored === "light"
        ? false
        : stored === "system"
          ? window.matchMedia("(prefers-color-scheme: dark)").matches
          : true;
    document.documentElement.classList.toggle("dark", isDark);
    document.documentElement.style.colorScheme = isDark ? "dark" : "light";
  } catch {
    document.documentElement.classList.add("dark");
  }
})();`;

const RootLayout = ({ children }: { children: ReactNode }) => (
  <html
    lang="zh-CN"
    className={`dark ${harmonySans.variable}`}
    suppressHydrationWarning
  >
    <head>
      <script dangerouslySetInnerHTML={{ __html: themeScript }} />
    </head>
    <body className="min-h-dvh bg-background text-foreground antialiased">
      <Providers>
        {children}
        <Toaster position="bottom-right" offset={{ bottom: 24, right: 24 }} />
      </Providers>
    </body>
  </html>
);

export default RootLayout;
