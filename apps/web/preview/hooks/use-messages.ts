"use client";

import { useQuery } from "@tanstack/react-query";
import { useLayoutEffect, useRef, useState } from "react";
import type { Message, Page } from "@arch-flow/shared";
import { requestApi } from "@/preview/lib/api-client";
import { messagesQueryKey } from "@/preview/lib/query-keys";

type MessageHistory = {
  conversationId: string;
  latestPage: Page<Message>;
  items: Message[];
  nextCursor: string | null;
  status: "loading" | "loaded" | "error";
};

const getMessagePage = (
  conversationId: string,
  signal: AbortSignal,
  cursor?: string,
) => {
  const params = new URLSearchParams({ limit: "50", direction: "backward" });
  if (cursor) params.set("cursor", cursor);
  return requestApi<Page<Message>>(
    `/api/mock/conversations/${conversationId}/messages?${params}`,
    { signal },
  );
};

export const mergeMessageHistory = (older: Message[], newer: Message[]) => {
  const newerIds = new Set(newer.map(({ id }) => id));
  return [...older.filter(({ id }) => !newerIds.has(id)), ...newer];
};

export const useMessages = (conversationId: string | null) => {
  const latest = useQuery({
    queryKey: messagesQueryKey(conversationId ?? "none"),
    queryFn: ({ signal }) => {
      if (!conversationId) {
        throw new Error("缺少 conversationId");
      }

      return getMessagePage(conversationId, signal);
    },
    enabled: conversationId !== null,
  });
  const [history, setHistory] = useState<MessageHistory>();
  const requestRef = useRef<AbortController | null>(null);
  const current =
    history?.conversationId === conversationId ? history : undefined;
  const latestPage = latest.data;
  const messages = current?.items ?? latestPage?.items ?? [];
  const nextCursor = current ? current.nextCursor : latestPage?.nextCursor;

  if (history && !current) {
    setHistory(undefined);
  } else if (current && latestPage && current.latestPage !== latestPage) {
    setHistory({
      ...current,
      latestPage,
      items: mergeMessageHistory(current.items, latestPage.items),
    });
  }

  useLayoutEffect(
    () => () => {
      requestRef.current?.abort();
      requestRef.current = null;
    },
    [conversationId],
  );

  const loadEarlier = async (beforePrepend: () => void) => {
    if (!conversationId || !latestPage || !nextCursor || requestRef.current)
      return;

    const controller = new AbortController();
    requestRef.current = controller;
    setHistory({
      conversationId,
      latestPage,
      items: messages,
      nextCursor,
      status: "loading",
    });

    try {
      const page = await getMessagePage(
        conversationId,
        controller.signal,
        nextCursor,
      );
      if (controller.signal.aborted) return;

      beforePrepend();
      setHistory((previous) =>
        previous?.conversationId === conversationId
          ? {
              ...previous,
              items: mergeMessageHistory(page.items, previous.items),
              nextCursor: page.nextCursor,
              status: "loaded",
            }
          : previous,
      );
    } catch {
      if (!controller.signal.aborted) {
        setHistory((previous) =>
          previous?.conversationId === conversationId
            ? { ...previous, status: "error" }
            : previous,
        );
      }
    } finally {
      if (requestRef.current === controller) requestRef.current = null;
    }
  };

  return {
    latest,
    messages,
    canLoadEarlier: Boolean(nextCursor),
    historyStatus: current?.status,
    loadEarlier,
  };
};
