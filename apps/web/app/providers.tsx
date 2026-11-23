"use client";

import { useEffect, useState, type ReactNode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { TooltipProvider } from "@/components/ui/tooltip";
import { bootstrapSession } from "@/lib/auth";
import { watchSystemTheme } from "@/lib/theme";
import {
  connectAuthTabs,
  getAuthState,
  restoreSession,
  subscribeToAuthState,
} from "@/preview/lib/api-client";

export const Providers = ({ children, preview }: { children: ReactNode; preview: boolean }) => {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            staleTime: 30_000,
            refetchOnWindowFocus: false,
            retry: 1,
          },
        },
      }),
  );

  useEffect(() => {
    if (!preview) {
      void bootstrapSession();
      return;
    }

    let userId = getAuthState().user?.id;
    const unsubscribe = subscribeToAuthState(() => {
      const nextUserId = getAuthState().user?.id;
      if (nextUserId !== userId) queryClient.clear();
      userId = nextUserId;
    });
    const disconnect = connectAuthTabs();
    if (getAuthState().status === "checking") void restoreSession();
    return () => {
      unsubscribe();
      disconnect?.();
    };
  }, [preview, queryClient]);

  useEffect(() => watchSystemTheme(), []);

  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider delayDuration={200}>{children}</TooltipProvider>
    </QueryClientProvider>
  );
};
