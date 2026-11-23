import { LoginForm } from "@/components/login-form";
import { BrandMark } from "@/components/logo";
import { ThemeToggle } from "@/components/theme-toggle";
import { LoginForm as PreviewLoginForm } from "@/preview/components/login-form";

export const dynamic = "force-dynamic";

const LoginPage = () => (
  <main className="grid min-h-dvh bg-background lg:grid-cols-2">
    <section className="relative hidden overflow-hidden border-r border-border bg-secondary dark:bg-background lg:flex">
      <div className="brand-dots pointer-events-none absolute inset-0" />

      <div className="relative mx-auto flex w-full max-w-xl flex-col justify-center px-12 xl:px-16">
        <div className="mb-10 flex items-center gap-2.5">
          <BrandMark />
          <span className="text-sm font-semibold tracking-tight text-foreground">
            ArchFlow
          </span>
        </div>

        <div className="border-l border-foreground/25 pl-6">
          <h2 className="text-balance text-4xl font-semibold leading-[1.18] tracking-tight text-foreground xl:text-[46px]">
            把模糊的项目 idea，
            <br />
            转化为可解释的架构决策。
          </h2>
        </div>

        <p className="mt-7 max-w-md text-sm leading-7 text-muted-foreground">
          与 AI 一起梳理约束、权衡方案，并构建真正适合团队的技术架构。
        </p>
      </div>

      <div className="absolute bottom-8 left-12 flex items-center gap-3 text-[10px] uppercase tracking-[0.2em] text-muted-foreground/60">
        <span>Constraint-driven</span>
        <span className="h-px w-8 bg-foreground/20" />
        <span>Architecture decisions</span>
      </div>
    </section>

    <section className="relative flex min-h-dvh items-center justify-center px-6 py-16">
      <ThemeToggle className="absolute right-6 top-6" />
      {process.env.MOCK_API === "1" ? <PreviewLoginForm /> : <LoginForm />}
    </section>
  </main>
);

export default LoginPage;
