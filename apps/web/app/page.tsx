import { BrandMark } from "@/components/logo";
import { CreateProjectButton } from "@/components/project/create-project-button";
import { ThemeToggle } from "@/components/theme-toggle";
import { PreviewHome } from "@/preview/components/preview-home";

export const dynamic = "force-dynamic";

const HomePage = () => {
  if (process.env.MOCK_API === "1") return <PreviewHome />;
  return (
    <main className="dot-grid mask-fade relative flex min-h-dvh items-center justify-center overflow-hidden bg-background px-6">
      <ThemeToggle className="absolute right-6 top-6" />

      <div className="relative flex w-full max-w-lg flex-col items-center text-center">
        <BrandMark className="size-12" />
        <h1 className="mt-8 text-4xl font-semibold tracking-tight">
          欢迎来到 ArchFlow
        </h1>
        <p className="mt-4 text-balance text-sm leading-7 text-muted-foreground">
          从一句模糊的 Idea 开始，让 AI 帮你推演并画出可落地的系统架构。
        </p>
        <CreateProjectButton
          label="创建你的第一个项目"
          size="lg"
          className="mt-9 h-11 px-6"
          showPendingState={false}
        />
        <p className="mt-5 text-[11px] text-muted-foreground">
          无需配置 · 从对话开始 · 随时导出
        </p>
      </div>

      <p className="absolute bottom-6 text-[10px] uppercase tracking-[0.2em] text-muted-foreground/60">
        ArchFlow · Constraint-driven architecture
      </p>
    </main>
  );
};

export default HomePage;
