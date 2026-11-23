"use client";

import { Fragment, useEffect, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/preview/hooks/use-auth";
import { restoreSession } from "@/preview/lib/api-client";

export const SessionGate = ({ children }: { children: ReactNode }) => {
  const auth = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (auth.status === "anonymous") router.replace("/login");
  }, [auth.status, router]);

  if (auth.status === "authenticated") return <Fragment key={auth.user.id}>{children}</Fragment>;

  return (
    <main className="grid min-h-dvh place-content-center px-6 text-center">
      {auth.status === "unavailable" ? (
        <div className="flex flex-col items-center gap-4" role="alert">
          <p className="text-sm text-muted-foreground">{auth.message}</p>
          <Button variant="outline" onClick={() => void restoreSession()}>重试</Button>
        </div>
      ) : (
        <p className="text-sm text-muted-foreground" role="status">正在检查会话…</p>
      )}
    </main>
  );
};
