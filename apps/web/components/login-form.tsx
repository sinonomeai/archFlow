"use client";

import { useState } from "react";
import type { FormEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowRight, Eye, EyeOff, Loader2, Lock, Mail, User } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { loginRequest, registerRequest } from "@/lib/auth";
import { setSessionHint } from "@/lib/session";

type FormMode = "login" | "register";

export const LoginForm = () => {
  const router = useRouter();
  const [mode, setMode] = useState<FormMode>("login");
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const isRegister = mode === "register";

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const email = String(form.get("email") ?? "");
    const password = String(form.get("password") ?? "");
    const username = String(form.get("username") ?? "");
    const confirmPassword = String(form.get("confirmPassword") ?? "");

    if (isRegister && password !== confirmPassword) {
      setError("两次输入的密码不一致");
      return;
    }

    setPending(true);
    setError(null);

    try {
      if (isRegister) {
        await registerRequest({ username, email, password });
      } else {
        await loginRequest({ email, password });
      }

      setSessionHint();
      router.replace("/workspace");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "请求失败，请稍后重试");
    } finally {
      setPending(false);
    }
  };

  const toggleMode = () => {
    setMode((current) => (current === "login" ? "register" : "login"));
    setError(null);
  };

  return (
    <div className="w-full max-w-[360px]">
      <div className="rounded-xl border border-border bg-transparent p-7">
        <div className="space-y-1.5">
          <h1 className="text-2xl font-semibold tracking-tight">
            {isRegister ? "创建账号" : "登录 ArchFlow"}
          </h1>
          <p className="text-sm text-muted-foreground">
            {isRegister
              ? "从一个想法开始，构建你的第一版架构。"
              : "继续你的架构设计"}
          </p>
        </div>

        <form onSubmit={handleSubmit} className="mt-7 space-y-4">
          {isRegister && (
            <div className="space-y-2">
              <label htmlFor="username" className="text-xs font-medium">
                用户名
              </label>
              <div className="relative">
                <User
                  className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
                  strokeWidth={1.75}
                />
                <Input
                  id="username"
                  name="username"
                  type="text"
                  autoComplete="username"
                  placeholder="你的用户名"
                  minLength={1}
                  maxLength={15}
                  className="pl-9"
                  required
                />
              </div>
            </div>
          )}

          <div className="space-y-2">
            <label htmlFor="email" className="text-xs font-medium">
              邮箱
            </label>
            <div className="relative">
              <Mail
                className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
                strokeWidth={1.75}
              />
              <Input
                id="email"
                name="email"
                type="email"
                autoComplete="email"
                placeholder="name@company.com"
                className="pl-9"
                required
              />
            </div>
          </div>

          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <label htmlFor="password" className="text-xs font-medium">
                密码
              </label>
              {!isRegister && (
                <Link
                  href="#"
                  className="text-[11px] text-muted-foreground transition-colors hover:text-foreground"
                >
                  忘记密码？
                </Link>
              )}
            </div>
            <div className="relative">
              <Lock
                className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
                strokeWidth={1.75}
              />
              <Input
                id="password"
                name="password"
                type={showPassword ? "text" : "password"}
                autoComplete={isRegister ? "new-password" : "current-password"}
                placeholder="输入密码"
                minLength={6}
                maxLength={16}
                className="pl-9 pr-10"
                required
              />
              <button
                type="button"
                onClick={() => setShowPassword((value) => !value)}
                aria-label={showPassword ? "隐藏密码" : "显示密码"}
                className="absolute right-2 top-1/2 flex size-7 -translate-y-1/2 items-center justify-center rounded text-muted-foreground transition-colors hover:text-foreground"
              >
                {showPassword ? (
                  <EyeOff className="size-4" strokeWidth={1.75} />
                ) : (
                  <Eye className="size-4" strokeWidth={1.75} />
                )}
              </button>
            </div>
          </div>

          {isRegister && (
            <div className="space-y-2">
              <label htmlFor="confirm-password" className="text-xs font-medium">
                确认密码
              </label>
              <div className="relative">
                <Lock
                  className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
                  strokeWidth={1.75}
                />
                <Input
                  id="confirm-password"
                  name="confirmPassword"
                  type={showConfirmPassword ? "text" : "password"}
                  autoComplete="new-password"
                  placeholder="再次输入密码"
                  minLength={6}
                  maxLength={16}
                  className="pl-9 pr-10"
                  required
                />
                <button
                  type="button"
                  onClick={() => setShowConfirmPassword((value) => !value)}
                  aria-label={
                    showConfirmPassword ? "隐藏确认密码" : "显示确认密码"
                  }
                  className="absolute right-2 top-1/2 flex size-7 -translate-y-1/2 items-center justify-center rounded text-muted-foreground transition-colors hover:text-foreground"
                >
                  {showConfirmPassword ? (
                    <EyeOff className="size-4" strokeWidth={1.75} />
                  ) : (
                    <Eye className="size-4" strokeWidth={1.75} />
                  )}
                </button>
              </div>
            </div>
          )}

          {error && (
            <p className="rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-[11px] leading-5 text-destructive">
              {error}
            </p>
          )}

          <Button
            type="submit"
            size="lg"
            className="mt-1 w-full"
            disabled={pending}
          >
            {pending ? (
              <Loader2 className="size-4 animate-spin" strokeWidth={1.75} />
            ) : (
              <ArrowRight className="size-4" strokeWidth={1.75} />
            )}
            {isRegister ? "创建账号" : "登录"}
          </Button>
        </form>

        <p className="mt-6 text-center text-xs text-muted-foreground">
          {isRegister ? "已有账号？" : "还没有账号？"}{" "}
          <button
            type="button"
            onClick={toggleMode}
            className="font-medium text-foreground underline-offset-4 hover:underline"
          >
            {isRegister ? "登录" : "注册"}
          </button>
        </p>
      </div>
    </div>
  );
};
